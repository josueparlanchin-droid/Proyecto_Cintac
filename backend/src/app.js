/**
 * app.js
 * -----------------------------------------------------------------
 * Construccion de la aplicacion Express (sin listen: eso es de server.js).
 * Separar ambos permite testear la app sin abrir un puerto.
 *
 * ORDEN DE LOS MIDDLEWARES: es lo que determina la seguridad.
 *   1. CORS y headers            - antes de todo
 *   2. parseo de body            - antes de las rutas
 *   3. limitador general         - antes de las rutas, para no gastar CPU
 *   4. log de peticiones
 *   5. rutas
 *   6. 404 y manejador de errores - siempre al final
 */

import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { rateLimiter } from './middleware/rateLimit.js';
import { registrarPeticiones } from './middleware/registrarPeticiones.js';
import { noEncontrado, manejadorErrores } from './middleware/errorHandler.js';

export const app = express();

// El esquema ya NO se crea aqui. Antes se hacia al importar el modulo, pero
// con PostgreSQL `inicializarEsquema()` es asincrono y llamarla sin esperar
// abriria una ventana en la que la primera peticion recibiria
// "relation does not exist". Ahora es `server.js` quien la espera antes de
// listenear, y `seed.js` quien la espera antes de sembrar.

// --- 1. CORS restringido a los origenes configurados ---
app.use(
  cors({
    origin(origin, callback) {
      // Sin Origin = navegacion directa, curl o Postman: se permite.
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    credentials: true,
  }),
);

/**
 * Headers de seguridad basicos.
 * Es un subconjunto minimo de helmet, suficiente para el MVP y sin
 * agregar dependencias.
 */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Powered-By', 'Cintac-S.A.-Comex');
  next();
});

// --- 2. Parseo del cuerpo ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// --- 3. Rate limiting global (antes de las rutas para protegerlas) ---
app.use(
  '/api',
  rateLimiter({
    max: env.RATE_LIMIT_MAX,
    windowMs: env.RATE_LIMIT_WINDOW_MIN * 60 * 1000,
    mensaje: `Demasiadas solicitudes. Intente nuevamente en ${env.RATE_LIMIT_WINDOW_MIN} minutos.`,
    nombre: 'api',
    codigo: 'RATE_LIMIT_EXCEDIDO',
  }),
);

// --- 4. Log de acceso ---
app.use(registrarPeticiones);

// --- 5. Rutas ---
app.use(routes);

// --- 6. 404 y manejador de errores ---
app.use(noEncontrado);
app.use(manejadorErrores);

export default app;