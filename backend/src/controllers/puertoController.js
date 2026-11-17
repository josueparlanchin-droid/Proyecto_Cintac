/**
 * controllers/puertoController.js
 * -----------------------------------------------------------------
 * Catalogo de puertos de origen y destino.
 *
 * Las dos listas se construyen a partir de las rutas que tienen tarifa:
 * la base decide que combinaciones son cotizables, no una regla fija de
 * regiones en el codigo.
 */

import * as puertoModel from '../models/puertoModel.js';
import * as tarifaModel from '../models/tarifaModel.js';
import { queryOne, enTransaccion } from '../config/db.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import {
  CAPACIDAD_POR_TIPO,
  REGIONES,
  TIPO_CONTENEDOR_DEFAULT,
  MAX_TONELADAS_POR_CONTENEDOR,
} from '../utils/constantes.js';
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

  const [origen, destino, todos] = await Promise.all([
    puertoModel.listarOrigenesConTarifa(),
    puertoModel.listarDestinosConTarifa(),
    puertoModel.listar(),
  ]);

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
      capacidadesPorTipo: CAPACIDAD_POR_TIPO,
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

/**
 * GET /api/v1/puertos/admin
 *
 * Mantenedor de puertos: devuelve todos los puertos registrados con sus
 * metricas asociadas (total de tarifas como origen, total de tarifas como destino
 * y cantidad de cotizaciones historicas registradas).
 * Acceso exclusivo: Jefatura Comex (ADMIN_COMEX).
 */
export async function listarAdmin(req, res) {
  const puertos = await puertoModel.listarConEstadisticas();

  res.json({
    exito: true,
    datos: puertos,
    total: puertos.length,
  });
}

/**
 * POST /api/v1/puertos
 *
 * Crea un nuevo puerto en el catalogo. Si se incluye `tarifa_inicial`,
 * crea de manera atomica una tarifa de flete hacia el puerto de destino
 * indicado para que el puerto quede activo de inmediato en el cotizador.
 * Acceso exclusivo: Jefatura Comex (ADMIN_COMEX).
 */
export async function crear(req, res) {
  const { nombre, pais_origen, region, codigo, tarifa_inicial } = req.body;
  const codigoNormalizado = codigo.trim().toUpperCase();

  // Comprobar que no exista otro puerto con el mismo UN/LOCODE
  const existente = await puertoModel.buscarPorCodigo(codigoNormalizado);
  if (existente) {
    throw ApiError.conflicto(
      `Ya existe un puerto registrado con el codigo "${codigoNormalizado}" (${existente.nombre}, ${existente.pais_origen}).`,
      { codigo: 'CODIGO_PUERTO_DUPLICADO' },
    );
  }

  let nuevoPuerto;
  let tarifaCreada = null;

  await enTransaccion(async () => {
    nuevoPuerto = await puertoModel.crear({
      nombre,
      pais_origen,
      region,
      codigo: codigoNormalizado,
    });

    if (tarifa_inicial && tarifa_inicial.puerto_destino_id) {
      const destino = await puertoModel.buscarPorId(tarifa_inicial.puerto_destino_id);
      if (!destino) {
        throw ApiError.badRequest('El puerto de destino especificado para la tarifa inicial no existe.', {
          codigo: 'DESTINO_NO_EXISTE',
        });
      }
      if (destino.id === nuevoPuerto.id) {
        throw ApiError.badRequest('El puerto de origen y destino no pueden ser el mismo.', {
          codigo: 'RUTA_INVALIDA',
        });
      }

      await tarifaModel.guardar({
        puerto_origen_id: nuevoPuerto.id,
        puerto_destino_id: destino.id,
        tipo_contenedor: tarifa_inicial.tipo_contenedor || '40HC',
        precio_usd: Number(tarifa_inicial.precio_usd),
        dias_viaje_base: Number(tarifa_inicial.dias_viaje_base),
        capacidad_max_tn: Number(tarifa_inicial.capacidad_max_tn || 25),
      });

      tarifaCreada = {
        destino_nombre: destino.nombre,
        destino_pais: destino.pais_origen,
        precio_usd: Number(tarifa_inicial.precio_usd),
      };
    }
  });

  logger.info(
    `Puerto creado por ${req.usuario.email}: ${nuevoPuerto.nombre} (${nuevoPuerto.codigo}, ${nuevoPuerto.region})${
      tarifaCreada ? ` con tarifa inicial a ${tarifaCreada.destino_nombre}` : ''
    }`,
  );

  res.status(201).json({
    exito: true,
    mensaje: `Puerto "${nuevoPuerto.nombre}" registrado exitosamente.${
      tarifaCreada ? ` Se configuro la tarifa inicial hacia ${tarifaCreada.destino_nombre}.` : ''
    }`,
    datos: nuevoPuerto,
  });
}

