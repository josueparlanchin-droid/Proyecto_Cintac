/**
 * pages/Tarifas.jsx
 * -----------------------------------------------------------------
 * Solo para Jefatura Comex: consulta de las rutas tarifadas y carga
 * masiva de planillas .xlsx / .csv.
 *
 * La carga es idempotente: si la ruta ya existe se actualiza el precio,
 * de modo que se puede subir la misma planilla corregida cuantas veces
 * haga falta sin duplicar informacion.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { Alerta, Cargador, Insignia } from '../components/Comunes';
import { formatearUSD, formatearEntero, claseRegion, REGIONES } from '../utils/formato';

export default function Tarifas() {
  const entradaArchivo = useRef(null);

  const [tarifas, setTarifas] = useState([]);
  const [cargando, setCargando] = useState(true);

  /**
   * Filas agrupadas por region de origen.
   *
   * El agrupamiento se arma aqui, y no se toma de `respuesta.porRegion`, porque
   * ese campo es un CONTAJE por region ({ CHINA: 5, EUROPA: 3, ... }), tal como
   * lo construye el controlador. Leerlo como si fueran arreglos rompia la tabla
   * entera: al llegar los datos la pantalla se quedaba en blanco, porque React
   * desmonta el arbol cuando una funcion falla durante el render.
   */
  const grupos = useMemo(() => {
    const porRegion = {};
    for (const region of Object.keys(REGIONES)) porRegion[region] = [];

    for (const tarifa of tarifas) {
      // `??=` agrupa tambien las regiones que el backend no contempla.
      (porRegion[tarifa.origen_region] ??= []).push(tarifa);
    }

    // Se descartan los grupos vacios para no pintar encabezados sin filas.
    return Object.entries(porRegion).filter(([, lista]) => lista.length > 0);
  }, [tarifas]);

  const [subiendo, setSubiendo] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);

  // ==================================================================
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const respuesta = await api.tarifas();
      setTarifas(respuesta.datos);
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // ==================================================================
  async function subirArchivo(evento) {
    evento.preventDefault();

    const archivo = evento.target.files?.[0];
    if (!archivo) return;

    setError(null);
    setResultado(null);
    setSubiendo(true);

    try {
      const respuesta = await api.subirTarifas(archivo);
      // La API responde el sobre { exito, mensaje, datos }; el resumen de la
      // importacion vive en `datos`, no en la raiz.
      setResultado(respuesta.datos ?? respuesta);
      cargar();
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle });
    } finally {
      setSubiendo(false);
      // Se limpia el input para permitir reenviar el mismo archivo.
      if (entradaArchivo.current) entradaArchivo.current.value = '';
    }
  }

  // ==================================================================
  return (
    <div className="pagina">
      <div className="pagina__encabezado">
        <div>
          <h1 className="pagina__titulo">Tarifas de Flete</h1>
          <p className="pagina__descripcion">
            Rutas, precios por contenedor y dias de viaje base que alimentan el motor de calculo.
          </p>
        </div>

        <Insignia variante="admin">Acceso exclusivo de Jefatura Comex</Insignia>
      </div>

      {error && (
        <Alerta tipo="error" titulo="Error en la carga de la planilla" detalle={error.detalle} onCerrar={() => setError(null)}>
          {error.mensaje}
        </Alerta>
      )}

      {resultado && (
        <Alerta
          tipo={resultado.omitidas > 0 ? 'advertencia' : 'exito'}
          titulo="Planilla procesada"
          onCerrar={() => setResultado(null)}
        >
          {resultado.mensaje}
          <ul style={{ marginTop: '0.4rem', paddingLeft: '1.1rem', listStyle: 'disc' }}>
            <li>Filas leidas: {resultado.procesadas}</li>
            <li>Rutas nuevas: {resultado.insertadas}</li>
            <li>Rutas actualizadas: {resultado.actualizadas}</li>
            <li>Filas omitidas: {resultado.omitidas}</li>
            <li>Total de rutas vigentes: {formatearEntero(tarifas.length)}</li>
          </ul>

          {resultado.errores.length > 0 && (
            <details style={{ marginTop: '0.6rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: '600' }}>
                Ver detalle de las {resultado.errores.length} fila(s) omitida(s)
              </summary>
              <ul style={{ marginTop: '0.4rem', paddingLeft: '1.1rem', listStyle: 'disc' }}>
                {resultado.errores.slice(0, 20).map((e) => (
                  <li key={`${e.fila}-${e.motivo}`}>
                    <strong>Fila {e.fila}:</strong> {e.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Alerta>
      )}

      <div className="rejilla">
        {/* ---------------- Carga de planilla ---------------- */}
        <section className="tarjeta">
          <div className="tarjeta__encabezado">
            <h2 className="tarjeta__titulo">Cargar planilla de tarifas</h2>
          </div>

          <div className="tarjeta__cuerpo">
            <form onSubmit={subirArchivo}>
              <div className="campo">
                <label className="campo__etiqueta" htmlFor="archivo">Archivo .xlsx o .csv</label>
                <input
                  id="archivo"
                  ref={entradaArchivo}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="control"
                  disabled={subiendo}
                />
                <p className="campo__ayuda">
                  Columnas obligatorias: <strong>puerto_origen</strong>, <strong>puerto_destino</strong> y{' '}
                  <strong>precio_usd</strong>. Opcionales: <strong>tipo_contenedor</strong>,{' '}
                  <strong>dias_viaje_base</strong> y <strong>capacidad_max_tn</strong>.
                </p>
              </div>

              <button type="submit" className="boton boton--principal boton--bloque" disabled={subiendo}>
                {subiendo ? <span className="boton__spinner" /> : 'Procesar planilla'}
              </button>
            </form>

            <div
              style={{
                marginTop: 'var(--esp-5)',
                padding: 'var(--esp-4)',
                background: 'var(--blanco-hueso)',
                borderRadius: 'var(--radio)',
                border: '1px dashed var(--borde-fuerte)',
              }}
            >
              <strong style={{ fontSize: 'var(--texto-sm)' }}>Formato de ejemplo</strong>
              <pre
                style={{
                  marginTop: 'var(--esp-2)',
                  fontSize: 'var(--texto-xs)',
                  fontFamily: 'var(--fuente-mono)',
                  overflowX: 'auto',
                  color: 'var(--gris-medio)',
                  lineHeight: '1.6',
                }}
              >
{`puerto_origen,puerto_destino,tipo_contenedor,precio_usd,dias_viaje_base,capacidad_max_tn
Shanghai,Valparaiso,40HC,2450,32,25
Rotterdam,San Antonio,40HC,1890,25,25
Miami,Valparaiso,40HC,1450,9,25`}
              </pre>

              <p className="campo__ayuda" style={{ marginTop: 'var(--esp-2)' }}>
                Los puertos pueden escribirse por nombre o por codigo UN/LOCODE (CNSHA, CLVAP...).
                Si una ruta ya existe, su precio se actualiza en lugar de duplicarse.
              </p>
            </div>
          </div>
        </section>

        {/* ---------------- Listado ---------------- */}
        <section className="tarjeta">
          <div className="tarjeta__encabezado">
            <h2 className="tarjeta__titulo">Rutas tarifadas</h2>
            <span className="insignia insignia--neutro">{formatearEntero(tarifas.length)} rutas</span>
          </div>

          {cargando ? (
            <Cargador texto="Cargando tarifas..." />
          ) : (
            <div className="tabla-envoltorio">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Origen</th>
                    <th>Destino</th>
                    <th>Tipo</th>
                    <th className="tabla__numero">Precio (USD)</th>
                    <th className="tabla__numero">Dias</th>
                    <th className="tabla__numero">Limite</th>
                  </tr>
                </thead>

                <tbody>
                  {grupos.flatMap(([region, lista]) =>
                    lista.map((t, indice) => (
                      <tr key={`${region}-${t.id ?? indice}`}>
                        <td>
                          <Insignia variante={claseRegion(t.origen_region).replace('insignia--', '')}>
                            {t.origen_codigo}
                          </Insignia>
                          <div style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-claro)' }}>
                            {t.origen_nombre}
                          </div>
                        </td>

                        <td>
                          <Insignia variante="chile">{t.destino_codigo}</Insignia>
                          <div style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-claro)' }}>
                            {t.destino_nombre}
                          </div>
                        </td>

                        <td>{t.tipo_contenedor}</td>
                        <td className="tabla__numero"><strong>{formatearUSD(t.precio_usd)}</strong></td>
                        <td className="tabla__numero">{t.dias_viaje_base}</td>
                        <td className="tabla__numero">{t.capacidad_max_tn} tn</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}