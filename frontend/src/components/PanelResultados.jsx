/**
 * components/PanelResultados.jsx
 * -----------------------------------------------------------------
 * Panel derecho del cotizador: muestra el resultado que devuelve el backend.
 *
 * Toda la informacion proviene de `resultado` (la respuesta de la API).
 * El componente no recalcula nada: si mostrara una conversion propia,
 * la pantalla podria contradecir al informe PDF o al historial.
 */

import { Stat, Insignia } from './Comunes';
import { formatearUSD, formatearPeso, formatearToneladas, formatearEntero, claseRegion } from '../utils/formato';

/**
 * Dibuja un contenedor por cada unidad requerida.
 *
 * El relleno vertical de la ultima caja representa la ocupacion real, que
 * es donde se ve el efecto del limite de 25 tn: una carga de 26 tn llena un
 * contenedor y deja el siguiente casi vacio.
 */
function VisualizadorContenedores({ cantidad, ocupacionPct, tipo }) {
  // Por encima de 40 cajas el bloque deja de ser legible: se resumen.
  const MAX_VISIBLES = 40;
  const excedente = cantidad > MAX_VISIBLES;
  const visibles = excedente ? MAX_VISIBLES : cantidad;

  // El ultimo contenedor mostrado es el que lleva la carga remanente.
  const indiceUltimo = visibles - 1;

  return (
    <div>
      <div className="contenedores">
        {Array.from({ length: visibles }, (_, indice) => {
          const esUltimo = indice === indiceUltimo;
          const relleno = esUltimo ? Math.min(Math.max(ocupacionPct, 6), 100) : 100;

          return (
            <div
              key={indice}
              className="contenedor-caja"
              title={esUltimo ? `Contenedor ${indice + 1}: ${ocupacionPct.toFixed(1)}% ocupado` : `Contenedor ${indice + 1}: completo`}
            >
              <div className="contenedor-caja__relleno" style={{ height: `${relleno}%` }} />
              <span className="contenedor-caja__etiqueta">{indice + 1}</span>
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: '0.5rem', fontSize: 'var(--texto-xs)', color: 'var(--gris-claro)' }}>
        {cantidad} contenedor(es) {tipo} · limite legal aplicado: 25 tn por unidad.
        {visibles > 0 && ` Ultimo contenedor al ${Math.min(Math.max(ocupacionPct, 0), 100).toFixed(1)}% de ocupacion.`}
        {excedente && ` Se muestran los primeros ${MAX_VISIBLES}.`}
      </p>
    </div>
  );
}

/**
 * @param {{resultado:object|null, calculando:boolean, contingencia:number,
 *          onExportar:Function}} props
 */
export default function PanelResultados({ resultado, calculando, contingencia, onExportar }) {
  // --- Sin resultado: instructions --- 
  if (!resultado) {
    return (
      <section className="tarjeta">
        <div className="tarjeta__encabezado">
          <h2 className="tarjeta__titulo">Resultado de la simulacion</h2>
        </div>

        <div className="tarjeta__cuerpo">
          {calculando ? (
            <div style={{ padding: '3rem 1rem' }}>
              <div className="cargador" role="status" aria-label="Calculando" />
              <p style={{ textAlign: 'center', marginTop: '1rem', color: 'var(--gris-claro)', fontSize: 'var(--texto-sm)' }}>
                Calculando contenedores, costo de flete e impuesto...
              </p>
            </div>
          ) : (
            <div className="vacio">
              <div className="vacio__icono" aria-hidden="true">📊</div>
              <h3 className="vacio__titulo">Aun no hay resultados</h3>
              <p className="vacio__texto">
                Complete el formulario y presione <strong>Calcular cotizacion</strong>. Vera aqui la
                cantidad de contenedores, el desglose financiero y los dias de transito estimado.
              </p>

              <div style={{ marginTop: '1.75rem', textAlign: 'left', display: 'inline-block' }}>
                <Stat etiqueta="Tasa de impuesto sobre CIF" valor="19%" variante="acento" />
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  // --- Con resultado ---
  const {
    peso_kg: pesoKg,
    toneladas,
    cantidad_contenedores: contenedores,
    tipo_contenedor: tipoContenedor,
    ocupacion_ultimo_contenedor_pct: ocupacion,
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
    cotizacion_id: cotizacionId,
    parametros,
  } = resultado;

  return (
    <section className="tarjeta">
      <div className="tarjeta__encabezado">
        <h2 className="tarjeta__titulo">Resultado de la simulacion</h2>
        {cotizacionId ? (
          <Insignia variante="admin">Cotizacion N.{cotizacionId}</Insignia>
        ) : (
          <Insignia variante="neutro">Simulacion sin registro</Insignia>
        )}
      </div>

      <div className="tarjeta__cuerpo">
        {/* ---------- Ruta ---------- */}
        <div className="ruta">
          <div className="ruta__nodo">
            <Insignia variante={claseRegion(origen.region).replace('insignia--', '')}>{origen.codigo}</Insignia>
            <span className="ruta__nombre" style={{ marginTop: '0.3rem' }}>{origen.nombre}</span>
            <span className="ruta__pais">{origen.pais}</span>
          </div>

          <div className="ruta__flecha" aria-hidden="true">→</div>

          <div className="ruta__nodo">
            <Insignia variante="chile">{destino.codigo}</Insignia>
            <span className="ruta__nombre" style={{ marginTop: '0.3rem' }}>{destino.nombre}</span>
            <span className="ruta__pais">Chile</span>
          </div>
        </div>

        {/* ---------- Indicadores ---------- */}
        <div className="rejilla-stats" style={{ marginBottom: 'var(--esp-5)' }}>
          <Stat
            etiqueta="Contenedores"
            valor={formatearEntero(contenedores)}
            detalle={`${tipoContenedor} · ${formatearUSD(precioContenedor)} c/u`}
            variante="acento"
          />
          <Stat
            etiqueta="Peso total"
            valor={`${formatearToneladas(toneladas, 2)} tn`}
            detalle={`${formatearPeso(pesoKg)} kg`}
            variante="info"
          />
          <Stat
            etiqueta="Flete maritimo"
            valor={formatearUSD(costoFlete)}
            detalle={`${contenedores} x ${formatearUSD(precioContenedor)}`}
            variante="neutro"
          />
          <Stat
            etiqueta="Impuesto 19% CIF"
            valor={formatearUSD(impuesto)}
            detalle="Sobre valor CIF"
            variante="advertencia"
          />
          <Stat
            etiqueta="Costo total"
            valor={formatearUSD(costoTotal)}
            detalle="Flete + impuesto"
            variante="exito"
          />
          <Stat
            etiqueta="Tiempo de transito"
            valor={`${formatearEntero(diasTransito)} dias`}
            detalle={`${diasBase} base${diasContingencia ? ` + ${diasContingencia} contingencia` : ''}`}
            variante="info"
          />
        </div>

        {/* ---------- Contenedores ---------- */}
        <div style={{ marginBottom: 'var(--esp-5)' }}>
          <h3 style={{ fontSize: 'var(--texto-sm)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--gris-claro)', marginBottom: 'var(--esp-2)' }}>
            Distribucion de carga
          </h3>
          <VisualizadorContenedores
            cantidad={contenedores}
            ocupacionPct={ocupacion ?? 0}
            tipo={tipoContenedor}
          />
        </div>

        {/* ---------- Desglose financiero ---------- */}
        <h3 style={{ fontSize: 'var(--texto-sm)', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--gris-claro)', marginBottom: 'var(--esp-2)' }}>
          Desglose financiero
        </h3>

        <div className="desglose">
          <div className="desglose__fila">
            <span className="desglose__etiqueta">Valor de la mercaderia (FOB)</span>
            <span className="desglose__valor">{formatearUSD(valorMercaderia)}</span>
          </div>

          <div className="desglose__fila">
            <span className="desglose__etiqueta">
              Flete maritimo
              <span className="desglose__sub">{contenedores} contenedor(es) {tipoContenedor} x {formatearUSD(precioContenedor)}</span>
            </span>
            <span className="desglose__valor">{formatearUSD(costoFlete)}</span>
          </div>

          <div className="desglose__fila">
            <span className="desglose__etiqueta">
              Seguro de carga
              <span className="desglose__sub">1,0% sobre el valor de la mercaderia</span>
            </span>
            <span className="desglose__valor">{formatearUSD(seguro)}</span>
          </div>

          <div className="desglose__fila desglose__fila--destacada">
            <span className="desglose__etiqueta">
              Valor CIF (base imponible)
              <span className="desglose__sub">Mercaderia + flete + seguro</span>
            </span>
            <span className="desglose__valor">{formatearUSD(valorCif)}</span>
          </div>

          <div className="desglose__fila">
            <span className="desglose__etiqueta">
              Impuesto ad valorem 19%
              <span className="desglose__sub">19% sobre {formatearUSD(valorCif)}</span>
            </span>
            <span className="desglose__valor" style={{ color: 'var(--naranjo)' }}>{formatearUSD(impuesto)}</span>
          </div>

          <div className="desglose__fila desglose__fila--total">
            <span className="desglose__etiqueta">Costo total de la importacion</span>
            <span className="desglose__valor">{formatearUSD(costoTotal)}</span>
          </div>
        </div>

        {/* ---------- Base de calculo ---------- */}
        <details style={{ marginTop: 'var(--esp-5)' }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 'var(--texto-sm)',
              color: 'var(--gris-claro)',
              fontWeight: '600',
              padding: 'var(--esp-2) 0',
            }}
          >
            Ver base de calculo aplicada
          </summary>

          <div
            style={{
              marginTop: 'var(--esp-2)',
              padding: 'var(--esp-3)',
              background: 'var(--blanco-hueso)',
              borderRadius: 'var(--radio-sm)',
              fontSize: 'var(--texto-xs)',
              color: 'var(--gris-medio)',
              fontFamily: 'var(--fuente-mono)',
              lineHeight: '1.7',
            }}
          >
            toneladas = {formatearPeso(pesoKg)} kg / 1000 = {formatearToneladas(toneladas)} tn<br />
            contenedores = ceil({formatearToneladas(toneladas)} / {parametros?.limite_toneladas_por_contenedor}) = {contenedores}<br />
            flete = {contenedores} × {formatearUSD(precioContenedor)} = {formatearUSD(costoFlete)}<br />
            seguro = {formatearUSD(valorMercaderia)} × {(parametros?.tasa_seguro * 100).toFixed(1)}% = {formatearUSD(seguro)}<br />
            CIF = {formatearUSD(valorMercaderia)} + {formatearUSD(costoFlete)} + {formatearUSD(seguro)} = {formatearUSD(valorCif)}<br />
            impuesto = {formatearUSD(valorCif)} × {((parametros?.tasa_impuesto_cif ?? 0.19) * 100).toFixed(0)}% = {formatearUSD(impuesto)}<br />
            total = {formatearUSD(costoFlete)} + {formatearUSD(impuesto)} = {formatearUSD(costoTotal)}<br />
            transito = {diasBase} + {diasContingencia} = {diasTransito} dias
          </div>
        </details>
      </div>

      <div className="tarjeta__pie" style={{ display: 'flex', gap: 'var(--esp-3)' }}>
        <button type="button" className="boton boton--principal" onClick={onExportar} style={{ flex: 1 }}>
          📄 Exportar informe PDF
        </button>
      </div>
    </section>
  );
}