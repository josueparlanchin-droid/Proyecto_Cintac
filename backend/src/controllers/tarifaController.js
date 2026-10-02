/**
 * controllers/tarifaController.js
 * -----------------------------------------------------------------
 * Endpoints del catalogo de tarifas de flete.
 *
 * La logica de leer y validar la planilla esta en `tarifaService`; aqui solo
 * se traduce la peticion y se da forma a la respuesta, incluida la agrupacion
 * por region que usa la tabla del frontend.
 */

import * as tarifaModel from '../models/tarifaModel.js';
import * as tarifaService from '../services/tarifaService.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { REGIONES } from '../utils/constantes.js';

/**
 * Filas de ejemplo para la plantilla CSV.
 *
 * Se ofrecen rutas que YA existen en el catalogo de puertos para que el
 * archivo se pueda subir tal cual, sin editar, y servir de prueba de humo del
 * proceso de importacion.
 */
const EJEMPLOS_PLANTILLA = [
  ['CNSHA', 'CLSAI', '40HC', '2450', '28', '25'],
  ['CNSHA', 'CLVAP', '40HC', '2680', '30', '25'],
  ['CNNGB', 'CLSAI', '40HC', '2750', '26', '25'],
  ['DEHAM', 'CLSAV', '40HC', '2350', '35', '25'],
  ['NLRTM', 'CLVAP', '40HC', '1910', '25', '25'],
  ['USMIA', 'CLSAI', '20', '1090', '18', '20'],
];

/**
 * GET /api/v1/tarifas
 *
 * Devuelve la lista plana (la que consume la tabla) y ademas un conteo por
 * region de origen, para que la UI pueda filtrar sin recorrer el arreglo.
 */
export async function listar(req, res) {
  const tarifas = await tarifaService.listarTarifas();

  const porRegion = {};
  for (const region of Object.keys(REGIONES)) porRegion[region] = 0;

  for (const tarifa of tarifas) {
    const region = tarifa.origen_region;
    porRegion[region] = (porRegion[region] ?? 0) + 1;
  }

  res.json({
    exito: true,
    datos: tarifas,
    total: tarifas.length,
    porRegion,
  });
}

/**
 * GET /api/v1/tarifas/plantilla
 *
 * Entrega un CSV con los encabezados correctos. Se responde como texto plano y
 * NO como JSON, porque el navegador debe poder guardarlo directamente como
 * archivo.
 */
export function plantilla(req, res) {
  const encabezados = 'puerto_origen,puerto_destino,tipo_contenedor,precio_usd,dias_viaje_base,capacidad_max_tn';
  const cuerpo = EJEMPLOS_PLANTILLA.map((fila) => fila.join(',')).join('\n');
  const csv = `${encabezados}\n${cuerpo}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-tarifas.csv"');
  res.send(csv);
}

/**
 * POST /api/v1/tarifas/upload
 *
 * Solo ADMIN_COMEX (restriccion aplicada en `tarifas.routes.js`). Multer deja
 * el archivo en memoria; la escritura ocurre dentro de una transaccion en el
 * servicio, asi que una fila invalida no deja imports a medias.
 */
export async function subir(req, res) {
  if (!req.file) {
    throw ApiError.badRequest('No se recibio ningun archivo. Envie la planilla en el campo "archivo".', {
      codigo: 'ARCHIVO_AUSENTE',
    });
  }

  const resumen = await tarifaService.importarDesdeBuffer(
    req.file.buffer,
    req.file.originalname,
  );

  logger.info(
    `Importacion de tarifas por ${req.usuario.email}: ` +
      `${resumen.insertadas} insertadas, ${resumen.actualizadas} actualizadas, ` +
      `${resumen.omitidas} omitidas de ${resumen.procesadas} filas`,
  );

  if (resumen.omitidas && !resumen.insertadas && !resumen.actualizadas) {
    // Hubo filas pero ninguna valida: se responde 400 para que el usuario no
    // piense que la carga funciono.
    throw ApiError.badRequest(
      `Ninguna fila de "${req.file.originalname}" pudo importarse. Revise el detalle y la plantilla.`,
      { codigo: 'PLANILLA_SIN_FILAS_VALIDAS', detalle: resumen.errores },
    );
  }

  res.status(201).json({
    exito: true,
    mensaje: `Planilla procesada: ${resumen.insertadas} rutas nuevas, ${resumen.actualizadas} actualizadas, ${resumen.omitidas} omitidas.`,
    datos: resumen,
  });
}

/**
 * DELETE /api/v1/tarifas/:id
 *
 * No existe ruta que lo exponga hoy (se conserva la operacion del modelo),
 * pero deja el camino abierto si mas adelante se necesita.
 */
export async function eliminar(req, res) {
  const { id } = req.params;
  const borrada = await tarifaModel.eliminar(id);

  if (!borrada) {
    throw ApiError.noEncontrado(`No existe una tarifa con el id ${id}.`);
  }

  logger.warn(`Tarifa ${id} eliminada por ${req.usuario.email}`);

  res.json({ exito: true, mensaje: `Tarifa ${id} eliminada.`, datos: { id: Number(id) } });
}
