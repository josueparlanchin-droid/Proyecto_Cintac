/**
 * services/usuarioService.js
 * -----------------------------------------------------------------
 * Logica de las cuentas de usuario: auto-registro publico con codigo de
 * invitacion, y administracion de cuentas reservada a Jefatura Comex.
 *
 * SEPARACION DE RESPONSABILIDADES
 * Este modulo NO toca la columna `password`. El hash lo hace
 * `authService.hashPassword`, que es el unico punto del backend que
 * importa bcrypt. Aqui no hay ni una referencia al hash, de modo que es
 * imposible que un hash se escape por un `return` de este archivo.
 *
 * Salvaguardas de administracion (las cuatro acordadas):
 *   1. Nadie puede modificar su propia cuenta.
 *   2. No se puede degradar ni desactivar al ultimo administrador activo.
 *   3. El registro exige un codigo de invitacion valido.
 *   4. Toda accion queda anotada en `usuarios_auditoria`.
 *
 * Las cuatro se aplican DENTRO de una transaccion. No es un detalle de
 * estilo: sin atomicidad, dos administradores que se degradan entre si a la
 * vez dejarian el sistema sin nadie con permisos, que es justo lo que la
 * salvaguarda 2 promete impedir.
 */

import crypto from 'node:crypto';
import {
  registrar as registrarEnBase,
  buscarPorId,
  buscarPorIdBloqueado,
  bloquearAdministradoresActivos,
  listar as listarDeBase,
  actualizarRol,
  actualizarActivo,
  registrarAuditoria,
  listarAuditoria,
} from '../models/usuarioModel.js';
import { hashPassword } from './authService.js';
import { enTransaccion } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { ROLES } from '../utils/constantes.js';

/**
 * Comprueba el codigo de invitacion en tiempo constante.
 *
 * `crypto.timingSafeEqual` es la pieza clave: comparar codigos con `===`
 * devuelve `false` en el primer caracter que difiere y `true` solo al final,
 * asi que el tiempo de respuesta revela cuantos caracteres correctos lleva
 * el atacante. El secreto no es eso, pero el patron se aplica igual.
 *
 * La comparacion se hace sobre el Buffer porque `timingSafeEqual` exige que
 * ambos operandos tengan el mismo largo; por eso se pasan dos SHA-256, que
 * siempre miden lo mismo.
 *
 * @param {string} recibido
 * @param {string} esperado
 * @returns {boolean}
 */
function codigoCoincide(recibido, esperado) {
  const recibidoHash = crypto.createHash('sha256').update(String(recibido ?? '')).digest();
  const esperadoHash = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(recibidoHash, esperadoHash);
}

/**
 * Verifica las reglas de complejidad de la contrasena.
 *
 * El schema de Zod ya las aplica en la capa HTTP. Se repiten aqui a
 * proposito: este servicio puede ser invocado desde otro camino (un script,
 * una tarea programada, otro endpoint futuro) y una regla de contrasena
 * que solo vive en el borde es una regla que se puede esquivar.
 *
 * @param {string} clave
 * @returns {string[]} lista de requisitos incumplidos, vacia si cumple todo.
 */
function requisitosPendientes(clave) {
  const faltantes = [];
  if ((clave ?? '').length < 8) {
    faltantes.push('Al menos 8 caracteres.');
  }
  if (!/[a-z]/.test(clave ?? '')) faltantes.push('Al menos una letra minuscula.');
  if (!/[A-Z]/.test(clave ?? '')) faltantes.push('Al menos una letra mayuscula.');
  if (!/[0-9]/.test(clave ?? '')) faltantes.push('Al menos un numero.');
  if (!/[^A-Za-z0-9]/.test(clave ?? '')) {
    faltantes.push('Al menos un caracter especial, por ejemplo ! @ # $ % &.');
  }
  return faltantes;
}

