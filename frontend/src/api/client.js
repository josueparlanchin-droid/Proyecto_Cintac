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

const BASE_URL = '/api/v1';

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
    throw new ErrorApi(
      'No se pudo conectar con el servidor. Verifique que el backend este ejecutandose en el puerto 4010.',
      { codigo: 'SIN_CONEXION' },
    );
  }

  // 204: sin cuerpo que parsear.
  if (respuesta.status === 204) return {};

  const texto = await respuesta.text();
  let datos;

  try {
    datos = texto ? JSON.parse(texto) : {};
  } catch {
    throw new ErrorApi('El servidor devolvio una respuesta no valida.', {
      status: respuesta.status,
      codigo: 'RESPUESTA_INVALIDA',
    });
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
};

export default api;