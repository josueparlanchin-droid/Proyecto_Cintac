/**
 * middleware/validar.js
 * -----------------------------------------------------------------
 * Middleware de validacion de entrada basado en Zod.
 *
 * Centraliza el control de datos invalidos ANTES de que lleguen al
 * controller. Un controller que asume datos ya validados no necesita
 * repetir chequeos: es la version barato y segura de la seguridad.
 *
 * Uso:  router.post('/calcular', requiereAuth, validar(cuerpoCalculo), controller.calcular);
 */

import { ApiError } from '../utils/ApiError.js';

/**
 * Traduce los issues de Zod a un objeto campo -> mensaje, que es lo que
 * la UI necesita para marcar los inputs.
 *
 * @param {import('zod').ZodError} error
 * @returns {Record<string, string>}
 */
function aDetalleCampios(error) {
  const detalle = {};
  for (const issue of error.issues) {
    const campo = issue.path.join('.') || '_general';
    // Si un campo tiene varios problemas, se conserva el primero.
    if (!detalle[campo]) detalle[campo] = issue.message;
  }
  return detalle;
}

/**
 * @param {{body?:import('zod').ZodType, query?:import('zod').ZodType, params?:import('zod').ZodType}} esquemas
 * @returns {import('express').RequestHandler}
 */
export function validar({ body, query, params }) {
  return function ejecutarValidacion(req, res, next) {
    try {
      if (body) {
        // `req.body` es reescrito con la salida parseada: el controller
        // recibe datos ya coercionados y con tipos definitivos.
        req.body = body.parse(req.body ?? {});
      }

      if (params) req.params = params.parse(req.params ?? {});

      if (query) {
        // req.query tiene solo getter en Express 5; se redefinie el valor.
        const resultado = query.parse(req.query ?? {});
        Object.defineProperty(req, 'query', {
          value: resultado,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      return next();
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return next(
          ApiError.badRequest('Los datos enviados no son validos.', {
            codigo: 'VALIDACION_FALLIDA',
            detalle: aDetalleCampios(error),
          }),
        );
      }
      return next(error);
    }
  };
}

/** Atajo: valida solo el body. */
export const validarBody = (esquema) => validar({ body: esquema });