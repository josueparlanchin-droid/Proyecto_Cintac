/**
 * scripts/limpiar-cuentas-prueba.js
 * -----------------------------------------------------------------
 * Borra las cuentas creadas por las suites de verificacion.
 *
 * Las pruebas de alta de usuario (API y navegador) necesitan una cuenta
 * nueva en cada ejecucion. Sin una limpieza, esas cuentas quedan en la tabla
 * `usuarios` y aparecen en la pantalla "Solicitudes pendientes" de Jefatura,
 * ensuciando los datos de demostracion.
 *
 * El borrado es por patrón de correo y NUNCA por id: si alguien pasa un
 * patron que no parece de prueba (por ejemplo "cintac.cl"), el script se
 * niega a ejecutar y explica por que.
 *
 * Uso:
 *   npm run limpiar:pruebas              -> borra verificacion.%
 *   npm run limpiar:pruebas -- otro.%    -> borra las filas que casen con eso
 */

import { query, cerrarBaseDatos } from '../src/config/db.js';

/** Patrones que se consideran "de prueba" y se pueden borrar sin confirmacion. */
const PERMITIDOS = ['verificacion.%', 'prueba.%', 'test.%'];

const patrones = process.argv.slice(2);

if (patrones.length === 0) {
  patrones.push('verificacion.%');
}

for (const patron of patrones) {
  if (!PERMITIDOS.includes(patron)) {
    console.error(
      `[ABORTO] El patron "${patron}" no esta autorizado. ` +
        `Solo se borran cuentas de prueba: ${PERMITIDOS.join(', ')}`,
    );
    process.exit(1);
  }
}

// El correltato va en la base: los usuarios de demostracion (jefe@, analista@)
// nunca casan con estos patrones, pero la restriccion se hace aqui y no solo
// en el SQL, para que el error sea explicito.
const condiciones = patrones.map((patron, indice) => `email ILIKE $${indice + 1}`).join(' OR ');

async function main() {
  const cuentas = await query(
    `SELECT id, email FROM usuarios WHERE ${condiciones} ORDER BY id`,
    patrones,
  );

  if (cuentas.rowCount === 0) {
    console.log('No hay cuentas de prueba que borrar.');
    return;
  }

  const ids = cuentas.rows.map((fila) => fila.id);

  // Las cotizaciones se borran antes que las cuentas: `cotizaciones_log`
  // declara `usuario_id ... ON DELETE RESTRICT` porque el historial es
  // informacion contable. Aqui si se puede, porque son datos de prueba.
  const cotizaciones = await query(
    `DELETE FROM cotizaciones_log WHERE usuario_id = ANY($1::int[])`,
    [ids],
  );

  // Las anotaciones de `usuarios_auditoria` caen solas con ON DELETE CASCADE.
  const borradas = await query(`DELETE FROM usuarios WHERE id = ANY($1::int[])`, [ids]);

  console.log(`Cuentas de prueba eliminadas: ${borradas.rowCount}`);
  for (const fila of cuentas.rows) {
    console.log(`  - ${fila.email} (id ${fila.id})`);
  }
  console.log(`Cotizaciones de prueba eliminadas: ${cotizaciones.rowCount}`);
}

try {
  await main();
} catch (error) {
  console.error('No se pudo limpiar:', error.message);
  process.exitCode = 1;
} finally {
  await cerrarBaseDatos();
}
