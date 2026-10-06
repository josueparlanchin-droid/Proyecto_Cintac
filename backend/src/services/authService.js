/**
 * services/authService.js
 * -----------------------------------------------------------------
 * Logica de autenticacion: verificacion de credenciales y emision de JWT.
 *
 * El hash con bcrypt NUNCA se compara ni se devuelve desde aqui; este
 * modulo es el unico lugar del backend que toca la columna `password`, y por
 * eso `hashPassword` vive aqui y no en el servicio de usuarios.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { buscarPorEmail } from '../models/usuarioModel.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../utils/constantes.js';
import { registrarFallo, limpiarFallos, consultarFallos } from '../middleware/rateLimit.js';

/** Costo de bcrypt: 10 rondas es el minimo recomendado hoy (OWASP). */
const SALT_ROUNDS = 10;

/** Ventana y tope del contador de intentos fallidos del login. */
const LIMITE_FALLIDOS = {
  max: env.AUTH_RATE_LIMIT_MAX,
  ventanaMs: env.AUTH_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
};

/**
 * Claves del contador de fallos.
 *
 * Se usan dos, a proposito:
 *  - `cuenta` aísla los fallos de una cuenta concreta, de modo que un usuario
 *    legitimo no bloquea a los demas que comparten su IP.
 *  - `ip` cubre el caso en que la cuenta NO existe. Si solo se contara por
 *    cuenta, un atacante probando miles de correos inventados tendria un
 *    contador nuevo cada vez y el limite no lo frenaria nunca.
 *
 * @param {string} ip
 * @param {string} correo
 * @returns {{cuenta:string, ip:string}}
 */
function clavesLogin(ip, correo) {
  const origen = ip ?? 'desconocido';
  return { cuenta: `login:${origen}:${correo}`, ip: `login-ip:${origen}` };
}

/**
 * Headers X-RateLimit-* derivados del estado de un contador.
 *
 * Se adjuntan a las respuestas correctas y tambien a las rechazadas (401 y
 * 429), para que el cliente sepa siempre cuanto le queda. En el 429 se suma
 * `Retry-After`, que es el header que un cliente HTTP respeta para reintentar.
 *
 * @param {{excedido:boolean, restantes:number, reintentoEn:number}} estado
 * @returns {Record<string,string>}
 */
function cabecerasIntentos(estado) {
  return {
    'X-RateLimit-Limit': String(LIMITE_FALLIDOS.max),
    'X-RateLimit-Remaining': String(estado.restantes),
    'X-RateLimit-Reset': String(Math.max(estado.reintentoEn, 0)),
  };
}

/**
 * Hashea una contrasena con bcrypt.
 *
 * Vive aqui, y no en el servicio de usuarios, para que exista UN solo lugar
 * en todo el backend que importe bcrypt. Si el hash se hiciera en dos
 * archivos, alguien acabaria usando `SALT_ROUNDS` distinto en uno de los dos,
 * y las cuentas creadas por un camino serian mas lentas de verificar que las
 * del otro.
 *
 * @param {string} passwordPlano
 * @returns {Promise<string>} hash bcrypt.
 */
export async function hashPassword(passwordPlano) {
  return bcrypt.hash(passwordPlano, SALT_ROUNDS);
}

/**
 * Verifica credenciales y firma un token.
 *
 * Un usuario inexistente y una password incorrecta producen el MISMO
 * error generico a proposito: differentiated mensajes permitirian
 * enumerar correos validos.
 *
 * Solo los intentos FALLIDOS consumen cuota. El limite se evalua al inicio,
 * pero contra el historial de fallos, no contra el numero de peticiones: por eso
 * un login correcto nunca bloquea a nadie y un atacante si queda acotado.
 *
 * @param {{email:string, password:string, ip?:string}} credenciales
 * @returns {Promise<{token:string, expiraEn:string, usuario:object, intentosRestantes:number}>}
 */
