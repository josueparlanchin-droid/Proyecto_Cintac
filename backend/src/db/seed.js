/**
 * db/seed.js
 * -----------------------------------------------------------------
 * Carga de datos iniciales: usuarios, catalogo de puertos, rutas
 * tarifadas y cotizaciones de ejemplo.
 *
 * Ejecutar con:  npm run seed
 *
 * Es IDEMPOTENTE: se puede correr las veces que haga falta sin duplicar
 * registros. Los usuarios y puertos se identifican por su clave natural
 * (email / codigo), y las cotizaciones de ejemplo solo se insertan si la
 * bitacora esta vacia.
 *
 * Con PostgreSQL todas las operaciones son asincronas y las transacciones se
 * abren con `await`. La bitacora de ejemplo se genera DENTRO de una
 * transaccion: gracias a que `enTransaccion` usa AsyncLocalStorage, el
 * `simular()` que se invoca dos niveles mas abajo escribe en la misma
 * conexion, y si un caso falla se revierte todo junto.
 */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { inicializarEsquema, enTransaccion, cerrarBaseDatos, descripcionBaseDatos, queryOne, query } from '../config/db.js';
import { hashPassword } from '../services/authService.js';
import * as puertoModel from '../models/puertoModel.js';
import * as tarifaModel from '../models/tarifaModel.js';
import * as cotizacionModel from '../models/cotizacionModel.js';
import { simular } from '../services/calculoService.js';
import {
  MAX_TONELADAS_POR_CONTENEDOR,
  TIPO_CONTENEDOR_DEFAULT,
} from '../utils/constantes.js';
import { logger } from '../utils/logger.js';

// ==================================================================
// 1. USUARIOS
// ==================================================================
const USUARIOS = [
  {
    nombre: 'Carla Mendoza Rivas',
    email: 'jefe@cintac.cl',
    password: 'Jefatura2026',
    rol: 'ADMIN_COMEX',
  },
  {
    nombre: 'Diego Fuentes Soto',
    email: 'analista@cintac.cl',
    password: 'Analista2026',
    rol: 'ANALISTA',
  },
];

// ==================================================================
// 2. CATALOGO DE PUERTOS
// ==================================================================
const PUERTOS = [
  // --- China ---
  { nombre: 'Shanghai',        pais_origen: 'China',         region: 'CHINA',  codigo: 'CNSHA' },
  { nombre: 'Shenzhen (Nansha)', pais_origen: 'China',       region: 'CHINA',  codigo: 'CNNGB' },
  { nombre: 'Qingdao',         pais_origen: 'China',         region: 'CHINA',  codigo: 'CNTAO' },

  // --- Europa ---
  { nombre: 'Rotterdam',       pais_origen: 'Paises Bajos',  region: 'EUROPA', codigo: 'NLRTM' },
  { nombre: 'Hamburgo',        pais_origen: 'Alemania',      region: 'EUROPA', codigo: 'DEHAM' },
  { nombre: 'Valencia',        pais_origen: 'Espana',        region: 'EUROPA', codigo: 'ESVLC' },

  // --- America ---
  { nombre: 'Miami',           pais_origen: 'Estados Unidos', region: 'AMERICA', codigo: 'USMIA' },
  { nombre: 'Manzanillo (MX)', pais_origen: 'Mexico',        region: 'AMERICA', codigo: 'MXZLO' },
  { nombre: 'Cartagena',       pais_origen: 'Colombia',      region: 'AMERICA', codigo: 'COCTG' },

  // --- Chile (destino) ---
  { nombre: 'Valparaiso',      pais_origen: 'Chile',         region: 'CHILE',  codigo: 'CLVAP' },
  { nombre: 'San Antonio',     pais_origen: 'Chile',         region: 'CHILE',  codigo: 'CLSAI' },
  { nombre: 'San Vicente',     pais_origen: 'Chile',         region: 'CHILE',  codigo: 'CLSAV' },
];

