/**
 * controllers/cotizacionController.js
 * -----------------------------------------------------------------
 * Calculo y consulta del historial de cotizaciones.
 */

import { simular } from '../services/calculoService.js';
import * as cotizacionModel from '../models/cotizacionModel.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * POST /api/v1/cotizaciones/calcular
 *
 * Ejecuta la simulacion y, salvo que se mande `guardar: false`, persiste
 * el registro. En ambos casos responde con la misma forma para que el
 * frontend no tenga que distinguir dos casos de render.
 */
export async function calcular(req, res) {
  const { guardar = true, ...entrada } = req.body;

  const { simulacion, cotizacion } = await simular({
    ...entrada,
    guardar,
    usuario_id: req.usuario.id,
  });

  logger.info(
    `Cotizacion calculada por ${req.usuario.email}: ` +
      `${simulacion.peso_kg} kg (${simulacion.toneladas} tn) ` +
      `${simulacion.ruta} -> ${simulacion.cantidad_contenedores} contenedor(es), ` +
      `USD ${simulacion.costo_total_usd}`,
  );

  res.status(201).json({
    exito: true,
    mensaje: guardar ? 'Cotizacion calculada y registrada.' : 'Simulacion calculada (sin registro).',
    datos: {
      ...simulacion,
      cotizacion_id: cotizacion?.id ?? null,
      fecha_creacion: cotizacion?.fecha_creacion ?? null,
      registrada: guardar,
    },
  });
}

/**
 * GET /api/v1/cotizaciones/historial
 *
 * REGLA DE VISIBILIDAD: un Analista solo ve sus propias cotizaciones.
 * Jefatura Comex ve el historial completo. El filtro por usuario se
 * inyecta en el service, no se acepta desde el cliente, para que un
 * Analista no pueda "saltarse" la regla pidiendo otro id.
 */
export async function historial(req, res) {
  const { pagina, porPagina, puerto_origen_id, puerto_destino_id, busqueda, desde, hasta } = req.query;

  if (req.usuario.rol !== 'ADMIN_COMEX') {
    req.query.usuarioId = req.usuario.id;
  }

  const resultado = await cotizacionModel.listar({
    pagina,
    porPagina,
    puerto_origen_id: puerto_origen_id ?? null,
    puerto_destino_id: puerto_destino_id ?? null,
    busqueda: busqueda ?? null,
    desde: desde ?? null,
    hasta: hasta ?? null,
    usuarioId: req.query.usuarioId ?? null,
  });

  res.json({
    exito: true,
    datos: resultado.datos,
    paginacion: resultado.paginacion,
    filtros: { puerto_origen_id, puerto_destino_id, busqueda, desde, hasta },
  });
}

/**
 * GET /api/v1/cotizaciones/resumen
 * Metricas agregadas para la cabecera de la vista de historial.
 */
export async function resumen(req, res) {
  const metricas = await cotizacionModel.resumen();

  res.json({
    exito: true,
    datos: {
      ...metricas,
      toneladas_totales: Math.round(metricas.toneladas_totales * 1000) / 1000,
      facturacion_total_usd: Math.round(metricas.facturacion_total_usd * 100) / 100,
    },
  });
}

/**
 * GET /api/v1/cotizaciones/:id
 * Cotizacion individual; se usa para recargar el informe PDF desde la
 * tabla de historial sin guardar el resultado en el navegador.
 */
export async function detalle(req, res) {
  const cotizacion = await cotizacionModel.buscarPorId(req.params.id);

  if (!cotizacion) {
    throw ApiError.noEncontrado(`No existe una cotizacion con el id ${req.params.id}.`);
  }

  // Respeta la misma regla de visibilidad que el historial.
  if (req.usuario.rol !== 'ADMIN_COMEX' && cotizacion.usuario_id !== req.usuario.id) {
    throw ApiError.prohibido('No tiene acceso a esta cotizacion.');
  }

  res.json({ exito: true, datos: cotizacion });
}

/**
 * DELETE /api/v1/cotizaciones/:id
 * Restringido a ADMIN_COMEX por la capa de rutas.
 */
export async function eliminar(req, res) {
  const { id } = req.params;

  const cotizacion = await cotizacionModel.buscarPorId(id);
  if (!cotizacion) {
    throw ApiError.noEncontrado(`No existe una cotizacion con el id ${id}.`);
  }

  await cotizacionModel.eliminar(id);
  logger.warn(`Cotizacion ${id} eliminada por ${req.usuario.email}`);

  res.json({
    exito: true,
    mensaje: `Cotizacion ${id} eliminada correctamente.`,
    datos: { id: Number(id) },
  });
}
