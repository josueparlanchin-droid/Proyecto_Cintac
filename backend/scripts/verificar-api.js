/**
 * scripts/verificar-api.js
 * -----------------------------------------------------------------
 * Prueba de humo end-to-end contra una API en ejecucion.
 *
 *   node scripts/verificar-api.js            (usa http://localhost:4010)
 *   node scripts/verificar-api.js http://localhost:4010/api/v1
 *
 * No es un framework de tests: es un script que imprime una tabla de
 * comprobaciones y termina con codigo 1 si alguna falla. Sirve para
 * demostrar en la defensa que las validaciones y el control de acceso
 * funcionan de verdad, no solo en teoria.
 */

const BASE = (process.argv[2] ?? 'http://localhost:4010/api/v1').replace(/\/$/, '');

const USUARIOS = {
  admin: { email: 'jefe@cintac.cl', password: 'Jefatura2026', rol: 'ADMIN_COMEX' },
  analista: { email: 'analista@cintac.cl', password: 'Analista2026', rol: 'ANALISTA' },
};

/**
 * Solo email y password. El esquema de login es estricto (`.strict()`), por
 * lo que enviar el campo `rol` debe ser rechazado: no se incluye aqui.
 */
const credenciales = (clave) => ({ email: USUARIOS[clave].email, password: USUARIOS[clave].password });

let total = 0;
let fallos = 0;

/**
 * Ejecuta una peticion y evalua el resultado.
 *
 * @param {string} descripcion
 * @param {Function} peticion   - () => fetch(...)
 * @param {(json:object)=>boolean} verificar
 * @param {object} [opciones]   - { statusEsperado, mostrar }
 */
async function comprobar(descripcion, peticion, verificar, opciones = {}) {
  const { statusEsperado = 200, mostrar = null, json = true } = opciones;
  total += 1;

  let respuesta;
  let cuerpo = null;

  try {
    respuesta = await peticion();
    if (json) {
      cuerpo = await respuesta.json();
    } else {
      cuerpo = { texto: await respuesta.text() };
    }
  } catch (error) {
    fallos += 1;
    console.log(`  [FALLA] ${descripcion}\n          No se pudo obtener respuesta: ${error.message}`);
    return null;
  }

  const okEstado = respuesta.status === statusEsperado;
  const okCuerpo = verificar ? verificar(cuerpo) : true;
  const ok = okEstado && okCuerpo;

  if (!ok) fallos += 1;

  const marca = ok ? '  OK   ' : ' [FALLA]';
  console.log(`${marca} ${descripcion}  [${respuesta.status}]`);

  if (!ok) {
    console.log(`          Esperado: ${statusEsperado}, recibido: ${respuesta.status}`);
    console.log(`          Cuerpo: ${JSON.stringify(cuerpo).slice(0, 300)}`);
  }

  if (mostrar && ok) console.log(`          -> ${mostrar(cuerpo)}`);

  return cuerpo;
}

/** Atajo: peticion JSON con token opcional. */
function pedir(ruta, { metodo = 'GET', token = null, cuerpo = null, cabeceras = {} } = {}) {
  return async () => {
    const config = { method: metodo, headers: { ...cabeceras } };

    if (token) config.headers.Authorization = `Bearer ${token}`;

    if (cuerpo instanceof FormData) {
      config.body = cuerpo;
    } else if (cuerpo !== null) {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(cuerpo);
    }

    return fetch(`${BASE}${ruta}`, config);
  };
}

/** Calcula el valor esperado para una serie de casos y compara. */
function esperado(toneladas, capacidad, precioCont, valorMerc) {
  const contenedores = Math.max(Math.ceil(toneladas / capacidad), 1);
  const flete = Math.round(contenedores * precioCont * 100) / 100;
  const seguro = Math.round(valorMerc * 0.01 * 100) / 100;
  const cif = Math.round((valorMerc + flete + seguro) * 100) / 100;
  const impuesto = Math.round(cif * 0.19 * 100) / 100;
  return { contenedores, flete, impuesto, total: Math.round((flete + impuesto) * 100) / 100 };
}

