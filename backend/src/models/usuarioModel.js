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

// ------------------------------------------------------------------
// Gestion de cuentas: registro, rol y estado
// ------------------------------------------------------------------

/**
 * Da de alta una cuenta desde el auto-registro publico.
 *
 * A diferencia de `crear`, el rol queda FIJO en ANALISTA y se usa
 * `ON CONFLICT DO NOTHING`. Motivo: el auto-registro es publico, asi que
 * la unica forma de distinguir "correo libre" de "correo ya tomado" es
 * que la base de datos diga que no hizo falta insertar. Confiar en un
 * SELECT previo deja una carrera entre dos registros simultaneos con el
 * mismo correo.
 *
 * @param {{nombre:string, email:string, passwordHash:string}} datos
 * @returns {Promise<object|null>} la fila creada, o null si el correo ya existia.
 */
export async function registrar({ nombre, email, passwordHash }) {
  return queryOne(
    `INSERT INTO usuarios (nombre, email, password, rol, activo)
     VALUES ($1, $2, $3, 'ANALISTA', TRUE)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${CAMPOS_PUBLICOS}`,
    [nombre, email.toLowerCase().trim(), passwordHash],
  );
}

/**
 * Cambia el rol de una cuenta entre ADMIN_COMEX y ANALISTA.
 *
 * @param {number} id
 * @param {'ADMIN_COMEX'|'ANALISTA'} rol
 * @returns {Promise<object|null>} la fila actualizada, o null si el id no existe.
 */
export async function actualizarRol(id, rol) {
  return queryOne(
    `UPDATE usuarios SET rol = $1 WHERE id = $2 RETURNING ${CAMPOS_PUBLICOS}`,
    [rol, id],
  );
}

/**
 * Activa o desactiva una cuenta (baja logica).
 *
 * No es un borrado: `cotizaciones_log.usuario_id` esta declarado con
 * `ON DELETE RESTRICT`, y con razon, porque el historial de cotizaciones
 * es contable. Desactivar deja la cuenta fuera del acceso y conserva
 * toda su trazabilidad.
 *
 * @param {number} id
 * @param {boolean} activo
 * @returns {Promise<object|null>} la fila actualizada, o null si el id no existe.
 */
export async function actualizarActivo(id, activo) {
  return queryOne(
    `UPDATE usuarios SET activo = $1 WHERE id = $2 RETURNING ${CAMPOS_PUBLICOS}`,
    [activo, id],
  );
}

/**
 * Bloquea a los administradores que pueden iniciar sesion ahora mismo.
 *
 * Es la pieza que hace ATOMICA la salvaguarda del ultimo administrador. Con un
 * `COUNT(*)` a secas, dos administradores que se degradan mutuamente a la vez
 * leen ambos "hay 2" y los dos aceptan: el sistema queda sin administracion.
 * Con `FOR UPDATE` el segundo se queda esperando a que el primero confirme, y
 * al despertar vuelve a contar sobre el estado ya actualizado.
 *
 * El `ORDER BY id` no es decorativo: fija el orden en que se toman los
 * bloqueos para que dos transacciones concurrentes los pidan siempre en la
 * misma secuencia. Sin el, dos peticiones simultaneas podrian cruzarse y
 * provocar un interbloqueo.
 *
 * @returns {Promise<object[]>} filas bloqueadas; el `.length` es el conteo.
 */
export async function bloquearAdministradoresActivos() {
  return queryAll(
    `SELECT id, nombre, email, rol
       FROM usuarios
      WHERE rol = 'ADMIN_COMEX' AND activo = TRUE
      ORDER BY id
        FOR UPDATE`,
  );
}

/**
 * Lee un usuario y lo bloquea para actualizacion.
 *
 * El `FOR UPDATE` cierra la ventana entre "leer el rol actual" y "cambiarlo":
 * sin el, dos peticiones simultaneas podrian decidir ambas cosas sobre un
 * estado que ya cambio.
 *
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function buscarPorIdBloqueado(id) {
  return queryOne(`SELECT ${CAMPOS_PUBLICOS} FROM usuarios WHERE id = $1 FOR UPDATE`, [id]);
}

/**
 * Anota una accion de administracion en la bitacora.
 *
 * NO captura el error a proposito. El servicio llama a esta funcion dentro de
 * la misma transaccion que modifica la cuenta, y ahi un fallo debe abortar las
 * dos cosas: una cuenta degradada sin su anotacion correspondiente es
 * justamente el hueco que la bitacora existe para tapar.
 *
 * @param {{usuarioObjetivoId:number, administradorId?:number|null, administradorEmail?:string|null,
 *          accion:string, rolAnterior?:string|null, rolNuevo?:string|null, detalle?:string|null}} datos
 * @returns {Promise<void>}
 */
export async function registrarAuditoria({
  usuarioObjetivoId,
  administradorId = null,
  administradorEmail = null,
  accion,
  rolAnterior = null,
  rolNuevo = null,
  detalle = null,
}) {
  await query(
    `INSERT INTO usuarios_auditoria
       (usuario_objetivo_id, administrador_id, administrador_email,
        accion, rol_anterior, rol_nuevo, detalle)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [usuarioObjetivoId, administradorId, administradorEmail, accion, rolAnterior, rolNuevo, detalle],
  );
}

/**
 * Historial de acciones sobre una cuenta, del mas reciente al mas antiguo.
 *
 * @param {number} usuarioId
 * @returns {Promise<object[]>}
 */
export async function listarAuditoria(usuarioId) {
  return queryAll(
    `SELECT id, accion, administrador_email, rol_anterior, rol_nuevo, detalle, creado_en
       FROM usuarios_auditoria
      WHERE usuario_objetivo_id = $1
      ORDER BY creado_en DESC, id DESC`,
    [usuarioId],
  );
}
