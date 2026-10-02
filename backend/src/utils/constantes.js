/**
 * utils/constantes.js
 * -----------------------------------------------------------------
 * Todos los parametros de negocio del calculo viven aqui.
 *
 * Concentrarlos tiene dos ventajas practicas para el proyecto academico:
 *  1. Si el docente pide cambiar el impuesto de 19% a 18%, se edita UNA linea.
 *  2. El informe PDF puede imprimir estas constantes como "base de calculo",
 *    ya que el cliente ve exactamente que reglas se aplicaron.
 */

/** Tasa del impuesto ad valorem aplicado sobre el valor CIF. */
export const TASA_IMPUESTO_CIF = 0.19;

/** Prima del seguro opcional sobre el valor de la mercaderia (parte del CIF). */
export const TASA_SEGURO = 0.01;

/**
 * Limite de carga por contenedor. Es el valor por defecto de la columna
 * `tarifas_flete.capacidad_max_tn`, por lo que el dato real usado siempre
 * se lee de la base y este valor solo actua como respaldo.
 */
export const MAX_TONELADAS_POR_CONTENEDOR = 25;

/** Tipo de contenedor usado por defecto en las simulaciones. */
export const TIPO_CONTENEDOR_DEFAULT = '40HC';

/** Etiquetas legibles de los roles (evita repetir el switch en el codigo). */
export const ROLES = Object.freeze({
  ADMIN_COMEX: 'Jefatura Comex',
  ANALISTA: 'Analista Comex',
});

/** Etiquetas legibles de las regiones del catalogo de puertos. */
export const REGIONES = Object.freeze({
  CHINA: 'Asia - China',
  EUROPA: 'Europa',
  AMERICA: 'America',
  CHILE: 'Chile (destino)',
});

/** Limite superior de peso admitido, en kg. Frena cargas absurdas o injection. */
export const PESO_MAXIMO_KG = 30_000_000; // 30.000 tn

/** Rango admitido de dias de contingencia. */
export const DIAS_CONTINGENCIA_MAX = 90;

/** Divisor deConversion de toneladas a kilogramos. */
export const KG_POR_TONELADA = 1000;

/**
 * Redondeo monetario a 2 decimales.
 * Se usa en cada paso del desglose para que el total sea siempre
 * reproducible: sumar los valores mostrados da exactamente el total.
 *
 * @param {number} valor
 * @returns {number}
 */
export function redondearMoneda(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/**
 * Redondeo de pesos a 3 decimales, para no perder terreno con fracciones
 * de tonelada al dividir por la capacidad del contenedor.
 *
 * @param {number} valor
 * @returns {number}
 */
export function redondearPeso(valor) {
  return Math.round((valor + Number.EPSILON) * 1000) / 1000;
}