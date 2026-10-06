/**
 * middleware/auth.js
 * -----------------------------------------------------------------
 * Autenticacion y autorizacion por rol (RBAC).
 */

import { verificarToken } from '../services/authService.js';
import { buscarPorId } from '../models/usuarioModel.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Exige un JWT valido en el header `Authorization: Bearer <token>`.
 *
 * Verifica la firma y la expiracion, y ADEMAS relee la cuenta desde la base de
 * datos. Ese segundo paso no es desconfianza del token: es lo que hace que una
 * baja o una degradacion surtan efecto de inmediato.
 *
 * Un JWT es una promesa firmada, valida hasta ocho horas. Si el middleware se
 * quedara solo con lo que dice el token:
 *   - un analista degradado seguiria siendo ADMIN_COMEX durante esas ocho horas;
 *   - una cuenta desactivada podria seguir cotizando y dando por hecho que la
 *     de la del sistema lo dejo fuera.
 * Ninguna de las dos cosas es aceptable en un control de acceso, asi que la
 * fila manda: el token solo acredita quien es, y `activo` y `rol` se leen del
 * servidor. Por ese motivo `req.usuario` es la fila, no el payload.
 *
 * El costo es una consulta por peticion autenticada, sobre una base ya
 * agrupada en el pool. Es el precio de que la baja de un usuario signifique
 * algo, y el enunciado pide explicitamente que no se pueda operar con cuentas
 * desactivadas.
 *
 * @type {import('express').RequestHandler}
 */
export async function requiereAuth(req, res, next) {
  const header = req.headers.authorization ?? '';

  if (!header.startsWith('Bearer ')) {
    return next(ApiError.noAutorizado('Falta el token de autenticacion. Inicie sesion.'));
  }

  const token = header.slice(7).trim();
  if (!token) {
    return next(ApiError.noAutorizado('Token de autenticacion vacio.'));
  }

  let payload;
  try {
    payload = verificarToken(token);
  } catch (error) {
    return next(error);
  }

  try {
    const usuario = await buscarPorId(payload.sub);

    // Cuenta borrada o desactivada: la sesion muere aqui. El codigo es el
    // mismo para ambos casos a proposito, para no confirmar por diferencia si
    // un correo dado esta o no registrado.
    if (!usuario || !usuario.activo) {
      return next(
        ApiError.noAutorizado('La sesion ya no es valida. Inicie sesion nuevamente.', {
          codigo: 'SESION_INVALIDA',
        }),
      );
    }

    // La fila completa, con `rol` de la base y no del token: asi una
    // degradacion no espera a que caduque la credencial para aplicarse.
    req.usuario = usuario;
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