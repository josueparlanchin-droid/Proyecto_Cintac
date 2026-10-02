/**
 * models/usuarioModel.js
 * -----------------------------------------------------------------
 * Acceso a datos de la tabla `usuarios`.
 *
 * REGLA DE ORO: todas las consultas usan marcadores posicionales ($1, $2)
 * enviados en un array. Nunca se concatena input del usuario dentro
 * del SQL, lo que neutraliza la inyeccion SQL.
 *
 * Las funciones son async porque el driver `pg` es asincrono. El correo se
 * normaliza a minuscula en el servicio de auth y en `crear`, porque en
 * PostgreSQL la comparacion `email = $1` distingue mayusculas.
 */

import { queryOne, queryAll, insertarDevolviendoId, query } from '../config/db.js';

/** Proyeccion segura: nunca se devuelve la columna `password`. */
const CAMPOS_PUBLICOS = 'id, nombre, email, rol, activo, creado_en';

/**
 * @param {string} email - ya normalizado a minuscula por el servicio.
 * @returns {Promise<object|null>} fila con password incluida, o null si no existe.
 */
export async function buscarPorEmail(email) {
  return queryOne('SELECT * FROM usuarios WHERE email = $1', [email]);
}

/**
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function buscarPorId(id) {
  return queryOne(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = $1`, [id]);
}

/**
 * Crea un usuario con la password ya hasheada por el servicio de auth.
 *
 * @param {{nombre:string, email:string, password:string, rol?:string}} datos
 * @returns {Promise<number>} id generado.
 */
export async function crear({ nombre, email, password, rol = 'ANALISTA' }) {
  return insertarDevolviendoId(
    `INSERT INTO usuarios (nombre, email, password, rol, activo)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING id`,
    [nombre, email.toLowerCase().trim(), password, rol],
  );
}

/**
 * @returns {Promise<object[]>} todos los usuarios sin su password.
 */
export async function listar() {
  return queryAll(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios ORDER BY nombre ASC`);
}

/**
 * Actualiza el hash de la password (rotacion de credenciales).
 *
 * @param {number} id
 * @param {string} passwordHash
 * @returns {Promise<boolean>}
 */
export async function actualizarPassword(id, passwordHash) {
  const resultado = await query('UPDATE usuarios SET password = $1 WHERE id = $2', [
    passwordHash,
    id,
  ]);
  return resultado.rowCount > 0;
}