// ==================================================================
// 3. TARIFAS DE FLETE POR RUTA
//    precio en USD por contenedor 40'HC, dias de viaje base directo.
// ==================================================================
const TARIFAS = [
  // Shanghai -> Chile
  { origen: 'CNSHA', destino: 'CLVAP', precio_usd: 2450, dias_viaje_base: 32 },
  { origen: 'CNSHA', destino: 'CLSAI', precio_usd: 2520, dias_viaje_base: 33 },
  { origen: 'CNSHA', destino: 'CLSAV', precio_usd: 2560, dias_viaje_base: 34 },

  // Shenzhen (Nansha) -> Chile
  { origen: 'CNNGB', destino: 'CLVAP', precio_usd: 2380, dias_viaje_base: 31 },
  { origen: 'CNNGB', destino: 'CLSAI', precio_usd: 2460, dias_viaje_base: 32 },
  { origen: 'CNNGB', destino: 'CLSAV', precio_usd: 2500, dias_viaje_base: 33 },

  // Qingdao -> Chile
  { origen: 'CNTAO', destino: 'CLVAP', precio_usd: 2420, dias_viaje_base: 33 },
  { origen: 'CNTAO', destino: 'CLSAI', precio_usd: 2500, dias_viaje_base: 34 },
  { origen: 'CNTAO', destino: 'CLSAV', precio_usd: 2540, dias_viaje_base: 35 },

  // Rotterdam -> Chile
  { origen: 'NLRTM', destino: 'CLVAP', precio_usd: 1890, dias_viaje_base: 24 },
  { origen: 'NLRTM', destino: 'CLSAI', precio_usd: 1950, dias_viaje_base: 25 },
  { origen: 'NLRTM', destino: 'CLSAV', precio_usd: 1990, dias_viaje_base: 26 },

  // Hamburgo -> Chile
  { origen: 'DEHAM', destino: 'CLVAP', precio_usd: 1950, dias_viaje_base: 25 },
  { origen: 'DEHAM', destino: 'CLSAI', precio_usd: 2010, dias_viaje_base: 26 },
  { origen: 'DEHAM', destino: 'CLSAV', precio_usd: 2050, dias_viaje_base: 27 },

  // Valencia -> Chile
  { origen: 'ESVLC', destino: 'CLVAP', precio_usd: 2050, dias_viaje_base: 26 },
  { origen: 'ESVLC', destino: 'CLSAI', precio_usd: 2110, dias_viaje_base: 27 },
  { origen: 'ESVLC', destino: 'CLSAV', precio_usd: 2150, dias_viaje_base: 28 },

  // Miami -> Chile
  { origen: 'USMIA', destino: 'CLVAP', precio_usd: 1450, dias_viaje_base: 9 },
  { origen: 'USMIA', destino: 'CLSAI', precio_usd: 1510, dias_viaje_base: 10 },
  { origen: 'USMIA', destino: 'CLSAV', precio_usd: 1550, dias_viaje_base: 11 },

  // Manzanillo (Mexico) -> Chile
  { origen: 'MXZLO', destino: 'CLVAP', precio_usd: 1290, dias_viaje_base: 14 },
  { origen: 'MXZLO', destino: 'CLSAI', precio_usd: 1350, dias_viaje_base: 15 },
  { origen: 'MXZLO', destino: 'CLSAV', precio_usd: 1390, dias_viaje_base: 16 },

  // Cartagena (Colombia) -> Chile
  { origen: 'COCTG', destino: 'CLVAP', precio_usd: 980, dias_viaje_base: 8 },
  { origen: 'COCTG', destino: 'CLSAI', precio_usd: 1040, dias_viaje_base: 9 },
  { origen: 'COCTG', destino: 'CLSAV', precio_usd: 1080, dias_viaje_base: 10 },
];