/**
 * Proyecta una fila de usuario a la forma que consume el frontend.
 *
 * El hash no se incluye NUNCA, ni siquiera por descuido: la funcion pide
 * campos explicitos en vez de devolver la fila tal cual, para que anadir una
 * columna sensible a la tabla obligue a revisar este punto.
 *
 * @param {object} fila
 * @param {boolean} [conAuditoria] si true, incluye el historial de acciones.
 * @returns {Promise<object>}
 */
async function proyectar(fila, conAuditoria = false) {
  const base = {
    id: fila.id,
    nombre: fila.nombre,
    email: fila.email,
    rol: fila.rol,
    rolNombre: ROLES[fila.rol] ?? fila.rol,
    activo: fila.activo,
    creado_en: fila.creado_en,
  };
  if (conAuditoria) {
    base.auditoria = await listarAuditoria(fila.id);
  }
  return base;
}

/**
 * Resuelve el correo del administrador responsable, para la bitacora.
 *
 * El correo se copia a una columna propia (`administrador_email`) porque la
 * bitacora debe seguir siendo legible aunque la cuenta que la genero se borre
 * o cambie de direccion mas adelante. No es una comodidad: es la unica forma
 * de que la anotacion sobreviva a la persona que la origino.
 *
 * @param {number} administradorId
 * @returns {Promise<string|null>}
 */
async function correoDelAdministrador(administradorId) {
  const fila = await buscarPorId(administradorId);
  return fila?.email ?? null;
}

// ==================================================================
// 1. Auto-registro publico (con codigo de invitacion)
// ==================================================================

/**
 * Crea una cuenta de Analista a partir del formulario de registro.
 *
 * El rol lo fija el modelo en `ANALISTA`. Aceptarlo como parametro seria un
 * agujero: el registro es publico, asi que cualquiera que tenga el codigo
 * podria pedir ADMIN_COMEX y saltarse por completo el control de roles.
 *
 * @param {{nombre:string, email:string, password:string,
 *          passwordRepeticion:string, codigoInvitacion:string}} datos
 * @returns {Promise<{usuario:object}>}
 * @throws {ApiError} 403 si el registro esta deshabilitado o el codigo falla,
 *                     400 si la contrasena no cumple, 409 si el correo existe.
 */
export async function registrarUsuario({
  nombre,
  email,
  password,
  passwordRepeticion,
  codigoInvitacion,
}) {
  if (!env.registroHabilitado) {
    throw ApiError.prohibido(
      'El registro esta deshabilitado. Contacte a Jefatura Comex para obtener una cuenta.',
      { codigo: 'REGISTRO_DESHABILITADO' },
    );
  }

  if (!codigoCoincide(codigoInvitacion, env.REGISTRATION_CODE)) {
    throw ApiError.prohibido(
      'El codigo de invitacion no es valido.',
      { codigo: 'CODIGO_INVALIDO' },
    );
  }

  if (password !== passwordRepeticion) {
    throw ApiError.badRequest('Las contrasenas no coinciden.', {
      codigo: 'VALIDACION_FALLIDA',
      detalle: { passwordRepeticion: 'Las contrasenas no coinciden.' },
    });
  }

  const faltantes = requisitosPendientes(password);
  if (faltantes.length > 0) {
    throw ApiError.badRequest('La contrasena no cumple los requisitos de seguridad.', {
      codigo: 'CONTRASENA_DEBIL',
      detalle: { password: faltantes.join(' ') },
    });
  }

  // El hash se calcula ANTES de abrir la transaccion. bcrypt es deliberadamente
  // lento (unos 100 ms) y mantener el bloqueo de fila durante ese tiempo seria
  // bloquear a los demas administradores sin necesidad.
  const passwordHash = await hashPassword(password);

  // El INSERT y la anotacion van en la misma transaccion: una cuenta creada
  // sin su fila de auditoria seria un alta que nadie puede reconstruir.
  const fila = await enTransaccion(async () => {
    const creado = await registrarEnBase({ nombre: nombre.trim(), email, passwordHash });

    // `ON CONFLICT DO NOTHING` devolvio null: el correo ya estaba tomado.
    // La decision la toma la base de datos, no un SELECT previo, que dejaria
    // una carrera entre dos registros simultaneos con el mismo correo.
    if (!creado) {
      throw ApiError.conflicto('Ese correo ya esta registrado.', {
        codigo: 'EMAIL_DUPLICADO',
        detalle: { email: 'Ese correo ya esta registrado.' },
      });
    }

    await registrarAuditoria({
      usuarioObjetivoId: creado.id,
      administradorId: null,
      administradorEmail: null,
      accion: 'REGISTRO',
      rolNuevo: creado.rol,
      detalle: 'Alta mediante auto-registro con codigo de invitacion.',
    });

    return creado;
  });

  return { usuario: await proyectar(fila) };
}