/**
 * PUT /api/v1/puertos/:id
 *
 * Actualiza los datos basicos de un puerto existente.
 * Acceso exclusivo: Jefatura Comex (ADMIN_COMEX).
 */
export async function actualizar(req, res) {
  const { id } = req.params;
  const { nombre, pais_origen, region, codigo } = req.body;
  const codigoNormalizado = codigo.trim().toUpperCase();

  const actual = await puertoModel.buscarPorId(id);
  if (!actual) {
    throw ApiError.noEncontrado('El puerto especificado no existe.', {
      codigo: 'PUERTO_NO_ENCONTRADO',
    });
  }

  // Si se modifico el codigo, validar que no choque con otro puerto
  if (codigoNormalizado !== actual.codigo.toUpperCase()) {
    const existente = await puertoModel.buscarPorCodigo(codigoNormalizado);
    if (existente && Number(existente.id) !== Number(actual.id)) {
      throw ApiError.conflicto(
        `Ya existe otro puerto registrado con el codigo "${codigoNormalizado}" (${existente.nombre}, ${existente.pais_origen}).`,
        { codigo: 'CODIGO_PUERTO_DUPLICADO' },
      );
    }
  }

  const puertoActualizado = await puertoModel.actualizar(id, {
    nombre,
    pais_origen,
    region,
    codigo: codigoNormalizado,
  });

  logger.info(`Puerto ${id} actualizado por ${req.usuario.email}: ${puertoActualizado.nombre} (${puertoActualizado.codigo})`);

  res.json({
    exito: true,
    mensaje: `Puerto "${puertoActualizado.nombre}" actualizado correctamente.`,
    datos: puertoActualizado,
  });
}

/**
 * DELETE /api/v1/puertos/:id
 *
 * Elimina un puerto si no cuenta con cotizaciones historicas registradas.
 * Acceso exclusivo: Jefatura Comex (ADMIN_COMEX).
 */
export async function eliminar(req, res) {
  const { id } = req.params;

  const actual = await puertoModel.buscarPorId(id);
  if (!actual) {
    throw ApiError.noEncontrado('El puerto especificado no existe.', {
      codigo: 'PUERTO_NO_ENCONTRADO',
    });
  }

  const totalCotizaciones = await puertoModel.contarCotizaciones(id);
  if (totalCotizaciones > 0) {
    throw ApiError.conflicto(
      `No se puede eliminar el puerto "${actual.nombre}" porque esta referenciado en ${totalCotizaciones} cotizacion(es) historica(s). ` +
        `Por requerimiento de trazabilidad contable, el registro debe conservarse.`,
      { codigo: 'PUERTO_CON_HISTORIAL' },
    );
  }

  await puertoModel.eliminar(id);
  logger.info(`Puerto ${id} (${actual.nombre}) eliminado por ${req.usuario.email}`);

  res.json({
    exito: true,
    mensaje: `Puerto "${actual.nombre}" eliminado correctamente.`,
  });
}
