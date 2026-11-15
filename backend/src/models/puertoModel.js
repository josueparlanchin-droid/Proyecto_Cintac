/**
 * models/puertoModel.js
 * -----------------------------------------------------------------
 * Acceso a datos del catalogo de puertos (origen y destino).
 *
 * La validez de una ruta la define la existencia de una tarifa, no la
 * region del puerto: hay rutas Chile -> Peru y China/Europa/America -> Chile.
 *
 * Todas las funciones son async por el driver `pg`.
 */

import { queryOne, queryAll, query } from '../config/db.js';

/** Regiones del catalogo. Cualquiera puede ser origen o destino. */
export const REGIONES = ['CHINA', 'EUROPA', 'AMERICA', 'CHILE'];

/**
 * @param {string} [region] Filtro opcional por region.
 * @returns {Promise<object[]>} Puertos ordenados por region y nombre.
 */
export async function listar(region) {
  if (region) {
    return queryAll('SELECT * FROM puertos WHERE region = $1 ORDER BY nombre ASC', [
      region.toUpperCase(),
    ]);
  }
  return queryAll(`
    SELECT * FROM puertos
    ORDER BY
      CASE region
        WHEN 'CHINA'  THEN 1
        WHEN 'EUROPA' THEN 2
        WHEN 'AMERICA' THEN 3
        WHEN 'CHILE'  THEN 4
      END,
      nombre ASC
  `);
}

/** Orden logico de las regiones en los listados. */
const ORDEN_REGION = `
  CASE region
    WHEN 'CHINA'   THEN 1
    WHEN 'EUROPA'  THEN 2
    WHEN 'AMERICA' THEN 3
    WHEN 'CHILE'   THEN 4
  END`;

/**
 * Puertos que pueden ser ORIGEN: los que tienen al menos una tarifa.
 * Evita ofrecer en el formulario una ruta que el motor rechazaria.
 *
 * @returns {Promise<object[]>}
 */
export async function listarOrigenesConTarifa() {
  return queryAll(`
    SELECT * FROM puertos p
    WHERE EXISTS (
      SELECT 1 FROM tarifas_flete t WHERE t.puerto_origen_id = p.id
    )
    ORDER BY ${ORDEN_REGION}, nombre ASC
  `);
}

/**
 * Puertos que pueden ser DESTINO: los que tienen al menos una tarifa.
 *
 * @returns {Promise<object[]>}
 */
export async function listarDestinosConTarifa() {
  return queryAll(`
    SELECT * FROM puertos p
    WHERE EXISTS (
      SELECT 1 FROM tarifas_flete t WHERE t.puerto_destino_id = p.id
    )
    ORDER BY ${ORDEN_REGION}, nombre ASC
  `);
}

/**
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function buscarPorId(id) {
  return queryOne('SELECT * FROM puertos WHERE id = $1', [id]);
}

/**
 * Resuelve varios ids en una sola consulta. Evita el problema N+1 al
 * armar el historial, donde cada fila necesita sus dos nombres de puerto.
 *
 * @param {number[]} ids
 * @returns {Promise<Map<number, object>>}
 */
export async function mapaPorIds(ids) {
  if (!ids.length) return new Map();

  // Los marcadores se generan por cantidad de ids, nunca por contenido:
  // los ids ya son numeros validados y se pasan igual como parametros.
  const marcadores = ids.map((_, indice) => `$${indice + 1}`).join(', ');
  const filas = await queryAll(
    `SELECT * FROM puertos WHERE id IN (${marcadores})`,
    ids,
  );

  return new Map(filas.map((p) => [p.id, p]));
}

/**
 * @param {string} codigo - Codigo UN/LOCODE, ej. 'CNSHA'.
 * @returns {Promise<object|null>}
 */
export async function buscarPorCodigo(codigo) {
  return queryOne('SELECT * FROM puertos WHERE codigo = $1', [codigo]);
}

/**
 * Insercion multiple, usada por el seed.
 *
 * Va en una sola sentencia con multiples VALUES: en Postgres se puede
 * repetir `( $1, $2, $3, $4 ), ( $5, ... )` y es una unica ida y vuelta.
 *
 * @param {Array<{nombre:string, pais_origen:string, region:string, codigo:string}>} puertos
 * @returns {Promise<number>} cantidad enviada.
 */
export async function insertarVarios(puertos) {
  if (!puertos.length) return 0;

  const valores = [];
  const filas = puertos.map((p, indice) => {
    const base = indice * 4;
    valores.push(p.nombre, p.pais_origen, p.region, p.codigo);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
  });

  await query(
    `INSERT INTO puertos (nombre, pais_origen, region, codigo)
     VALUES ${filas.join(', ')}
     ON CONFLICT (codigo) DO UPDATE SET
       nombre = excluded.nombre,
       pais_origen = excluded.pais_origen,
       region = excluded.region`,
    valores,
  );

  return puertos.length;
}
