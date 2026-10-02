/**
 * routes/tarifas.routes.js
 * -----------------------------------------------------------------
 * GET  /api/v1/tarifas              Listar rutas tarifadas (ambos roles)
 * GET  /api/v1/tarifas/plantilla    Descargar CSV de ejemplo (ambos roles)
 * POST /api/v1/tarifas/upload       Cargar planilla .xlsx/.csv (solo ADMIN_COMEX)
 */

import { Router } from 'express';
import multer from 'multer';
import * as controller from '../controllers/tarifaController.js';
import { requiereAuth, cualquiera, soloAdmin } from '../middleware/auth.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Configuracion de Multer.
 *
 * `memoryStorage` + `limits.fileSize`: la planilla se valida en memoria y
 * se procesa al vuelo, sin dejar archivos ejecutables en el servidor.
 */
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: env.UPLOAD_MAX_MB * 1024 * 1024, files: 1 },
  /**
   * Filtro de extensiones. Es una primera barrera; ademas se valida que
   * multer haya recibido exactamente un archivo en el campo `archivo`.
   */
  fileFilter(req, file, cb) {
    const extension = file.originalname.toLowerCase().split('.').pop();

    if (!['xlsx', 'xls', 'csv'].includes(extension)) {
      return cb(
        ApiError.badRequest(
          `Formato no permitido: ".${extension}". Cargue una planilla .xlsx, .xls o .csv.`,
          { codigo: 'FORMATO_NO_PERMITIDO' },
        ),
      );
    }

    return cb(null, true);
  },
});

/** Traduce los errores propios de Multer al formato de la API. */
function manejarErrorMulter(error, req, res, next) {
  if (error instanceof multer.MulterError) {
    const mensajes = {
      LIMIT_FILE_SIZE: `El archivo supera el maximo permitido de ${env.UPLOAD_MAX_MB} MB.`,
      LIMIT_UNEXPECTED_FILE: 'Envie la planilla en el campo "archivo".',
    };
    return next(ApiError.badRequest(mensajes[error.code] ?? 'Error al procesar el archivo.', {
      codigo: 'ERROR_UPLOAD',
    }));
  }
  return next(error);
}

router.get('/', requiereAuth, cualquiera, controller.listar);
router.get('/plantilla', requiereAuth, cualquiera, controller.plantilla);

// La cadena requiereAuth -> cualquiera -> soloAdmin se puede simplificar a
// requiereAuth -> soloAdmin, pero se deja explicita para mostrar la separacion
// entre "estas autenticado" y "tienes este rol".
router.post('/upload', requiereAuth, soloAdmin, (req, res, next) => {
  upload.single('archivo')(req, res, (error) => {
    if (error) return manejarErrorMulter(error, req, res, next);
    logger.info(`Planilla recibida de ${req.usuario.email}: ${req.file?.originalname ?? '(sin archivo)'}`);
    return next();
  });
}, controller.subir);

export default router;