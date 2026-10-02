/**
 * models/cotizacionModel.js
 * -----------------------------------------------------------------
 * Acceso a datos de la bitacora `cotizaciones_log`.
 *
 * El historial se pagina en el SERVIDOR: traer todas las filas y paginar
 * en el navegador se rompe en cuanto la tabla crece. Ademas el filtro por
 * usuario se empuja al SQL para que un Analista nunca vea (ni pueda
 * filtrar) cotizaciones de otro usuario.
 *
 * Dos ajustes obligatorios para PostgreSQL:
 *   - la busqueda usa ILIKE, porque LIKE en Postgres distingue mayusculas
 *     y en SQLite no (el comportamiento anterior era insensible);
 *   - las fechas son TIMESTAMPTZ, asi que se comparan con cast a DATE.
 */

import { queryOne, queryAll, query, insertarDevolviendoId } from '../config/db.js';

/** SELECT base con los nombres de puerto resueltos via JOIN. */
const SELECT_BASE = `
  SELECT c.*,
         po.nombre AS puerto_origen,
         po.pais_origen AS puerto_origen_pais,
         po.region   AS puerto_origen_region,
         po.codigo   AS puerto_origen_codigo,
         pd.nombre AS puerto_destino,
         pd.codigo   AS puerto_destino_codigo
  FROM cotizaciones_log c
  JOIN puertos po ON po.id = c.puerto_origen_id
  JOIN puertos pd ON pd.id = c.puerto_destino_id
`;

/** Tope duro de registros por pagina, para proteger la memoria del servidor. */
const MAX_POR_PAGINA = 100;

/**
 * @param {object} cotizacion - Fila completa a persistir.
 * @returns {Promise<number>} id de la cotizacion creada.
 */
export async function crear(cotizacion) {
  return insertarDevolviendoId(
    `INSERT INTO cotizaciones_log (
        usuario_id, peso_kg, toneladas, cantidad_contenedores,
        puerto_origen_id, puerto_destino_id, tipo_contenedor, dias_viaje_base,
        valor_mercaderia_usd, capacidad_max_tn, precio_contenedor_usd, dias_contingencia,
        costo_flete_usd, seguro_usd, valor_cif_usd, impuesto_19_cif_usd, costo_total_usd,
        dias_transito, fecha_creacion
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
      RETURNING id`,
    [
      cotizacion.usuario_id,
      cotizacion.peso_kg,
      cotizacion.toneladas,
      cotizacion.cantidad_contenedores,
      cotizacion.puerto_origen_id,
      cotizacion.puerto_destino_id,
      cotizacion.tipo_contenedor,
      cotizacion.dias_viaje_base,
      cotizacion.valor_mercaderia_usd,
      cotizacion.capacidad_max_tn,
      cotizacion.precio_contenedor_usd,
      cotizacion.dias_contingencia,
      cotizacion.costo_flete_usd,
      cotizacion.seguro_usd,
      cotizacion.valor_cif_usd,
      cotizacion.impuesto_19_cif_usd,
      cotizacion.costo_total_usd,
      cotizacion.dias_transito,
    ],
  );
}

/**
 * Consulta paginada del historial.
 *
 * @param {object} filtros
 * @param {number|null} [filtros.usuarioId]   null = historial global (solo ADMIN).
 * @param {number|null} [filtros.puertoOrigenId]
 * @param {number|null} [filtros.puertoDestinoId]
 * @param {string|null} [filtros.busqueda]     Coincide con nombre de puerto.
 * @param {string|null} [filtros.desde]        'YYYY-MM-DD'
 * @param {string|null} [filtros.hasta]        'YYYY-MM-DD'
 * @param {number} [filtros.pagina]
 * @param {number} [filtros.porPagina]
 * @returns {Promise<{datos:object[], paginacion:{pagina:number, porPagina:number, total:number, totalPaginas:number}}>}
 */
