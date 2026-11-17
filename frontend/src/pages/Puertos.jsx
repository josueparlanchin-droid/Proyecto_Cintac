/**
 * pages/Puertos.jsx
 * -----------------------------------------------------------------
 * Mantenedor moderno y responsive de puertos del catalogo (origen y destino).
 * Reservado exclusivamente para Jefatura Comex (ADMIN_COMEX).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  Alerta,
  Campo,
  Cargador,
  Insignia,
  ModalConfirmacion,
  Vacio,
} from '../components/Comunes';
import {
  REGIONES,
  claseRegion,
  formatearEntero,
} from '../utils/formato';

const REGIONES_OPCIONES = [
  { id: 'CHINA', etiqueta: 'Asia - China' },
  { id: 'EUROPA', etiqueta: 'Europa' },
  { id: 'AMERICA', etiqueta: 'América' },
  { id: 'CHILE', etiqueta: 'Chile' },
];

const TIPOS_CONTENEDOR_OPCIONES = [
  { id: '40HC', etiqueta: '40 High Cube (40HC) — 25 tn' },
  { id: '40', etiqueta: '40 Standard (40) — 25 tn' },
  { id: '20', etiqueta: '20 Standard (20) — 23 tn' },
  { id: '40RF', etiqueta: '40 Reefer (40RF) — 25 tn' },
];

export default function Puertos() {
  const { esAdmin } = useAuth();

  // --- Datos del servidor ---
  const [puertos, setPuertos] = useState([]);
  const [destinosCatalogo, setDestinosCatalogo] = useState([]);
  const [cargando, setCargando] = useState(true);

  // --- Filtros reactivos ---
  const [busqueda, setBusqueda] = useState('');
  const [filtroRegion, setFiltroRegion] = useState('TODAS');
  const [filtroEstado, setFiltroEstado] = useState('TODOS');

  // --- Alertas y notificaciones ---
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);

  // --- Estado de modales ---
  const [modalCrearAbierto, setModalCrearAbierto] = useState(false);
  const [puertoEnEdicion, setPuertoEnEdicion] = useState(null);
  const [puertoPorEliminar, setPuertoPorEliminar] = useState(null);
  const [guardando, setGuardando] = useState(false);

  // --- Formulario Nuevo Puerto ---
  const [nuevoForm, setNuevoForm] = useState({
    nombre: '',
    codigo: '',
    pais_origen: '',
    region: 'CHINA',
    incluirTarifa: true,
    puerto_destino_id: '',
    tipo_contenedor: '40HC',
    precio_usd: '2450',
    dias_viaje_base: '32',
    capacidad_max_tn: '25',
  });

  // --- Formulario Edicion ---
  const [editarForm, setEditarForm] = useState({
    nombre: '',
    codigo: '',
    pais_origen: '',
    region: 'CHINA',
  });

  // ==================================================================
  // Carga de datos
  // ==================================================================
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);

    try {
      const [resAdmin, resPublico] = await Promise.all([
        api.puertosAdmin(),
        api.puertos(),
      ]);

      setPuertos(resAdmin.datos ?? []);
      const destinos = resPublico?.datos?.destino ?? [];
      setDestinosCatalogo(destinos);

      // Preseleccionar primer destino chileno si existe
      if (destinos.length > 0) {
        const destinoChileno = destinos.find((d) => d.region === 'CHILE') ?? destinos[0];
        setNuevoForm((prev) => ({
          ...prev,
          puerto_destino_id: prev.puerto_destino_id || String(destinoChileno.id),
        }));
      }
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
  // Estadisticas de resumen
  // ==================================================================
  const metricas = useMemo(() => {
    const total = puertos.length;
    const conTarifaOrigen = puertos.filter((p) => Number(p.total_tarifas_origen) > 0).length;
    const conTarifaDestino = puertos.filter((p) => Number(p.total_tarifas_destino) > 0).length;
    const sinTarifas = total - conTarifaOrigen;
    const regionesUnicas = new Set(puertos.map((p) => p.region)).size;

    return { total, conTarifaOrigen, conTarifaDestino, sinTarifas, regionesUnicas };
  }, [puertos]);

  // ==================================================================
  // Filtrado de la lista
  // ==================================================================
  const puertosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase();

    return puertos.filter((p) => {
      // Filtro por region
      if (filtroRegion !== 'TODAS' && p.region !== filtroRegion) return false;

      // Filtro por estado de tarifas
      const tieneTarifa = Number(p.total_tarifas_origen) > 0;
      if (filtroEstado === 'CON_TARIFA' && !tieneTarifa) return false;
      if (filtroEstado === 'SIN_TARIFA' && tieneTarifa) return false;

      // Busqueda por texto
      if (termino) {
        const enNombre = p.nombre.toLowerCase().includes(termino);
        const enCodigo = p.codigo.toLowerCase().includes(termino);
        const enPais = p.pais_origen.toLowerCase().includes(termino);
        if (!enNombre && !enCodigo && !enPais) return false;
      }

      return true;
    });
  }, [puertos, busqueda, filtroRegion, filtroEstado]);

  // ==================================================================
  // Handlers para Crear
  // ==================================================================
  function abrirModalCrear() {
    setError(null);
    setExito(null);
    const primerDestino = destinosCatalogo.find((d) => d.region === 'CHILE') ?? destinosCatalogo[0];

    setNuevoForm({
      nombre: '',
      codigo: '',
      pais_origen: '',
      region: 'CHINA',
      incluirTarifa: true,
      puerto_destino_id: primerDestino ? String(primerDestino.id) : '',
      tipo_contenedor: '40HC',
      precio_usd: '2450',
      dias_viaje_base: '32',
      capacidad_max_tn: '25',
    });
    setModalCrearAbierto(true);
  }

  async function manejarCrear(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);

    try {
      const payload = {
        nombre: nuevoForm.nombre.trim(),
        codigo: nuevoForm.codigo.trim().toUpperCase(),
        pais_origen: nuevoForm.pais_origen.trim(),
        region: nuevoForm.region,
      };

      if (nuevoForm.incluirTarifa && nuevoForm.puerto_destino_id) {
        payload.tarifa_inicial = {
          puerto_destino_id: Number(nuevoForm.puerto_destino_id),
          tipo_contenedor: nuevoForm.tipo_contenedor,
          precio_usd: Number(nuevoForm.precio_usd),
          dias_viaje_base: Number(nuevoForm.dias_viaje_base),
          capacidad_max_tn: Number(nuevoForm.capacidad_max_tn || 25),
        };
      }

      const respuesta = await api.crearPuerto(payload);
      setModalCrearAbierto(false);
      setExito(respuesta.mensaje || `Puerto "${payload.nombre}" creado exitosamente.`);
      await cargar();
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle });
    } finally {
      setGuardando(false);
    }
  }

  // ==================================================================
  // Handlers para Editar
  // ==================================================================
  function abrirModalEditar(puerto) {
    setError(null);
    setExito(null);
    setPuertoEnEdicion(puerto);
    setEditarForm({
      nombre: puerto.nombre,
      codigo: puerto.codigo,
      pais_origen: puerto.pais_origen,
      region: puerto.region,
    });
  }

  async function manejarEditar(e) {
    e.preventDefault();
    if (!puertoEnEdicion) return;

    setError(null);
    setGuardando(true);

    try {
      const payload = {
        nombre: editarForm.nombre.trim(),
        codigo: editarForm.codigo.trim().toUpperCase(),
        pais_origen: editarForm.pais_origen.trim(),
        region: editarForm.region,
      };

      const respuesta = await api.actualizarPuerto(puertoEnEdicion.id, payload);
      setPuertoEnEdicion(null);
      setExito(respuesta.mensaje || `Puerto "${payload.nombre}" actualizado.`);
      await cargar();
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle });
    } finally {
      setGuardando(false);
    }
  }

  // ==================================================================
  // Handlers para Eliminar
  // ==================================================================
  async function confirmarEliminacion() {
    if (!puertoPorEliminar) return;

    setError(null);
    setGuardando(true);

    try {
      const respuesta = await api.eliminarPuerto(puertoPorEliminar.id);
      setPuertoPorEliminar(null);
      setExito(respuesta.mensaje || `Puerto "${puertoPorEliminar.nombre}" eliminado.`);
      await cargar();
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="contenedor">
      {/* ================= ENCABEZADO DE PAGINA MODERNO ================= */}
      <div className="puertos-encabezado">
        <div className="puertos-encabezado__info">
          <h1 className="puertos-encabezado__titulo">
            <span className="puertos-encabezado__icono" aria-hidden="true">⚓</span>
            Mantenedor de Puertos
          </h1>
          <p className="puertos-encabezado__desc">
            Administración del catálogo de puertos de origen y destino. Permite dar de alta
            nuevas terminales marítimas y habilitarlas de inmediato para el cotizador.
          </p>
        </div>

        <div className="puertos-encabezado__acciones">
          <Insignia variante="admin">Jefatura Comex</Insignia>
          <button
            type="button"
            className="boton boton--principal"
            onClick={abrirModalCrear}
            style={{ boxShadow: 'var(--sombra-terracota)' }}
          >
            <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>+</span> Nuevo Puerto de Origen
          </button>
        </div>
      </div>

      {/* ================= AVISOS ================= */}
      {error && (
        <Alerta
          tipo="error"
          titulo="Error en la operación"
          detalle={error.detalle}
          onCerrar={() => setError(null)}
        >
          {error.mensaje}
        </Alerta>
      )}

      {exito && (
        <Alerta tipo="exito" onCerrar={() => setExito(null)}>
          {exito}
        </Alerta>
      )}

      {/* ================= METRICAS MODERNAS EN REJILLA RESPONSIVE ================= */}
      <div className="rejilla-stats-moderna">
        <div className="stat-moderno">
          <div className="stat-moderno__icono stat-moderno__icono--naranjo">
            ⚓
          </div>
          <div className="stat-moderno__datos">
            <div className="stat-moderno__etiqueta">Total Puertos</div>
            <div className="stat-moderno__valor">{formatearEntero(metricas.total)}</div>
            <div className="stat-moderno__detalle">Catálogo en Neon DB</div>
          </div>
        </div>

        <div className="stat-moderno">
          <div className="stat-moderno__icono stat-moderno__icono--verde">
            🚢
          </div>
          <div className="stat-moderno__datos">
            <div className="stat-moderno__etiqueta">Orígenes con Tarifa</div>
            <div className="stat-moderno__valor">{formatearEntero(metricas.conTarifaOrigen)}</div>
            <div className="stat-moderno__detalle">Listos para cotizar</div>
          </div>
        </div>

        <div className="stat-moderno">
          <div className="stat-moderno__icono stat-moderno__icono--azul">
            📍
          </div>
          <div className="stat-moderno__datos">
            <div className="stat-moderno__etiqueta">Destinos Operativos</div>
            <div className="stat-moderno__valor">{formatearEntero(metricas.conTarifaDestino)}</div>
            <div className="stat-moderno__detalle">Chile y Callao (Perú)</div>
          </div>
        </div>

        <div className="stat-moderno">
          <div className="stat-moderno__icono stat-moderno__icono--morado">
            🌐
          </div>
          <div className="stat-moderno__datos">
            <div className="stat-moderno__etiqueta">Regiones Activas</div>
            <div className="stat-moderno__valor">{formatearEntero(metricas.regionesUnicas)}</div>
            <div className="stat-moderno__detalle">Asia, Europa, América, Chile</div>
          </div>
        </div>
      </div>

      {/* ================= TARJETA PRINCIPAL CON FILTROS Y TABLA ================= */}
      <div className="tarjeta" style={{ overflow: 'hidden' }}>
        {/* Barra de Filtros */}
        <div className="barra-filtros-puertos">
          <div className="barra-filtros-puertos__fila">
            {/* Buscador interactivo */}
            <div className="buscador-puertos-wrapper">
              <span className="buscador-icono" aria-hidden="true">🔍</span>
              <input
                type="search"
                className="control"
                placeholder="Buscar por puerto, país o código UN/LOCODE..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>

            {/* Selector de Region */}
            <div style={{ minWidth: '170px' }}>
              <select
                className="control"
                value={filtroRegion}
                onChange={(e) => setFiltroRegion(e.target.value)}
                style={{ fontSize: 'var(--texto-xs)', height: '38px' }}
              >
                <option value="TODAS">Todas las regiones</option>
                {REGIONES_OPCIONES.map((reg) => (
                  <option key={reg.id} value={reg.id}>
                    {reg.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Segunda fila: Filtros rápidos tipo Pills y contador */}
          <div className="barra-filtros-puertos__fila" style={{ marginTop: 'var(--esp-1)' }}>
            <div className="barra-filtros-puertos__pills">
              <button
                type="button"
                className={`filtro-pill ${filtroEstado === 'TODOS' ? 'filtro-pill--activo' : ''}`}
                onClick={() => setFiltroEstado('TODOS')}
              >
                Todos ({metricas.total})
              </button>
              <button
                type="button"
                className={`filtro-pill ${filtroEstado === 'CON_TARIFA' ? 'filtro-pill--activo' : ''}`}
                onClick={() => setFiltroEstado('CON_TARIFA')}
              >
                Listos para cotizar ({metricas.conTarifaOrigen})
              </button>
              <button
                type="button"
                className={`filtro-pill ${filtroEstado === 'SIN_TARIFA' ? 'filtro-pill--activo' : ''}`}
                onClick={() => setFiltroEstado('SIN_TARIFA')}
              >
                Sin tarifas ({metricas.sinTarifas})
              </button>
            </div>

            <div style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-claro)', fontWeight: 600 }}>
              Mostrando {puertosFiltrados.length} de {puertos.length} puertos
            </div>
          </div>
        </div>

        {cargando ? (
          <Cargador texto="Cargando catálogo de puertos..." />
        ) : puertosFiltrados.length === 0 ? (
          <Vacio
            icono="⚓"
            titulo="No se encontraron puertos"
          >
            {busqueda || filtroRegion !== 'TODAS' || filtroEstado !== 'TODOS'
              ? 'No hay registros que coincidan con los criterios de búsqueda o filtros aplicados.'
              : 'No hay puertos registrados en la base de datos.'}
          </Vacio>
        ) : (
          <>
            {/* ===== VISTA DE ESCRITORIO: TABLA MODERNA ===== */}
            <div className="tabla-envoltorio tabla-envoltorio--escritorio">
              <table className="tabla--puertos">
                <thead>
                  <tr>
                    <th style={{ width: '120px' }}>Código</th>
                    <th>Puerto y País</th>
                    <th>Región</th>
                    <th>Tarifas de Origen</th>
                    <th>Tarifas de Destino</th>
                    <th style={{ textAlign: 'center', width: '110px' }}>Cotizaciones</th>
                    <th style={{ textAlign: 'right', width: '170px' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {puertosFiltrados.map((p) => {
                    const tarifasOrigen = Number(p.total_tarifas_origen || 0);
                    const tarifasDestino = Number(p.total_tarifas_destino || 0);
                    const cotizaciones = Number(p.total_cotizaciones || 0);
                    const tieneHistorial = cotizaciones > 0;

                    return (
                      <tr key={p.id}>
                        <td>
                          <span className="badge-codigo-locode">{p.codigo}</span>
                        </td>
                        <td>
                          <div className="puerto-celda-nombre">
                            <strong>{p.nombre}</strong>
                            <span className="puerto-celda-pais">
                              <span style={{ opacity: 0.6 }}>📍</span> {p.pais_origen}
                            </span>
                          </div>
                        </td>
                        <td>
                          <Insignia variante={claseRegion(p.region)}>
                            {REGIONES[p.region] ?? p.region}
                          </Insignia>
                        </td>
                        <td>
                          {tarifasOrigen > 0 ? (
                            <span className="tarifa-badge-status tarifa-badge-status--activo">
                              <span className="tarifa-badge-punto tarifa-badge-punto--verde" />
                              {tarifasOrigen} {tarifasOrigen === 1 ? 'ruta vigente' : 'rutas vigentes'}
                            </span>
                          ) : (
                            <span className="tarifa-badge-status tarifa-badge-status--inactivo">
                              <span className="tarifa-badge-punto tarifa-badge-punto--naranjo" />
                              Sin tarifas (inactivo)
                            </span>
                          )}
                        </td>
                        <td>
                          {tarifasDestino > 0 ? (
                            <span style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-medio)', fontWeight: 600 }}>
                              {tarifasDestino} destino(s)
                            </span>
                          ) : (
                            <span style={{ color: 'var(--gris-humo)', fontSize: 'var(--texto-xs)' }}>
                              —
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {tieneHistorial ? (
                            <span
                              className="insignia insignia--neutro"
                              style={{ fontWeight: 700 }}
                              title="Cotizaciones registradas en la bitácora contable"
                            >
                              {cotizaciones}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--gris-humo)', fontSize: 'var(--texto-xs)' }}>
                              0
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="acciones-puerto">
                            <button
                              type="button"
                              className="boton-accion"
                              onClick={() => abrirModalEditar(p)}
                              title="Editar datos del puerto"
                            >
                              ✏️ Editar
                            </button>

                            <button
                              type="button"
                              className="boton-accion boton-accion--peligro"
                              disabled={tieneHistorial}
                              title={
                                tieneHistorial
                                  ? 'No se puede eliminar: el puerto está referenciado en cotizaciones contables históricas.'
                                  : 'Eliminar este puerto'
                              }
                              onClick={() => setPuertoPorEliminar(p)}
                            >
                              🗑️ Eliminar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ===== VISTA MOVIL: TARJETAS RESPONSIVE (PANTALLAS <= 820px) ===== */}
            <div className="rejilla-puertos-movil">
              {puertosFiltrados.map((p) => {
                const tarifasOrigen = Number(p.total_tarifas_origen || 0);
                const cotizaciones = Number(p.total_cotizaciones || 0);
                const tieneHistorial = cotizaciones > 0;

                return (
                  <div key={p.id} className="puerto-tarjeta-movil">
                    <div className="puerto-tarjeta-movil__cabecera">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--esp-2)', marginBottom: '4px' }}>
                          <span className="badge-codigo-locode">{p.codigo}</span>
                          <strong style={{ fontSize: 'var(--texto-md)' }}>{p.nombre}</strong>
                        </div>
                        <span style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-claro)' }}>
                          📍 {p.pais_origen}
                        </span>
                      </div>
                      <Insignia variante={claseRegion(p.region)}>
                        {REGIONES[p.region] ?? p.region}
                      </Insignia>
                    </div>

                    <div className="puerto-tarjeta-movil__detalles">
                      <div>
                        <div style={{ color: 'var(--gris-claro)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                          Estado Tarifas
                        </div>
                        <div style={{ marginTop: '2px' }}>
                          {tarifasOrigen > 0 ? (
                            <span style={{ color: 'var(--exito)', fontWeight: 700 }}>
                              ✓ {tarifasOrigen} ruta(s) activa(s)
                            </span>
                          ) : (
                            <span style={{ color: 'var(--advertencia)', fontWeight: 650 }}>
                              ⚠ Sin tarifas
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div style={{ color: 'var(--gris-claro)', fontSize: '0.7rem', textTransform: 'uppercase' }}>
                          Historial Comex
                        </div>
                        <div style={{ marginTop: '2px', fontWeight: 650 }}>
                          {cotizaciones} cotización(es)
                        </div>
                      </div>
                    </div>

                    <div className="puerto-tarjeta-movil__acciones">
                      <button
                        type="button"
                        className="boton boton--secundario boton--pequeno"
                        onClick={() => abrirModalEditar(p)}
                      >
                        ✏️ Editar
                      </button>

                      <button
                        type="button"
                        className="boton boton--peligro boton--pequeno"
                        disabled={tieneHistorial}
                        onClick={() => setPuertoPorEliminar(p)}
                        title={tieneHistorial ? 'No se puede eliminar: tiene cotizaciones' : 'Eliminar'}
                      >
                        🗑️ Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ================= MODAL: NUEVO PUERTO ================= */}
      {modalCrearAbierto && (
        <div
          className="modal-fondo"
          onClick={() => !guardando && setModalCrearAbierto(false)}
          role="presentation"
        >
          <div
            className="modal modal--amplio"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal__cabecera">
              <span style={{ fontSize: 'var(--texto-base)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⚓</span> Agregar Nuevo Puerto de Origen
              </span>
            </div>

            <form onSubmit={manejarCrear}>
              <div className="modal__cuerpo" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-4)' }}>
                <p style={{ margin: 0, fontSize: 'var(--texto-sm)', color: 'var(--gris-medio)', lineHeight: 1.4 }}>
                  Ingrese los datos oficiales de la terminal portuaria. Puede configurar de inmediato
                  una tarifa inicial hacia Chile para que quede disponible en el Cotizador.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--esp-3)' }}>
                  <Campo etiqueta="Nombre del Puerto" htmlFor="nuevo-nombre" requerido>
                    <input
                      id="nuevo-nombre"
                      type="text"
                      className="control"
                      placeholder="Ej. Ningbo, Busan, Santos"
                      value={nuevoForm.nombre}
                      onChange={(e) => setNuevoForm({ ...nuevoForm, nombre: e.target.value })}
                      required
                    />
                  </Campo>

                  <Campo
                    etiqueta="Código UN/LOCODE"
                    htmlFor="nuevo-codigo"
                    requerido
                    ayuda="Código internacional (ej. CNNGB)"
                  >
                    <input
                      id="nuevo-codigo"
                      type="text"
                      className="control"
                      placeholder="Ej. CNNGB"
                      maxLength={12}
                      value={nuevoForm.codigo}
                      onChange={(e) => setNuevoForm({ ...nuevoForm, codigo: e.target.value.toUpperCase() })}
                      required
                    />
                  </Campo>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--esp-3)' }}>
                  <Campo etiqueta="País de Origen" htmlFor="nuevo-pais" requerido>
                    <input
                      id="nuevo-pais"
                      type="text"
                      className="control"
                      placeholder="Ej. China, Corea del Sur, Brasil"
                      value={nuevoForm.pais_origen}
                      onChange={(e) => setNuevoForm({ ...nuevoForm, pais_origen: e.target.value })}
                      required
                    />
                  </Campo>

                  <Campo etiqueta="Región Geográfica" htmlFor="nuevo-region" requerido>
                    <select
                      id="nuevo-region"
                      className="control"
                      value={nuevoForm.region}
                      onChange={(e) => setNuevoForm({ ...nuevoForm, region: e.target.value })}
                    >
                      {REGIONES_OPCIONES.map((reg) => (
                        <option key={reg.id} value={reg.id}>
                          {reg.etiqueta}
                        </option>
                      ))}
                    </select>
                  </Campo>
                </div>

                {/* Caja de Tarifa Inicial */}
                <div className="caja-tarifa-inicial">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--esp-2)', cursor: 'pointer', fontWeight: 650 }}>
                    <input
                      type="checkbox"
                      checked={nuevoForm.incluirTarifa}
                      onChange={(e) => setNuevoForm({ ...nuevoForm, incluirTarifa: e.target.checked })}
                    />
                    <span>Activar inmediatamente en Cotizador con tarifa inicial</span>
                  </label>

                  {nuevoForm.incluirTarifa ? (
                    <div style={{ marginTop: 'var(--esp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--esp-3)' }}>
                      <Campo etiqueta="Puerto de Destino (Llegada)" htmlFor="tarifa-destino" requerido>
                        <select
                          id="tarifa-destino"
                          className="control"
                          value={nuevoForm.puerto_destino_id}
                          onChange={(e) => setNuevoForm({ ...nuevoForm, puerto_destino_id: e.target.value })}
                          required={nuevoForm.incluirTarifa}
                        >
                          <option value="">Seleccione puerto de llegada...</option>
                          {destinosCatalogo.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.nombre} ({d.pais_origen}) [{d.codigo}]
                            </option>
                          ))}
                        </select>
                      </Campo>

                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 'var(--esp-3)' }}>
                        <Campo etiqueta="Tipo Contenedor" htmlFor="tarifa-tipo">
                          <select
                            id="tarifa-tipo"
                            className="control"
                            value={nuevoForm.tipo_contenedor}
                            onChange={(e) => {
                              const tipo = e.target.value;
                              const capacidad = tipo === '20' ? '23' : '25';
                              setNuevoForm({
                                ...nuevoForm,
                                tipo_contenedor: tipo,
                                capacidad_max_tn: capacidad,
                              });
                            }}
                          >
                            {TIPOS_CONTENEDOR_OPCIONES.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.etiqueta}
                              </option>
                            ))}
                          </select>
                        </Campo>

                        <Campo etiqueta="Tarifa Flete" htmlFor="tarifa-precio" requerido sufijo="USD">
                          <input
                            id="tarifa-precio"
                            type="number"
                            min="1"
                            step="1"
                            className="control"
                            value={nuevoForm.precio_usd}
                            onChange={(e) => setNuevoForm({ ...nuevoForm, precio_usd: e.target.value })}
                            required={nuevoForm.incluirTarifa}
                          />
                        </Campo>

                        <Campo etiqueta="Días Tránsito" htmlFor="tarifa-dias" requerido sufijo="días">
                          <input
                            id="tarifa-dias"
                            type="number"
                            min="1"
                            max="180"
                            className="control"
                            value={nuevoForm.dias_viaje_base}
                            onChange={(e) => setNuevoForm({ ...nuevoForm, dias_viaje_base: e.target.value })}
                            required={nuevoForm.incluirTarifa}
                          />
                        </Campo>
                      </div>
                    </div>
                  ) : (
                    <p style={{ margin: 'var(--esp-2) 0 0', fontSize: 'var(--texto-xs)', color: 'var(--gris-claro)' }}>
                      El puerto quedará registrado en el catálogo pero inactivo en el Cotizador hasta
                      que le asigne una tarifa de ruta en la sección de Tarifas.
                    </p>
                  )}
                </div>
              </div>

              <div className="modal__pie">
                <button
                  type="button"
                  className="boton boton--secundario"
                  onClick={() => setModalCrearAbierto(false)}
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="boton boton--principal"
                  disabled={guardando}
                >
                  {guardando ? <span className="boton__spinner" /> : 'Guardar Puerto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: EDITAR PUERTO ================= */}
      {puertoEnEdicion && (
        <div
          className="modal-fondo"
          onClick={() => !guardando && setPuertoEnEdicion(null)}
          role="presentation"
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal__cabecera">
              <span style={{ fontSize: 'var(--texto-base)', fontWeight: 700 }}>
                Editar Puerto: {puertoEnEdicion.nombre}
              </span>
            </div>

            <form onSubmit={manejarEditar}>
              <div className="modal__cuerpo" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-3)' }}>
                <Campo etiqueta="Nombre del Puerto" htmlFor="editar-nombre" requerido>
                  <input
                    id="editar-nombre"
                    type="text"
                    className="control"
                    value={editarForm.nombre}
                    onChange={(e) => setEditarForm({ ...editarForm, nombre: e.target.value })}
                    required
                  />
                </Campo>

                <Campo etiqueta="Código UN/LOCODE" htmlFor="editar-codigo" requerido>
                  <input
                    id="editar-codigo"
                    type="text"
                    className="control"
                    maxLength={12}
                    value={editarForm.codigo}
                    onChange={(e) => setEditarForm({ ...editarForm, codigo: e.target.value.toUpperCase() })}
                    required
                  />
                </Campo>

                <Campo etiqueta="País" htmlFor="editar-pais" requerido>
                  <input
                    id="editar-pais"
                    type="text"
                    className="control"
                    value={editarForm.pais_origen}
                    onChange={(e) => setEditarForm({ ...editarForm, pais_origen: e.target.value })}
                    required
                  />
                </Campo>

                <Campo etiqueta="Región Geográfica" htmlFor="editar-region" requerido>
                  <select
                    id="editar-region"
                    className="control"
                    value={editarForm.region}
                    onChange={(e) => setEditarForm({ ...editarForm, region: e.target.value })}
                  >
                    {REGIONES_OPCIONES.map((reg) => (
                      <option key={reg.id} value={reg.id}>
                        {reg.etiqueta}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>

              <div className="modal__pie">
                <button
                  type="button"
                  className="boton boton--secundario"
                  onClick={() => setPuertoEnEdicion(null)}
                  disabled={guardando}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="boton boton--principal"
                  disabled={guardando}
                >
                  {guardando ? <span className="boton__spinner" /> : 'Guardar Cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: CONFIRMACION DE BORRADO ================= */}
      {puertoPorEliminar && (
        <ModalConfirmacion
          titulo="Eliminar Puerto del Catálogo"
          textoConfirmar="Eliminar Puerto"
          peligro
          cargando={guardando}
          onConfirmar={confirmarEliminacion}
          onCancelar={() => setPuertoPorEliminar(null)}
        >
          <p>
            ¿Está seguro de que desea eliminar el puerto{' '}
            <strong>{puertoPorEliminar.nombre} ({puertoPorEliminar.codigo})</strong>?
          </p>
          <p style={{ marginTop: '0.5rem', color: 'var(--gris-claro)', fontSize: 'var(--texto-xs)' }}>
            Esta acción eliminará el puerto y sus tarifas asociadas si no posee cotizaciones
            históricas registradas.
          </p>
        </ModalConfirmacion>
      )}
    </div>
  );
}
