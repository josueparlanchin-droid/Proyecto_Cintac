/**
 * pages/Cotizador.jsx
 * -----------------------------------------------------------------
 * Formulario de cotizacion de importacion y panel de resultados.
 *
 * El calculo NO se hace en el navegador: el frontend convierte kg a tn
 * solo para dar feedback inmediato mientras se escribe, y el resultado
 * oficial (contenedores, flete, impuesto, transito) siempre lo calcula y
 * devuelve el backend. Es la regla clave del proyecto: la interfaz Anticipa,
 * el servidor decide.
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Alerta, Campo, Cargador, Stat } from '../components/Comunes';
import PanelResultados from '../components/PanelResultados';
import {
  formatearPeso,
  formatearToneladas,
  REGIONES,
  claseRegion,
} from '../utils/formato';
import { generarInformePDF } from '../utils/pdf';

/** Limite legal por contenedor. Solo para feedback visual; el backend usa el valor de la tarifa. */
const LIMITE_TN = 25;

/**
 * Convierte a numero admitiendo coma o punto como separador decimal.
 *
 * El usuario escribe "18000", "1.250,75" o "1250.75"; se eliminan los
 * separadores de miles antes de interpretar el decimal, para no rechazar
 * la escritura natural en un formulario chileno.
 *
 * @param {string|number} texto
 * @returns {number} NaN si no es convertible.
 */
function aNumero(texto) {
  if (typeof texto === 'number') return texto;
  if (typeof texto !== 'string' || texto.trim() === '') return Number.NaN;

  return Number(texto.replace(/\./g, '').replace(',', '.').trim());
}

