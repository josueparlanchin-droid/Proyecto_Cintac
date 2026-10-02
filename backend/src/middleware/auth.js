/**
 * middleware/auth.js
 * -----------------------------------------------------------------
 * Autenticacion y autorizacion por rol (RBAC).
 */

import { verificarToken } from '../services/authService.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Exige un JWT valido en el header `Authorization: Bearer <token>`.
 * Verifica la firma y la expiracion, y deja el payload en `req.usuario`.
 *
 * @type {import('express').RequestHandler}
 */
export function requiereAuth(req, res, next) {
  const header = req.headers.authorization ?? '';

  if (!header.startsWith('Bearer ')) {
    return next(ApiError.noAutorizado('Falta el token de autenticacion. Inicie sesion.'));
  }

  const token = header.slice(7).trim();
  if (!token) {
    return next(ApiError.noAutorizado('Token de autenticacion vacio.'));
  }

  try {
    const payload = verificarToken(token);
    req.usuario = {
      id: payload.sub,
      email: payload.email,
      rol: payload.rol,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

/**
 * Autorizacion por rol. Se aplica SIEMPRE despues de `requiereAuth`.
 *
 * Ejemplo: `router.delete('/:id', requiereAuth, soloAdmin, controller.borrar)`
 *
 * @param {...string} roles Permitidos.
 * @returns {import('express').RequestHandler}
 */
export function requiereRol(...roles) {
  const permitidos = roles.flat();

  return function verificarRol(req, res, next) {
    if (!req.usuario) {
      return next(ApiError.noAutorizado('Peticion no autenticada.'));
    }

    if (!permitidos.includes(req.usuario.rol)) {
      return next(
        ApiError.prohibido(
          `Su rol (${req.usuario.rol}) no tiene permiso para esta operacion.`,
        ),
      );
    }

    return next();
  };
}

/** Atajos de rol usados en las rutas. */
export const soloAdmin = requiereRol('ADMIN_COMEX');
export const cualquiera = requiereRol('ADMIN_COMEX', 'ANALISTA');