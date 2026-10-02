/**
 * middleware/registrarPeticiones.js
 * -----------------------------------------------------------------
 * Log de acceso HTTP: metodo, ruta, codigo de respuesta y duracion.
 * A diferencia de Morgan, no agrega dependencias.
 */

import { logger } from '../utils/logger.js';

/**
 * @type {import('express').RequestHandler}
 */
export function registrarPeticiones(req, res, next) {
  const inicio = performance.now();

  res.on('finish', () => {
    const duracionMs = Math.round(performance.now() - inicio);
    logger.http(req.method, req.originalUrl, res.statusCode, duracionMs);
  });

  next();
}