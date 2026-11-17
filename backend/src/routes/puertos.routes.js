/**
 * routes/puertos.routes.js
 * -----------------------------------------------------------------
 * GET    /api/v1/puertos         Catalogo de puertos de origen y destino para cotizaciones.
 * GET    /api/v1/puertos/admin   Mantenedor de puertos con estadisticas (ADMIN_COMEX).
 * POST   /api/v1/puertos         Crear nuevo puerto de origen/destino (ADMIN_COMEX).
 * PUT    /api/v1/puertos/:id     Actualizar puerto existente (ADMIN_COMEX).
 * DELETE /api/v1/puertos/:id     Eliminar puerto sin historial (ADMIN_COMEX).
 * GET    /api/v1/health          Sonda de estado del servicio.
 */

import { Router } from 'express';
import * as controller from '../controllers/puertoController.js';
import { validar } from '../middleware/validar.js';
import { requiereAuth, soloAdmin } from '../middleware/auth.js';
import {
  esquemaConsultaPuertos,
  esquemaCrearPuerto,
  esquemaEditarPuerto,
  esquemaIdPuerto,
} from './schemas.js';

const router = Router();

// Publica a proposito: la UI puede pintar el formulario antes de autenticar.
router.get('/health', controller.health);

// Catalogo general para cotizador e historial
router.get('/puertos', requiereAuth, validar({ query: esquemaConsultaPuertos }), controller.listar);

// Mantenedor exclusivo de Jefatura Comex (ADMIN_COMEX)
router.get('/puertos/admin', requiereAuth, soloAdmin, controller.listarAdmin);
router.post('/puertos', requiereAuth, soloAdmin, validar({ body: esquemaCrearPuerto }), controller.crear);
router.put(
  '/puertos/:id',
  requiereAuth,
  soloAdmin,
  validar({ params: esquemaIdPuerto, body: esquemaEditarPuerto }),
  controller.actualizar,
);
router.delete(
  '/puertos/:id',
  requiereAuth,
  soloAdmin,
  validar({ params: esquemaIdPuerto }),
  controller.eliminar,
);

export default router;