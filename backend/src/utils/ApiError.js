/**
 * utils/ApiError.js
 * -----------------------------------------------------------------
 * Error de aplicacion con codigo HTTP asociado.
 *
 * Los controllers lanzan `ApiError` para los fallos *esperados*
 * (credenciales invalidas, validacion, no encontrado). Cualquier otro
 * error se considera no previsto y el middleware de errores lo
 * convierte en un 500 generico sin filtrar detalles internos.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode - Codigo HTTP (400, 401, 403, 404, 409, 429).
   * @param {string} mensaje    - Mensaje legible para el usuario final.
   * @param {object} [opciones]
   * @param {string} [opciones.codigo]   - Codigo de negocio, ej. 'PESO_INVALIDO'.
   * @param {object} [opciones.detalle]  - Errores campo a campo (validacion).
   * @param {object} [opciones.cabeceras] - Headers que debe incluir la
   *   respuesta. Lo usa el limitador de login para informar el estado del
   *   cupo incluso cuando la peticion se rechaza (401 o 429), de modo que el
   *   cliente siempre sepa quantos intentos le quedan.
   */
  constructor(statusCode, mensaje, opciones = {}) {
    super(mensaje);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.codigo = opciones.codigo ?? 'ERROR_GENERICO';
    this.detalle = opciones.detalle ?? null;
    this.cabeceras = opciones.cabeceras ?? null;
    this.esErrorEsperado = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(mensaje, opciones) {
    return new ApiError(400, mensaje, { codigo: 'SOLICITUD_INVALIDA', ...opciones });
  }

  static noAutorizado(mensaje = 'Credenciales invalidas o sesion expirada.', opciones) {
    return new ApiError(401, mensaje, { codigo: 'NO_AUTORIZADO', ...opciones });
  }

  static prohibido(mensaje = 'No tiene permisos para realizar esta accion.', opciones) {
    return new ApiError(403, mensaje, { codigo: 'ACCESO_DENEGADO', ...opciones });
  }

  static noEncontrado(mensaje = 'Recurso no encontrado.', opciones) {
    return new ApiError(404, mensaje, { codigo: 'NO_ENCONTRADO', ...opciones });
  }

  static conflicto(mensaje, opciones) {
    return new ApiError(409, mensaje, { codigo: 'CONFLICTO', ...opciones });
  }

  static demasiadasSolicitudes(mensaje, opciones) {
    return new ApiError(429, mensaje, { codigo: 'RATE_LIMIT_EXCEDIDO', ...opciones });
  }
}

export default ApiError;