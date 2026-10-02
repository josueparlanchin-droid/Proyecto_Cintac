/**
 * services/calculoService.js
 * -----------------------------------------------------------------
 * MOTOR DE CALCULO DEL COTIZADOR. Es la pieza central del proyecto.
 *
 * Reglas de negocio implementadas (todas configurables en constantes.js):
 *
 *   toneladas   = peso_kg / 1000
 *   contenedores= ceil(toneladas / capacidad_max_tn)      [minimo 1]
 *   flete       = contenedores x precio_usd_del_contenedor
 *   seguro      = valor_mercaderia_usd x 1%
 *   CIF         = valor_mercaderia_usd + flete + seguro
 *   impuesto    = CIF x 19%
 *   costo_total = flete + impuesto
 *   transito    = dias_viaje_base + dias_contingencia
 *
 * El limite de 25 tn NO esta escrito aqui: se lee de la tarifa de la ruta
 * (columna capacidad_max_tn), con 25 tn como valor de respaldo.
 */

import * as tarifaModel from '../models/tarifaModel.js';
import * as puertoModel from '../models/puertoModel.js';
import * as cotizacionModel from '../models/cotizacionModel.js';
import { ApiError } from '../utils/ApiError.js';
import {
  TASA_IMPUESTO_CIF,
  TASA_SEGURO,
  MAX_TONELADAS_POR_CONTENEDOR,
  TIPO_CONTENEDOR_DEFAULT,
  KG_POR_TONELADA,
  redondearMoneda,
  redondearPeso,
} from '../utils/constantes.js';

/**
 * Convierte kilogramos a toneladas con 3 decimales.
 *
 * @param {number} pesoKg
 * @returns {number} toneladas.
 */
export function convertirKgAToneladas(pesoKg) {
  return redondearPeso(pesoKg / KG_POR_TONELADA);
}

/**
 * Calcula cuantos contenedores requiere una carga.
 *
 * Se usa Math.ceil porque el limite es ESTRICTO: una carga de 25.001 tn
 * NO puede ir en un contenedor de 25 tn, necesita un segundo. Un
 * redondeo a la baja generaria una sobrecarga ilegal del contenedor.
 *
 * @param {number} toneladas
 * @param {number} capacidadMaxTn
 * @returns {number} cantidad de contenedores (siempre >= 1).
 */
export function calcularContenedores(toneladas, capacidadMaxTn) {
  return Math.max(Math.ceil(toneladas / capacidadMaxTn), 1);
}

/**
 * Simula una cotizacion de importacion.
 *
 * @param {object} entrada - Ya validada por Zod en el middleware.
 * @param {number} entrada.peso_kg
 * @param {number} entrada.valor_mercaderia_usd
 * @param {number} entrada.puerto_origen_id
 * @param {number} entrada.puerto_destino_id
 * @param {number} [entrada.dias_contingencia]
 * @param {string} [entrada.tipo_contenedor]
 * @param {number} [entrada.usuario_id] - Si se envia, ademas persiste la cotizacion.
 * @param {boolean} [entrada.guardar]
 * @returns {Promise<{simulacion:object, cotizacion:object|null}>}
 */
