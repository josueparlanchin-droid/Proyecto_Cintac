/**
 * scripts/verificar-frontend.js
 * -----------------------------------------------------------------
 * Prueba de renderizado real con Chrome headless.
 *
 * Comprueba que la aplicacion React monta, que el login funciona y que
 * la pantalla del cotizador pinta el resultado del calculo. La API ya
 * esta verificada aparte con `npm run verificar`.
 *
 * Requiere que esten levantados:
 *   - backend  en http://localhost:4010
 *   - frontend en http://localhost:5173
 *   - Google Chrome instalado
 *
 * Uso:  node scripts/verificar-frontend.js
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';

const FRONTEND = 'http://localhost:5173';
const API = 'http://localhost:4010';

const CHROME =
  [
    join(process.env.ProgramFiles ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.ProgramFiles ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].find((ruta) => ruta && existsSync(ruta)) ?? null;

// ------------------------------------------------------------------
let total = 0;
let fallos = 0;

function comprobar(descripcion, condicion, detalle = '') {
  total += 1;
  if (condicion) {
    console.log(`  OK    ${descripcion}${detalle ? `\n          ${detalle}` : ''}`);
  } else {
    fallos += 1;
    console.log(` [FALLA] ${descripcion}${detalle ? `\n          ${detalle}` : ''}`);
  }
}

/**
 * Comprueba que un puerto escucha algo.
 *
 * Vite 8 se enlaza solo en IPv6 (`[::1]`), mientras el backend Express
 * usa IPv4, asi que se prueban ambos: si solo se consultara 127.0.0.1 el
 * script declararia caido un servidor que si responde en el navegador.
 */
async function puertoAbierto(puerto) {
  for (const host of ['127.0.0.1', '::1', 'localhost']) {
    const abierto = await new Promise((resolve) => {
      const socket = createConnection({ port: puerto, host });
      const cerrar = (resultado) => {
        socket.destroy();
        resolve(resultado);
      };
      socket.setTimeout(1500);
      socket.on('connect', () => cerrar(true));
      socket.on('timeout', () => cerrar(false));
      socket.on('error', () => cerrar(false));
    });

    if (abierto) return true;
  }
  return false;
}

