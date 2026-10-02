/**
 * routes/cotizaciones.routes.js
 * -----------------------------------------------------------------
 * POST   /api/v1/cotizaciones/calcular    Calcula y registra (ambos roles)
 * GET    /api/v1/cotizaciones/historial   Historial paginado (ambos roles)
 * GET    /api/v1/cotizaciones/resumen     Metricas agregadas (ambos roles)
 * GET    /api/v1/cotizaciones/:id         Detalle de una cotizacion
 * DELETE /api/v1/cotizaciones/:id         Eliminar (solo ADMIN_COMEX)
 *
 * IMPORTANTE: las rutas literales (/historial, /resumen) se declaran
 * ANTES que '/:id', porque Express evalua en orden: si '/:id' fuera
 * primero, "historial" se interpretaria como un id y daria 400.
 */

import { Router } from 'express';
import * as controller from '../controllers/cotizacionController.js';
import { validar, validarBody } from '../middleware/validar.js';
import { requiereAuth, cualquiera, soloAdmin } from '../middleware/auth.js';
import { esquemaCalculo, esquemaHistorial, esquemaIdCotizacion } from './schemas.js';

const router = Router();

// Todo lo de este router exige sesion iniciada.
router.use(requiereAuth, cualquiera);

router.post('/calcular', validarBody(esquemaCalculo), controller.calcular);
router.get('/historial', validar({ query: esquemaHistorial }), controller.historial);
router.get('/resumen', controller.resumen);
router.get('/:id', validar({ params: esquemaIdCotizacion }), controller.detalle);

// El orden de los middlewares importa: primero autenticacion, luego rol.
router.delete('/:id', soloAdmin, validar({ params: esquemaIdCotizacion }), controller.eliminar);

export default router;