/**
 * controllers/authController.js
 * -----------------------------------------------------------------
 * Endpoints de autenticacion.
 *
 * Los controllers solo orquestan: traducen la peticion, llaman al servicio y
 * dan forma a la respuesta. La comparacion de contrasenas vive exclusivamente
 * en `authService`, y la validacion de lo que llega por el body, en el
 * middleware `validar` (Zod). Este archivo nunca ve una contrasena en claro.
 */

import * as authService from '../services/authService.js';
import * as usuarioService from '../services/usuarioService.js';
import { logger } from '../utils/logger.js';
import { ROLES } from '../utils/constantes.js';

/**
 * Permisos que la UI usa para ocultar acciones que el usuario no puede hacer.
 *
 * Se calculan AQUI y no en el cliente a partir del rol: aunque alguien
 * manipulase el JavaScript del navegador, el backend es quien sigue aplicando
 * la restriccion de verdad (vease `middleware/auth.js`). Estos flags son solo
 * para la presentacion.
 *
 * @param {string} rol
 * @returns {{eliminarCotizacion:boolean, eliminarTarifa:boolean, importarTarifas:boolean, verHistorialCompleto:boolean, gestionarUsuarios:boolean}}
 */
function permisosDe(rol) {
  const esAdmin = rol === 'ADMIN_COMEX';

  return {
    eliminarCotizacion: esAdmin,
    eliminarTarifa: esAdmin,
    importarTarifas: esAdmin,
    verHistorialCompleto: esAdmin,
    gestionarUsuarios: esAdmin,
  };
}

/**
 * POST /api/v1/auth/login
 *
 * Publico. El limite de intentos fallidos vive en el servicio (no es un
 * middleware previo) y los headers X-RateLimit-* viajan tanto en la respuesta
 * correcta como en el 401 o el 429.
 */
export async function login(req, res) {
  const { email, password } = req.body;

  const { cabeceras, ...respuesta } = await authService.login({
    email,
    password,
    ip: req.ip,
  });

  for (const [nombre, valor] of Object.entries(cabeceras)) {
    res.setHeader(nombre, valor);
  }

  logger.info(`Login exitoso de ${respuesta.usuario.email} (${respuesta.usuario.rol})`);

  res.json({
    exito: true,
    mensaje: 'Sesion iniciada correctamente.',
    datos: respuesta,
  });
}

/**
 * POST /api/v1/auth/registro
 *
 * Publico, pero exige codigo de invitacion. No se pide confirmacion por correo
 * porque el proyecto no tiene libreria de correo: la cuenta nace activa.
 *
 * Se devuelve un token ya firmado para que la persona entre de inmediato sin
 * pasar por el login. Como el rol queda fijo en ANALISTA (lo decide el modelo,
 * no lo que llegue en el body), no hay ninguna forma de que alguien se
 * registre como administrador por esta via.
 */
export async function registro(req, res) {
  const { nombre, email, password, passwordRepeticion, codigoInvitacion } = req.body;

  const { usuario } = await usuarioService.registrarUsuario({
    nombre,
    email,
    password,
    passwordRepeticion,
    codigoInvitacion,
  });

  const { token, expiraEn } = authService.firmarToken({
    id: usuario.id,
    email: usuario.email,
    rol: usuario.rol,
  });

  logger.info(`Registro de nuevo analista: ${usuario.email}`);

  res.status(201).json({
    exito: true,
    mensaje: 'Cuenta creada correctamente. Ya puede comenzar a cotizar.',
    datos: {
      token,
      expiraEn,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        rolNombre: usuario.rolNombre,
      },
    },
  });
}

/**
 * GET /api/v1/auth/me
 *
 * Requiere token. No vuelve a leer la base: `requiereAuth` ya dejo en
 * `req.usuario` la fila vigente, con `activo` y `rol` tomados del servidor y
 * no del token. Consultar de nuevo seria la misma lectura dos veces.
 */
export async function miPerfil(req, res) {
  const usuario = req.usuario;

  res.json({
    exito: true,
    datos: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      rolNombre: ROLES[usuario.rol] ?? usuario.rol,
      activo: usuario.activo,
      creado_en: usuario.creado_en,
      permisos: permisosDe(usuario.rol),
    },
  });
}
