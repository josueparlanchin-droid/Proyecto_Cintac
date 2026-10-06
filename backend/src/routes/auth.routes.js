/**
 * routes/auth.routes.js
 * -----------------------------------------------------------------
 * POST /api/v1/auth/login     (publico, con rate limit mas estricto)
 * POST /api/v1/auth/registro  (publico, exige codigo de invitacion)
 * GET  /api/v1/auth/me        (requiere token)
 */

import { Router } from 'express';
import * as controller from '../controllers/authController.js';
import { validarBody } from '../middleware/validar.js';
import { requiereAuth } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rateLimit.js';
import { esquemaLogin, esquemaRegistro } from './schemas.js';
import { env } from '../config/env.js';

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

// El registro es al reves, y por eso SI lleva `rateLimiter` previo: contar cada
// intento,correcto o no, es justo lo que se quiere aqui. A diferencia del
// login, un alta de cuenta que se repite es sempre un abuse (creacion masiva de
// cuentas). Se usa el tope general de la API, que ya es holgado, y la
// separacion por IP viene de `rateLimiter` mismo.
const limiteRegistro = rateLimiter({
  max: env.RATE_LIMIT_MAX,
  windowMs: env.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  mensaje: 'Demasiados intentos de registro. Intente nuevamente mas tarde.',
  nombre: 'registro',
  codigo: 'REGISTRO_DEMASIADOS_INTENTOS',
});

router.post('/login', validarBody(esquemaLogin), controller.login);
router.post('/registro', limiteRegistro, validarBody(esquemaRegistro), controller.registro);
router.get('/me', requiereAuth, controller.miPerfil);

export default router;