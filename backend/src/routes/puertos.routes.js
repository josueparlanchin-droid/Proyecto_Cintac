/**
 * routes/puertos.routes.js
 * -----------------------------------------------------------------
 * GET /api/v1/puertos   Catalogo de puertos de origen y destino.
 * GET /api/v1/health    Sonda de estado del servicio.
 */

import { Router } from 'express';
import * as controller from '../controllers/puertoController.js';
import { validar } from '../middleware/validar.js';
import { requiereAuth } from '../middleware/auth.js';
import { esquemaConsultaPuertos } from './schemas.js';

const router = Router();

// Publica a proposito: la UI puede pintar el formulario antes de autenticar.
router.get('/health', controller.health);
router.get('/puertos', requiereAuth, validar({ query: esquemaConsultaPuertos }), controller.listar);

export default router;