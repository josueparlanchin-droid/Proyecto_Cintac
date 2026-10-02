/**
 * config/db.js
 * -----------------------------------------------------------------
 * Conexion a PostgreSQL mediante `pg` (driver oficial).
 *
 * Antes se usaba `node:sqlite` porque no exigia instalar un motor de base
 * de datos. Para desplegar en Render/Vercel hace falta persistencia real,
 * asi que el motor paso a ser PostgreSQL alojado en Neon.
 *
 * Las diferencias que mas afectan a este proyecto:
 *
 *  1. `NUMERIC` llega como TEXTO. Postgres entrega los numeric como string
 *     para no perder precision, y eso romperia el calculo (que suma
 *     precio_usd * contenedores) y el JSON del frontend ("2450.00" en vez
 *     de 2450). Se registra un type parser que los convierte a Number.
 *     La precision sigue garantizada DENTRO de Postgres; lo que sale hacia
 *     JS vuelve a ser float, igual que cuando la columna era REAL.
 *
 *  2. `COUNT(*)` llega como string (bigint, OID 20). Se convierte igual,
 *     porque un conteo jamas supera 2^53.
 *
 *  3. `LIKE` distingue mayusculas en Postgres (en SQLite no). Las busquedas
 *     del historial usan `ILIKE` para conservar el comportamiento previo.
 *
 *  4. `date(x)` sobre un TIMESTAMPTZ necesita cast explicito, y `?` pasa a
 *     ser `$1`, `$2`, ... en el orden en que se entregan los valores.
 *
 * REGLA DE ORO: nunca se concatena input del usuario dentro del SQL, siempre
 * marcadores posicionales.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import env from './env.js';
import { logger } from '../utils/logger.js';

const { Pool, types } = pg;

// --- 1. NUMERIC (OID 1700) -> Number -------------------------------------
// Sin esto, `precio_usd` seria "2450.00" (string) y la cuenta
// `cantidad * precio` de calculoService devolveria NaN.
types.setTypeParser(1700, (valor) => (valor === null ? null : Number(valor)));

// --- 2. int8 / bigint (OID 20) -> Number ---------------------------------
// COUNT(*) y los contadores del seed/panel resumen.
types.setTypeParser(20, (valor) => (valor === null ? null : Number(valor)));

/**
 * Pool de conexiones a la base configurada en DATABASE_URL.
 * `max: 10` es deliberado: Neon en plan gratuito limita las conexiones
 * concurrentes del pooler, y Render solo levanta un proceso Node.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

/**
 * Cliente de la transaccion en curso, por cadena asincrona.
 *
 * Se usa AsyncLocalStorage y no una variable global porque el servidor
 * atiende varias peticiones a la vez: si `enTransaccion` guardase el cliente
 * en un modulo, una peticion concurrente podria escribir dentro de la
 * transaccion de otra. Cada `enTransaccion` abre su propio contexto, asi que
 * el aislamiento es correcto sin tener que pasar el cliente a mano por
 * todos los modelos.
 * @type {AsyncLocalStorage<import('pg').PoolClient>}
 */
const clienteEnTransaccion = new AsyncLocalStorage();

/**
 * Ejecuta un SELECT y devuelve la primera fila, o null.
 *
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<object|null>}
 */
export async function queryOne(sql, params = []) {
  const cliente = clienteEnTransaccion.getStore() ?? pool;
  const { rows } = await cliente.query(sql, params);
  return rows[0] ?? null;
}

/**
 * Ejecuta un SELECT y devuelve todas las filas.
 *
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<object[]>}
 */
export async function queryAll(sql, params = []) {
  const cliente = clienteEnTransaccion.getStore() ?? pool;
  const { rows } = await cliente.query(sql, params);
  return rows;
}

/**
 * Ejecuta un INSERT/UPDATE/DELETE y devuelve el detalle de `pg`
 * (incluye `rowCount`, que reemplaza al `changes` de SQLite).
 *
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(sql, params = []) {
  const cliente = clienteEnTransaccion.getStore() ?? pool;
  return cliente.query(sql, params);
}

/**
 * Envoltura de INSERT que devuelve el id generado.
 *
 * Usa `RETURNING id` en vez del viejo `lastInsertRowid`, que solo existe
 * en SQLite. Es una consulta extra de red pero mantiene el mismo contrato
 * para quien llama.
 *
 * @param {string} sql - Sentencia con un `RETURNING id` al final.
 * @param {unknown[]} [params]
 * @returns {Promise<number>}
 */
export async function insertarDevolviendoId(sql, params = []) {
  const fila = await queryOne(sql, params);
  return fila?.id ?? null;
}

/**
 * Ejecuta `callback` dentro de una transaccion: COMMIT si termina bien,
 * ROLLBACK si lanza.
 *
 * Todo lo que el callback ejecute a traves de `query`/`queryOne`/`queryAll`
 * usa automaticamente la misma conexion, aunque llame a varios niveles mas
 * abajo (servicio -> modelo). Asi el seed puede llamar a `simular()` dentro de
 * una transaccion sin que sus INSERT se fuguen a otra conexion.
 *
 * @template T
 * @param {(cliente: import('pg').PoolClient) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function enTransaccion(callback) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await clienteEnTransaccion.run(cliente, () => callback(cliente));
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch((e) =>
      logger.error('No se pudo revertir la transaccion:', e.message),
    );
    throw error;
  } finally {
    cliente.release();
  }
}

/**
 * Crea las tablas si no existen.
 *
 * Todo el esquema se manda en una sola sentencia: sin parametros, `pg` usa
 * el protocolo simple, que admite varias sentencias separadas por `;`.
 *
 * @returns {Promise<void>}
 */
export async function inicializarEsquema() {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const rutaEsquema = join(aqui, '..', 'db', 'schema.sql');
  const sql = readFileSync(rutaEsquema, 'utf8');

  await pool.query(sql);
  logger.info('Esquema verificado en PostgreSQL.');
}

/**
 * Descripcion segura de la base activa, para los logs de arranque.
 * Oculta la contraseña por si el mensaje llega a una plataforma externa.
 *
 * @returns {string}
 */
export function descripcionBaseDatos() {
  try {
    const url = new URL(env.DATABASE_URL);
    return `${url.protocol}//${url.username}:***@${url.host}${url.pathname}`;
  } catch {
    return '(DATABASE_URL no valida)';
  }
}

/**
 * Cierra el pool. Se usa al apagar el servidor para no dejar conexiones
 * colgadas en Neon.
 *
 * @returns {Promise<void>}
 */
export async function cerrarBaseDatos() {
  await pool.end();
}
