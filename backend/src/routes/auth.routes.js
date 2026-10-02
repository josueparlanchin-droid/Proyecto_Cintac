/**
 * routes/auth.routes.js
 * -----------------------------------------------------------------
 * POST /api/v1/auth/login   (publico, con rate limit mas estricto)
 * GET  /api/v1/auth/me      (requiere token)
 */

import { Router } from 'express';
import * as controller from '../controllers/authController.js';
import { validarBody } from '../middleware/validar.js';
import { requiereAuth } from '../middleware/auth.js';
import { esquemaLogin } from './schemas.js';

const router = Router();

// El login NO lleva un `rateLimiter` previo a proposito. Ese middleware
// contaria cada peticion, incluidos los logins correctos, y con un tope de 20
// acabaria bloqueando el uso normal (y despues de correr las pruebas, sin que
// hubiera ningun ataque de por medio).
//
// El limite de intentos vive en `authService.login` y cuenta SOLO los
// intentos fallidos, aislado por cuenta. Ventajas:
//  - un login correcto nunca agota la cuota ni bloquea a un usuario legitimo;
//  - un atacante de fuerza bruta sigue acotado a AUTH_RATE_LIMIT_MAX intentos;
//  - correr las pruebas ya no deja la aplicacion bloqueada.

router.post('/login', validarBody(esquemaLogin), controller.login);
router.get('/me', requiereAuth, controller.miPerfil);

export default router;