/**
 * routes/usuarios.routes.js
 * -----------------------------------------------------------------
 * Administracion de cuentas. Toda la superficie va restringida a ADMIN_COMEX.
 *
 * ORDEN DE LOS MIDDLEWARES, y es deliberado:
 *
 *   1. `requiereAuth`  -> sin token, 401.
 *   2. `soloAdmin`     -> con token de ANALISTA, 403.
 *   3. `validarBody`   -> solo si ya se sabe quien pregunta, se mira la forma.
 *
 * El paso 3 va ultimo a proposito. Si la validacion fuera primero, un
 * escenario sin sesion recibiria un 400 con el detalle de cada campo, que es
 * informacion sobre la API que un visitante anonimo no deberia tener. Este
 * orden responde 401 o 403 primero y solo despues entra a validar el cuerpo.
 */

import { Router } from 'express';
import * as controller from '../controllers/usuarioController.js';
import { requiereAuth, soloAdmin } from '../middleware/auth.js';
import { validarBody, validar } from '../middleware/validar.js';
import { esquemaCambioRol, esquemaCambioActivo, esquemaIdUsuario } from './schemas.js';

const router = Router();

// El router completo se aplica como bloque, para que anadir un endpoint nuevo
// no pueda olvidarse de la cadena de seguridad.
router.use(requiereAuth, soloAdmin);

router.get('/', controller.listar);
router.patch('/:id/rol', validar({ params: esquemaIdUsuario }), validarBody(esquemaCambioRol), controller.cambiarRol);
router.patch(
  '/:id/activo',
  validar({ params: esquemaIdUsuario }),
  validarBody(esquemaCambioActivo),
  controller.cambiarActivo,
);

export default router;