/**
 * routes/index.js
 * -----------------------------------------------------------------
 * Enrutador raiz de la API. Monta cada router bajo su prefijo y expone
 * el indice de endpoints, util para la defensa del proyecto.
 */

import { Router } from 'express';
import { env } from '../config/env.js';
import authRoutes from './auth.routes.js';
import puertosRoutes from './puertos.routes.js';
import cotizacionesRoutes from './cotizaciones.routes.js';
import tarifasRoutes from './tarifas.routes.js';

const router = Router();

/** Prefijo unico de la API: permite montar varias versiones en paralelo. */
const V1 = '/api/v1';

router.use(`${V1}/auth`, authRoutes);
router.use(V1, puertosRoutes);
router.use(`${V1}/cotizaciones`, cotizacionesRoutes);
router.use(`${V1}/tarifas`, tarifasRoutes);

/** Documentacion minima de la API en texto plano. */
router.get(`${V1}`, (req, res) => {
  res.json({
    exito: true,
    datos: {
      servicio: 'Cotizador Logistico de Importaciones Comex - Cintac S.A.',
      version: '1.0.0',
      entorno: env.nodeEnv,
      endpoints: [
        { metodo: 'POST', ruta: '/api/v1/auth/login', descripcion: 'Autenticacion (JWT)' },
        { metodo: 'GET', ruta: '/api/v1/auth/me', descripcion: 'Perfil del usuario autenticado' },
        { metodo: 'GET', ruta: '/api/v1/puertos', descripcion: 'Catalogo de puertos' },
        { metodo: 'POST', ruta: '/api/v1/cotizaciones/calcular', descripcion: 'Calcular y registrar cotizacion' },
        { metodo: 'GET', ruta: '/api/v1/cotizaciones/historial', descripcion: 'Historial paginado' },
        { metodo: 'GET', ruta: '/api/v1/cotizaciones/resumen', descripcion: 'Metricas del historial' },
        { metodo: 'GET', ruta: '/api/v1/cotizaciones/:id', descripcion: 'Detalle de cotizacion' },
        { metodo: 'DELETE', ruta: '/api/v1/cotizaciones/:id', descripcion: 'Eliminar cotizacion (ADMIN_COMEX)' },
        { metodo: 'GET', ruta: '/api/v1/tarifas', descripcion: 'Listar rutas tarifadas' },
        { metodo: 'GET', ruta: '/api/v1/tarifas/plantilla', descripcion: 'CSV de ejemplo' },
        { metodo: 'POST', ruta: '/api/v1/tarifas/upload', descripcion: 'Cargar planilla .xlsx/.csv (ADMIN_COMEX)' },
        { metodo: 'GET', ruta: '/api/v1/health', descripcion: 'Estado del servicio' },
      ],
    },
  });
});

export default router;