/**
 * utils/pdf.js
 * -----------------------------------------------------------------
 * Generacion del informe PDF con jsPDF + autoTable.
 *
 * Se genera EN EL NAVEGADOR a proposito: el boton funciona sin conexion
 * al servidor y el usuario obtiene el archivo de inmediato, sin esperar
 * un round-trip. Los mismos datos que se ven en pantalla son los que se
 * imprimen, porque ambos vienen del mismo objeto `resultado`.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/** Paleta corporativa, replicada en el PDF. */
const COLOR = {
  terracota: [200, 90, 50],
  naranjo: [230, 81, 0],
  grisOscuro: [43, 43, 43],
  grisClaro: [107, 107, 107],
  grisBorde: [224, 221, 217],
  blanco: [255, 255, 255],
  exito: [27, 122, 75],
};

const MARGEN = 14;
const ANCHO_UTIL = 182; // A4 (210 mm) menos los margenes

/** Formatea un monto: "USD 2.450,00" */
const usd = (valor) => `USD ${Number(valor ?? 0).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Formatea un numero con separador de miles. */
const num = (valor, decimales = 0) =>
  Number(valor ?? 0).toLocaleString('es-CL', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });

/**
 * Dibuja el membrete: bloque de color con el nombre de la empresa.
 *
 * @param {jsPDF} doc
 * @param {number} y - Coordenada vertical de inicio.
 */
function membrete(doc, y) {
  doc.setFillColor(...COLOR.terracota);
  doc.rect(0, 0, 210, 32, 'F');

  // Cuadro blanco con la inicial de la empresa.
  doc.setFillColor(...COLOR.blanco);
  doc.roundedRect(MARGEN, y - 4.5, 15, 15, 2, 2, 'F');

  doc.setTextColor(...COLOR.terracota);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('C', MARGEN + 7.5, y + 5.8, { align: 'center' });

  doc.setTextColor(...COLOR.blanco);
  doc.setFontSize(13);
  doc.text('CINTAC S.A.', MARGEN + 20, y + 1.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Cotizador Logistico de Importaciones Comex', MARGEN + 20, y + 7);

  return 40; // Retorna la Y donde sigue el contenido
}

/** Pie con numeracion de pagina y datos de la simulacion. */
function pie(doc, titulo, numero) {
  const paginas = doc.getNumberOfPages();
  const totalAlto = doc.internal.pageSize.getHeight();

  for (let pagina = 1; pagina <= paginas; pagina += 1) {
    doc.setPage(pagina);

    doc.setDrawColor(...COLOR.grisBorde);
    doc.setLineWidth(0.2);
    doc.line(MARGEN, totalAlto - 14, 210 - MARGEN, totalAlto - 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR.grisClaro);

    doc.text('Documento generado automaticamente. No constituye una declaracion ante Servicio Nacional de Aduanas.', MARGEN, totalAlto - 9);

    doc.text(`${titulo}`, 210 - MARGEN, totalAlto - 9, { align: 'right' });
    doc.text(`Pagina ${pagina} de ${paginas}`, 210 - MARGEN, totalAlto - 5.5, { align: 'right' });
  }

  void numero;
}

/** Titulo de seccion. */
function seccion(doc, texto, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR.terracota);
  doc.text(texto.toUpperCase(), MARGEN, y);
  doc.setDrawColor(...COLOR.grisBorde);
  doc.setLineWidth(0.3);
  doc.line(MARGEN, y + 1.8, 210 - MARGEN, y + 1.8);
  return y + 5.5;
}

/**
 * Genera y descarga el informe PDF de una simulacion.
 *
 * @param {object} r  - Respuesta de POST /cotizaciones/calcular.
 * @param {object} [usuario] - Sesion activa; se imprime en el pie.
 * @returns {jsPDF}
 */
export function generarInformePDF(r, usuario) {
  const {
    peso_kg: pesoKg,
    toneladas,
    cantidad_contenedores: contenedores,
    tipo_contenedor: tipoContenedor,
    puerto_origen: origen,
    puerto_destino: destino,
    valor_mercaderia_usd: valorMercaderia,
    precio_contenedor_usd: precioContenedor,
    costo_flete_usd: costoFlete,
    seguro_usd: seguro,
    valor_cif_usd: valorCif,
    impuesto_19_cif_usd: impuesto,
    costo_total_usd: costoTotal,
    dias_viaje_base: diasBase,
    dias_contingencia: diasContingencia,
    dias_transito: diasTransito,
    ocupacion_ultimo_contenedor_pct: ocupacion,
    cotizacion_id: cotizacionId,
    fecha_creacion: fechaCreacion,
    parametros,
  } = r;

  const doc = new jsPDF({ unit: 'mm', format: 'A4', orientation: 'portrait' });
  const limiteTn = parametros?.limite_toneladas_por_contenedor ?? 25;

  let y = membrete(doc, 18);

  // ------------------------------------------------------------------
  // Encabezado del informe
  // ------------------------------------------------------------------
  doc.setTextColor(...COLOR.grisOscuro);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('INFORME DE COTIZACION DE IMPORTACION', MARGEN, y);

  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLOR.grisClaro);
  doc.text(
    `Simulacion de flete maritimo e impuesto ad valorem 19% sobre valor CIF`,
    MARGEN,
    y,
  );

  const generado = new Date();
  const fechaInforme = generado.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  doc.text(`Emitido: ${fechaInforme}`, 210 - MARGEN, y - 4, { align: 'right' });

  if (cotizacionId) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLOR.terracota);
    doc.text(`Cotizacion N.${cotizacionId}`, 210 - MARGEN, y, { align: 'right' });
  }

  y += 8;

  // ------------------------------------------------------------------
  // 1. Datos de la operacion
  // ------------------------------------------------------------------
  y = seccion(doc, '1. Datos de la operacion', y);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGEN, right: MARGEN },
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 2.2,
      lineColor: COLOR.grisBorde,
      lineWidth: 0.15,
      textColor: COLOR.grisOscuro,
    },
    alternateRowStyles: { fillColor: [250, 249, 248] },
    columnStyles: {
      0: { cellWidth: 46, fontStyle: 'bold', fillColor: [247, 246, 244] },
      1: { cellWidth: 45 },
      2: { cellWidth: 46, fontStyle: 'bold', fillColor: [247, 246, 244] },
      3: { cellWidth: 45 },
    },
    body: [
      [
        'Puerto de origen',
        `${origen.nombre}, ${origen.pais}`,
        'Puerto de destino',
        `${destino.nombre}, Chile`,
      ],
      ['Codigo de puerto', `${origen.codigo} / ${destino.codigo}`, 'Ruta', 'Trasoceanico'],
      ['Peso declarado', `${num(pesoKg, 3)} kg`, 'Peso en toneladas', `${num(toneladas, 3)} tn`],
      ['Tipo de contenedor', tipoContenedor, 'Limite por contenedor', `${limiteTn} tn`],
      ['Contenedores requeridos', `${contenedores}`, 'Ocupacion ultimo', `${num(ocupacion, 1)} %`],
      [
        'Dias de viaje base',
        `${diasBase} dias`,
        'Dias de contingencia',
        `${diasContingencia} dias`,
      ],
      [
        'Tiempo total de transito',
        `${diasTransito} dias`,
        'Fecha de la simulacion',
        fechaCreacion
          ? new Date(String(fechaCreacion).replace(' ', 'T')).toLocaleString('es-CL')
          : fechaInforme,
      ],
    ],
  });

  y = doc.lastAutoTable.finalY + 8;

  // ------------------------------------------------------------------
  // 2. Desglose financiero
  // ------------------------------------------------------------------
  y = seccion(doc, '2. Desglose financiero', y);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGEN, right: MARGEN },
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 2.4,
      lineColor: COLOR.grisBorde,
      lineWidth: 0.15,
      textColor: COLOR.grisOscuro,
    },
    columnStyles: {
      0: { cellWidth: 96 },
      1: { cellWidth: 50, halign: 'right' },
      2: { cellWidth: 36, halign: 'right' },
    },
    head: [['Concepto', 'Detalle', 'Monto (USD)']],
    headStyles: { fillColor: COLOR.grisOscuro, textColor: COLOR.blanco, fontStyle: 'bold', fontSize: 8 },
    body: [
      [
        'Valor de la mercaderia (FOB)',
        'Valor declarado sin flete',
        num(valorMercaderia, 2),
      ],
      [
        'Flete maritimo',
        `${contenedores} x ${tipoContenedor} @ ${num(precioContenedor, 2)}`,
        num(costoFlete, 2),
      ],
      ['Seguro de carga', '1,0% sobre valor de la mercaderia', num(seguro, 2)],
      [
        { content: 'VALOR CIF', styles: { fontStyle: 'bold' } },
        { content: 'Mercaderia + flete + seguro', styles: { fontStyle: 'italic' } },
        { content: num(valorCif, 2), styles: { fontStyle: 'bold' } },
      ],
      [
        'Impuesto ad valorem 19%',
        '19% sobre el valor CIF',
        num(impuesto, 2),
      ],
      [
        { content: 'COSTO TOTAL DE LA IMPORTACION', styles: { fontStyle: 'bold', textColor: COLOR.terracota } },
        { content: 'Flete + impuesto', styles: { fontStyle: 'italic' } },
        {
          content: num(costoTotal, 2),
          styles: { fontStyle: 'bold', textColor: COLOR.terracota },
        },
      ],
    ],
  });

  y = doc.lastAutoTable.finalY + 8;

  // ------------------------------------------------------------------
  // 3. Base de calculo
  // ------------------------------------------------------------------
  y = seccion(doc, '3. Base de calculo aplicada', y);

  doc.setFont('courier', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(...COLOR.grisOscuro);

  const formulas = [
    `toneladas      = ${num(pesoKg, 3)} kg / 1000 = ${num(toneladas, 3)} tn`,
    `contenedores   = ceil(${num(toneladas, 3)} / ${limiteTn}) = ${contenedores}`,
    `flete          = ${contenedores} x ${num(precioContenedor, 2)} = ${num(costoFlete, 2)} USD`,
    `seguro         = ${num(valorMercaderia, 2)} x 1,00% = ${num(seguro, 2)} USD`,
    `CIF            = ${num(valorMercaderia, 2)} + ${num(costoFlete, 2)} + ${num(seguro, 2)} = ${num(valorCif, 2)} USD`,
    `impuesto 19%   = ${num(valorCif, 2)} x 19% = ${num(impuesto, 2)} USD`,
    `costo total    = ${num(costoFlete, 2)} + ${num(impuesto, 2)} = ${num(costoTotal, 2)} USD`,
    `transito       = ${diasBase} + ${diasContingencia} = ${diasTransito} dias`,
  ];

  formulas.forEach((linea) => {
    doc.text(linea, MARGEN, y);
    y += 4.4;
  });

  y += 3;

  // ------------------------------------------------------------------
  // 4. Resumen destacada
  // ------------------------------------------------------------------
  const alturaResumen = 22;

  doc.setFillColor(247, 246, 244);
  doc.setDrawColor(...COLOR.terracota);
  doc.setLineWidth(0.4);
  doc.roundedRect(MARGEN, y, ANCHO_UTIL, alturaResumen, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLOR.grisOscuro);
  doc.text('RESUMEN EJECUTIVO', MARGEN + 5, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `Importar ${num(toneladas, 3)} toneladas desde ${origen.nombre} (${origen.pais}) a ${destino.nombre}, Chile.`,
    MARGEN + 5,
    y + 12,
  );
  doc.text(
    `Se requieren ${contenedores} contenedor(es) ${tipoContenedor}, con un tiempo estimado de ${diasTransito} dias.`,
    MARGEN + 5,
    y + 17,
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLOR.terracota);
  doc.text(`Costo total: ${usd(costoTotal)}`, MARGEN + 5, y + 20);

  // ------------------------------------------------------------------
  // Validacion y descarga
  // ------------------------------------------------------------------
  pie(doc, `Cotizacion ${cotizacionId ? `N.${cotizacionId}` : 'simulacion'}`, cotizacionId);

  const sello = [
    `cotizacion-${String(cotizacionId ?? 'simulacion').padStart(5, '0')}`,
    origen.codigo.toLowerCase(),
    destino.codigo.toLowerCase(),
    `${num(toneladas, 0)}tn`,
  ].join('_');

  doc.save(`${sello}.pdf`);

  if (usuario) {
    // eslint-disable-next-line no-console
    console.info(`[PDF] Informe generado por ${usuario.email} para la cotizacion ${cotizacionId ?? 'sin registro'}.`);
  }

  return doc;
}