export async function listar(filtros = {}) {
  const {
    usuarioId = null,
    puertoOrigenId = null,
    puertoDestinoId = null,
    busqueda = null,
    desde = null,
    hasta = null,
    pagina = 1,
    porPagina = 10,
  } = filtros;

  // --- Construccion dinamica del WHERE: cada filtro es un fragmento opcional ---
  // El numero de marcador se deriva de la cantidad de condiciones agregadas
  // (`valores.length + 1`), nunca de lo que el usuario escribio.
  const condiciones = [];
  const valores = [];

  if (usuarioId !== null) {
    condiciones.push(`c.usuario_id = $${valores.length + 1}`);
    valores.push(usuarioId);
  }
  if (puertoOrigenId !== null) {
    condiciones.push(`c.puerto_origen_id = $${valores.length + 1}`);
    valores.push(puertoOrigenId);
  }
  if (puertoDestinoId !== null) {
    condiciones.push(`c.puerto_destino_id = $${valores.length + 1}`);
    valores.push(puertoDestinoId);
  }
  if (busqueda) {
    // ILIKE, no LIKE: en PostgreSQL LIKE es sensible a mayusculas.
    const patron = `%${busqueda}%`;
    condiciones.push(
      `(po.nombre ILIKE $${valores.length + 1} OR pd.nombre ILIKE $${valores.length + 2})`,
    );
    valores.push(patron, patron);
  }
  if (desde) {
    condiciones.push(`CAST(c.fecha_creacion AS DATE) >= $${valores.length + 1}::date`);
    valores.push(desde);
  }
  if (hasta) {
    // El cast a DATE compara solo la parte de la fecha, asi que el dia final
    // se incluye completo.
    condiciones.push(`CAST(c.fecha_creacion AS DATE) <= $${valores.length + 1}::date`);
    valores.push(hasta);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { total } = await queryOne(
    `SELECT COUNT(*) AS total FROM cotizaciones_log c
     JOIN puertos po ON po.id = c.puerto_origen_id
     JOIN puertos pd ON pd.id = c.puerto_destino_id
     ${where}`,
    valores,
  );

  const limite = Math.min(Math.max(Number(porPagina) || 10, 1), MAX_POR_PAGINA);
  const paginaActual = Math.max(Number(pagina) || 1, 1);
  const offset = (paginaActual - 1) * limite;

  // LIMIT y OFFSET van al final de la lista de marcadores, por eso siguen la
  // numeracion de los filtros.
  const datos = await queryAll(
    `${SELECT_BASE} ${where}
     ORDER BY c.fecha_creacion DESC, c.id DESC
     LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
    [...valores, limite, offset],
  );

  return {
    datos,
    paginacion: {
      pagina: paginaActual,
      porPagina: limite,
      total,
      totalPaginas: Math.max(Math.ceil(total / limite), 1),
    },
  };
}

/**
 * @param {number} id
 * @returns {Promise<object|null>} Cotizacion enrichida con nombre y rol del usuario.
 */
export async function buscarPorId(id) {
  return queryOne(
    `SELECT c.*,
            po.nombre AS puerto_origen,
            po.pais_origen AS puerto_origen_pais,
            po.region   AS puerto_origen_region,
            po.codigo   AS puerto_origen_codigo,
            pd.nombre AS puerto_destino,
            pd.codigo   AS puerto_destino_codigo,
            u.nombre AS usuario_nombre,
            u.email  AS usuario_email,
            u.rol    AS usuario_rol
     FROM cotizaciones_log c
     JOIN puertos  po ON po.id = c.puerto_origen_id
     JOIN puertos  pd ON pd.id = c.puerto_destino_id
     JOIN usuarios u  ON u.id = c.usuario_id
     WHERE c.id = $1`,
    [id],
  );
}

/**
 * @param {number} id
 * @returns {Promise<boolean>}
 */
export async function eliminar(id) {
  const resultado = await query('DELETE FROM cotizaciones_log WHERE id = $1', [id]);
  return resultado.rowCount > 0;
}

/** @returns {Promise<object>} Metricas agregadas para la vista de resumen. */
export async function resumen() {
  return queryOne(`
    SELECT
      COUNT(*)                              AS total_cotizaciones,
      COALESCE(SUM(toneladas), 0)           AS toneladas_totales,
      COALESCE(SUM(cantidad_contenedores), 0) AS contenedores_totales,
      COALESCE(SUM(costo_total_usd), 0)     AS facturacion_total_usd
    FROM cotizaciones_log
  `);
}

/** @returns {Promise<number>} total de registros, para el seed. */
export async function contar() {
  const fila = await queryOne('SELECT COUNT(*) AS total FROM cotizaciones_log');
  return fila.total;
}

/** @returns {Promise<number>} total de usuarios, para el seed. */
export async function contarUsuarios() {
  const fila = await queryOne('SELECT COUNT(*) AS total FROM usuarios');
  return fila.total;
}