export async function login({ email, password, ip }) {
  const correo = email.toLowerCase().trim();
  const claves = clavesLogin(ip, correo);

  // Se consulta primero si la cuenta existe, porque de eso depende QUE
  // contador se evalua. Sin este orden, un atacante que escribiera 20 correos
  // inexistentes desde la misma IP dejaria el bucket de IP agotado, y el
  // siguiente login LEGITIMO desde esa IP seria rechazado con 429 aunque su
  // cuenta no tuviera ni un solo fallo.
  const fila = await buscarPorEmail(correo);

  if (!fila) {
    // Correo inexistente: no hay cuenta que aislar, asi que el intento se
    // contabiliza contra la IP. Es el patron tipico de un ataque que prueba
    // muchos correos distintos para enumerar cuentas validas.
    const antes = consultarFallos(claves.ip, LIMITE_FALLIDOS);
    if (antes.excedido) {
      throw ApiError.demasiadasSolicitudes(
        `Demasiados intentos fallidos de acceso. Espere ${env.AUTH_RATE_LIMIT_WINDOW_MIN} minutos.`,
        {
          codigo: 'LOGIN_RATE_LIMIT_EXCEDIDO',
          cabeceras: { ...cabecerasIntentos(antes), 'Retry-After': String(Math.max(antes.reintentoEn, 1)) },
        },
      );
    }

    registrarFallo(claves.ip, LIMITE_FALLIDOS.ventanaMs);
    throw ApiError.noAutorizado('Credenciales invalidas. Verifique correo y contrasena.', {
      cabeceras: cabecerasIntentos(consultarFallos(claves.ip, LIMITE_FALLIDOS)),
    });
  }

  // La cuenta existe: el bloqueo se evalua contra SU historial, nunca contra
  // el de la IP. Asi un usuario legitimo no puede quedar bloqueado por el
  // trafico de otras personas que salen desde la misma salida a internet.
  const estadoCuenta = consultarFallos(claves.cuenta, LIMITE_FALLIDOS);
  if (estadoCuenta.excedido) {
    throw ApiError.demasiadasSolicitudes(
      `Demasiados intentos fallidos de acceso. Espere ${env.AUTH_RATE_LIMIT_WINDOW_MIN} minutos.`,
      {
        codigo: 'LOGIN_RATE_LIMIT_EXCEDIDO',
        cabeceras: {
          ...cabecerasIntentos(estadoCuenta),
          'Retry-After': String(Math.max(estadoCuenta.reintentoEn, 1)),
        },
      },
    );
  }

  const passwordValida = await bcrypt.compare(password, fila.password);
  if (!passwordValida) {
    registrarFallo(claves.cuenta, LIMITE_FALLIDOS.ventanaMs);
    throw ApiError.noAutorizado('Credenciales invalidas. Verifique correo y contrasena.', {
      cabeceras: cabecerasIntentos(consultarFallos(claves.cuenta, LIMITE_FALLIDOS)),
    });
  }

  if (!fila.activo) {
    throw ApiError.prohibido('El usuario esta desactivado. Contacte a Jefatura Comex.');
  }

  // El acceso fue legitimo: se borra el historial de fallos de esta cuenta para
  // que no arrastre errores pasados hacia el futuro.
  limpiarFallos(claves.cuenta);

  const payload = {
    sub: fila.id,
    email: fila.email,
    rol: fila.rol,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

  return {
    token,
    expiraEn: env.JWT_EXPIRES_IN,
    usuario: {
      id: fila.id,
      nombre: fila.nombre,
      email: fila.email,
      rol: fila.rol,
      rolNombre: ROLES[fila.rol] ?? fila.rol,
    },
    intentosRestantes: consultarFallos(claves.cuenta, LIMITE_FALLIDOS).restantes,
    // Se devuelve aparte, no dentro de `usuario`, porque es metadata de
    // transporte: el controller la convierte en headers y no debe aparecer
    // en el cuerpo de la respuesta.
    cabeceras: cabecerasIntentos(consultarFallos(claves.cuenta, LIMITE_FALLIDOS)),
  };
}

/**
 * Firma un token sin consultar la base de datos.
 *
 * @param {{id:number, email:string, rol:string}} usuario
 * @returns {{token:string, expiraEn:string}}
 */
export function firmarToken(usuario) {
  const token = jwt.sign(
    { sub: usuario.id, email: usuario.email, rol: usuario.rol },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );
  return { token, expiraEn: env.JWT_EXPIRES_IN };
}

/**
 * Decodifica y valida un token.
 *
 * @param {string} token
 * @returns {object} payload del JWT.
 * @throws {ApiError} 401 si el token es invalido o expiro.
 */
export function verificarToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch (error) {
    const mensaje =
      error.name === 'TokenExpiredError'
        ? 'La sesion expiro. Inicie sesion nuevamente.'
        : 'Token de autenticacion invalido.';
    throw ApiError.noAutorizado(mensaje);
  }
}