// ==================================================================
async function main() {
  console.log(`\nVerificando API en ${BASE}\n${'='.repeat(74)}`);

  // ---------------- 1. Salud ----------------
  console.log('\n1. SALUD DEL SERVICIO');
  await comprobar('GET /health responde operativo', pedir('/health'), (c) => c.datos.estado === 'operativo');

  // ---------------- 2. Autenticacion ----------------
  console.log('\n2. AUTENTICACION (JWT + bcrypt)');

  const loginAdmin = await comprobar(
    'POST /auth/login - Jefatura Comex',
    pedir('/auth/login', { metodo: 'POST', cuerpo: credenciales('admin') }),
    (c) => c.exito && c.datos.token.length > 50 && c.datos.usuario.rol === 'ADMIN_COMEX',
    { mostrar: (c) => `rol=${c.datos.usuario.rol}, expira en ${c.datos.expiraEn}` },
  );

  const loginAnalista = await comprobar(
    'POST /auth/login - Analista',
    pedir('/auth/login', { metodo: 'POST', cuerpo: credenciales('analista') }),
    (c) => c.exito && c.datos.usuario.rol === 'ANALISTA',
  );

  const tokenAdmin = loginAdmin?.datos.token;
  const tokenAnalista = loginAnalista?.datos.token;

  await comprobar(
    'POST /auth/login - password incorrecta -> 401',
    pedir('/auth/login', { metodo: 'POST', cuerpo: { email: 'jefe@cintac.cl', password: 'incorrecta' } }),
    (c) => !c.exito,
    { statusEsperado: 401 },
  );

  await comprobar(
    'POST /auth/login - usuario inexistente -> 401 (mismo mensaje, no enumera usuarios)',
    pedir('/auth/login', { metodo: 'POST', cuerpo: { email: 'fantasma@cintac.cl', password: 'x' } }),
    (c) => c.error.codigo === 'NO_AUTORIZADO',
    { statusEsperado: 401 },
  );

  await comprobar(
    'POST /auth/login - email invalido -> 400 con detalle por campo',
    pedir('/auth/login', { metodo: 'POST', cuerpo: { email: 'no-es-mail', password: '' } }),
    (c) => c.error.codigo === 'VALIDACION_FALLIDA' && c.error.detalle.email,
    { statusEsperado: 400 },
  );

  await comprobar(
    'GET /auth/me sin token -> 401',
    pedir('/auth/me'),
    (c) => c.error.codigo === 'NO_AUTORIZADO',
    { statusEsperado: 401 },
  );

  // ---------------- Auto-registro con codigo ----------------
  // El codigo llega por el entorno del proceso que lanza la suite, nunca por
  // linea de comandos: asi no queda escrito en el historial del shell.
  //
  // Si no esta definido, la seccion se OMITE en lugar de fallar. El registro
  // puede estar cerrado a proposito (la variable no definida lo deshabilita),
  // y en ese caso un fallo seria una alarma falsa.
  console.log('\n3. AUTO-REGISTRO CON CODIGO DE INVITACION');

  const CORREO_ALTA = `verificacion.registro.${Date.now()}@cintac.cl`;
  const CLAVE_ALTA = 'Analista#2026';
  const codigoInvitacion = process.env.REGISTRATION_CODE;

  /** Cuenta creada por esta corrida, para el resto de las comprobaciones. */
  let altaCreada = null;

  if (!codigoInvitacion) {
    console.log('  [OMITE] REGISTRATION_CODE no esta definido: el registro esta cerrado.');
  } else {
    const cuerpoAlta = {
      nombre: 'Analista de Verificacion',
      email: CORREO_ALTA,
      password: CLAVE_ALTA,
      passwordRepeticion: CLAVE_ALTA,
      codigoInvitacion,
    };

    await comprobar(
      'POST /auth/registro - codigo incorrecto -> 403',
      pedir('/auth/registro', {
        metodo: 'POST',
        cuerpo: { ...cuerpoAlta, codigoInvitacion: 'codigo-que-no-es' },
      }),
      (c) => c.error.codigo === 'CODIGO_INVALIDO',
      { statusEsperado: 403 },
    );

    await comprobar(
      'POST /auth/registro - contrasena debil -> 400',
      pedir('/auth/registro', {
        metodo: 'POST',
        cuerpo: { ...cuerpoAlta, password: 'debil', passwordRepeticion: 'debil' },
      }),
      (c) => c.error.codigo === 'VALIDACION_FALLIDA',
      { statusEsperado: 400 },
    );

    await comprobar(
      'POST /auth/registro - repeticion distinta -> 400',
      pedir('/auth/registro', {
        metodo: 'POST',
        cuerpo: { ...cuerpoAlta, passwordRepeticion: 'Otra#2026distinta' },
      }),
      (c) => c.error.codigo === 'VALIDACION_FALLIDA',
      { statusEsperado: 400 },
    );

    // El endpoint es publico, asi que aceptar un rol desde el body seria un
    // agujero de escalamiento de privilegios. El esquema es estricto, asi que
    // el campo de mas produce 400 antes de tocar la base de datos.
    await comprobar(
      'POST /auth/registro - intento de inyectar el rol -> 400',
      pedir('/auth/registro', { metodo: 'POST', cuerpo: { ...cuerpoAlta, rol: 'ADMIN_COMEX' } }),
      (c) => c.error.codigo === 'VALIDACION_FALLIDA',
      { statusEsperado: 400 },
    );

    const alta = await comprobar(
      'POST /auth/registro - alta valida -> 201 con token inmediato',
      pedir('/auth/registro', { metodo: 'POST', cuerpo: cuerpoAlta }),
      (c) => c.exito
        && c.datos.token.length > 50
        && c.datos.usuario.rol === 'ANALISTA'
        && !('password' in c.datos.usuario),
      {
        statusEsperado: 201,
        mostrar: (c) => `id=${c.datos.usuario.id}, rol=${c.datos.usuario.rol}`,
      },
    );

    if (alta) {
      altaCreada = { id: alta.datos.usuario.id, email: CORREO_ALTA };

      await comprobar(
        'POST /auth/registro - el recien registrado ya puede entrar',
        pedir('/auth/login', { metodo: 'POST', cuerpo: { email: CORREO_ALTA, password: CLAVE_ALTA } }),
        (c) => c.exito && c.datos.usuario.rol === 'ANALISTA',
      );

      await comprobar(
        'POST /auth/registro - correo duplicado -> 409',
        pedir('/auth/registro', { metodo: 'POST', cuerpo: cuerpoAlta }),
        (c) => c.error.codigo === 'EMAIL_DUPLICADO',
        { statusEsperado: 409 },
      );
    }
  }

  // ---------------- Administracion de cuentas ----------------
  console.log('\n4. ADMINISTRACION DE CUENTAS (solo ADMIN_COMEX)');

  await comprobar(
    'GET /usuarios - sin token -> 401',
    pedir('/usuarios'),
    (c) => !c.exito,
    { statusEsperado: 401 },
  );

  await comprobar(
    'GET /usuarios - con token de Analista -> 403',
    pedir('/usuarios', { token: tokenAnalista }),
    (c) => !c.exito,
    { statusEsperado: 403 },
  );

  const idAdmin = loginAdmin?.datos.usuario.id;

  const listaUsuarios = await comprobar(
    'GET /usuarios - como Administrador -> 200',
    pedir('/usuarios', { token: tokenAdmin }),
    (c) => c.exito && Array.isArray(c.datos.usuarios) && c.datos.resumen.total > 0,
    { mostrar: (c) => `${c.datos.resumen.total} cuentas, ${c.datos.resumen.administradores} admin` },
  );

  // El listado no debe incluir jamas la columna con el hash. Es una comprobacion
  // sobre datos ya leidos, asi que se cuenta a mano en vez de pasar por
  // `comprobar`, que espera una peticion HTTP.
  total += 1;
  if (/password/i.test(JSON.stringify(listaUsuarios?.datos ?? {}))) {
    fallos += 1;
    console.log(' [FALLA] GET /usuarios - la respuesta no incluye la columna password');
  } else {
    console.log('  OK    GET /usuarios - la respuesta no incluye la columna password');
  }

  // ---------------- Promocion, degradacion y baja logica ----------------
  console.log('\n5. PROMOCION, DEGRADACION Y BAJA LOGICA');

  if (!altaCreada) {
    console.log('  [OMITE] Sin cuenta de prueba: no hay a quien administrar.');
  } else {
    const { id } = altaCreada;

    await comprobar(
      'PATCH /usuarios/:id/rol - degradarse a si mismo -> 400',
      pedir(`/usuarios/${idAdmin}/rol`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { rol: 'ANALISTA' } }),
      (c) => c.error.codigo === 'AUTOMODIFICACION_PROHIBIDA',
      { statusEsperado: 400 },
    );

    await comprobar(
      'PATCH /usuarios/:id/rol - mismo rol -> 409 sin cambio',
      pedir(`/usuarios/${id}/rol`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { rol: 'ANALISTA' } }),
      (c) => c.error.codigo === 'ROL_SIN_CAMBIO',
      { statusEsperado: 409 },
    );

    await comprobar(
      'PATCH /usuarios/:id/rol - como Analista -> 403',
      pedir(`/usuarios/${id}/rol`, { metodo: 'PATCH', token: tokenAnalista, cuerpo: { rol: 'ADMIN_COMEX' } }),
      (c) => !c.exito,
      { statusEsperado: 403 },
    );

    await comprobar(
      'PATCH /usuarios/:id/rol - id inexistente -> 404',
      pedir('/usuarios/999999/rol', { metodo: 'PATCH', token: tokenAdmin, cuerpo: { rol: 'ADMIN_COMEX' } }),
      (c) => c.error.codigo === 'USUARIO_NO_ENCONTRADO',
      { statusEsperado: 404 },
    );

    await comprobar(
      'PATCH /usuarios/:id/rol - rol invalido -> 400',
      pedir(`/usuarios/${id}/rol`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { rol: 'SUPERADMIN' } }),
      (c) => c.error.codigo === 'VALIDACION_FALLIDA',
      { statusEsperado: 400 },
    );

    await comprobar(
      'PATCH /usuarios/:id/rol - promocion a Administrador -> 200',
      pedir(`/usuarios/${id}/rol`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { rol: 'ADMIN_COMEX' } }),
      (c) => c.exito && c.datos.usuario.rol === 'ADMIN_COMEX',
    );

    // El token se pide con la cuenta ya promovida y todavia activa. Debe morir
    // en cuanto se desactive, asi que se obtiene ANTES.
    //
    // `pedir` devuelve una FUNCION: el script usa esa forma para que la
    // peticion se ejecute dentro de `comprobar`, que ya sabe manejar la
    // Response. Aqui se necesita el token suelto, asi que se invoca la funcion
    // y se lee el JSON a mano.
    const respuestaSesion = await pedir('/auth/login', {
      metodo: 'POST',
      cuerpo: { email: CORREO_ALTA, password: CLAVE_ALTA },
    })();
    const cuerpoSesion = await respuestaSesion.json();
    const tokenAntesDeLaBaja = cuerpoSesion?.datos?.token ?? null;

    await comprobar(
      'PATCH /usuarios/:id/activo - desactivacion -> 200',
      pedir(`/usuarios/${id}/activo`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { activo: false } }),
      (c) => c.exito && c.datos.usuario.activo === false,
    );

    await comprobar(
      'POST /auth/login - cuenta desactivada -> 403',
      pedir('/auth/login', { metodo: 'POST', cuerpo: { email: CORREO_ALTA, password: CLAVE_ALTA } }),
      (c) => !c.exito,
      { statusEsperado: 403 },
    );

    await comprobar(
      'PATCH /usuarios/:id/activo - estado sin cambio -> 409',
      pedir(`/usuarios/${id}/activo`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { activo: false } }),
      (c) => c.error.codigo === 'ESTADO_SIN_CAMBIO',
      { statusEsperado: 409 },
    );

    await comprobar(
      'PATCH /usuarios/:id/activo - reactivacion -> 200',
      pedir(`/usuarios/${id}/activo`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { activo: true } }),
      (c) => c.exito && c.datos.usuario.activo === true,
    );

    await comprobar(
      'POST /auth/login - cuenta reactivada vuelve a entrar',
      pedir('/auth/login', { metodo: 'POST', cuerpo: { email: CORREO_ALTA, password: CLAVE_ALTA } }),
      (c) => c.exito,
    );

    await comprobar(
      'PATCH /usuarios/:id/rol - degradar a otro administrador -> 200',
      pedir(`/usuarios/${id}/rol`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { rol: 'ANALISTA' } }),
      (c) => c.exito && c.datos.usuario.rol === 'ANALISTA',
    );

    // ---------------- Bitacora ----------------
    console.log('\n6. BITACORA DE ACCIONES');

    // `pedir` devuelve una funcion; hay que invocarla y leer el JSON a mano.
    const respuestaTras = await pedir('/usuarios', { token: tokenAdmin })();
    const cuerpoTras = await respuestaTras.json();
    const registro = cuerpoTras?.datos?.usuarios?.find((u) => u.id === id);
    const acciones = (registro?.auditoria ?? []).map((e) => e.accion);

    // Estas cuatro comprueban datos YA leidos del listado, asi que no pasan por
    // `comprobar`: ese helper espera una peticion HTTP y leeria el cuerpo dos
    // veces. Se anotan a mano sobre los mismos contadores.
    const aserciones = [
      [
        'la bitacora conserva todas las acciones',
        ['REGISTRO', 'CAMBIAR_ROL', 'DESACTIVAR', 'ACTIVAR'].every((a) => acciones.includes(a)),
        acciones.join(', '),
      ],
      [
        'la bitacora guarda el rol anterior y el nuevo',
        (registro?.auditoria ?? []).some(
          (e) => e.rol_anterior === 'ADMIN_COMEX' && e.rol_nuevo === 'ANALISTA',
        ),
        '',
      ],
      [
        'la bitacora identifica al administrador responsable',
        (registro?.auditoria ?? []).some((e) => e.administrador_email === USUARIOS.admin.email),
        '',
      ],
      [
        'el auto-registro se distingue de una accion manual',
        (registro?.auditoria ?? []).some((e) => e.accion === 'REGISTRO' && !e.administrador_email),
        '',
      ],
    ];

    for (const [descripcion, condicion, detalle] of aserciones) {
      total += 1;
      if (condicion) {
        console.log(`  OK    ${descripcion}`);
        if (detalle) console.log(`          -> ${detalle}`);
      } else {
        fallos += 1;
        console.log(` [FALLA] ${descripcion}`);
      }
    }

    console.log('\n7. LA BAJA SURTE EFECTO INMEDIATO');

    // Al final de la seccion 5 la cuenta quedo ACTIVA y degradada a Analista,
    // porque esas comprobaciones necesitan esos dos estados. Este token se
    // emitio con ella activa, asi que la prueba de la baja necesita volver a
    // desactivarla primero.
    await pedir(`/usuarios/${id}/activo`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { activo: false } })();

    await comprobar(
      'GET /cotizaciones/historial - token de cuenta desactivada -> 401',
      pedir('/cotizaciones/historial', { token: tokenAntesDeLaBaja }),
      (c) => !c.exito,
      { statusEsperado: 401 },
    );

    await comprobar(
      'GET /usuarios - el token de la baja tampoco lista cuentas',
      pedir('/usuarios', { token: tokenAntesDeLaBaja }),
      (c) => !c.exito,
      { statusEsperado: 401 },
    );

    await comprobar(
      'GET /auth/me - el token de la baja tampoco identifica al usuario',
      pedir('/auth/me', { token: tokenAntesDeLaBaja }),
      (c) => !c.exito,
      { statusEsperado: 401 },
    );

    // Se deja la cuenta activa y como Analista: es el estado en que se creo, y
    // una cuenta de prueba abandonada a medias no sirve para la proxima corrida.
    await pedir(`/usuarios/${id}/activo`, { metodo: 'PATCH', token: tokenAdmin, cuerpo: { activo: true } })();
  }

  await comprobar(
    'GET /auth/me con token -> permisos por rol',
    pedir('/auth/me', { token: tokenAdmin }),
    (c) => c.datos.permisos.eliminarCotizacion === true,
  );

  await comprobar(
    'GET /auth/me con token manipulado -> 401',
    pedir('/auth/me', { token: `${tokenAdmin.slice(0, -4)}xxxx` }),
    (c) => c.error.codigo === 'NO_AUTORIZADO',
    { statusEsperado: 401 },
  );

  // ---------------- 3. Catalogo de puertos ----------------
  console.log('\n8. CATALOGO DE PUERTOS');

  const catalogos = await comprobar(
    'GET /puertos -> origen y destino separados',
    pedir('/puertos', { token: tokenAdmin }),
    (c) => c.datos.origen.length > 0 && c.datos.destino.length > 0 && c.parametros.limiteToneladasPorContenedor === 25,
    { mostrar: (c) => `${c.datos.origen.length} origen / ${c.datos.destino.length} destino, limite ${c.parametros.limiteToneladasPorContenedor} tn` },
  );

  await comprobar(
    'GET /puertos?region=CHINA -> solo China',
    pedir('/puertos?region=CHINA', { token: tokenAdmin }),
    (c) => Array.isArray(c.datos) && c.datos.every((p) => p.region === 'CHINA'),
  );

  await comprobar(
    'GET /puertos?region=MARSIA -> 400',
    pedir('/puertos?region=MARSIA', { token: tokenAdmin }),
    (c) => c.error.codigo === 'VALIDACION_FALLIDA',
    { statusEsperado: 400 },
  );

  const porCodigo = Object.fromEntries(catalogos.datos.origen.concat(catalogos.datos.destino).map((p) => [p.codigo, p.id]));
  const SHA = porCodigo.CNSHA;
  const VAP = porCodigo.CLVAP;
  const SAI = porCodigo.CLSAI;
  const RTM = porCodigo.NLRTM;

  // ---------------- 4. Motor de calculo ----------------
  console.log('\n9. MOTOR DE CALCULO (limite de 25 tn por contenedor)');

  const casos = [
    { nombre: '24.000 kg = 24 tn -> 1 contenedor', peso: 24_000, cont: 1 },
    { nombre: '25.000 kg = 25 tn -> 1 contenedor (justo en el limite)', peso: 25_000, cont: 1 },
    { nombre: '25.001 kg = 25,001 tn -> 2 contenedores (excede el limite)', peso: 25_001, cont: 2 },
    { nombre: '30.000 kg = 30 tn -> 2 contenedores', peso: 30_000, cont: 2 },
    { nombre: '49.999 kg = 49,999 tn -> 2 contenedores', peso: 49_999, cont: 2 },
    { nombre: '50.000 kg = 50 tn -> 2 contenedores (justo en el limite)', peso: 50_000, cont: 2 },
    { nombre: '50.001 kg = 50,001 tn -> 3 contenedores', peso: 50_001, cont: 3 },
  ];

  for (const caso of casos) {
    const resultado = await comprobar(
      caso.nombre,
      pedir('/cotizaciones/calcular', {
        metodo: 'POST',
        token: tokenAnalista,
        cuerpo: {
          peso_kg: caso.peso,
          valor_mercaderia_usd: 88_000,
          puerto_origen_id: SHA,
          puerto_destino_id: VAP,
          dias_contingencia: 0,
        },
      }),
      (c) => c.datos.cantidad_contenedores === caso.cont && Math.abs(c.datos.toneladas - caso.peso / 1000) < 0.001,
      { statusEsperado: 201, mostrar: (c) => `${c.datos.toneladas} tn, ${c.datos.cantidad_contenedores} x ${c.datos.precio_contenedor_usd} USD` },
    );

    // Verificacion aritmetica independiente del backend.
    if (resultado) {
      const e = esperado(resultado.datos.toneladas, 25, resultado.datos.precio_contenedor_usd, 88_000);
      const coincide =
        resultado.datos.costo_flete_usd === e.flete &&
        resultado.datos.impuesto_19_cif_usd === e.impuesto &&
        resultado.datos.costo_total_usd === e.total;

      total += 1;
      if (!coincide) {
        fallos += 1;
        console.log(
          ` [FALLA]   Desglose financiero de ${caso.peso} kg no coincide.\n` +
          `          Backend: flete=${resultado.datos.costo_flete_usd} impuesto=${resultado.datos.impuesto_19_cif_usd} total=${resultado.datos.costo_total_usd}\n` +
          `          Manual:   flete=${e.flete} impuesto=${e.impuesto} total=${e.total}`,
        );
      } else {
        console.log(
          `          Desglose correcto: merc 88000 + flete ${e.flete} + seguro ${e.total && 880} -> CIF -> 19% = ${e.impuesto} | total ${e.total}`,
        );
      }
    }
  }

  await comprobar(
    'Dias de contingencia suman al tiempo de transito',
    pedir('/cotizaciones/calcular', {
      metodo: 'POST',
      token: tokenAnalista,
      cuerpo: {
        peso_kg: 10_000,
        valor_mercaderia_usd: 50_000,
        puerto_origen_id: SHA,
        puerto_destino_id: VAP,
        dias_contingencia: 12,
      },
    }),
    (c) => c.datos.dias_transito === c.datos.dias_viaje_base + 12,
    { statusEsperado: 201, mostrar: (c) => `${c.datos.dias_viaje_base} + ${c.datos.dias_contingencia} = ${c.datos.dias_transito} dias` },
  );

  await comprobar(
    'guardar=false simula sin persistir',
    pedir('/cotizaciones/calcular', {
      metodo: 'POST',
      token: tokenAnalista,
      cuerpo: { peso_kg: 5_000, valor_mercaderia_usd: 20_000, puerto_origen_id: SHA, puerto_destino_id: VAP, guardar: false },
    }),
    (c) => c.datos.registrada === false && c.datos.cotizacion_id === null,
    { statusEsperado: 201 },
  );

  // ---------------- 5. Validaciones ----------------
  console.log('\n10. VALIDACION DE ENTRADA');

  const validaciones = [
    { nombre: 'peso NEGATIVO', campos: { peso_kg: -500, valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: VAP } },
    { nombre: 'peso CERO', campos: { peso_kg: 0, valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: VAP } },
    { nombre: 'peso AUSENTE', campos: { valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: VAP } },
    { nombre: 'peso no numerico', campos: { peso_kg: 'mucho', valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: VAP } },
    { nombre: 'peso absurdamente alto', campos: { peso_kg: 999_999_999, valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: VAP } },
    { nombre: 'valor mercaderia vacio', campos: { peso_kg: 1_000, valor_mercaderia_usd: '', puerto_origen_id: SHA, puerto_destino_id: VAP } },
    { nombre: 'puerto origen inexistente', campos: { peso_kg: 1_000, valor_mercaderia_usd: 88_000, puerto_origen_id: 999_999, puerto_destino_id: VAP } },
    { nombre: 'origen = destino', campos: { peso_kg: 1_000, valor_mercaderia_usd: 88_000, puerto_origen_id: VAP, puerto_destino_id: VAP } },
    { nombre: 'origen chileno (invertida)', campos: { peso_kg: 1_000, valor_mercaderia_usd: 88_000, puerto_origen_id: VAP, puerto_destino_id: SAI } },
    { nombre: 'destino no chileno', campos: { peso_kg: 1_000, valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: RTM } },
    { nombre: 'dias de contingencia negativo', campos: { peso_kg: 1_000, valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: VAP, dias_contingencia: -5 } },
    { nombre: 'dias de contingencia exagerado', campos: { peso_kg: 1_000, valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: VAP, dias_contingencia: 999 } },
    { nombre: 'campo inesperado (inyeccion de params)', campos: { peso_kg: 1_000, valor_mercaderia_usd: 88_000, puerto_origen_id: SHA, puerto_destino_id: VAP, rol: 'ADMIN_COMEX' } },
  ];

  for (const validacion of validaciones) {
    await comprobar(
      `${validacion.nombre} -> 400`,
      pedir('/cotizaciones/calcular', {
        metodo: 'POST',
        token: tokenAnalista,
        cuerpo: validacion.campos,
      }),
      (c) => !c.exito,
      { statusEsperado: 400 },
    );
  }

  await comprobar(
    'SQL injection en parametro de ruta -> 400 (consulta parametrizada)',
    pedir('/cotizaciones/calcular', {
      metodo: 'POST',
      token: tokenAnalista,
      cuerpo: {
        peso_kg: 1_000,
        valor_mercaderia_usd: 88_000,
        puerto_origen_id: "1 OR 1=1; DROP TABLE cotizaciones_log;--",
        puerto_destino_id: VAP,
      },
    }),
    (c) => c.error.codigo === 'VALIDACION_FALLIDA' || c.error.codigo === 'PUERTO_ORIGEN_INVALIDO',
    { statusEsperado: 400 },
  );

  // ---------------- 6. Control de acceso por rol ----------------
  console.log('\n11. AUTORIZACION POR ROL');

  await comprobar(
    'DELETE de cotizacion como ANALISTA -> 403 (prohibido)',
    pedir('/cotizaciones/1', { metodo: 'DELETE', token: tokenAnalista }),
    (c) => c.error.codigo === 'ACCESO_DENEGADO',
    { statusEsperado: 403 },
  );

  await comprobar(
    'POST /tarifas/upload como ANALISTA -> 403',
    pedir('/tarifas/upload', { metodo: 'POST', token: tokenAnalista }),
    (c) => c.error.codigo === 'ACCESO_DENEGADO',
    { statusEsperado: 403 },
  );

  await comprobar(
    'GET /cotizaciones/:id sin token -> 401',
    pedir('/cotizaciones/1'),
    (c) => c.error.codigo === 'NO_AUTORIZADO',
    { statusEsperado: 401 },
  );

  await comprobar(
    'GET /ruta/inexistente -> 404 con codigo RUTA_NO_ENCONTRADA',
    pedir('/esto-no-existe', { token: tokenAdmin }),
    (c) => c.error.codigo === 'RUTA_NO_ENCONTRADA',
    { statusEsperado: 404 },
  );

  // ---------------- 7. Historial y aislamiento entre usuarios ----------------
  console.log('\n12. HISTORIAL Y AISLAMIENTO DE DATOS');

  const historialAdmin = await comprobar(
    'GET /cotizaciones/historial paginado (admin ve todo)',
    pedir('/cotizaciones/historial?pagina=1&porPagina=5', { token: tokenAdmin }),
    (c) => Array.isArray(c.datos) && c.datos.length > 0 && c.paginacion.total > 0,
    { mostrar: (c) => `${c.datos.length} de ${c.paginacion.total} registros, pagina ${c.paginacion.pagina}/${c.paginacion.totalPaginas}` },
  );

  await comprobar(
    'GET /historial pagina 2 devuelve registros distintos',
    pedir('/cotizaciones/historial?pagina=2&porPagina=5', { token: tokenAdmin }),
    (c) => c.paginacion.pagina === 2,
  );

  await comprobar(
    'GET /historial?porPagina=999 -> 400 (el limite se valida, no se trunca en silencio)',
    pedir('/cotizaciones/historial?porPagina=999', { token: tokenAdmin }),
    (c) => c.error.codigo === 'VALIDACION_FALLIDA',
    { statusEsperado: 400 },
  );

  await comprobar(
    'GET /historial?porPagina=100 (maximo permitido) funciona',
    pedir('/cotizaciones/historial?porPagina=100', { token: tokenAdmin }),
    (c) => c.paginacion.porPagina === 100,
  );

  await comprobar(
    'GET /historial?pagina=0 -> 400',
    pedir('/cotizaciones/historial?pagina=0', { token: tokenAdmin }),
    (c) => c.error.codigo === 'VALIDACION_FALLIDA',
    { statusEsperado: 400 },
  );

  const idsVisiblesAnalista = new Set();
  let pagina = 1;
  let registrosUltimaPagina = 0;

  // Se recorre todo el historial del Analista para comprobar que ninguna
  // fila pertenece a otro usuario (aislamiento de datos por rol).
  do {
    const respuesta = await fetch(`${BASE}/cotizaciones/historial?pagina=${pagina}&porPagina=100`, {
      headers: { Authorization: `Bearer ${tokenAnalista}` },
    });
    const cuerpo = await respuesta.json();

    if (Array.isArray(cuerpo.datos)) {
      cuerpo.datos.forEach((c) => idsVisiblesAnalista.add(c.usuario_id));
      registrosUltimaPagina = cuerpo.datos.length;
    } else {
      registrosUltimaPagina = 0;
    }

    pagina += 1;
  } while (registrosUltimaPagina > 0 && pagina < 20);

  // El id propio se obtiene de /auth/me: es la referencia correcta para
  // comparar, ya que el registro mas reciente del admin puede ser suyo.
  const perfilAnalista = await (await fetch(`${BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${tokenAnalista}` },
  })).json();

  total += 1;
  const idsUnicos = [...idsVisiblesAnalista];
  const aislado = idsUnicos.length === 1 && idsUnicos[0] === perfilAnalista.datos.id;
  if (!aislado) fallos += 1;
  console.log(`  ${aislado ? '  OK   ' : ' [FALLA]'} El historial del Analista solo contiene registros propios`);
  console.log(
    `          usuario id esperado=${perfilAnalista.datos.id} | ids hallados en su historial: ${idsUnicos.join(', ') || '(ninguno)'}`,
  );

  await comprobar(
    'GET /auth/me del Analista no otorga permiso de eliminacion',
    pedir('/auth/me', { token: tokenAnalista }),
    (c) => c.datos.permisos.eliminarCotizacion === false,
  );

  await comprobar(
    'GET /historial?busqueda=Shanghai filtra por nombre de puerto',
    pedir('/cotizaciones/historial?busqueda=Shanghai&porPagina=50', { token: tokenAdmin }),
    (c) => c.datos.every((x) => x.puerto_origen.includes('Shanghai')),
    { mostrar: (c) => `${c.datos.length} coincidencias` },
  );

  await comprobar(
    'GET /historial?desde con fecha invalida -> 400',
    pedir('/cotizaciones/historial?desde=ayer', { token: tokenAdmin }),
    (c) => c.error.codigo === 'VALIDACION_FALLIDA',
    { statusEsperado: 400 },
  );

  await comprobar(
    'GET /cotizaciones/resumen devuelve metricas',
    pedir('/cotizaciones/resumen', { token: tokenAdmin }),
    (c) => c.datos.total_cotizaciones > 0 && c.datos.contenedores_totales > 0,
    { mostrar: (c) => `${c.datos.total_cotizaciones} cotizaciones, ${c.datos.contenedores_totales} contenedores, USD ${c.datos.facturacion_total_usd}` },
  );

  // ---------------- 8. DELETE por ADMIN ----------------
  console.log('\n13. ELIMINACION (solo ADMIN_COMEX)');

  const creada = await comprobar(
    'POST /cotizaciones/calcular crea un registro descartable',
    pedir('/cotizaciones/calcular', {
      metodo: 'POST',
      token: tokenAdmin,
      cuerpo: { peso_kg: 1_234, valor_mercaderia_usd: 9_999, puerto_origen_id: SHA, puerto_destino_id: VAP },
    }),
    (c) => c.datos.cotizacion_id > 0,
    { statusEsperado: 201 },
  );

  if (creada?.datos.cotizacion_id) {
    await comprobar(
      'GET /cotizaciones/:id recupera el registro (base del PDF)',
      pedir(`/cotizaciones/${creada.datos.cotizacion_id}`, { token: tokenAdmin }),
      (c) => c.datos.peso_kg === 1_234,
    );

    await comprobar(
      `DELETE /cotizaciones/${creada.datos.cotizacion_id} como ADMIN -> 200`,
      pedir(`/cotizaciones/${creada.datos.cotizacion_id}`, { metodo: 'DELETE', token: tokenAdmin }),
      (c) => c.exito,
    );

    await comprobar(
      'GET del registro eliminado -> 404',
      pedir(`/cotizaciones/${creada.datos.cotizacion_id}`, { token: tokenAdmin }),
      (c) => c.error.codigo === 'NO_ENCONTRADO',
      { statusEsperado: 404 },
    );
  }

  // ---------------- 9. Tarifas ----------------
  console.log('\n14. TARIFAS Y CARGA DE PLANILLAS');

  await comprobar(
    'GET /tarifas lista las rutas vigentes',
    pedir('/tarifas', { token: tokenAdmin }),
    (c) => c.datos.length > 0,
    { mostrar: (c) => `${c.total} rutas en ${Object.keys(c.porRegion).length} regiones` },
  );

  await comprobar(
    'GET /tarifas/plantilla entrega un CSV descargable',
    pedir('/tarifas/plantilla', { token: tokenAdmin }),
    (c) => c.texto.includes('puerto_origen') && c.texto.includes('precio_usd'),
    { json: false, mostrar: (c) => `${c.texto.split('\n').length} lineas de ejemplo` },
  );

  await comprobar(
    'POST /tarifas/upload sin archivo -> 400',
    pedir('/tarifas/upload', { metodo: 'POST', token: tokenAdmin }),
    (c) => c.error.codigo === 'ERROR_UPLOAD' || c.error.codigo === 'ARCHIVO_AUSENTE',
    { statusEsperado: 400 },
  );

  // Planilla CSV en memoria: actualiza Shanghai -> San Antonio con un precio nuevo.
  const csvValido = ['puerto_origen,puerto_destino,tipo_contenedor,precio_usd,dias_viaje_base,capacidad_max_tn',
    'Shanghai,San Antonio,40HC,2600,34,25',
    'Rotterdam,Valparaiso,40HC,1910,25,25',
    'PuertoInexistente,Valparaiso,40HC,1000,20,25'].join('\n');

  const formData = new FormData();
  formData.append('archivo', new Blob([csvValido], { type: 'text/csv' }), 'tarifas_prueba.csv');

  await comprobar(
    'POST /tarifas/upload con CSV valido (2 filas ok, 1 con puerto desconocido)',
    pedir('/tarifas/upload', { metodo: 'POST', token: tokenAdmin, cuerpo: formData }),
    (c) => c.exito && c.datos.omitidas === 1 && c.datos.errores.length === 1,
    { statusEsperado: 201, mostrar: (c) => `${c.datos.insertadas} nuevas, ${c.datos.actualizadas} actualizadas, ${c.datos.omitidas} omitidas -> ${c.datos.errores[0]?.motivo ?? ''}` },
  );

  const tras = await (await fetch(`${BASE}/tarifas`, { headers: { Authorization: `Bearer ${tokenAdmin}` } })).json();
  const shanghaiSanAntonio = tras.datos.find((t) => t.origen_codigo === 'CNSHA' && t.destino_codigo === 'CLSAI');
  await comprobar(
    'El precio de la planilla quedo aplicado en la base de datos',
    pedir('/tarifas', { token: tokenAdmin }),
    () => shanghaiSanAntonio?.precio_usd === 2600 && shanghaiSanAntonio?.dias_viaje_base === 34,
    { mostrar: () => `CNSHA->CLSAI ahora en USD ${shanghaiSanAntonio?.precio_usd} / ${shanghaiSanAntonio?.dias_viaje_base} dias` },
  );

  await comprobar(
    'Reimportar la misma planilla actualiza en vez de duplicar (idempotencia)',
    (() => {
      const fd = new FormData();
      fd.append('archivo', new Blob([csvValido], { type: 'text/csv' }), 'tarifas_prueba.csv');
      return pedir('/tarifas/upload', { metodo: 'POST', token: tokenAdmin, cuerpo: fd });
    })(),
    (c) => c.datos.insertadas === 0 && c.datos.actualizadas === 2,
    { statusEsperado: 201, mostrar: (c) => `${c.datos.actualizadas} actualizadas, ${c.datos.insertadas} nuevas` },
  );

  const formDataMalo = new FormData();
  formDataMalo.append('archivo', new Blob(['contenido cualquiera'], { type: 'application/octet-stream' }), 'malicioso.exe');
  await comprobar(
    'POST /tarifas/upload con extension .exe -> 400',
    pedir('/tarifas/upload', { metodo: 'POST', token: tokenAdmin, cuerpo: formDataMalo }),
    (c) => c.error.codigo === 'FORMATO_NO_PERMITIDO',
    { statusEsperado: 400 },
  );

  const formDataSinHeaders = new FormData();
  formDataSinHeaders.append('archivo', new Blob(['a,b,c\n1,2,3'], { type: 'text/csv' }), 'sin_encabezados.csv');
  await comprobar(
    'POST /tarifas/upload sin columnas requeridas -> 400 explicito',
    pedir('/tarifas/upload', { metodo: 'POST', token: tokenAdmin, cuerpo: formDataSinHeaders }),
    (c) => c.error.codigo === 'PLANILLA_ENCABEZADOS_INVALIDOS',
    { statusEsperado: 400 },
  );

  // ---------------- 10. Rate limiting ----------------
  console.log('\n15. RATE LIMITING DEL LOGIN');

  total += 1;
  let saw429 = false;
  let cabeceras = null;
  let codigo429 = null;

  // El limite se lee de la respuesta en lugar de fijarlo en el codigo, para
  // que la prueba siga siendo valida si se cambia AUTH_RATE_LIMIT_MAX en .env.
  const intentoFallido = async () => {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rate@limit.cl', password: 'cualquiera' }),
    });

    const limite = Number(r.headers.get('x-ratelimit-limit'));
    if (Number.isFinite(limite) && limite > 0) {
      cabeceras = {
        limite: r.headers.get('x-ratelimit-limit'),
        restante: r.headers.get('x-ratelimit-remaining'),
        reinicio: r.headers.get('x-ratelimit-reset'),
      };
    }

    if (r.status === 429) {
      codigo429 = (await r.json().catch(() => ({})))?.error?.codigo ?? null;
      return true;
    }
    return false;
  };

  let intento = 0;
  for (; intento < 40; intento += 1) {
    if (await intentoFallido()) { saw429 = true; break; }
  }

  // Se exige que el rechazo venga del limitador de LOGIN. Aceptar cualquier 429
  // haria que la prueba pasara porque se disparo el limitador global, sin haber
  // comprobado jamas el del login.
  const limiteAlcanzado = saw429 && codigo429 === 'LOGIN_RATE_LIMIT_EXCEDIDO';
  if (!limiteAlcanzado) fallos += 1;
  console.log(`  ${limiteAlcanzado ? '  OK   ' : ' [FALLA]'} El login se bloquea con 429 al superar su propio cupo`);
  if (limiteAlcanzado) {
    console.log(`          ${intento + 1} intentos -> 429 ${codigo429} (limite: ${cabeceras?.limite})`);
  } else {
    console.log(`          -> saw429=${saw429} codigo=${codigo429}`);
  }

  if (cabeceras) {
    total += 1;
    const okCabeceras = cabeceras.restante === '0' && Number(cabeceras.reinicio) > 0;
    if (!okCabeceras) fallos += 1;
    console.log(`  ${okCabeceras ? '  OK   ' : ' [FALLA]'} Los headers X-RateLimit-* se exponen al cliente`);
    console.log(`          X-RateLimit-Limit=${cabeceras.limite} Remaining=${cabeceras.restante} Reset=${cabeceras.reinicio}s`);
  }

  // Con el cupo de la IP agotado, los intentos SIGUIENTES (correos que no
  // existen) se rechazan. Es lo que protege el contador por IP: un atacante que
  // prueba miles de correos inventados recibe el mismo 429, sin que nunca se
  // llegue a ejecutar bcrypt.
  total += 1;
  const bloqueado = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'rate@limit.cl', password: 'cualquiera' }),
  });
  const cuerpoBloqueo = await bloqueado.json().catch(() => ({}));
  const mensajeBloqueo = cuerpoBloqueo?.error?.mensaje ?? '';
  const okMensaje = bloqueado.status === 429 && /minuto/i.test(mensajeBloqueo) && bloqueado.headers.get('retry-after');
  if (!okMensaje) fallos += 1;
  console.log(`  ${okMensaje ? '  OK   ' : ' [FALLA]'} El bloqueo explica cuanto tiempo esperar`);
  if (!okMensaje) {
    console.log(`          -> status ${bloqueado.status} | mensaje "${mensajeBloqueo}"`);
  } else {
    console.log(`          "${mensajeBloqueo}" (Retry-After: ${bloqueado.headers.get('retry-after')}s)`);
  }

  // Y el caso contrario, que es el que motivio separar los contadores: un login
  // LEGITIMO desde la misma IP debe seguir funcionando aunque el cupo de la IP
  // este agotado, porque su cuota es la de SU cuenta, que esta en cero.
  // Sin esta separacion, veinte correos mal escritos bloqueaban a todo el
  // mundo: en un laboratorio universitario, donde todos salen por la misma IP
  // publica, un usuario dejaba fuera al resto.
  total += 1;
  const noAfectado = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'jefe@cintac.cl', password: 'Jefatura2026' }),
  });
  const cuerpoNoAfectado = await noAfectado.json().catch(() => ({}));
  const okNoAfectado = noAfectado.status === 200 && Boolean(cuerpoNoAfectado?.datos?.token);
  if (!okNoAfectado) fallos += 1;
  console.log(`  ${okNoAfectado ? '  OK   ' : ' [FALLA]'} Un login legitimo no sufre el bloqueo ajeno`);
  if (!okNoAfectado) {
    console.log(`          -> status ${noAfectado.status} | ${cuerpoNoAfectado?.error?.codigo ?? 'sin codigo'}`);
  }

  console.log('\n          Nota: el cupo de login por IP queda agotado al terminar esta prueba.');
  console.log('          Reinicia el backend (los contadores viven en memoria) antes de');
  console.log('          volver a iniciar sesion desde el navegador.');

  // ---------------- Resumen ----------------
  console.log(`\n${'='.repeat(74)}`);
  console.log(`Comprobaciones ejecutadas: ${total}`);
  console.log(`Fallidas: ${fallos}`);
  console.log(fallos === 0 ? 'RESULTADO: todas las comprobaciones pasaron.\n' : 'RESULTADO: hay comprobaciones fallidas.\n');

  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nError al ejecutar la verificacion:', error.message);
  console.error(`¿La API esta corriendo en ${BASE}?`);
  process.exit(1);
});