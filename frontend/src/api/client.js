/**
 * api/client.js
 * -----------------------------------------------------------------
 * Envoltura de `fetch` para la API REST.
 *
 * Concentrar aqui el acceso a la red deja tres ventajas:
 *  1. El token JWT se agrega en un solo punto y nunca se escribe a mano
 *     en cada componente.
 *  2. Los errores del servidor (que vienen en JSON) se convierten en
 *     excepciones con un mensaje util, en vez de leerse de res.json().
 *  3. Si el token caduca, se emite un evento global y la app redirige al
 *     login sin que cada pantalla deba detectarlo.
 */

/**
 * URL base de la API.
 *
 * En desarrollo no se define VITE_API_URL y el navegador llama a /api/v1
 * sobre el mismo origen, que el proxy de Vite reenvia a localhost:4010.
 *
 * En produccion NO existe ese proxy: Vercel solo sirve los archivos estaticos
 * del build, asi que /api/v1 devolveria el index.html de la SPA (HTTP 200 con
 * content-type text/html) y el fallo apareceria como un error de parseo de
 * JSON, muy lejos de su causa real. Por eso el despliegue define
 * VITE_API_URL apuntando a la URL publica del backend.
 *
 * El `replace` evita que un valor con barra final genere rutas dobles al
 * concatenar con un ruta que ya empieza por '/'.
 */
const BASE_URL = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/+$/, '');

/** Clave del token en localStorage. */
export const CLAVE_TOKEN = 'cintac_comex_token';

/**
 * Error enriquecido: mantiene el codigo HTTP y el detalle por campo que
 * devuelve la API, para que el formulario pueda marcar los inputs.
 */
export class ErrorApi extends Error {
  constructor(mensaje, { status = 0, codigo = 'ERROR', detalle = null } = {}) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.status = status;
    this.codigo = codigo;
    this.detalle = detalle ?? {};
  }
}

// --- Token ------------------------------------------------------------
export function guardarToken(token) {
  localStorage.setItem(CLAVE_TOKEN, token);
}

export function leerToken() {
  return localStorage.getItem(CLAVE_TOKEN);
}

export function borrarToken() {
  localStorage.removeItem(CLAVE_TOKEN);
}

/**
 * Peticion generica a la API.
 *
 * @param {string} ruta   - Ruta relativa, ej. '/auth/login'.
 * @param {object} [opciones]
 * @param {string} [opciones.metodo='GET']
 * @param {object} [opciones.cuerpo]      - Se serializa como JSON.
 * @param {FormData} [opciones.formData] - Para la carga de planillas.
 * @param {boolean} [opciones.silencioso] - No dispara el evento de sesion expirada.
 * @returns {Promise<object>} El cuerpo COMPLETO de la respuesta
 *   (`{ exito, mensaje, datos, paginacion, ... }`).
 *
 *   Se devuelve el sobre entero y no solo `datos` a proposito: endpoints
 *   como el historial incluyen `paginacion` al lado de la lista, y
 *   descartarla haria que la tabla no supiera cuántas páginas hay.
 */