export async function simular(entrada) {
  const {
    peso_kg: pesoKg,
    valor_mercaderia_usd: valorMercaderiaUsd,
    puerto_origen_id: puertoOrigenId,
    puerto_destino_id: puertoDestinoId,
    dias_contingencia: diasContingencia = 0,
    tipo_contenedor: tipoContenedorSolicitado = TIPO_CONTENEDOR_DEFAULT,
    usuario_id: usuarioId = null,
    guardar = false,
  } = entrada;

  // --- 1. Validar que los puertos existan y tengan el rol correcto ---
  const origen = await puertoModel.buscarPorId(puertoOrigenId);
  const destino = await puertoModel.buscarPorId(puertoDestinoId);

  if (!origen) throw ApiError.badRequest('El puerto de origen seleccionado no existe.', { codigo: 'PUERTO_ORIGEN_INVALIDO' });
  if (!destino) throw ApiError.badRequest('El puerto de destino seleccionado no existe.', { codigo: 'PUERTO_DESTINO_INVALIDO' });

  if (origen.region === 'CHILE') {
    throw ApiError.badRequest('El puerto de origen no puede ser un puerto chileno.', { codigo: 'ORIGEN_INVALIDO' });
  }
  if (destino.region !== 'CHILE') {
    throw ApiError.badRequest('El puerto de destino debe ser un puerto de Chile.', { codigo: 'DESTINO_INVALIDO' });
  }
  if (origen.id === destino.id) {
    throw ApiError.badRequest('El puerto de origen y destino no pueden ser iguales.', { codigo: 'RUTA_INVALIDA' });
  }

  // --- 2. Obtener la tarifa de la ruta ---
  const tarifa = await tarifaModel.buscarRuta(origen.id, destino.id, tipoContenedorSolicitado);

  if (!tarifa) {
    throw ApiError.conflicto(
      `No existe tarifa vigente para la ruta ${origen.nombre} (${origen.pais_origen}) -> ${destino.nombre} (${destino.pais_origen}). ` +
        'Cargue la planilla de tarifas correspondiente.',
      { codigo: 'RUTA_SIN_TARIFA' },
    );
  }

  const tipoContenedor = tarifa.tipo_contenedor;
  const capacidadMaxTn = tarifa.capacidad_max_tn || MAX_TONELADAS_POR_CONTENEDOR;

  // --- 3. Conversion de unidades y calculo de contenedores ---
  const toneladas = convertirKgAToneladas(pesoKg);
  const cantidadContenedores = calcularContenedores(toneladas, capacidadMaxTn);

  // --- 4. Desglose financiero ---
  const costoFleteUsd = redondearMoneda(cantidadContenedores * tarifa.precio_usd);
  const seguroUsd = redondearMoneda(valorMercaderiaUsd * TASA_SEGURO);
  const valorCifUsd = redondearMoneda(valorMercaderiaUsd + costoFleteUsd + seguroUsd);
  const impuesto19CifUsd = redondearMoneda(valorCifUsd * TASA_IMPUESTO_CIF);
  const costoTotalUsd = redondearMoneda(costoFleteUsd + impuesto19CifUsd);

  // --- 5. Dias de transito ---
  const diasTransito = tarifa.dias_viaje_base + diasContingencia;

  const simulacion = {
    // --- Datos de la carga ---
    peso_kg: pesoKg,
    toneladas,
    cantidad_contenedores: cantidadContenedores,
    tipo_contenedor: tipoContenedor,
    capacidad_max_tn: capacidadMaxTn,
    /** Porcentaje de ocupacion del ultimo contenedor (util para la UI). */
    ocupacion_ultimo_contenedor_pct: redondearPeso(
      ((toneladas - (cantidadContenedores - 1) * capacidadMaxTn) / capacidadMaxTn) * 100,
    ),

    // --- Ruta ---
    puerto_origen: {
      id: origen.id,
      nombre: origen.nombre,
      pais: origen.pais_origen,
      region: origen.region,
      codigo: origen.codigo,
    },
    puerto_destino: {
      id: destino.id,
      nombre: destino.nombre,
      pais: destino.pais_origen,
      codigo: destino.codigo,
    },
    ruta: `${origen.nombre}, ${origen.pais_origen} -> ${destino.nombre}, Chile`,

    // --- Desglose financiero ---
    valor_mercaderia_usd: redondearMoneda(valorMercaderiaUsd),
    precio_contenedor_usd: tarifa.precio_usd,
    costo_flete_usd: costoFleteUsd,
    seguro_usd: seguroUsd,
    valor_cif_usd: valorCifUsd,
    impuesto_19_cif_usd: impuesto19CifUsd,
    costo_total_usd: costoTotalUsd,

    // --- Tiempo ---
    dias_viaje_base: tarifa.dias_viaje_base,
    dias_contingencia: diasContingencia,
    dias_transito: diasTransito,

    /** Base de calculo: se imprime tal cual en el informe PDF. */
    parametros: {
      tasa_impuesto_cif: TASA_IMPUESTO_CIF,
      tasa_seguro: TASA_SEGURO,
      limite_toneladas_por_contenedor: capacidadMaxTn,
      tipo_contenedor: tipoContenedor,
    },
  };

  // --- 6. Persistencia opcional ---
  let cotizacion = null;
  if (guardar && usuarioId !== null) {
    const id = await cotizacionModel.crear({
      usuario_id: usuarioId,
      peso_kg: pesoKg,
      toneladas,
      cantidad_contenedores: cantidadContenedores,
      puerto_origen_id: origen.id,
      puerto_destino_id: destino.id,
      tipo_contenedor: tipoContenedor,
      dias_viaje_base: tarifa.dias_viaje_base,
      valor_mercaderia_usd: redondearMoneda(valorMercaderiaUsd),
      capacidad_max_tn: capacidadMaxTn,
      precio_contenedor_usd: tarifa.precio_usd,
      dias_contingencia: diasContingencia,
      costo_flete_usd: costoFleteUsd,
      seguro_usd: seguroUsd,
      valor_cif_usd: valorCifUsd,
      impuesto_19_cif_usd: impuesto19CifUsd,
      costo_total_usd: costoTotalUsd,
      dias_transito: diasTransito,
    });

    cotizacion = await cotizacionModel.buscarPorId(id);
  }

  return { simulacion, cotizacion };
}