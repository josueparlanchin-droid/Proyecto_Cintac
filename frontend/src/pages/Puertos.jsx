/**
 * pages/Puertos.jsx
 * -----------------------------------------------------------------
 * Mantenedor de puertos del catalogo (origen y destino).
 * Reservado exclusivamente para Jefatura Comex (ADMIN_COMEX).
 *
 * Permite:
 *  1. Visualizar todos los puertos registrados con metricas de tarifas y cotizaciones.
 *  2. Agregar nuevos puertos de origen (o destino) con codigo UN/LOCODE.
 *  3. Configurar opcionalmente una tarifa inicial para que el puerto quede activo
 *     y disponible para cotizar de inmediato en el formulario principal.
 *  4. Modificar datos basicos de puertos existentes.
 *  5. Eliminar puertos no referenciados en cotizaciones historicas
 *     (proteccion estricta de integridad contable y auditoria).
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
  Stat,
  Vacio,
} from '../components/Comunes';
import {
  REGIONES,
  claseRegion,
  formatearEntero,
  formatearUSD,
} from '../utils/formato';

const REGIONES_OPCIONES = [
  { id: 'CHINA', etiqueta: 'Asia - China' },
  { id: 'EUROPA', etiqueta: 'Europa' },
  { id: 'AMERICA', etiqueta: 'America' },
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

  // --- Filtros ---
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
    const regionesUnicas = new Set(puertos.map((p) => p.region)).size;

    return { total, conTarifaOrigen, conTarifaDestino, regionesUnicas };
  }, [puertos]);

  // ==================================================================
  // Filtrado de la tabla
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
      {/* ================= ENCABEZADO DE PAGINA ================= */}
      <div className="encabezado-seccion">
        <div>
          <h1 className="encabezado-seccion__titulo">Mantenedor de Puertos</h1>
          <p className="encabezado-seccion__subtitulo">
            Gestion del catalogo de puertos de origen y destino. Permite dar de alta
            nuevos puertos para cotizaciones de importacion Comex.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--esp-3)', alignItems: 'center' }}>
          <Insignia variante="admin">Acceso exclusivo Jefatura Comex</Insignia>
          <button
            type="button"
            className="boton boton--principal"
            onClick={abrirModalCrear}
          >
            + Nuevo Puerto de Origen
          </button>
        </div>
      </div>

      {/* ================= AVISOS ================= */}
      {error && (
        <Alerta
          tipo="error"
          titulo="Error en la operacion"
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

      {/* ================= METRICAS DEL CATALOGO ================= */}
      <div className="resumen-metricas">
        <Stat
          etiqueta="Total de Puertos"
          valor={formatearEntero(metricas.total)}
          detalle="Puertos en la base de datos"
          variante="neutro"
        />
        <Stat
          etiqueta="Origenes con Tarifa"
          valor={formatearEntero(metricas.conTarifaOrigen)}
          detalle="Disponibles en el Cotizador"
          variante="exito"
        />
        <Stat
          etiqueta="Destinos Operativos"
          valor={formatearEntero(metricas.conTarifaDestino)}
          detalle="Puertos de llegada configurados"
          variante="info"
        />
        <Stat
          etiqueta="Regiones Cubiertas"
          valor={formatearEntero(metricas.regionesUnicas)}
          detalle="China, Europa, America, Chile"
          variante="acento"
        />
      </div>

      {/* ================= TABLA Y FILTROS ================= */}
      <div className="tarjeta">
        <div className="tarjeta__encabezado" style={{ flexDirection: 'column', gap: 'var(--esp-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <h2 className="tarjeta__titulo" style={{ margin: 0, border: 'none' }}>
              Catálogo de Puertos Registrados
            </h2>
            <span style={{ fontSize: 'var(--texto-xs)', color: 'var(--gris-claro)' }}>
              Mostrando {puertosFiltrados.length} de {puertos.length} puertos
            </span>
          </div>

          {/* Barra de filtros */}
          <div
            style={{
              display: 'flex',
              gap: 'var(--esp-3)',
              width: '100%',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <div style={{ flex: '1 1 240px', minWidth: '220px' }}>
              <input
                type="search"
                className="control"
                placeholder="Buscar por nombre, código UN/LOCODE o país..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>

            <div style={{ minWidth: '160px' }}>
              <select
                className="control"
                value={filtroRegion}
                onChange={(e) => setFiltroRegion(e.target.value)}
              >
                <option value="TODAS">Todas las regiones</option>
                {REGIONES_OPCIONES.map((reg) => (
                  <option key={reg.id} value={reg.id}>
                    {reg.etiqueta}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ minWidth: '170px' }}>
              <select
                className="control"
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
              >
                <option value="TODOS">Todos los estados</option>
                <option value="CON_TARIFA">Listos para cotizar</option>
                <option value="SIN_TARIFA">Sin tarifas asignadas</option>
              </select>
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
              ? 'No hay puertos que coincidan con los filtros aplicados.'
              : 'No hay puertos registrados en el sistema.'}
          </Vacio>
        ) : (
          <div className="tabla-envoltorio">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Puerto</th>
                  <th>País</th>
                  <th>Región</th>
                  <th>Tarifas de Origen</th>
                  <th>Tarifas de Destino</th>
                  <th style={{ textAlign: 'center' }}>Cotizaciones</th>
                  <th style={{ textAlign: 'right' }}>Acciones</th>
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
                        <code className="codigo-locode">{p.codigo}</code>
                      </td>
                      <td>
                        <strong>{p.nombre}</strong>
                      </td>
                      <td>{p.pais_origen}</td>
                      <td>
                        <Insignia variante={claseRegion(p.region)}>
                          {REGIONES[p.region] ?? p.region}
                        </Insignia>
                      </td>
                      <td>
                        {tarifasOrigen > 0 ? (
                          <Insignia variante="exito">
                            {tarifasOrigen} {tarifasOrigen === 1 ? 'ruta vigente' : 'rutas vigentes'}
                          </Insignia>
                        ) : (
                          <Insignia variante="advertencia">Sin tarifas (inactivo)</Insignia>
                        )}
                      </td>
                      <td>
                        {tarifasDestino > 0 ? (
                          <span style={{ fontSize: 'var(--texto-sm)' }}>
                            {tarifasDestino} destino(s)
                          </span>
                        ) : (
                          <span style={{ color: 'var(--gris-claro)', fontSize: 'var(--texto-sm)' }}>
                            —
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {tieneHistorial ? (
                          <span className="tabla__numero" title="Cotizaciones registradas">
                            {cotizaciones}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--gris-claro)', fontSize: 'var(--texto-sm)' }}>
                            0
                          </span>
                        )}
                      </td>
                      <td className="tabla__acciones">
                        <div className="acciones-fila" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="boton boton--secundario boton--pequeno"
                            onClick={() => abrirModalEditar(p)}
                          >
                            Editar
                          </button>

                          <button
                            type="button"
                            className="boton boton--peligro boton--pequeno"
                            disabled={tieneHistorial}
                            title={
                              tieneHistorial
                                ? 'No se puede eliminar: el puerto está referenciado en cotizaciones históricas contables.'
                                : 'Eliminar puerto del catálogo'
                            }
                            onClick={() => setPuertoPorEliminar(p)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
              <span style={{ fontSize: 'var(--texto-base)', fontWeight: 700 }}>
                Agregar Nuevo Puerto de Origen
              </span>
            </div>

            <form onSubmit={manejarCrear}>
              <div className="modal__cuerpo" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--esp-4)' }}>
                <p style={{ margin: 0, fontSize: 'var(--texto-sm)', color: 'var(--gris-medio)' }}>
                  Ingrese los datos oficiales del puerto. Para que esté disponible inmediatamente en
                  el cotizador, puede configurar una tarifa de flete inicial.
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
                    ayuda="5 caracteres estándar internacional"
                  >
                    <input
                      id="nuevo-codigo"
                      type="text"
                      className="control"
                      placeholder="Ej. CNNGB, KRPUS"
                      maxLength={12}
                      value={nuevoForm.codigo}
                      onChange={(e) => setNuevoForm({ ...nuevoForm, codigo: e.target.value.toUpperCase() })}
                      required
                    />
                  </Campo>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--esp-3)' }}>
                  <Campo etiqueta="País" htmlFor="nuevo-pais" requerido>
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
                    <span>Configurar tarifa inicial para activar de inmediato en el Cotizador</span>
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
                          <option value="">Seleccione destino...</option>
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

                        <Campo etiqueta="Tarifa Flete (USD)" htmlFor="tarifa-precio" requerido sufijo="USD">
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
                      El puerto se guardará en el catálogo. Permanecerá inactivo en el Cotizador hasta
                      que cargue una planilla de tarifas o defina una ruta para él.
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
                  {guardando ? <span className="boton__spinner" /> : 'Actualizar'}
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
            Esta acción eliminará el puerto y las tarifas de ruta asociadas directamente. No se
            puede deshacer.
          </p>
        </ModalConfirmacion>
      )}
    </div>
  );
}