async function peticion(ruta, { metodo = 'GET', cuerpo = null, formData = null, silencioso = false } = {}) {
  const cabeceras = {};

  const token = leerToken();
  if (token) cabeceras.Authorization = `Bearer ${token}`;

  // FormData debe enviarse sin Content-Type: el navegador agrega el
  // `multipart/form-data` con el boundary, y forzarlo rompe la subida.
  if (!formData && cuerpo !== null) cabeceras['Content-Type'] = 'application/json';

  let respuesta;
  try {
    respuesta = await fetch(`${BASE_URL}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: formData ?? (cuerpo !== null ? JSON.stringify(cuerpo) : undefined),
    });
  } catch {
    // Se nombra la URL efectiva: decir "puerto 4010" seria falso en
    // produccion, donde el backend vive en otro dominio.
    throw new ErrorApi(`No se pudo conectar con la API en ${BASE_URL}.`, {
      codigo: 'SIN_CONEXION',
    });
  }

  // 204: sin cuerpo que parsear.
  if (respuesta.status === 204) return {};

  const texto = await respuesta.text();
  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    // Casi siempre significa que la respuesta era HTML: la peticion cayo en
    // un servidor que no es la API. Se informan status y content-type porque
    // distinguen de un vistazo entre "no existe ese endpoint" (404) y
    // "respondio otra aplicacion" (200 con text/html), que es el sintoma
    // clasico de VITE_API_URL sin definir en un despliegue.
    const tipo = respuesta.headers.get('content-type') ?? 'tipo desconocido';
    throw new ErrorApi(
      `La API en ${BASE_URL} no devolvio JSON (HTTP ${respuesta.status}, ${tipo}).`,
      { status: respuesta.status, codigo: 'RESPUESTA_INVALIDA' },
    );
  }

  if (!respuesta.ok) {
    const info = datos.error ?? {};

    // Token invalido o expirado: se avisa una sola vez para que la app
    // cierre la sesion en lugar de repetir la redireccion.
    if (respuesta.status === 401 && !silencioso) {
      window.dispatchEvent(new CustomEvent('cintac:sesion-expirada'));
    }

    throw new ErrorApi(info.mensaje ?? 'Ocurrio un error inesperado.', {
      status: respuesta.status,
      codigo: info.codigo,
      detalle: info.detalle,
    });
  }

  return datos;
}

// ==================================================================
// Endpoints
// ==================================================================
// Todos devuelven el cuerpo completo de la respuesta. Quien llama debe
// leer la propiedad que necesite: `respuesta.datos`, `respuesta.paginacion`,
// `respuesta.porRegion`, etc.

export const api = {
  /** POST /auth/login -> { token, expiraEn, usuario } */
  login: (email, password) =>
    peticion('/auth/login', { metodo: 'POST', cuerpo: { email, password } }),

  /**
   * POST /auth/registro -> { token, expiraEn, usuario }
   *
   * Devuelve token, igual que el login: quien se registra con un codigo
   * valido entra de inmediato, sin pasar por el formulario otra vez.
   */
  registro: (datos) =>
    peticion('/auth/registro', {
      metodo: 'POST',
      cuerpo: {
        nombre: datos.nombre,
        email: datos.email,
        password: datos.password,
        passwordRepeticion: datos.passwordRepeticion,
        codigoInvitacion: datos.codigoInvitacion,
      },
    }),

  /** GET /auth/me */
  perfil: () => peticion('/auth/me'),

  /** GET /puertos */
  puertos: () => peticion('/puertos'),

  /** POST /cotizaciones/calcular */
  calcular: (datos) => peticion('/cotizaciones/calcular', { metodo: 'POST', cuerpo: datos }),

  /** GET /cotizaciones/historial */
  historial: (filtros = {}) => {
    const parametros = new URLSearchParams();

    for (const [clave, valor] of Object.entries(filtros)) {
      if (valor !== null && valor !== undefined && valor !== '') {
        parametros.set(clave, valor);
      }
    }

    const query = parametros.toString();
    return peticion(`/cotizaciones/historial${query ? `?${query}` : ''}`);
  },

  /** GET /cotizaciones/resumen */
  resumen: () => peticion('/cotizaciones/resumen'),

  /** GET /cotizaciones/:id */
  cotizacion: (id) => peticion(`/cotizaciones/${id}`),

  /** DELETE /cotizaciones/:id */
  eliminarCotizacion: (id) => peticion(`/cotizaciones/${id}`, { metodo: 'DELETE' }),

  /** GET /tarifas */
  tarifas: () => peticion('/tarifas'),

  /** POST /tarifas/upload */
  subirTarifas: (archivo) => {
    const formData = new FormData();
    formData.append('archivo', archivo);
    return peticion('/tarifas/upload', { metodo: 'POST', formData });
  },

  // --- Administracion de cuentas (solo ADMIN_COMEX) ---
  // Se decluran aqui, y no en un segundo cliente, porque la autorizacion ya
  // la aplica el backend en `soloAdmin`: agregar el metodo no es una puerta
  // nueva, solo una llamada mas al mismo lugar.

  /** GET /usuarios -> { usuarios, resumen } */
  usuarios: () => peticion('/usuarios'),

  /** PATCH /usuarios/:id/rol */
  cambiarRol: (id, rol) =>
    peticion(`/usuarios/${id}/rol`, { metodo: 'PATCH', cuerpo: { rol } }),

  /** PATCH /usuarios/:id/activo */
  cambiarActivo: (id, activo) =>
    peticion(`/usuarios/${id}/activo`, { metodo: 'PATCH', cuerpo: { activo } }),
};

export default api;