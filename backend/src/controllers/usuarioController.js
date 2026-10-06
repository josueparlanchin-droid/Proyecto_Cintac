/**
 * controllers/usuarioController.js
 * -----------------------------------------------------------------
 * Endpoints de administracion de cuentas, todos restringidos a ADMIN_COMEX por
 * `soloAdmin` (vease routes/usuarios.routes.js).
 *
 * El control real esta en el middleware. Este archivo no vuelve a comprobar el
 * rol a mano, porque dos comprobaciones siempre divergen: alguien actualiza una
 * y olvida la otra. La UI oculta el enlace y la ruta tambien esta protegida;
 * aqui solo se orquesta.
 *
 * Ninguna respuesta incluye el hash de la contrasena. No es que se filtre por
 * olvido: la funcion `proyectar` del servicio devuelve campos explicitos, de
 * modo que anadir una columna sensible a la tabla obliga a revisarla.
 */

import * as usuarioService from '../services/usuarioService.js';
import { logger } from '../utils/logger.js';

/**
 * GET /api/v1/usuarios
 *
 * Devuelve las cuentas con su bitacora de acciones, para que Jefatura pueda
 * reconstruir que paso con cada una sin recurrir a la base de datos.
 */
export async function listar(req, res) {
  const usuarios = await usuarioService.listarUsuarios();

  const activos = usuarios.filter((u) => u.activo).length;
  const administradores = usuarios.filter((u) => u.activo && u.rol === 'ADMIN_COMEX').length;

  res.json({
    exito: true,
    datos: {
      usuarios,
      resumen: {
        total: usuarios.length,
        activos,
        inactivos: usuarios.length - activos,
        administradores,
      },
    },
  });
}

/**
 * PATCH /api/v1/usuarios/:id/rol
 *
 * Body: { rol: 'ADMIN_COMEX' | 'ANALISTA' }
 * Convierte un analista en administrador o al reves. Las salvaguardas
 * (auto-modificacion y ultimo administrador) estan en el servicio.
 */
export async function cambiarRol(req, res) {
  const { id } = req.params;
  const { rol } = req.body;

  const { usuario, mensaje } = await usuarioService.cambiarRol({
    administradorId: req.usuario.id,
    objetivoId: Number(id),
    nuevoRol: rol,
  });

  logger.info(`El administrador ${req.usuario.email} cambio el rol de ${usuario.email} a ${rol}`);

  res.json({
    exito: true,
    mensaje,
    datos: { usuario },
  });
}

/**
 * PATCH /api/v1/usuarios/:id/activo
 *
 * Body: { activo: boolean }
 * Baja logica: la cuenta deja de poder iniciar sesion y conserva su historial.
 * No es un borrado; `cotizaciones_log.usuario_id` esta declarado con
 * `ON DELETE RESTRICT` porque el historial de cotizaciones es contable.
 */
export async function cambiarActivo(req, res) {
  const { id } = req.params;
  const { activo } = req.body;

  const { usuario, mensaje } = await usuarioService.cambiarActivo({
    administradorId: req.usuario.id,
    objetivoId: Number(id),
    activo,
  });

  logger.info(
    `El administrador ${req.usuario.email} ${activo ? 'reactivo' : 'desactivo'} la cuenta de ${usuario.email}`,
  );

  res.json({
    exito: true,
    mensaje,
    datos: { usuario },
  });
}