/**
 * services/tarifaService.js
 * -----------------------------------------------------------------
 * Lectura e importacion masiva de tarifas de flete desde planillas.
 *
 * Formatos aceptados: .xlsx y .csv (misma interfaz, misma validacion).
 * La planilla se interpreta como una tabla donde cada fila es una ruta:
 *
 *   puerto_origen | puerto_destino | tipo_contenedor | precio_usd | dias_viaje_base | capacidad_max_tn
 *   CNSHA         | CLVAP          | 40HC            | 2450       | 32              | 25
 *
 * La importacion es idempotente: correrla dos veces actualiza las rutas
 * existentes en vez de duplicarlas.
 */

import * as XLSX from 'xlsx';
import * as puertoModel from '../models/puertoModel.js';
import * as tarifaModel from '../models/tarifaModel.js';
import { enTransaccion } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import {
  TIPO_CONTENEDOR_DEFAULT,
  MAX_TONELADAS_POR_CONTENEDOR,
} from '../utils/constantes.js';

/** Nombres de columna aceptados, con alias tolerados a mayusculas/espacios. */
const COLUMNAS = {
  origen: ['puerto_origen', 'origen', 'puerto origen', 'puerto_de_origen', 'origen_codigo'],
  destino: ['puerto_destino', 'destino', 'puerto destino', 'puerto_de_destino', 'destino_codigo'],
  tipo: ['tipo_contenedor', 'contenedor', 'tipo', 'tipo de contenedor'],
  precio: ['precio_usd', 'precio', 'valor_usd', 'tarifa', 'flete_usd'],
  dias: ['dias_viaje_base', 'dias_viaje', 'dias', 'transito_dias', 'dias_transito'],
  capacidad: ['capacidad_max_tn', 'capacidad', 'max_tn', 'capacidad_toneladas'],
};

/** Normaliza un encabezado: minusculas, sin acentos, sin espacios extra. */
function normalizarEncabezado(valor) {
  return String(valor ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Convierte una hoja a una matriz de objetos usando COLUMNAS como mapa.
 *
 * @param {import('xlsx').WorkSheet} hoja
 * @returns {{filas:object[], encabezados:string[]}}
 */
function hojaAMatrix(hoja) {
  const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: true });
  if (!matriz.length) return { filas: [], encabezados: [] };

  const mapaEncabezado = new Map();
  const encabezados = matriz[0];

  encabezados.forEach((encabezado, indice) => {
    const normalizado = normalizarEncabezado(encabezado);
    for (const [campo, alias] of Object.entries(COLUMNAS)) {
      if (alias.includes(normalizado)) {
        mapaEncabezado.set(campo, indice);
        break;
      }
    }
  });

  if (!mapaEncabezado.has('origen') || !mapaEncabezado.has('destino') || !mapaEncabezado.has('precio')) {
    throw ApiError.badRequest(
      'La planilla no tiene los encabezados requeridos. Se esperan las columnas: ' +
        'puerto_origen, puerto_destino, precio_usd (opcionales: tipo_contenedor, dias_viaje_base, capacidad_max_tn).',
      { codigo: 'PLANILLA_ENCABEZADOS_INVALIDOS' },
    );
  }

  // Descarta filas totalmente vacias (típico en archivos exportados desde Excel).
  const filas = matriz.slice(1).filter((fila) => fila.some((celda) => String(celda).trim() !== ''));

  return {
    encabezados: [...mapaEncabezado.keys()],
    filas: filas.map((fila) => {
      const leer = (campo) =>
        mapaEncabezado.has(campo) ? fila[mapaEncabezado.get(campo)] : undefined;

      return {
        origen: String(leer('origen') ?? '').trim(),
        destino: String(leer('destino') ?? '').trim(),
        tipo: String(leer('tipo') ?? TIPO_CONTENEDOR_DEFAULT).trim().toUpperCase(),
        precio: Number(leer('precio')),
        dias: leer('dias') === undefined || Number(leer('dias')) === 0 ? null : Number(leer('dias')),
        capacidad:
          leer('capacidad') === undefined || Number(leer('capacidad')) === 0
            ? MAX_TONELADAS_POR_CONTENEDOR
            : Number(leer('capacidad')),
      };
    }),
  };
}

/**
 * Crea un resolvedor de puertos a partir de una sola carga del catalogo.
 *
 * Antes se consultaba la tabla `puertos` dos veces por cada fila de la
 * planilla (buscarPorCodigo y luego listar para comparar por nombre). Con 27
 * filas eso son 54 idas y vueltas a la base de una sola vez. Ahora el catalogo
 * se lee una vez, se indexa en memoria y cada fila resuelve sin tocar la base.
 *
 * El catalogo no cambia durante la importacion, asi que la instantanea es
 * consistente con lo que se esta escribiendo.
 *
 * @param {object[]} puertos
 * @returns {(texto:string) => object|null}
 */
