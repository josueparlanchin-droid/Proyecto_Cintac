/**
 * middleware/rateLimit.js
 * -----------------------------------------------------------------
 * SIMULACION de Rate Limiting, implementada a mano (no se usa la libreria
 * express-rate-limit) para que el proyecto muestre el algoritmo de forma
 * explicita durante la defensa.
 *
 * Que hace y por que importa:
 *  - cuenta peticiones por IP dentro de una ventana deslizante;
 *  - al superarla, responde 429 y NO ejecuta el controller (ahorra CPU y
 *    evita que un atacante pueda forzar bcrypt, que es costoso);
 *  - expone los headers X-RateLimit-* en TODAS las respuestas, para que el
 *    limite sea observable desde las DevTools del navegador.
 *
 * Limitacion conocida y asumida: el almacen es un Map en memoria del
 * proceso. Con varias instancias habria que usar Redis.
 */

import { ApiError } from '../utils/ApiError.js';

/** bucket = clave -> { timestamps: number[], ventanaMs: number }. */
const buckets = new Map();

/**
 * Obtiene el bucket de una clave y descarta las marcas de tiempo vencidas.
 *
 * @param {string} clave
 * @param {number} ventanaMs
 * @returns {{timestamps:number[], ventanaMs:number}}
 */
function obtenerBucket(clave, ventanaMs) {
  let bucket = buckets.get(clave);
  if (!bucket) {
    bucket = { timestamps: [], ventanaMs };
    buckets.set(clave, bucket);
  }
  // Ventana deslizante: descarta las marcas de tiempo ya vencidas.
  bucket.timestamps = bucket.timestamps.filter((t) => Date.now() - t < ventanaMs);
  return bucket;
}

/**
 * Elimina entradas vencidas. Corre periodicamente para que el Map no
 * crezca de forma indefinida en un servidor con mucho trafico.
 */
const temporizadorLimpieza = setInterval(() => {
  const ahora = Date.now();
  for (const [clave, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => ahora - t < bucket.ventanaMs);
    if (bucket.timestamps.length === 0) buckets.delete(clave);
  }
}, 60_000);

// `unref()` evita que este intervalo mantenga vivo el proceso al tests/shutdown.
temporizadorLimpieza.unref?.();

/**
 * @param {object} opciones
 * @param {number} opciones.max              - Peticiones permitidas por ventana.
 * @param {number} opciones.windowMs          - Duracion de la ventana.
 * @param {string} [opciones.mensaje]         - Mensaje del 429.
 * @param {string} [opciones.nombre]          - Prefijo del bucket.
 * @param {string} [opciones.codigo]          - Codigo de error del 429. Permite
 *   distinguir que limitador actuo (global o de login) en lugar de obligar al
 *   cliente a adivinarlo por el mensaje.
 * @returns {import('express').RequestHandler}
 */
export function rateLimiter({ max, windowMs, mensaje, nombre = 'general', codigo }) {
  return function aplicarRateLimit(req, res, next) {
    const bucket = obtenerBucket(`${nombre}:${req.ip ?? 'desconocido'}`, windowMs);
    const ahora = Date.now();

    const restantes = Math.max(max - bucket.timestamps.length, 0);
    const limiteAlcanzado = bucket.timestamps.length >= max;

    // Headers observables siempre, tanto en exito como en 429.
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', restantes);
    res.setHeader('X-RateLimit-Reset', Math.ceil((bucket.timestamps[0] + windowMs - ahora) / 1000));

    if (limiteAlcanzado) {
      const reintentoEn = Math.ceil((bucket.timestamps[0] + windowMs - ahora) / 1000);
      res.setHeader('Retry-After', reintentoEn);
      return next(
        ApiError.demasiadasSolicitudes(
          mensaje ?? `Demasiadas solicitudes. Intente nuevamente en ${reintentoEn} segundos.`,
          codigo ? { codigo } : undefined,
        ),
      );
    }

    bucket.timestamps.push(ahora);
    return next();
  };
}

/**
 * ==================================================================
 *  Contador de INTENTOS FALLIDOS
 * ==================================================================
 *
 * A diferencia de `rateLimiter`, esto NO es un middleware: se consulta DESPUES
 * de verificar las credenciales, porque solo los intentos fallidos deben
 * contar. Asi un login correcto nunca agota el cupo ni bloquea a un usuario
 * legitimo, mientras que un atacante sigue topandose con el limite tras `max`
 * intentos.
 *
 * Ademas la clave la elige quien lo usa (ver `authService`), no la IP sola:
 * aislar por cuenta evita que en una red compartida, como un laboratorio
 * universitario con una sola IP publica, un usuario bloquee a todos los demas.
 */

/**
 * Registra un intento fallido para una clave.
 *
 * @param {string} clave
 * @param {number} ventanaMs
 */
export function registrarFallo(clave, ventanaMs) {
  obtenerBucket(clave, ventanaMs).timestamps.push(Date.now());
}

/**
 * Limpia el contador de una clave. Se invoca tras un login CORRECTO, para que
 * un usuario que se equivoco un par de veces y luego entra bien no arrastre el
 * historial de errores hacia adelante.
 *
 * @param {string} clave
 */
export function limpiarFallos(clave) {
  buckets.delete(clave);
}

/**
 * Consulta el estado del contador, ya en formato listo para responder.
 *
 * @param {string} clave
 * @param {{max:number, ventanaMs:number}} opciones
 * @returns {{excedido:boolean, restantes:number, reintentoEn:number}}
 */
export function consultarFallos(clave, { max, ventanaMs }) {
  const bucket = obtenerBucket(clave, ventanaMs);
  const restantes = Math.max(max - bucket.timestamps.length, 0);

  return {
    excedido: bucket.timestamps.length >= max,
    restantes,
    // Segundos que faltan para que se libere el mas antiguo de la ventana.
    reintentoEn: bucket.timestamps.length
      ? Math.ceil((bucket.timestamps[0] + ventanaMs - Date.now()) / 1000)
      : 0,
  };
}

/** Libera los contadores. Se usa en tests para no arrastrar estado. */
export function limpiarContadores() {
  buckets.clear();
}

/** @returns {object} estado actual de los contadores (para /health y debug). */
export function estadoContadores() {
  return { bucketsActivos: buckets.size };
}