// ==================================================================
// 4. COTIZACIONES DE EJEMPLO
//    Casos pensados para que el historial muestre variedad y, sobre
//    todo, los casos borde del limite de 25 tn por contenedor:
//      - 24.000 kg   -> 24 tn    -> 1 contenedor (casi lleno)
//      - 25.001 kg   -> 25.001tn -> 2 contenedores (excede el limite)
//      - 25.000 kg   -> 25 tn    -> 1 contenedor (justo en el limite)
// ==================================================================
const COTIZACIONES_EJEMPLO = [
  { peso_kg: 18_400,   valor_mercaderia_usd: 62_000,   origen: 'CNSHA', destino: 'CLVAP', dias_contingencia: 4 },
  { peso_kg: 24_000,   valor_mercaderia_usd: 88_500,   origen: 'CNSHA', destino: 'CLSAI', dias_contingencia: 7 },
  { peso_kg: 25_000,   valor_mercaderia_usd: 91_000,   origen: 'CNNGB', destino: 'CLSAI', dias_contingencia: 0 },
  { peso_kg: 25_001,   valor_mercaderia_usd: 91_200,   origen: 'CNNGB', destino: 'CLSAI', dias_contingencia: 3 },
  { peso_kg: 47_500,   valor_mercaderia_usd: 165_000,  origen: 'CNTAO', destino: 'CLVAP', dias_contingencia: 10 },
  { peso_kg: 12_800,   valor_mercaderia_usd: 54_300,   origen: 'NLRTM', destino: 'CLSAI', dias_contingencia: 2 },
  { peso_kg: 22_600,   valor_mercaderia_usd: 79_400,   origen: 'NLRTM', destino: 'CLVAP', dias_contingencia: 5 },
  { peso_kg: 8_950,    valor_mercaderia_usd: 41_700,   origen: 'DEHAM', destino: 'CLSAV', dias_contingencia: 1 },
  { peso_kg: 15_300,   valor_mercaderia_usd: 63_900,   origen: 'ESVLC', destino: 'CLSAI', dias_contingencia: 6 },
  { peso_kg: 6_200,    valor_mercaderia_usd: 28_400,   origen: 'USMIA', destino: 'CLVAP', dias_contingencia: 0 },
  { peso_kg: 19_750,   valor_mercaderia_usd: 71_800,   origen: 'USMIA', destino: 'CLSAI', dias_contingencia: 2 },
  { peso_kg: 31_200,   valor_mercaderia_usd: 128_500,  origen: 'MXZLO', destino: 'CLSAV', dias_contingencia: 8 },
  { peso_kg: 9_800,    valor_mercaderia_usd: 44_600,   origen: 'COCTG', destino: 'CLVAP', dias_contingencia: 1 },
];

/**
 * Devuelve la fecha de hace `dias` dias, para dispersar el historial.
 *
 * Se devuelve un `Date`, no un texto: la columna es TIMESTAMPTZ y el driver
 * lo serializa con su offset, de modo que no queda pendiente de interpretar
 * en la zona horaria de la sesion de PostgreSQL. Formatearlo a mano con
 * `.toISOString().slice(0, 19)` dejaba un string sin zona, que PostgreSQL
 * asumiria en la suya y podria desplazar el registro.
 *
 * @param {number} dias
 * @param {number} [horas]
 * @returns {Date}
 */
function fechaHace(dias, horas = 9) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  fecha.setHours(horas, Math.floor(Math.random() * 60), 0, 0);
  return fecha;
}

/**
 * Carga los datos iniciales. Se exporta para poder invocarla desde otro
 * proceso (por ejemplo `reset-db.js`) sin depender del autoarranque.
 *
 * @returns {Promise<boolean>} true si la base quedo lista.
 */