function crearIndicePuertos(puertos) {
  const porCodigo = new Map(puertos.map((p) => [p.codigo.toUpperCase(), p]));

  return function resolverPuerto(texto) {
    const limpio = normalizarEncabezado(texto);
    if (!limpio) return null;

    const porCodigoExacto = porCodigo.get(limpio.toUpperCase());
    if (porCodigoExacto) return porCodigoExacto;

    return (
      puertos.find((p) => normalizarEncabezado(p.nombre) === limpio) ??
      puertos.find((p) => normalizarEncabezado(p.pais_origen) === limpio) ??
      null
    );
  };
}

/**
 * Importa las tarifas contenidas en un buffer de planilla.
 *
 * @param {Buffer} buffer - Contenido del archivo subido.
 * @param {string} nombreArchivo - Solo para mensajes de error.
 * @returns {Promise<{insertadas:number, actualizadas:number, omitidas:number, errores:object[], procesadas:number}>}
 */
export async function importarDesdeBuffer(buffer, nombreArchivo = 'planilla') {
  let libro;
  try {
    libro = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw ApiError.badRequest(
      `No se pudo leer el archivo "${nombreArchivo}". Verifique que sea un .xlsx o .csv valido.`,
      { codigo: 'ARCHIVO_ILEGIBLE' },
    );
  }

  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) {
    throw ApiError.badRequest('La planilla no contiene hojas de trabajo.', { codigo: 'PLANILLA_VACIA' });
  }

  const { filas } = hojaAMatrix(hoja);

  if (!filas.length) {
    throw ApiError.badRequest('La planilla no contiene filas de datos.', { codigo: 'PLANILLA_VACIA' });
  }

  const resumen = { procesadas: filas.length, insertadas: 0, actualizadas: 0, omitidas: 0, errores: [] };

  const resolverPuerto = crearIndicePuertos(await puertoModel.listar());

  // Toda la importacion en UNA transaccion: si una fila viene mal, no se
  // escribe ninguna, y la planilla original sigue intacta.
  //
  // El recorrido es con `for...of` y no con `forEach` a proposito: las
  // escrituras deben ejecutarse UNA tras otra y en orden. Con `forEach` las
  // promesas se lanzarian todas a la vez, el COMMIT podria ocurrir antes de que
  // terminaran, y un error en la fila 30 no revertiria nada.
  await enTransaccion(async () => {
    for (const [indice, fila] of filas.entries()) {
      const numeroFila = indice + 2; // +2 porque la fila 1 son los encabezados

      const origen = resolverPuerto(fila.origen);
      if (!origen) {
        resumen.omitidas += 1;
        resumen.errores.push({ fila: numeroFila, motivo: `Puerto de origen desconocido: "${fila.origen}"` });
        continue;
      }

      const destino = resolverPuerto(fila.destino);
      if (!destino) {
        resumen.omitidas += 1;
        resumen.errores.push({ fila: numeroFila, motivo: `Puerto de destino desconocido: "${fila.destino}"` });
        continue;
      }

      if (origen.region === 'CHILE' || destino.region !== 'CHILE') {
        resumen.omitidas += 1;
        resumen.errores.push({
          fila: numeroFila,
          motivo: `Ruta invalida: el origen debe ser internacional y el destino chileno.`,
        });
        continue;
      }

      if (!Number.isFinite(fila.precio) || fila.precio <= 0) {
        resumen.omitidas += 1;
        resumen.errores.push({ fila: numeroFila, motivo: `precio_usd invalido: "${fila.precio}"` });
        continue;
      }

      if (fila.dias !== null && (!Number.isFinite(fila.dias) || fila.dias <= 0)) {
        resumen.omitidas += 1;
        resumen.errores.push({ fila: numeroFila, motivo: `dias_viaje_base invalido: "${fila.dias}"` });
        continue;
      }

      if (!Number.isFinite(fila.capacidad) || fila.capacidad <= 0) {
        resumen.omitidas += 1;
        resumen.errores.push({ fila: numeroFila, motivo: `capacidad_max_tn invalida: "${fila.capacidad}"` });
        continue;
      }

      const resultado = await tarifaModel.guardar({
        puerto_origen_id: origen.id,
        puerto_destino_id: destino.id,
        tipo_contenedor: fila.tipo,
        precio_usd: fila.precio,
        dias_viaje_base: fila.dias ?? 30,
        capacidad_max_tn: fila.capacidad,
      });

      if (resultado === 'insertada') resumen.insertadas += 1;
      else resumen.actualizadas += 1;
    }
  });

  return resumen;
}

/**
 * @returns {Promise<object[]>} Todas las rutas tarifadas, agrupables para la UI.
 */
export async function listarTarifas() {
  return tarifaModel.listar();
}

