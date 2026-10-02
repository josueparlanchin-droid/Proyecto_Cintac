/**
 * pages/Historial.jsx
 * -----------------------------------------------------------------
 * Tabla de cotizaciones guardadas, con filtros, paginacion, exportacion
 * a PDF y eliminacion (reservada a Jefatura Comex).
 *
 * La paginacion y el filtrado ocurren en el servidor: el endpoint devuelve
 * solo la pagina pedida, y ademas el backend restringe que registros ve
 * cada rol, asi que no se puede eludir la regla desde el navegador.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Alerta, Cargador, Insignia, ModalConfirmacion, Vacio } from '../components/Comunes';
import { generarInformePDF } from '../utils/pdf';
import {
  formatearUSD,
  formatearPeso,
  formatearToneladas,
  formatearEntero,
  formatearFechaHora,
  tiempoRelativo,
  claseRegion,
} from '../utils/formato';

const POR_PAGINA = 10;

export default function Historial() {
  const { usuario, esAdmin } = useAuth();

  // --- Datos ---
  const [cotizaciones, setCotizaciones] = useState([]);
  const [paginacion, setPaginacion] = useState({ pagina: 1, total: 0, totalPaginas: 1 });
  const [metricas, setMetricas] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [puertos, setPuertos] = useState([]);

  // --- Filtros ---
  const [filtros, setFiltros] = useState({ puerto_origen_id: '', busqueda: '', desde: '', hasta: '' });
  const [filtrosAplicados, setFiltrosAplicados] = useState({});
  const [pagina, setPagina] = useState(1);

  // --- Interaccion ---
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [porEliminar, setPorEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);

  // ==================================================================
  // Carga
  // ==================================================================
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);

    try {
      const { datos, paginacion } = await api.historial({
        ...filtrosAplicados,
        pagina,
        porPagina: POR_PAGINA,
      });
      setCotizaciones(datos);
      setPaginacion(paginacion);
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle });
    } finally {
      setCargando(false);
    }
  }, [filtrosAplicados, pagina]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    async function cargarAuxiliares() {
      try {
        const [listaPuertos, resumen] = await Promise.all([api.puertos(), api.resumen()]);
        setPuertos(listaPuertos.datos.origen);
        setMetricas(resumen.datos);
      } catch {
        // Son datos auxiliares: si fallan, la tabla principal sigue siendo util.
      }
    }

    cargarAuxiliares();
  }, []);

  // ==================================================================
  // Acciones
  // ==================================================================
  function aplicarFiltros(evento) {
    evento.preventDefault();
    setPagina(1);
    setFiltrosAplicados(filtros);
  }

  function limpiarFiltros() {
    const vacio = { puerto_origen_id: '', busqueda: '', desde: '', hasta: '' };
    setFiltros(vacio);
    setFiltrosAplicados({});
    setPagina(1);
  }

  async function confirmarEliminacion() {
    setEliminando(true);

    try {
      await api.eliminarCotizacion(porEliminar.id);
      setExito(`Cotizacion N.${porEliminar.id} eliminada.`);
      setPorEliminar(null);
      cargar();
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle });
      setPorEliminar(null);
    } finally {
      setEliminando(false);
    }
  }

  /**
   * Exporta una fila del historial.
   *
   * Se reconstruye el objeto con la misma forma que devuelve el endpoint de
   * calculo, de modo que el generador de PDF no necesita dos variantes.
   */
  function exportarFila(cotizacion) {
    try {
      generarInformePDF(
        {
          peso_kg: cotizacion.peso_kg,
          toneladas: cotizacion.toneladas,
          cantidad_contenedores: cotizacion.cantidad_contenedores,
          tipo_contenedor: cotizacion.tipo_contenedor,
          ocupacion_ultimo_contenedor_pct: 100,
          puerto_origen: {
            nombre: cotizacion.puerto_origen,
            pais: cotizacion.puerto_origen_pais,
            region: cotizacion.puerto_origen_region,
            codigo: cotizacion.puerto_origen_codigo,
          },
          puerto_destino: {
            nombre: cotizacion.puerto_destino,
            pais: 'Chile',
            codigo: cotizacion.puerto_destino_codigo,
          },
          valor_mercaderia_usd: cotizacion.valor_mercaderia_usd,
          precio_contenedor_usd: cotizacion.precio_contenedor_usd,
          costo_flete_usd: cotizacion.costo_flete_usd,
          seguro_usd: cotizacion.seguro_usd,
          valor_cif_usd: cotizacion.valor_cif_usd,
          impuesto_19_cif_usd: cotizacion.impuesto_19_cif_usd,
          costo_total_usd: cotizacion.costo_total_usd,
          dias_viaje_base: cotizacion.dias_viaje_base,
          dias_contingencia: cotizacion.dias_contingencia,
          dias_transito: cotizacion.dias_transito,
          cotizacion_id: cotizacion.id,
          fecha_creacion: cotizacion.fecha_creacion,
          parametros: { limite_toneladas_por_contenedor: cotizacion.capacidad_max_tn },
        },
        usuario,
      );
    } catch (fallo) {
      setError({ mensaje: `No se pudo generar el PDF: ${fallo.message}` });
    }
  }

  // ==================================================================
  const hayFiltros = Object.values(filtrosAplicados).some(Boolean);

  return (
    <div className="pagina">
      <div className="pagina__encabezado">
        <div>
          <h1 className="pagina__titulo">Historial de Cotizaciones</h1>
          <p className="pagina__descripcion">
            {esAdmin
              ? 'Vista completa de las simulaciones registradas por el equipo Comex.'
              : 'Sus simulaciones registradas. Solo usted accede a este listado.'}
          </p>
        </div>

        <Insignia variante={esAdmin ? 'admin' : 'analista'}>
          {esAdmin ? 'Jefatura Comex - vista completa' : 'Analista Comex - vista personal'}
        </Insignia>
      </div>

      {error && (
        <Alerta tipo="error" titulo="No se pudo completar la operacion" detalle={error.detalle} onCerrar={() => setError(null)}>
          {error.mensaje}
        </Alerta>
      )}

      {exito && <Alerta tipo="exito" onCerrar={() => setExito(null)}>{exito}</Alerta>}

      {/* ---------------- Metricas ---------------- */}
      {metricas && (
        <div className="rejilla-stats" style={{ marginBottom: 'var(--esp-5)' }}>
          <div className="stat stat--acento">
            <div className="stat__etiqueta">Cotizaciones</div>
            <div className="stat__valor">{formatearEntero(metricas.total_cotizaciones)}</div>
          </div>
          <div className="stat stat--info">
            <div className="stat__etiqueta">Toneladas totales</div>
            <div className="stat__valor">{formatearToneladas(metricas.toneladas_totales, 1)}</div>
          </div>
          <div className="stat">
            <div className="stat__etiqueta">Contenedores</div>
            <div className="stat__valor">{formatearEntero(metricas.contenedores_totales)}</div>
          </div>
          <div className="stat stat--exito">
            <div className="stat__etiqueta">Facturacion simulada</div>
            <div className="stat__valor" style={{ fontSize: 'var(--texto-lg)' }}>
              {formatearUSD(metricas.facturacion_total_usd)}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Tabla ---------------- */}
      <section className="tarjeta">
        <form className="filtros" onSubmit={aplicarFiltros}>
          <div className="campo">
            <label className="campo__etiqueta" htmlFor="f-origen">Puerto de origen</label>
            <select
              id="f-origen"
              className="control"
              value={filtros.puerto_origen_id}
              onChange={(e) => setFiltros({ ...filtros, puerto_origen_id: e.target.value })}
            >
              <option value="">Todos</option>
              {puertos.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label className="campo__etiqueta" htmlFor="f-busqueda">Buscar</label>
            <input
              id="f-busqueda"
              type="search"
              className="control"
              placeholder="Nombre de puerto..."
              value={filtros.busqueda}
              onChange={(e) => setFiltros({ ...filtros, busqueda: e.target.value })}
            />
          </div>

          <div className="campo">
            <label className="campo__etiqueta" htmlFor="f-desde">Desde</label>
            <input
              id="f-desde"
              type="date"
              className="control"
              value={filtros.desde}
              onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
            />
          </div>

          <div className="campo">
            <label className="campo__etiqueta" htmlFor="f-hasta">Hasta</label>
            <input
              id="f-hasta"
              type="date"
              className="control"
              value={filtros.hasta}
              onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
            />
          </div>

          <div className="campo" style={{ display: 'flex', gap: 'var(--esp-2)', alignItems: 'flex-end' }}>
            <button type="submit" className="boton boton--principal">Filtrar</button>
            {hayFiltros && (
              <button type="button" className="boton boton--fantasma" onClick={limpiarFiltros}>Limpiar</button>
            )}
          </div>
        </form>

        {cargando ? (
          <Cargador texto="Consultando historial..." />
        ) : cotizaciones.length === 0 ? (
          <Vacio icono="🗂" titulo="No hay cotizaciones que mostrar">
            {hayFiltros
              ? 'Ningun registro coincide con los filtros aplicados. Pruebe con un rango de fechas mas amplio.'
              : 'Aun no se han registrado simulaciones. Vuelva al cotizador y genere una nueva cotizacion.'}
          </Vacio>
        ) : (
          <>
            <div className="tabla-envoltorio">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>N.</th>
                    <th>Fecha</th>
                    <th>Ruta</th>
                    <th className="tabla__numero">Peso (kg)</th>
                    <th className="tabla__numero">Toneladas</th>
                    <th className="tabla__numero">Cont.</th>
                    <th className="tabla__numero">Flete</th>
                    <th className="tabla__numero">Impuesto 19%</th>
                    <th className="tabla__numero">Total</th>
                    <th className="tabla__numero">Dias</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>

                <tbody>
                  {cotizaciones.map((c) => (
                    <tr key={c.id}>
                      <td><strong>#{c.id}</strong></td>

                      <td title={formatearFechaHora(c.fecha_creacion)}>
                        {tiempoRelativo(c.fecha_creacion)}
                      </td>

                      <td>
                        <Insignia variante={claseRegion(c.puerto_origen_region).replace('insignia--', '')}>
                          {c.puerto_origen_codigo}
                        </Insignia>
                        <span style={{ margin: '0 0.35rem', color: 'var(--gris-humo)' }}>→</span>
                        <Insignia variante="chile">{c.puerto_destino_codigo}</Insignia>
                        <div style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-claro)', marginTop: '0.2rem' }}>
                          {c.puerto_origen} → {c.puerto_destino}
                        </div>
                      </td>

                      <td className="tabla__numero">{formatearPeso(c.peso_kg)}</td>
                      <td className="tabla__numero">{formatearToneladas(c.toneladas, 3)}</td>
                      <td className="tabla__numero">
                        <strong>{c.cantidad_contenedores}</strong>
                        <div style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-humo)' }}>{c.tipo_contenedor}</div>
                      </td>
                      <td className="tabla__numero">{formatearUSD(c.costo_flete_usd)}</td>
                      <td className="tabla__numero" style={{ color: 'var(--naranjo)' }}>
                        {formatearUSD(c.impuesto_19_cif_usd)}
                      </td>
                      <td className="tabla__numero"><strong>{formatearUSD(c.costo_total_usd)}</strong></td>
                      <td className="tabla__numero">
                        {c.dias_transito}
                        {c.dias_contingencia > 0 && (
                          <div style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-humo)' }}>
                            +{c.dias_contingencia}
                          </div>
                        )}
                      </td>

                      <td>
                        <div className="tabla__acciones">
                          <button
                            type="button"
                            className="boton boton--fantasma"
                            title="Exportar informe PDF"
                            aria-label={`Exportar cotizacion ${c.id} a PDF`}
                            onClick={() => exportarFila(c)}
                            style={{ padding: '0.35rem 0.6rem', fontSize: 'var(--texto-sm)' }}
                          >
                            PDF
                          </button>

                          {esAdmin && (
                            <button
                              type="button"
                              className="boton boton--peligro"
                              title="Eliminar cotizacion"
                              aria-label={`Eliminar cotizacion ${c.id}`}
                              onClick={() => setPorEliminar(c)}
                              style={{ padding: '0.35rem 0.6rem', fontSize: 'var(--texto-sm)' }}
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ---------------- Paginacion ---------------- */}
            <div className="paginacion">
              <span className="paginacion__info">
                Mostrando {cotizaciones.length} de {formatearEntero(paginacion.total)} cotizaciones · pagina{' '}
                {paginacion.pagina} de {paginacion.totalPaginas}
              </span>

              <div className="paginacion__controles">
                <button
                  type="button"
                  className="boton boton--secundario"
                  onClick={() => setPagina((p) => Math.max(p - 1, 1))}
                  disabled={paginacion.pagina <= 1}
                >
                  Anterior
                </button>

                <button
                  type="button"
                  className="boton boton--secundario"
                  onClick={() => setPagina((p) => Math.min(p + 1, paginacion.totalPaginas))}
                  disabled={paginacion.pagina >= paginacion.totalPaginas}
                >
                  Siguiente
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {porEliminar && (
        <ModalConfirmacion
          titulo="Eliminar cotizacion"
          textoConfirmar="Eliminar"
          peligro
          cargando={eliminando}
          onCancelar={() => setPorEliminar(null)}
          onConfirmar={confirmarEliminacion}
        >
          Se eliminara permanentemente la cotizacion <strong>#{porEliminar.id}</strong> ({porEliminar.puerto_origen} →{' '}
          {porEliminar.puerto_destino}, {formatearUSD(porEliminar.costo_total_usd)}).
          <br />
          <br />
          Esta accion no se puede deshacer.
        </ModalConfirmacion>
      )}
    </div>
  );
}