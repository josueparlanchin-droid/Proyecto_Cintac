/**
 * scripts/probar-conexion.js
 * -----------------------------------------------------------------
 * Comprueba que el backend puede conectarse a PostgreSQL.
 *
 * Util cuando:
 *  - se acaba de cambiar DATABASE_URL;
 *  - el servidor de Render arranca y falla (es el primer diagnostico);
 *  - se quiere confirmar que Neon responde antes de correr el seed.
 *
 *   npm run db:check
 *
 * No crea ni modifica nada: solo SELECT.
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const url = process.env.DATABASE_URL;

if (!url) {
  console.error('\n  ERROR: falta la variable DATABASE_URL en backend/.env\n');
  process.exit(1);
}

// Se oculta la contrasena antes de imprimir la URL.
const urlOculta = url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');

console.log('\n========================================');
console.log('  Comprobacion de conexion a PostgreSQL');
console.log('========================================');
console.log(`  URL: ${urlOculta}\n`);

const pool = new Pool({
  connectionString: url,
  // El modo SSL sale de DATABASE_URL (`sslmode=verify-full`), que es la forma
  // explicita y validada contra la CA publica de Neon. No se relaja con
  // `rejectUnauthorized: false` a proposito: en una red corporativa que
  // intercepte el TLS, es preferible fallar de forma visible.
  connectionTimeoutMillis: 15_000,
});

try {
  const info = await pool.query(
    'SELECT version() AS version, current_database() AS base, current_user AS usuario',
  );

  console.log('  CONEXION CORRECTA');
  console.log(`    Base de datos: ${info.rows[0].base}`);
  console.log(`    Usuario:       ${info.rows[0].usuario}`);
  console.log(`    Motor:         ${info.rows[0].version.split(',')[0]}\n`);

  const tablas = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );

  console.log(`  Tablas en el esquema public: ${tablas.rows.length}`);
  tablas.rows.forEach((t) => console.log(`    - ${t.table_name}`));

  const esperadas = ['usuarios', 'puertos', 'tarifas_flete', 'cotizaciones_log'];
  const faltantes = esperadas.filter((t) => !tablas.rows.some((x) => x.table_name === t));

  if (faltantes.length) {
    console.log(`\n  Faltan tablas: ${faltantes.join(', ')}`);
    console.log('  Se crearan solas al arrancar el backend (o ejecuta `npm run seed`).\n');
  } else {
    const conteos = await pool.query(
      `SELECT
         (SELECT count(*) FROM usuarios)            AS usuarios,
         (SELECT count(*) FROM puertos)             AS puertos,
         (SELECT count(*) FROM tarifas_flete)       AS tarifas,
         (SELECT count(*) FROM cotizaciones_log)    AS cotizaciones`,
    );
    const c = conteos.rows[0];
    console.log(
      `\n  Registros: ${c.usuarios} usuarios | ${c.puertos} puertos | ` +
        `${c.tarifas} tarifas | ${c.cotizaciones} cotizaciones`,
    );
    console.log('\n  La base ya tiene datos.\n');
  }
} catch (error) {
  console.error('  CONEXION FALLIDA\n');
  console.error(`  Codigo:  ${error.code ?? '(sin codigo)'}`);
  console.error(`  Mensaje: ${error.message}\n`);

  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
    console.error('  Pista: el host no resuelve. Revisa el dominio de DATABASE_URL.\n');
  } else if (error.code === 'ETIMEDOUT') {
    console.error('  Pista: el host no responde. Revisa la red o el firewall.\n');
  } else if (error.code === '28P01' || error.code === '28000') {
    console.error('  Pista: usuario o contrasena incorrectos.\n');
  } else if (error.code === '3D000') {
    console.error('  Pista: la base de datos indicada no existe.\n');
  } else if (error.code === '42501') {
    console.error('  Pista: el usuario no tiene permisos sobre esa base.\n');
  }

  process.exitCode = 1;
} finally {
  await pool.end();
}