export default function Cotizador() {
  const { usuario } = useAuth();

  // --- Catalogo de puertos ---
  const [puertos, setPuertos] = useState(null);
  const [cargandoPuertos, setCargandoPuertos] = useState(true);
  const [errorPuertos, setErrorPuertos] = useState(null);

  // --- Formulario ---
  const [pesoKg, setPesoKg] = useState('18000');
  const [valorMercaderia, setValorMercaderia] = useState('65000');
  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [contingencia, setContingencia] = useState(5);
  const [guardar, setGuardar] = useState(true);

  // --- Resultado / errores ---
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [exito, setExito] = useState(null);

  // ==================================================================
  // Carga del catalogo de puertos
  // ==================================================================
  useEffect(() => {
    let vigente = true;

    async function cargar() {
      try {
        const { datos } = await api.puertos();
        if (!vigente) return;

        setPuertos(datos);

        // Se preselecciona la primera ruta disponible (China -> Chile),
        // que es el caso de uso mas frecuente en la operacion real.
        const primerOrigen = datos.origenPorRegion?.CHINA?.[0] ?? datos.origen[0];
        const primerDestino = datos.destino[0];

        if (primerOrigen) setOrigenId(String(primerOrigen.id));
        if (primerDestino) setDestinoId(String(primerDestino.id));
      } catch (fallo) {
        if (vigente) setErrorPuertos(fallo.message);
      } finally {
        if (vigente) setCargandoPuertos(false);
      }
    }

    cargar();
    return () => {
      vigente = false;
    };
  }, []);

  // ==================================================================
  // Conversion en vivo kg -> tn (feedback inmediato, no es el resultado final)
  // ==================================================================
  const conversiones = useMemo(() => {
    const kg = aNumero(pesoKg);

    if (!Number.isFinite(kg) || kg <= 0) {
      return { valido: false, toneladas: 0, contenedorEstimado: 0, ocupacion: 0 };
    }

    const toneladas = kg / 1000;
    const contenedorEstimado = Math.max(Math.ceil(toneladas / LIMITE_TN), 1);

    // Porcentaje de ocupacion del ULTIMO contenedor: lo que ocupa
    // la carga mas alla de los contenedores completos.
    const tonsEnUltimo = toneladas - (contenedorEstimado - 1) * LIMITE_TN;

    return {
      valido: true,
      toneladas,
      contenedorEstimado,
      ocupacion: Math.min(Math.max((tonsEnUltimo / LIMITE_TN) * 100, 0), 100),
    };
  }, [pesoKg]);

  const valorMercaderiaNumero = aNumero(valorMercaderia);

  const formularioValido =
    conversiones.valido &&
    Number.isFinite(valorMercaderiaNumero) &&
    valorMercaderiaNumero > 0 &&
    Boolean(origenId) &&
    Boolean(destinoId);

  // ==================================================================
  // Envio del calculo
  // ==================================================================
  async function calcular(evento) {
    evento.preventDefault();

    setError(null);
    setExito(null);
    setResultado(null);
    setCalculando(true);

    try {
      const { datos } = await api.calcular({
        peso_kg: aNumero(pesoKg),
        valor_mercaderia_usd: aNumero(valorMercaderia),
        puerto_origen_id: Number(origenId),
        puerto_destino_id: Number(destinoId),
        dias_contingencia: Number(contingencia),
        guardar,
      });

      setResultado(datos);

      if (datos.registrada) {
        setExito(`Cotizacion N.${datos.cotizacion_id} registrada en el historial.`);
      }
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle });
    } finally {
      setCalculando(false);
    }
  }

  /** Descarga el informe PDF de la simulacion recien realizada. */
  function exportarPDF() {
    if (!resultado) return;
    try {
      generarInformePDF(resultado, usuario);
      setExito('Informe PDF generado correctamente.');
    } catch (fallo) {
      setError({ mensaje: `No se pudo generar el PDF: ${fallo.message}` });
    }
  }

  // ==================================================================
  if (cargandoPuertos) {
    return (
      <div className="pagina">
        <Cargador texto="Cargando catalogo de puertos..." />
      </div>
    );
  }

  return (
    <div className="pagina">
      <div className="pagina__encabezado">
        <div>
          <h1 className="pagina__titulo">Cotizacion de Importacion</h1>
          <p className="pagina__descripcion">
            Simule el costo y los plazos de una importacion. El limite legal de{' '}
            <strong>{LIMITE_TN} toneladas</strong> por contenedor se aplica automaticamente.
          </p>
        </div>
      </div>

      {errorPuertos && (
        <Alerta tipo="error" titulo="No se pudo cargar el catalogo de puertos">
          {errorPuertos}
        </Alerta>
      )}

      {error && (
        <Alerta tipo="error" titulo="No fue posible calcular la cotizacion" detalle={error.detalle} onCerrar={() => setError(null)}>
          {error.mensaje}
        </Alerta>
      )}

      {exito && (
        <Alerta tipo="exito" onCerrar={() => setExito(null)}>{exito}</Alerta>
      )}

      <div className="rejilla">
        {/* ================= FORMULARIO ================= */}
        <form className="tarjeta" onSubmit={calcular} noValidate>
          <div className="tarjeta__encabezado">
            <h2 className="tarjeta__titulo">Datos de la operacion</h2>
            <span className="insignia insignia--neutro">{usuario?.rol === 'ADMIN_COMEX' ? 'Jefatura' : 'Analista'}</span>
          </div>

          <div className="tarjeta__cuerpo">
            {/* --- Peso con conversion en vivo --- */}
            <Campo
              etiqueta="Peso de la carga"
              htmlFor="peso"
              requerido
              sufijo="kg"
              ayuda="Ingrese el peso en kilogramos. La conversion a toneladas se muestra al instante."
            >
              <input
                id="peso"
                name="peso"
                type="text"
                inputMode="decimal"
                className="control"
                value={pesoKg}
                onChange={(e) => setPesoKg(e.target.value)}
                placeholder="Ej. 18.000"
                autoComplete="off"
              />
            </Campo>

            {conversiones.valido && (
              <div style={{ marginTop: 'calc(var(--esp-5) * -1)', marginBottom: 'var(--esp-5)' }}>
                <div className="conversion">
                  <span>Equivale a</span>
                  <span className="conversion__valor">
                    {formatearToneladas(conversiones.toneladas)} tn
                  </span>
                </div>
              </div>
            )}

            {/* --- Valor de la mercancia (base del impuesto CIF) --- */}
            <Campo
              etiqueta="Valor de la mercaderia (FOB)"
              htmlFor="valor"
              requerido
              sufijo="USD"
              ayuda="Valor declarado de la carga sin flete. Forma parte de la base imponible del 19%."
            >
              <input
                id="valor"
                name="valor"
                type="text"
                inputMode="decimal"
                className="control"
                value={valorMercaderia}
                onChange={(e) => setValorMercaderia(e.target.value)}
                placeholder="Ej. 65.000"
                autoComplete="off"
              />
            </Campo>

            {/* --- Puerto de origen --- */}
            <Campo etiqueta="Puerto de origen internacional" htmlFor="origen" requerido>
              <select
                id="origen"
                name="origen"
                className="control"
                value={origenId}
                onChange={(e) => {
                  setOrigenId(e.target.value);
                  setResultado(null);
                }}
              >
                <option value="">Seleccione un puerto...</option>

                {puertos?.origenPorRegion &&
                  Object.entries(puertos.origenPorRegion).map(([region, lista]) => (
                    <optgroup key={region} label={REGIONES[region] ?? region}>
                      {lista.map((puerto) => (
                        <option key={puerto.id} value={puerto.id}>
                          {puerto.nombre} - {puerto.pais_origen}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
            </Campo>

            {/* --- Puerto de destino --- */}
            <Campo etiqueta="Puerto de destino en Chile" htmlFor="destino" requerido>
              <select
                id="destino"
                name="destino"
                className="control"
                value={destinoId}
                onChange={(e) => {
                  setDestinoId(e.target.value);
                  setResultado(null);
                }}
              >
                <option value="">Seleccione un puerto...</option>

                {puertos?.destino.map((puerto) => (
                  <option key={puerto.id} value={puerto.id}>
                    {puerto.nombre} - {puerto.pais_origen}
                  </option>
                ))}
              </select>
            </Campo>

            {/* --- Dias de contingencia --- */}
            <Campo
              etiqueta="Dias de contingencia"
              htmlFor="contingencia"
              ayuda="Margen por imponderables: tifones, cierre de puertos, demoras en aduana."
            >
              <input
                id="contingencia"
                name="contingencia"
                type="range"
                min="0"
                max="45"
                step="1"
                value={contingencia}
                onChange={(e) => setContingencia(Number(e.target.value))}
                className="deslizador"
              />

              <div className="deslizador-escala">
                <span>0 dias</span>
                <strong style={{ color: 'var(--terracota)' }}>+{contingencia} dias</strong>
                <span>45 dias</span>
              </div>
            </Campo>

            {/* --- Persistencia --- */}
            <div className="campo">
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: 'var(--texto-sm)' }}
              >
                <input
                  type="checkbox"
                  checked={guardar}
                  onChange={(e) => setGuardar(e.target.checked)}
                  style={{ width: '1.05rem', height: '1.05rem', accentColor: 'var(--terracota)', cursor: 'pointer' }}
                />
                Guardar esta simulacion en el historial
              </label>
            </div>
          </div>

          <div className="tarjeta__pie">
            <button type="submit" className="boton boton--principal boton--bloque boton--grande" disabled={!formularioValido || calculando}>
              {calculando ? <span className="boton__spinner" /> : 'Calcular cotizacion'}
            </button>

            {!formularioValido && (
              <p className="campo__ayuda" style={{ textAlign: 'center', marginTop: 'var(--esp-2)' }}>
                Complete el peso, el valor y ambos puertos para continuar.
              </p>
            )}
          </div>
        </form>

        {/* ================= RESULTADOS ================= */}
        <PanelResultados
          resultado={resultado}
          calculando={calculando}
          contingencia={Number(contingencia)}
          onExportar={exportarPDF}
        />
      </div>
    </div>
  );
}