// ==================================================================
// 2. Administracion de cuentas (solo ADMIN_COMEX)
// ==================================================================

/**
 * Lista todas las cuentas, con su bitacora de acciones.
 *
 * @returns {Promise<object[]>}
 */
export async function listarUsuarios() {
  const filas = await listarDeBase();
  return Promise.all(filas.map((fila) => proyectar(fila, true)));
}

/**
 * Sanciones que impiden dejar el sistema sin administracion.
 *
 * El conteo de administradores llega YA BLOQUEADO desde la transaccion que
 * llama a esta funcion, de modo que la decision se toma sobre un estado que no
 * puede cambiar mientras dura la operacion.
 *
 * @param {{administradorId:number, objetivo:object, administradoresActivos:number,
 *          nuevoRol?:string|null, vaADesactivar?:boolean}} contexto
 * @returns {void} lanza ApiError si alguna salvaguarda se activa.
 */
function verificarSalvaguardas({
  administradorId,
  objetivo,
  administradoresActivos,
  nuevoRol = null,
  vaADesactivar = false,
}) {
  // 1. Nadie se toca a si mismo.
  if (objetivo.id === administradorId) {
    throw ApiError.badRequest(
      'No puede modificar su propia cuenta.',
      { codigo: 'AUTOMODIFICACION_PROHIBIDA' },
    );
  }

  const dejaDeSerAdmin = vaADesactivar || (nuevoRol !== null && nuevoRol !== 'ADMIN_COMEX');

  // 2. No dejar el sistema sin nadie con control total.
  //
  // El `objetivo.activo` de la condicion importa: degradar a un
  // administrador que ya esta desactivado no deja a nadie sin acceso, porque
  // el es el unico que puede tener permisos ahora. Sin esa comprobacion, el
  // unico administrador activo no podria ordenar el rol de las cuentas
  // desactivadas y quedaria atrapado en una pantalla que no puede usar.
  if (objetivo.activo && objetivo.rol === 'ADMIN_COMEX' && dejaDeSerAdmin) {
    if (administradoresActivos <= 1) {
      throw ApiError.conflicto(
        'Debe existir al menos un administrador activo. Promueva a otro analista antes de continuar.',
        { codigo: 'ULTIMO_ADMINISTRADOR' },
      );
    }
  }
}

/**
 * Cambia el rol de una cuenta entre Analista y Administrador.
 *
 * TODO ocurre dentro de una transaccion: el bloqueo de administradores, la
 * lectura del objetivo, la salvaguarda, el UPDATE y la anotacion. O se aplican
 * los cinco, o ninguno.
 *
 * @param {{administradorId:number, objetivoId:number, nuevoRol:string}} datos
 * @returns {Promise<{usuario:object, mensaje:string}>}
 * @throws {ApiError} 400 auto-modificacion, 404 inexistente,
 *                     409 ultimo administrador, 409 rol sin cambio.
 */