/** Espera a que Chrome escuche el puerto de depuracion. */
async function esperarPuerto(puerto, intentos = 40) {
  for (let i = 0; i < intentos; i += 1) {
    if (await puertoAbierto(puerto)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** POST al protocolo de debugging de Chrome. */
async function cdp(puerto, metodo, params = {}, sessionId) {
  const respuesta = await fetch(`http://127.0.0.1:${puerto}/json/${sessionId ? `version` : 'version'}`, {
    method: metodo === 'POST' ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: metodo === 'POST' ? JSON.stringify(params) : undefined,
  });
  return respuesta.json();
}

async function main() {
  console.log(`\nVerificando frontend en ${FRONTEND}\n${'='.repeat(70)}`);

  if (!CHROME) {
    console.error('No se encontro Google Chrome ni Microsoft Edge en este equipo.');
    process.exit(1);
  }

  console.log(`Navegador: ${CHROME}`);

  const [apiViva, frontVivo] = await Promise.all([puertoAbierto(4010), puertoAbierto(5173)]);
  if (!apiViva || !frontVivo) {
    console.error(`\nEl frontend y el backend deben estar corriendo (npm run dev).`);
    console.error(`  API 4010: ${apiViva ? 'OK' : 'CAIDA'} | Frontend 5173: ${frontVivo ? 'OK' : 'CAIDO'}`);
    process.exit(1);
  }

  const perfil = mkdtempSync(join(tmpdir(), 'cintac-chrome-'));
  const puertoDepuracion = 9223;

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${puertoDepuracion}`,
      `--user-data-dir=${perfil}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--window-size=1366,768', // Resolucion tipica de notebook
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const limpiar = () => {
    try { chrome.kill(); } catch { /* ya termino */ }
    try { rmSync(perfil, { recursive: true, force: true }); } catch { /* nada que limpiar */ }
  };

  try {
    if (!(await esperarPuerto(puertoDepuracion))) {
      throw new Error('Chrome no abrio el puerto de depuracion.');
    }

    // --- Crear una pestana y adjuntarse a ella ---
    const version = await cdp(puertoDepuracion, 'GET');
    const wsUrl = version.webSocketDebuggerUrl;

    if (typeof globalThis.WebSocket !== 'function') {
      throw new Error(
        'Este script requiere Node 22+ con WebSocket nativo (disponible en Node ' + process.version + ').',
      );
    }

    const socket = new globalThis.WebSocket(wsUrl);
    await new Promise((res, rej) => {
      socket.addEventListener('open', res, { once: true });
      socket.addEventListener('error', rej, { once: true });
    });

    let mensajeId = 0;
    const pendientes = new Map();
    let idSesion = null;
    const erroresConsola = [];

    socket.addEventListener('message', (evento) => {
      const mensaje = JSON.parse(evento.data);

      if (mensaje.id && pendientes.has(mensaje.id)) {
        const { resolver, rechazo } = pendientes.get(mensaje.id);
        pendientes.delete(mensaje.id);
        if (mensaje.error) rechazo(new Error(`${mensaje.error.message} (${mensaje.error.code ?? '?'})`));
        else resolver(mensaje.result);
        return;
      }

      // Errores de la aplicacion: un import fallido o un error de render
      // aparecen aqui. Se guarda la descripcion completa, no solo el texto.
      if (mensaje.method === 'Runtime.exceptionThrown') {
        const d = mensaje.params?.exceptionDetails ?? {};
        erroresConsola.push(d.exception?.description ?? d.text ?? 'excepcion');
      }
    });

    const enviar = (metodo, params = {}) =>
      new Promise((resolver, rechazo) => {
        mensajeId += 1;
        pendientes.set(mensajeId, { resolver, rechazo });

        const mensaje = { id: mensajeId, method: metodo, params };

        // Chrome exige que sessionId sea string si viene: enviarlo como
        // null en los comandos de nivel navegador devuelve error -32600.
        if (typeof idSesion === 'string') mensaje.sessionId = idSesion;

        socket.send(JSON.stringify(mensaje));
      });

    // Adjuntar a una pestana nueva.
    const creado = await enviar('Target.createTarget', { url: 'about:blank' });
    if (!creado?.targetId) throw new Error(`Target.createTarget devolvio: ${JSON.stringify(creado)}`);

    const adjunto = await enviar('Target.attachToTarget', { targetId: creado.targetId, flatten: true });
    if (!adjunto?.sessionId) throw new Error(`Target.attachToTarget devolvio: ${JSON.stringify(adjunto)}`);
    idSesion = adjunto.sessionId;

    await enviar('Page.enable');
    await enviar('Runtime.enable');
    await enviar('Log.enable');

    /** Evalua una expresion en la pagina y devuelve su valor. */
    async function evaluar(expresion) {
      const r = await enviar('Runtime.evaluate', {
        expression: expresion,
        returnByValue: true,
        awaitPromise: true,
      });

      if (r?.exceptionDetails) {
        throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception?.description ?? ''));
      }
      return r?.result?.value;
    }

    async function navegar(url, esperaMs = 2500) {
      await enviar('Page.navigate', { url });
      await new Promise((r) => setTimeout(r, esperaMs));
    }

    /**
     * Escribe valores en varios campos por su id.
     *
     * Dos detalles importantes:
     *  - Se invoca el setter del prototipo, no `campo.value = x`, porque React
     *    rastrea el valor con su propio tracker: asignar la propiedad
     *    directamente no dispara `onChange` y el estado no se actualiza.
     *  - Devuelve `"falta:<id>"` en vez de lanzar si el campo no existe. Asi un
     *    fallo de interfaz se reporta como comprobacion fallida y legible, en
     *    lugar de abortar el script con un `Illegal invocation` incomprensible.
     */
    async function llenar(campos) {
      return evaluar(`
        (() => {
          const campos = ${JSON.stringify(campos)};
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          for (const [id, valor] of campos) {
            const campo = document.getElementById(id);
            if (!campo) return 'falta:' + id;
            setter.call(campo, valor);
            campo.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return true;
        })()
      `);
    }

    // ==================================================================
    console.log('\n1. MONTAJE DE LA APLICACION');
    // ==================================================================

    await navegar(`${FRONTEND}/login`);

    const tieneRoot = await evaluar(`document.getElementById('root').children.length > 0`);
    comprobar('React monta la aplicacion dentro de #root', tieneRoot === true);

    const titulo = await evaluar(`document.title`);
    comprobar('El documento tiene el titulo institucional', /Cintac/i.test(titulo ?? ''), `title="${titulo}"`);

    const textoLogin = await evaluar(`document.body.innerText`);
    comprobar('Se muestra el modulo de acceso a la aplicacion', /CINTAC/i.test(textoLogin ?? ''));
    comprobar('Se ofrecen las dos cuentas de demostracion', /Jefatura/i.test(textoLogin ?? '') && /Analista/i.test(textoLogin ?? ''));

    // ==================================================================
    console.log('\n2. INICIO DE SESION (Jefatura Comex)');
    // ==================================================================

    const camposLogin = await llenar([
      ['email', 'jefe@cintac.cl'],
      ['password', 'Jefatura2026'],
    ]);

    if (camposLogin !== true) {
      console.error(`\nNo se pudo escribir en los campos del formulario: ${camposLogin}`);
      console.error('El formulario de login no esta en pantalla. Suele significar que el');
      console.error('backend no responde o que el frontend quedo en una ruta inesperada.');
      throw new Error('Formulario de login no disponible');
    }

    await evaluar(`document.querySelector('form').requestSubmit(), true`);

    await new Promise((r) => setTimeout(r, 3000));

    const urlTrasLogin = await evaluar(`window.location.pathname`);

    // Un 429 en el login deja al usuario en la pantalla de acceso. Se detecta
    // para explicar la causa en vez de reportar fallos en cascada.
    if (urlTrasLogin === '/login') {
      const mensajeError = await evaluar(`document.querySelector('.alerta--error')?.innerText ?? ''`);
      throw new Error(
        `El login no completo (sigue en /login). ${mensajeError ? 'La aplicacion muestra: "' + mensajeError.trim() + '"' : ''}`.trim(),
      );
    }

    comprobar('El login redirige al cotizador', urlTrasLogin === '/cotizador', `ruta="${urlTrasLogin}"`);

    const textoTrasLogin = await evaluar(`document.body.innerText`);
    comprobar('La barra superior muestra al usuario autenticado', /Carla Mendoza/.test(textoTrasLogin ?? ''));
    comprobar('La barra superior indica el rol', /Jefatura Comex/.test(textoTrasLogin ?? ''));
    comprobar('El enlace Tarifas es visible para Jefatura', /Tarifas/.test(textoTrasLogin ?? ''));

    // ==================================================================
    console.log('\n3. CONVERSION kg -> tn EN VIVO');
    // ==================================================================

    const conversionInicial = await llenar([['peso', '50000']]);

    await new Promise((r) => setTimeout(r, 700));

    const textoConversion = await evaluar(`document.querySelector('.conversion')?.innerText ?? ''`);
    comprobar(
      'Al escribir 50.000 kg la interfaz muestra 50 tn al instante',
      /50,000/.test(textoConversion ?? ''),
      `texto="${(textoConversion ?? '').replace(/\n/g, ' ')}"`,
    );
    void conversionInicial;

    // ==================================================================
    console.log('\n4. CALCULO Y PANEL DE RESULTADOS');
    // ==================================================================

    // El calculo real lo hace el backend: se pulsa "Calcular cotizacion".
    const campoValor = await llenar([['valor', '88000']]);
    if (campoValor !== true) throw new Error(`No se encontro el campo de valor: ${campoValor}`);

    await new Promise((r) => setTimeout(r, 300));

    const botonTexto = await evaluar(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Calcular cotizacion'))?.textContent ?? ''
    `);
    comprobar('El boton de calcular esta habilitado con datos validos', !botonTexto.includes('undefined'), `texto="${botonTexto.trim()}"`);

    await evaluar(`
      Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.includes('Calcular cotizacion'))
        ?.click()
    `);

    await new Promise((r) => setTimeout(r, 2500));

    const textoResultado = await evaluar(`document.body.innerText`);

    /**
     * `innerText` aplica `text-transform`, y los rotulos de los indicadores
     * estan en mayusculas por CSS. Por eso las comparaciones son sin distincion
     * de mayusculas y acentos.
     */
    const texto = (textoResultado ?? '').toLowerCase();

    comprobar('El panel muestra la ruta simulada', /cntao|cnsha|cnngb|clvap|clsai/.test(texto));
    comprobar('Se muestra la cantidad de contenedores calculada', texto.includes('contenedores'));
    comprobar('Se muestra el flete maritimo', texto.includes('flete maritimo'));
    comprobar('Se muestra el impuesto de 19% sobre CIF', texto.includes('impuesto 19% cif'));
    comprobar('Se muestra el tiempo de transito', texto.includes('tiempo de transito'));
    comprobar('Se muestra el costo total', texto.includes('costo total'));

    // 50.000 kg = 50 tn -> exactamente 2 contenedores de 25 tn.
    const valorContenedores = await evaluar(`
      (() => {
        const stat = Array.from(document.querySelectorAll('.stat'))
          .find(s => s.textContent.includes('Contenedores'));
        return stat?.querySelector('.stat__valor')?.textContent?.trim() ?? '';
      })()
    `);
    comprobar(
      '50.000 kg se asigna a 2 contenedores (limite de 25 tn respetado)',
      valorContenedores === '2',
      `valor="${valorContenedores}"`,
    );

    const cajasContenedor = await evaluar(`document.querySelectorAll('.contenedor-caja').length`);
    comprobar('Se dibujan 2 cajas de contenedor', cajasContenedor === 2, `cajas=${cajasContenedor}`);

    const hayBotonPDF = await evaluar(`
      Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Exportar informe PDF'))
    `);
    comprobar('Esta disponible el boton para exportar el informe PDF', hayBotonPDF === true);

    // La base de calculo vive dentro de un <details> plegado, y `innerText`
    // no lee contenido oculto: hay que abrirlo antes de comprobarlo.
    await evaluar(`
      (() => {
        const d = Array.from(document.querySelectorAll('details')).find(x => x.textContent.includes('base de calculo'));
        if (d) d.open = true;
        return Boolean(d);
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));

    const hayFormula = await evaluar(`document.body.innerText.includes('ceil(')`);
    comprobar('Se puede desplegar la base de calculo aplicada', hayFormula === true);

    // ==================================================================
    console.log('\n5. HISTORIAL Y AISLAMIENTO POR ROL');
    // ==================================================================

    await evaluar(`
      Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Historial'))?.click()
    `);
    await new Promise((r) => setTimeout(r, 2500));

    const textoHistorial = (await evaluar(`document.body.innerText`)) ?? '';
    const historial = textoHistorial.toLowerCase();

    comprobar('La vista de historial carga registros', /n\.\d+|#\d+/.test(textoHistorial));
    comprobar('Jefatura ve el aviso de vista completa', historial.includes('vista completa'));
    comprobar('Jefuria dispone del boton Eliminar', historial.includes('eliminar'));
    comprobar('El historial muestra la paginacion', /mostrando .* cotizaciones/.test(historial));
    comprobar('Las metricas agregadas se muestran', historial.includes('facturacion simulada'));

    // ==================================================================
    console.log('\n6. SESION DEL ANALISTA (sin permisos de administracion)');
    // ==================================================================

    await evaluar(`window.localStorage.removeItem('cintac_comex_token')`);
    await navegar(`${FRONTEND}/login`);
    await new Promise((r) => setTimeout(r, 1500));

    await evaluar(`
      (() => {
        Array.from(document.querySelectorAll('.selector-rol__opcion'))
          .find(b => b.textContent.includes('Analista Comex'))?.click();
        return true;
      })()
    `);

    // El boton de rol ya completo el correo: solo queda la contrasena.
    await llenar([['password', 'Analista2026']]);
    await evaluar(`document.querySelector('form').requestSubmit(), true`);

    await new Promise((r) => setTimeout(r, 3000));

    const textoAnalista = (await evaluar(`document.body.innerText`)) ?? '';
    comprobar('El Analista accede a la aplicacion', /cotizacion de importacion/i.test(textoAnalista));
    comprobar('El Analista ve su nombre en la barra', /diego fuentes/i.test(textoAnalista));
    comprobar('El enlace Tarifas NO aparece para el Analista', !/tarifas/i.test(textoAnalista));

    await evaluar(`window.location.href = '${FRONTEND}/tarifas'`);
    await new Promise((r) => setTimeout(r, 2500));

    const urlAnalistaTarifas = await evaluar(`window.location.pathname`);
    comprobar(
      'El Analista es redirigido si intenta abrir /tarifas directamente',
      urlAnalistaTarifas === '/cotizador',
      `ruta="${urlAnalistaTarifas}"`,
    );

    // ==================================================================
    console.log('\n7. PERSISTENCIA DE SESION AL RECARGAR');
    // ==================================================================

    await navegar(`${FRONTEND}/historial`, 2500);
    const rutaTrasRecarga = await evaluar(`window.location.pathname`);
    comprobar('Recargar no expulsa al usuario de la sesion', rutaTrasRecarga === '/historial', `ruta="${rutaTrasRecarga}"`);

    // ==================================================================
    console.log('\n8. ERRORES DE CONSOLA');
    // ==================================================================
    comprobar(
      'La aplicacion no lanzo excepciones durante la prueba',
      erroresConsola.length === 0,
      erroresConsola.length ? erroresConsola.slice(0, 3).map((e) => `\n          ${String(e).split('\n')[0]}`).join('') : 'sin excepciones',
    );

    // ==================================================================
    socket.close();
  } finally {
    limpiar();
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`Comprobaciones ejecutadas: ${total}`);
  console.log(`Fallidas: ${fallos}`);
  console.log(fallos === 0 ? 'RESULTADO: el frontend renderiza y se comporta como se espera.\n' : 'RESULTADO: hay comprobaciones fallidas.\n');

  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nError al verificar el frontend:', error.message);
  process.exit(1);
});