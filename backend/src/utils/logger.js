/**
 * utils/logger.js
 * -----------------------------------------------------------------
 * Logger minimo con marcas de tiempo. Sustituye a `console.log` directo
 * para que la salida sea consistente y se pueda silencio en produccion.
 */

const prefijo = (nivel) => `[${new Date().toISOString()}] [${nivel}]`;

export const logger = Object.freeze({
  info: (...args) => console.log(prefijo('INFO '), ...args),
  warn: (...args) => console.warn(prefijo('WARN '), ...args),
  error: (...args) => console.error(prefijo('ERROR'), ...args),
  /** Log de peticion HTTP; lo invoca el middleware de registro. */
  http: (metodo, ruta, codigo, ms) =>
    console.log(prefijo('HTTP '), `${metodo} ${ruta} -> ${codigo} (${ms}ms)`),
});