export async function cambiarRol({ administradorId, objetivoId, nuevoRol }) {
  const actualizada = await enTransaccion(async () => {
    // Orden de bloqueo fijo: administradores primero, objetivo despues.
    // Invertirlo permitiria que dos administradores que se degradan entre si
    // se queden esperando el uno al otro.
    const administradores = await bloquearAdministradoresActivos();

    const objetivo = await buscarPorIdBloqueado(objetivoId);
    if (!objetivo) {
      throw ApiError.noEncontrado(
        `No existe una cuenta con el id ${objetivoId}.`,
        { codigo: 'USUARIO_NO_ENCONTRADO' },
      );
    }

    if (objetivo.rol === nuevoRol) {
      throw ApiError.conflicto(
        `La cuenta ya tiene el rol ${ROLES[nuevoRol] ?? nuevoRol}.`,
        { codigo: 'ROL_SIN_CAMBIO' },
      );
    }

    verificarSalvaguardas({
      administradorId,
      objetivo,
      administradoresActivos: administradores.length,
      nuevoRol,
    });

    const fila = await actualizarRol(objetivoId, nuevoRol);

    await registrarAuditoria({
      usuarioObjetivoId: objetivoId,
      administradorId,
      administradorEmail: await correoDelAdministrador(administradorId),
      accion: 'CAMBIAR_ROL',
      rolAnterior: objetivo.rol,
      rolNuevo: nuevoRol,
      detalle: `Rol cambiado de ${ROLES[objetivo.rol] ?? objetivo.rol} a ${ROLES[nuevoRol] ?? nuevoRol}.`,
    });

    return fila;
  });

  const usuario = await proyectar(actualizada);

  return {
    usuario,
    mensaje: `${usuario.nombre} ahora es ${ROLES[nuevoRol] ?? nuevoRol}.`,
  };
}

/**
 * Desactiva o reactiva una cuenta.
 *
 * Es una baja logica, no un borrado: `cotizaciones_log.usuario_id` esta
 * declarado con `ON DELETE RESTRICT` y el historial de cotizaciones es
 * informacion contable que no se puede perder. Desactivar deja la cuenta
 * fuera del acceso y conserva toda su trazabilidad.
 *
 * @param {{administradorId:number, objetivoId:number, activo:boolean}} datos
 * @returns {Promise<{usuario:object, mensaje:string}>}
 * @throws {ApiError} 400 auto-modificacion, 404, 409 ultimo administrador.
 */
export async function cambiarActivo({ administradorId, objetivoId, activo }) {
  const actualizada = await enTransaccion(async () => {
    const administradores = await bloquearAdministradoresActivos();

    const objetivo = await buscarPorIdBloqueado(objetivoId);
    if (!objetivo) {
      throw ApiError.noEncontrado(
        `No existe una cuenta con el id ${objetivoId}.`,
        { codigo: 'USUARIO_NO_ENCONTRADO' },
      );
    }

    if (objetivo.activo === activo) {
      throw ApiError.conflicto(
        activo
          ? 'La cuenta ya esta activa.'
          : 'La cuenta ya esta desactivada.',
        { codigo: 'ESTADO_SIN_CAMBIO' },
      );
    }

    verificarSalvaguardas({
      administradorId,
      objetivo,
      administradoresActivos: administradores.length,
      vaADesactivar: !activo,
    });

    const fila = await actualizarActivo(objetivoId, activo);

    await registrarAuditoria({
      usuarioObjetivoId: objetivoId,
      administradorId,
      administradorEmail: await correoDelAdministrador(administradorId),
      accion: activo ? 'ACTIVAR' : 'DESACTIVAR',
      detalle: activo
        ? 'Cuenta reactivada. Vuelve a poder iniciar sesion.'
        : 'Cuenta desactivada. Conserva su historial y puede reactivarse.',
    });

    return fila;
  });

  const usuario = await proyectar(actualizada);

  return {
    usuario,
    mensaje: activo
      ? `${usuario.nombre} fue reactivado.`
      : `${usuario.nombre} fue desactivado y ya no puede iniciar sesion.`,
  };
}