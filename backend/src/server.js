/**
 * server.js
 * -----------------------------------------------------------------
 * Punto de entrada del backend. Inicializa la base de datos, levanta el
 * servidor HTTP y gestiona el apagado ordenado.
 */

import app from './app.js';
import { env } from './config/env.js';
import { inicializarEsquema, cerrarBaseDatos, descripcionBaseDatos } from './config/db.js';
import { logger } from './utils/logger.js';

/**
 * El esquema se crea ANTES de aceptar peticiones. Con SQLite esto pasaba al
 * importar el modulo; con PostgreSQL `inicializarEsquema()` es asincrono (va
 * a la base), y arrancar el servidor sin esperarlo expondría una ventana en la
 * que la primera peticion recibiria "relation does not exist".
 */
inicializarEsquema()
  .then(() => {
    const servidor = app.listen(env.PORT, () => {
      logger.info('='.repeat(66));
      logger.info('  CINTAC S.A. - Cotizador Logistico de Importaciones Comex');
      logger.info(`  API      -> http://localhost:${env.PORT}/api/v1`);
      logger.info(`  Health   -> http://localhost:${env.PORT}/api/v1/health`);
      logger.info(`  Base     -> ${descripcionBaseDatos()}`);
      logger.info(`  Entorno  -> ${env.nodeEnv}`);
      logger.info('='.repeat(66));
    });

    /**
     * Apagado ordenado: deja de aceptar conexiones, espera a que terminen las
     * peticiones en curso y cierra el pool, para no cortar una carga de
     * planilla a la mitad ni dejar conexiones colgadas en Neon.
     */
    function apagar(senal) {
      logger.info(`Senal ${senal} recibida. Cerrando servidor...`);

      servidor.close(async () => {
        await cerrarBaseDatos().catch((error) =>
          logger.warn('No se pudo cerrar el pool de PostgreSQL:', error.message),
        );
        logger.info('Servidor y pool de base de datos cerrados correctamente.');
        process.exit(0);
      });

      // Red de seguridad: si algo queda colgado, se fuerza la salida.
      setTimeout(() => {
        logger.warn('Cierre forzado tras timeout.');
        process.exit(1);
      }, 5000).unref();
    }

    process.on('SIGTERM', () => apagar('SIGTERM'));
    process.on('SIGINT', () => apagar('SIGINT'));

    process.on('unhandledRejection', (motivo) => {
      logger.error('Promesa rechazada sin manejar:', motivo);
    });

    process.on('uncaughtException', (error) => {
      logger.error('Excepcion no controlada:', error);
      apagar('uncaughtException');
    });
  })
  .catch((error) => {
    // Si la base no responde, el despliegue debe fallar de forma visible en
    // lugar de quedar "vivo" pero sirviendo 500 en cada peticion.
    logger.error('No se pudo inicializar la base de datos:', error.message);
    process.exit(1);
  });