export async function sembrar() {
  logger.info('Iniciando carga de datos iniciales (seed)...');
  logger.info(`Base de datos: ${descripcionBaseDatos()}`);

  await inicializarEsquema();

  // ---------------------------------------------------------------
  // Usuarios
  // ---------------------------------------------------------------
  const hashes = await Promise.all(USUARIOS.map((u) => hashPassword(u.password)));

  await enTransaccion(async () => {
    for (const [i, usuario] of USUARIOS.entries()) {
      await query(
        `INSERT INTO usuarios (nombre, email, password, rol, activo)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (email) DO UPDATE SET
           nombre = excluded.nombre,
           rol = excluded.rol`,
        [usuario.nombre, usuario.email, hashes[i], usuario.rol],
      );
    }
  });

  logger.info(`Usuarios listos: ${USUARIOS.map((u) => `${u.email} (${u.rol})`).join(', ')}`);

  // ---------------------------------------------------------------
  // Puertos
  // ---------------------------------------------------------------
  const insertados = await puertoModel.insertarVarios(PUERTOS);
  logger.info(`Puertos sincronizados: ${insertados}`);

  // Indice codigo -> id para resolver rutas por codigo, sin consultar por fila.
  const idPorCodigo = new Map((await puertoModel.listar()).map((p) => [p.codigo, p.id]));

  // ---------------------------------------------------------------
  // Tarifas de flete
  // ---------------------------------------------------------------
  await enTransaccion(async () => {
    for (const tarifa of TARIFAS) {
      const origenId = idPorCodigo.get(tarifa.origen);
      const destinoId = idPorCodigo.get(tarifa.destino);

      if (!origenId || !destinoId) {
        logger.warn(`Tarifa omitida, puerto desconocido: ${tarifa.origen} -> ${tarifa.destino}`);
        continue;
      }

      await tarifaModel.guardar({
        puerto_origen_id: origenId,
        puerto_destino_id: destinoId,
        tipo_contenedor: TIPO_CONTENEDOR_DEFAULT,
        precio_usd: tarifa.precio_usd,
        dias_viaje_base: tarifa.dias_viaje_base,
        capacidad_max_tn: MAX_TONELADAS_POR_CONTENEDOR,
      });
    }
  });

  logger.info(`Rutas tarifadas: ${await tarifaModel.contar()} (limite de ${MAX_TONELADAS_POR_CONTENEDOR} tn por contenedor)`);

  // ---------------------------------------------------------------
  // Cotizaciones de ejemplo
  //   Solo si la bitacora esta vacia: en caso contrario se respetan los
  //   datos que el usuario ya genero en la demo.
  // ---------------------------------------------------------------
  const existentes = await cotizacionModel.contar();

  if (existentes > 0) {
    logger.info(`La bitacora ya tiene ${existentes} registros: se conservan.`);
  } else {
    const idAnalista = (await queryOne('SELECT id FROM usuarios WHERE email = $1', ['analista@cintac.cl']))?.id;
    const idJefe = (await queryOne('SELECT id FROM usuarios WHERE email = $1', ['jefe@cintac.cl']))?.id;

    // Una sola transaccion para toda la bitacora de ejemplo: o queda completa,
    // o no queda nada. Ademas, como `enTransaccion` fija el cliente con
    // AsyncLocalStorage, el `simular()` que se llama dentro escribe en esta
    // misma conexion y los casos quedan garantizados como atomicos.
    await enTransaccion(async () => {
      for (const [indice, caso] of COTIZACIONES_EJEMPLO.entries()) {
        // Se alterna el autor: el historial muestra ambos roles.
        const usuarioId = indice % 3 === 0 ? idJefe : idAnalista;

        try {
          const { cotizacion } = await simular({
            peso_kg: caso.peso_kg,
            valor_mercaderia_usd: caso.valor_mercaderia_usd,
            puerto_origen_id: idPorCodigo.get(caso.origen),
            puerto_destino_id: idPorCodigo.get(caso.destino),
            dias_contingencia: caso.dias_contingencia,
            tipo_contenedor: TIPO_CONTENEDOR_DEFAULT,
            usuario_id: usuarioId,
            guardar: true,
          });

          // Retrocede la fecha para que el historial parezca historico.
          await query('UPDATE cotizaciones_log SET fecha_creacion = $1 WHERE id = $2', [
            fechaHace(indice * 2 + 1),
            cotizacion.id,
          ]);
        } catch (error) {
          logger.warn(`Caso de ejemplo ${indice + 1} omitido: ${error.message}`);
        }
      }
    });

    logger.info(`Cotizaciones de ejemplo generadas: ${await cotizacionModel.contar()}`);
  }

  // ---------------------------------------------------------------
  const resumen = await cotizacionModel.resumen();
  logger.info('='.repeat(66));
  logger.info('  SEED COMPLETADO');
  logger.info(`  ${resumen.total_cotizaciones} cotizaciones | ${Math.round(resumen.toneladas_totales * 100) / 100} tn | ${resumen.contenedores_totales} contenedores`);
  logger.info('  Credenciales de acceso:');
  USUARIOS.forEach((u) => logger.info(`    ${u.email} / ${u.password}  [${u.rol}]`));
  logger.info('='.repeat(66));

  return true;
}

// Solo se autoejecuta cuando el archivo se lanza directamente (`npm run seed`).
// Si otro modulo lo importa, por ejemplo `reset-db.js`, no debe arrancar solo.
//
// La comparacion se hace con `fileURLToPath` y no comparando cadenas: en
// Windows `import.meta.url` es `file:///C:/...` (tres barras) mientras que
// `process.argv[1]` es `C:\...`, y un `file://${argv[1]}` nunca coincide.
const ejecutadoComoScript =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (ejecutadoComoScript) {
  sembrar()
    .then(async () => {
      await cerrarBaseDatos();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error('Error durante el seed:', error);
      await cerrarBaseDatos().catch(() => {});
      process.exit(1);
    });
}

