/**
 * Resetea la base de datos PostgreSQL y vuelve a cargar los datos de demostracion.
 *
 * Existe porque las pruebas (`npm run verificar`) modifican datos reales:
 * las cotizaciones de prueba se acumulan en el historial y la carga de
 * tarifas de prueba altera valores de la tabla `tarifas_flete`. Sin un reset,
 * una demo quedaria con decenas de registros basura.
 *
 * A diferencia de SQLite, aqui NO hace falta detener el backend: `TRUNCATE` y
 * `DROP SCHEMA` funcionan con la base en linea, porque cada conexion ve los
 * datos anew. Aun asi se recomienda detenerlo para no tener peticiones a medio
 * camino mientras se borra.
 *
 *   Ctrl+C   -> detener `npm run dev`
 *   npm run reset
 *
 * ADVERTENCIA: borra TODOS los datos de la base a la que apunte DATABASE_URL.
 * Por eso se pide una confirmacion explicita, y por eso se comprueba que no
 * apunte a una base de nombre inesperado.
 */

import { config } from 'dotenv';
import { pool, inicializarEsquema, query } from '../src/config/db.js';

config({ path: new URL('../.env', import.meta.url) });

const CONFIRMAR = process.argv.includes('--si');

/**
 * Nombres de base que se consideran de desarrollo o de pruebas. Apuntar el
 * reset a una base de produccion es un error caro, asi que se corta el paso
 * salvo que el operador lo fuerce con --si.
 */
const BASES_PERMITIDAS = ['neondb', 'cintac', 'postgres'];

function describirBase() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return { host: url.hostname, base: url.pathname.replace(/^\//, '') || '(sin nombre)' };
  } catch {
    return { host: '(DATABASE_URL no valida)', base: '(desconocida)' };
  }
}

async function main() {
  const { host, base } = describirBase();

  console.log('========================================');
  console.log('Reset de la base de datos PostgreSQL');
  console.log('========================================');
  console.log(`Servidor: ${host}`);
  console.log(`Base:     ${base}\n`);

  const basePermitida = BASES_PERMITIDAS.includes(base);

  if (!basePermitida) {
    console.error(`La base "${base}" no esta en la lista de bases conocidas (${BASES_PERMITIDAS.join(', ')}).`);
    console.error('Si es correcta de todos modos, ejecútalo con --si para confirmar.');
    process.exitCode = 1;
    return;
  }

  if (!CONFIRMAR) {
    console.log('Se BORRARÁN todas las tablas y sus datos. Para confirmar, ejecuta:');
    console.log('    npm run reset -- --si\n');
    process.exitCode = 1;
    return;
  }

  // `CASCADE` elimina tambien las tablas que dependan de estas por clave
  // foranea. Se reconstruyen justo despues con inicializarEsquema().
  console.log('Eliminando tablas existentes...');
  await query('DROP SCHEMA public CASCADE');
  await query('CREATE SCHEMA public');
  console.log('  Esquema vaciado.');

  await inicializarEsquema();
  console.log('  Tablas recreadas.\n');

  // El seed se importa (no se lanza como proceso hijo) para que el pool quede
  // controlado desde aqui y se cierre al final sin procesos huerfanos.
  const { sembrar } = await import('../src/db/seed.js');
  await sembrar();

  console.log('\nBase de datos lista. Ya puedes iniciar `npm run dev`.');
}

try {
  await main();
} catch (error) {
  console.error('\nERROR durante el reset:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
