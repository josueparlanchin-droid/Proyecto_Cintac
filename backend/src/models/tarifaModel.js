/**
 * models/tarifaModel.js
 * -----------------------------------------------------------------
 * Acceso a datos de las tarifas de flete por ruta.
 *
 * La tarifa es el insumo que convierte un peso en precio: sin ella el
 * calculador no podria cotizar. Por eso se puede importar masivamente
 * desde planillas .xlsx/.csv (endpoint /tarifas/upload).
 */

import { queryOne, queryAll, query } from '../config/db.js';

/**
 * Busca la tarifa aplicable a una ruta.
 *
 * La consulta esta ORDENADA por preferencia de tipo de contenedor: si el
 * cliente pide un 40HC y la tarifa solo tiene un 40 generico registrado,
 * se usa el 40 antes que un 20. Asi una planilla incompleta sigue siendo
 * utilizable en vez de devolver "ruta sin tarifa".
 *
 * Se puede resolver en una sola consulta con ORDER BY sobre un CASE que
 * ordena primero la coincidencia exacta y luego el '40' generico:
 *   - tipo pedido y tipo guardado coinciden  -> prioridad 1
 *   - tipo pedido 40HC y guardado es '40'    -> prioridad 2
 *   - cualquier otro caso                   -> no aparece
 *
 * @param {number} puertoOrigenId
 * @param {number} puertoDestinoId
 * @param {string} tipoContenedor
 * @returns {Promise<object|null>}
 */
export async function buscarRuta(puertoOrigenId, puertoDestinoId, tipoContenedor) {
  return queryOne(
    `SELECT * FROM tarifas_flete
     WHERE puerto_origen_id = $1
       AND puerto_destino_id = $2
       AND tipo_contenedor IN ($3, '40')
     ORDER BY CASE WHEN tipo_contenedor = $3 THEN 1 ELSE 2 END
     LIMIT 1`,
    [puertoOrigenId, puertoDestinoId, tipoContenedor],
  );
}

/**
 * @returns {Promise<object[]>} Todas las tarifas con los nombres de sus puertos.
 */
export async function listar() {
  return queryAll(`
    SELECT t.*,
           po.nombre AS origen_nombre,
           po.pais_origen AS origen_pais,
           po.region   AS origen_region,
           po.codigo   AS origen_codigo,
           pd.nombre AS destino_nombre,
           pd.pais_origen AS destino_pais,
           pd.codigo   AS destino_codigo
    FROM tarifas_flete t
    JOIN puertos po ON po.id = t.puerto_origen_id
    JOIN puertos pd ON pd.id = t.puerto_destino_id
    ORDER BY po.region, po.nombre, pd.nombre, t.tipo_contenedor
  `);
}

/**
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function buscarPorId(id) {
  return queryOne('SELECT * FROM tarifas_flete WHERE id = $1', [id]);
}

/**
 * Upsert de una tarifa. Si la ruta y el tipo ya existen se actualizan
 * precio y dias; si no, se inserta.
 *
 * Se resuelve con un unico INSERT ... ON CONFLICT gracias al indice UNIQUE
 * (puerto_origen_id, puerto_destino_id, tipo_contenedor): en lugar del
 * SELECT previo, la base decide. Asi es atómico y no hay carrera entre dos
 * cargas de planillas simultaneas.
 *
 * `RETURNING (xmax = 0) AS es_insercion` permite distinguir el caso sin
 * consultar antes: en un INSERT, `xmax` vale 0; en un UPDATE por conflicto,
 * vale el id de la tupla que el motor acaba de crear para la nueva version,
 * por lo que es distinto de 0. Es la forma habitual de distinguir un INSERT
 * de un UPDATE cuando el upsert se resuelve en una sola sentencia.
 *
 * @param {{puerto_origen_id:number, puerto_destino_id:number, tipo_contenedor:string,
 *          precio_usd:number, dias_viaje_base:number, capacidad_max_tn:number}} tarifa
 * @returns {Promise<'insertada'|'actualizada'>}
 */
export async function guardar(tarifa) {
  const resultado = await query(
    `INSERT INTO tarifas_flete
       (puerto_origen_id, puerto_destino_id, tipo_contenedor, precio_usd, dias_viaje_base, capacidad_max_tn)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (puerto_origen_id, puerto_destino_id, tipo_contenedor) DO UPDATE SET
       precio_usd = excluded.precio_usd,
       dias_viaje_base = excluded.dias_viaje_base,
       capacidad_max_tn = excluded.capacidad_max_tn,
       actualizado_en = NOW()
     RETURNING (xmax = 0) AS es_insercion`,
    [
      tarifa.puerto_origen_id,
      tarifa.puerto_destino_id,
      tarifa.tipo_contenedor,
      tarifa.precio_usd,
      tarifa.dias_viaje_base,
      tarifa.capacidad_max_tn,
    ],
  );

  return resultado.rows[0].es_insercion ? 'insertada' : 'actualizada';
}

/**
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function eliminar(id) {
  const resultado = await query('DELETE FROM tarifas_flete WHERE id = $1', [id]);
  return resultado.rowCount > 0;
}

/** @returns {Promise<number>} total de rutas tarifadas. */
export async function contar() {
  const fila = await queryOne('SELECT COUNT(*) AS total FROM tarifas_flete');
  return fila.total;
}
