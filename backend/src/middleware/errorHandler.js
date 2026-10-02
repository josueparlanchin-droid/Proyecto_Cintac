/**
 * middleware/errorHandler.js
 * -----------------------------------------------------------------
 * Manejo centralizado de errores.
 *
 * Regla de seguridad: al cliente solo se le envian errores ESPERADOS
 * (los ApiError lanzados a proposito). Cualquier excepcion inesperada se
 * registra completa en el log del servidor pero se responde con un 500
 * generico, para no filtrar rutas de archivos ni estructura interna.
 */

import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

/**
 * 404 para cualquier ruta no registrada. Se monta DESPUES de las rutas
 * reales, por eso usa 4 argumentos (err, req, res, next).
 *
 * @type {import('express').RequestHandler}
 */
export function noEncontrado(req, res, next) {
  next(
    ApiError.noEncontrado(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, {
      codigo: 'RUTA_NO_ENCONTRADA',
    }),
  );
}

/**
 * @param {Error} error
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
// eslint-disable-next-line no-unused-vars -- Express exige los 4 parametros para detectar el handler de errores.
export function manejadorErrores(error, req, res, next) {
  // Si la respuesta ya empezo a enviarse, no se puede reescribir: se delega.
  if (res.headersSent) return next(error);

  const esEsperado = error instanceof ApiError;
  const statusCode = esEsperado ? error.statusCode : 500;

  if (!esEsperado) {
    logger.error(`Error no controlado en ${req.method} ${req.originalUrl}:`, error);
  }

  // Cabeceras que el error trae consigo (por ejemplo el estado del cupo de
  // intentos de login). Se aplican ANTES de responder para que un 401 o un 429
  // tambien informe cuantos intentos quedan.
  if (esEsperado && error.cabeceras) {
    for (const [nombre, valor] of Object.entries(error.cabeceras)) {
      res.setHeader(nombre, valor);
    }
  }

  const cuerpo = {
    exito: false,
    error: {
      codigo: esEsperado ? error.codigo : 'ERROR_INTERNO',
      mensaje: esEsperado
        ? error.message
        : 'Ocurrio un error inesperado en el servidor. Intente nuevamente.',
    },
  };

  if (esEsperado && error.detalle) {
    cuerpo.error.detalle = error.detalle;
  }

  // El stack solo en desarrollo: nunca en produccion.
  if (!esEsperado && !env.isProduction) {
    cuerpo.error.stack = error.stack;
  }

  return res.status(statusCode).json(cuerpo);
}