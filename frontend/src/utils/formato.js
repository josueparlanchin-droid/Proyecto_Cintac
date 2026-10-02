/**
 * utils/formato.js
 * -----------------------------------------------------------------
 * Formateo de moneda, numeros y fechas en conventions chilenas (es-CL).
 * Centralizarlo evita que "1.234,56" aparezca en un sitio y "1234.56" en otro.
 */

const LOCALE = 'es-CL';

/** Formatea un numero de dolares: USD 1.234,56 */
export function formatearUSD(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 'USD 0,00';
  return `USD ${numero.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Formatea un numero de pesos chilenos: $1.234.567 */
export function formatearCLP(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '$0';
  return `$${Math.round(numero).toLocaleString(LOCALE)}`;
}

/** Formatea toneladas con 3 decimales: 24,001 */
export function formatearToneladas(valor, decimales = 3) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '0';
  return numero.toLocaleString(LOCALE, { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

/** Formatea kilogramos con separador de miles: 24.000 */
export function formatearPeso(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '0';
  return numero.toLocaleString(LOCALE, { maximumFractionDigits: 3 });
}

/** Convierte a entero como texto: 25001 -> "25.001" */
export function formatearEntero(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '0';
  return numero.toLocaleString(LOCALE, { maximumFractionDigits: 0 });
}

/** Fecha y hora legible: 02/10/2026, 14:35 */
export function formatearFechaHora(valor) {
  if (!valor) return '-';
  // PostgreSQL entrega las fechas como ISO 8601, que `new Date` interpreta
  // correctamente. `normalizarFecha` tambien acepta el formato ancien con
  // espacio, por si llegara alguna de esos strings.
  const fecha = normalizarFecha(valor);
  if (!fecha) return '-';

  return fecha.toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Solo la fecha: 02/10/2026 */
export function formatearFecha(valor) {
  if (!valor) return '-';
  const fecha = normalizarFecha(valor);
  if (!fecha) return '-';
  return fecha.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Convierte a un objeto Date valido.
 *
 * Acepta tanto ISO 8601, que es lo que entrega PostgreSQL (TIMESTAMPTZ llega
 * al navegador como "2026-10-02T22:13:18.164Z" y `new Date` lo interpreta
 * sin ayuda), como el formato "YYYY-MM-DD HH:MM:SS" de la base anterior en
 * SQLite. Se conserva el segundo caso a proposito: es inocuo y evita romper
 * cualquier registro antiguo o carga manual que se haga en ese formato.
 *
 * @param {string|Date} valor
 * @returns {Date|null}
 */
export function normalizarFecha(valor) {
  if (valor instanceof Date) return valor;
  if (!valor) return null;

  const texto = String(valor);

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(texto)) {
    // El formato nativo de Date interprets "YYYY-MM-DDTHH:MM:SS" como UTC,
    // lo que correria la hora. Se reemplaza el espacio por "T" sin "Z"
    // para que se lea como hora local.
    return new Date(texto.replace(' ', 'T'));
  }

  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** Devuelve "hace 3 dias", "ayer", etc. para el historial. */
export function tiempoRelativo(valor) {
  const fecha = normalizarFecha(valor);
  if (!fecha) return '-';

  const segundos = Math.floor((Date.now() - fecha.getTime()) / 1000);

  if (segundos < 60) return 'hace un momento';
  if (segundos < 3600) {
    const minutos = Math.floor(segundos / 60);
    return `hace ${minutos} minuto${minutos === 1 ? '' : 's'}`;
  }
  if (segundos < 86400) {
    const horas = Math.floor(segundos / 3600);
    return `hace ${horas} hora${horas === 1 ? '' : 's'}`;
  }
  if (segundos < 172800) return 'ayer';
  if (segundos < 2592000) {
    const dias = Math.floor(segundos / 86400);
    return `hace ${dias} dias`;
  }

  return formatearFecha(valor);
}

/** Nombre legible de la region, usado en el selector de origen. */
export const REGIONES = {
  CHINA: 'Asia - China',
  EUROPA: 'Europa',
  AMERICA: 'America',
  CHILE: 'Chile (destino)',
};

/** Clase CSS de la insignia segun la region. */
export const claseRegion = (region) =>
  ({
    CHINA: 'insignia--china',
    EUROPA: 'insignia--europa',
    AMERICA: 'insignia--america',
    CHILE: 'insignia--chile',
  })[region] ?? 'insignia--neutro';

/** Texto legible del rol. */
export const ROLES = {
  ADMIN_COMEX: 'Jefatura Comex',
  ANALISTA: 'Analista Comex',
};