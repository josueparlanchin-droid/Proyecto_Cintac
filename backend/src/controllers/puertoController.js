/**
 * controllers/puertoController.js
 * -----------------------------------------------------------------
 * Catalogo de puertos de origen internacional y de destino en Chile.
 */

import * as puertoModel from '../models/puertoModel.js';
import { queryOne } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { REGIONES, TIPO_CONTENEDOR_DEFAULT, MAX_TONELADAS_POR_CONTENEDOR } from '../utils/constantes.js';
import { estadoContadores } from '../middleware/rateLimit.js';

/**
 * GET /api/v1/puertos?region=CHINA
 *
 * Sin `region`, devuelve el catalogo completo separado en dos listas
 * porque la UI las necesita asi: un <select> de origen y otro de destino.
 * Si se manda una region, devuelve solo esa lista (array plano), que es
 * lo que consume el filtro opcional de la vista de historial.
 */
export async function listar(req, res) {
  const { region } = req.query ?? {};

  if (region) {
    const puertos = await puertoModel.listar(region);
    return res.json({
      exito: true,
      datos: puertos,
      total: puertos.length,
    });
  }

  const todos = await puertoModel.listar();

  const origen = todos.filter((p) => p.region !== 'CHILE');
  const destino = todos.filter((p) => p.region === 'CHILE');

  // Agrupar por region preserva el orden logico del formulario.
  const origenPorRegion = {};
  for (const puerto of origen) {
    (origenPorRegion[puerto.region] ??= []).push(puerto);
  }

  res.json({
    exito: true,
    datos: {
      origen,
      destino,
      origenPorRegion,
      regiones: REGIONES,
    },
    total: todos.length,
    parametros: {
      tipoContenedorSugerido: TIPO_CONTENEDOR_DEFAULT,
      limiteToneladasPorContenedor: MAX_TONELADAS_POR_CONTENEDOR,
    },
  });
}

/**
 * GET /api/v1/health
 * Sonda de salud publica: confirma que el proceso y la base responden.
 * Expone ademas el estado del rate limiter, util para la demostracion.
 *
 * Consulta de verdad a la base (`SELECT 1`) en lugar de afirmar que esta bien:
 * un health check que no toca la base no sirve para distinguir "el proceso
 * arranco" de "la base responde", que es justo lo que se quiere saber cuando
 * Render o Neon fallan.
 */
export async function health(req, res) {
  let baseOperativa = true;

  try {
    await queryOne('SELECT 1 AS ok');
  } catch (error) {
    baseOperativa = false;
    logger.error('Sonda de salud: la base no responde:', error.message);
  }

  res.status(baseOperativa ? 200 : 503).json({
    exito: baseOperativa,
    datos: {
      servicio: 'Cotizador Logistico de Importaciones Comex',
      empresa: 'Cintac S.A.',
      version: '1.1.0',
      estado: baseOperativa ? 'operativo' : 'degradado',
      baseDatos: 'postgresql',
      baseOperativa,
      timestamp: new Date().toISOString(),
      rateLimiting: estadoContadores(),
    },
  });
}
