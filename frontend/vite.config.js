/**
 * vite.config.js
 * -----------------------------------------------------------------
 * Configuracion de Vite para el frontend del cotizador.
 *
 * El proxy es lo que evita el problema de CORS en desarrollo: el navegador
 * llama a /api/... en el mismo origen (localhost:5173) y Vite reenvia la
 * peticion al backend (localhost:4010) del lado del servidor.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    // Si el puerto esta ocupado, Vite prueba el siguiente en lugar de fallar.
    strictPort: false,
    open: false,

    proxy: {
      '/api': {
        target: 'http://localhost:4010',
        changeOrigin: true,
        // No hace falta CORS porque el navegador ve un solo origen.
        secure: false,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * Separa las librerias pesadas del bundle de la aplicacion para que
         * el navegador las cachee de forma independiente.
         *
         * Vite 8 usa rolldown, que exige la forma de FUNCION (la forma de
         * objeto de Rollup classique ya no se acepta).
         *
         * @param {string} id - Ruta del modulo que se esta empaquetando.
         * @returns {string|undefined} Nombre del chunk, o undefined para
         *          que rolldown decida automaticamente.
         */
        manualChunks(id) {
          if (id.includes('jspdf')) return 'pdf';
          if (id.includes('node_modules') && id.includes('react')) return 'react';
          return undefined;
        },
      },
    },
  },
});