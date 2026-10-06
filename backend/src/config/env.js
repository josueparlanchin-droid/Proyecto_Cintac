/**
 * config/env.js
 * -----------------------------------------------------------------
 * Centraliza la lectura y validacion de las variables de entorno.
 * Se importa una unica vez (los modulos ES se cachean) y expone
 * un objeto inmutable `env` que el resto de la aplicacion consume.
 *
 * En lugar de fallar si falta el .env, se aplican valores por defecto
 * pensados para desarrollo local, de modo que el proyecto funcione con
 * un simple `npm install && npm run seed && npm run dev`.
 */

import 'dotenv/config';
import { z } from 'zod';

/** Esquema de validacion: si el .env tiene algo incoherente, falla al inicio. */
const esquemaEnv = z.object({
  PORT: z.coerce.number().int().positive().default(4010),
  JWT_SECRET: z.string().min(16).default('cintac-comex-desarrollo-clave-temporal'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  /**
   * Cadena de conexion a PostgreSQL.
   *
   * En desarrollo puede venir vacia: se usa el valor local por defecto. En
   * produccion es OBLIGATORIA, y esa asercion se hace mas abajo, porque
   * desplegar sin base de datos solo produciria errores confusos en el primer
   * request en lugar de un fallo claro al arrancar.
   */
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/cintac'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Holgado: es una red de seguridad para abusive automatizado, no un
  // contador de uso normal. Con 100, una sesion de trabajo normal o la propia
  // suite de verificacion lo agotaba.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),
  // Holgado a proposito: 20 intentos por 15 minutos bloquea la fuerza bruta
  // sinstrapear a un usuario que esta showcasing o que se equivoca al teclear.
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW_MIN: z.coerce.number().int().positive().default(15),

  UPLOAD_MAX_MB: z.coerce.number().positive().default(5),

  // Codigo de invitacion del auto-registro. Sin valor NO hay registro: el
  // endpoint responde 403. Borrar la variable es, por lo tanto, la forma
  // de cerrar el registro en produccion sin tocar una linea de codigo.
  //
  // No lleva valor por defecto a proposito: un codigo de ejemplo en el
  // repositorio seria un codigo real y publico en cuanto se despliega.
  REGISTRATION_CODE: z.string().min(6).optional(),
});

const parseado = esquemaEnv.safeParse(process.env);

if (!parseado.success) {
  console.error('[ENV] Variables de entorno invalidas:');
  console.error(parseado.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

const valores = parseado.data;

/** Advertencia visible si se ejecuta fuera de desarrollo con la clave por defecto. */
if (valores.JWT_SECRET === 'cintac-comex-desarrollo-clave-temporal') {
  console.warn('[ENV] Usando JWT_SECRET de desarrollo. Defina uno propio antes de publicar.');
}

const esProduccion = process.env.NODE_ENV === 'production';

// En produccion no hay valor por defecto que sirva: sin DATABASE_URL el
// proceso arrancaria y cada peticion fallaria. Se corta en el arranque, que es
// cuando el operador todavia esta mirando la consola del despliegue.
if (esProduccion && !process.env.DATABASE_URL) {
  console.error('[ENV] Falta DATABASE_URL, obligatoria en produccion.');
  console.error('      Defina la cadena de conexion de PostgreSQL (Render -> Environment).');
  process.exit(1);
}

// Igual para la clave: el valor por defecto es publico, asi que en produccion
// se obliga a definir uno propio.
if (esProduccion && valores.JWT_SECRET === 'cintac-comex-desarrollo-clave-temporal') {
  console.error('[ENV] Defina un JWT_SECRET propio: el valor por defecto es publico.');
  process.exit(1);
}

export const env = Object.freeze({
  ...valores,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: esProduccion,
  /** Lista de origenes permitidos, separada por comas. */
  corsOrigins: valores.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
  /** El auto-registro solo existe si hay codigo de invitacion definido. */
  registroHabilitado: Boolean(valores.REGISTRATION_CODE),
});

export default env;