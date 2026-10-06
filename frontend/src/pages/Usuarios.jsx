/**
 * pages/Usuarios.jsx
 * -----------------------------------------------------------------
 * Administracion de cuentas, restringida a ADMIN_COMEX.
 *
 * Dos decisiones que conviene tener presentes al leer el codigo:
 *
 *  1. NINGUN control de seguridad vive aqui. La pantalla oculta los botones
 *     que no corresponden, pero la razon de eso es la legibilidad, no la
 *     seguridad: un analista puede llamar a /usuarios igual y el backend le
 *     responde 403 en `soloAdmin`. Si se llegara a quitar un boton "para
 *     proteger" el sistema, lo unico que se obtiene es una interfaz que no
 *     corresponde con lo que el servidor realmente permite.
 *
 *  2. La baja es una DESACTIVACION. Ningun boton dice "eliminar" porque no
 *     borra nada: la cuenta queda con `activo = false`, conserva su historial
 *     de cotizaciones y se puede revertir desde esta misma pantalla.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Alerta, Campo, Cargador, Insignia, ModalConfirmacion, Stat, Vacio } from '../components/Comunes';

/** Etiquetas legibles para la bitacora. */
const ETIQUETA_ACCION = {
  REGISTRO: { texto: 'Alta', variante: 'info' },
  CAMBIAR_ROL: { texto: 'Cambio de rol', variante: 'acento' },
  DESACTIVAR: { texto: 'Desactivacion', variante: 'advertencia' },
  ACTIVAR: { texto: 'Reactivacion', variante: 'exito' },
};

/** Une una fecha de la base con la zona horaria del navegador. */
function fechaLegible(valor) {
  if (!valor) return '—';
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? '—'
    : fecha.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function Usuarios() {
  const { usuario: sesion, esAdmin, cargando } = useAuth();

  const [datos, setDatos] = useState(null);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  /** Id de la cuenta que se esta editando, para deshabilitar solo esa fila. */
  const [ocupado, setOcupado] = useState(null);

  /** Accion pendiente de confirmacion en el modal. */
  const [confirmacion, setConfirmacion] = useState(null);

  const cargar = useCallback(async () => {
    setCargandoLista(true);
    setError(null);
    try {
      const respuesta = await api.usuarios();
      setDatos(respuesta.datos);
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /**
   * Ordena el listado para dejar las cuentas activas arriba y las
   * desactivadas al final, sin perder el orden alfabetico dentro de cada
   * grupo. Un listado donde el estado no se ve de un vistazo obliga a leer
   * cada fila.
   */
  const usuarios = useMemo(() => {
    if (!datos?.usuarios) return [];
    return [...datos.usuarios].sort((a, b) => {
      if (a.activo !== b.activo) return a.activo ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }, [datos]);

  async function aplicar(cambio) {
    setOcupado(cambio.id);
    setError(null);
    setAviso(null);

    try {
      const respuesta = await cambio.ejecutar();
      setAviso(respuesta.mensaje);
      await cargar();
    } catch (fallo) {
      setError(fallo.message);
    } finally {
      setOcupado(null);
      setConfirmacion(null);
    }
  }

  function promover(usuario) {
    return {
      id: usuario.id,
      ejecutar: async () => {
        const r = await api.cambiarRol(usuario.id, 'ADMIN_COMEX');
        return r;
      },
    };
  }

  function degradar(usuario) {
    return {
      id: usuario.id,
      ejecutar: () => api.cambiarRol(usuario.id, 'ANALISTA'),
    };
  }

  function cambiarEstado(usuario, activo) {
    return {
      id: usuario.id,
      ejecutar: () => api.cambiarActivo(usuario.id, activo),
    };
  }

  // Sin sesion o sin permisos: no se intenta siquiera leer el listado. El
  // backend responderia 403 igual, pero es un viaje inútil y la pantalla
  // parpadearia entre "cargando" y "error".
  if (cargando) {
    return (
      <div className="pagina">
        <Cargador texto="Verificando permisos..." />
      </div>
    );
  }

  if (!esAdmin) {
    return <Navigate to="/cotizador" replace />;
  }

  return (
    <div className="pagina">
      <div className="pagina__cabecera">
        <div>
          <h1 className="pagina__titulo">Usuarios</h1>
          <p className="pagina__descripcion">
            Cuentas con acceso al cotizador. El alta de Analistas se hace desde la
            pantalla de registro con un codigo de invitacion; aqui se ajusta el rol
            y se desactiva el acceso.
          </p>
        </div>
      </div>

      {datos?.resumen && (
        <div className="rejilla-stats">
          <Stat etiqueta="Cuentas totales" valor={datos.resumen.total} />
          <Stat etiqueta="Activas" valor={datos.resumen.activos} variante="exito" />
          <Stat etiqueta="Desactivadas" valor={datos.resumen.inactivos} variante="advertencia" />
          <Stat
            etiqueta="Administradores"
            valor={datos.resumen.administradores}
            variante="acento"
            detalle={datos.resumen.administradores <= 1 ? 'Ultimo activo' : 'Con control total'}
          />
        </div>
      )}

      {error && (
        <Alerta tipo="error" titulo="No fue posible completar la operacion" onCerrar={() => setError(null)}>
          {error}
        </Alerta>
      )}

      {aviso && (
        <Alerta tipo="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alerta>
      )}

      <div className="tarjeta">
        {cargandoLista ? (
          <Cargador texto="Cargando cuentas..." />
        ) : usuarios.length === 0 ? (
          <Vacio icono="👤" titulo="Todavia no hay cuentas">
            Las cuentas creadas mediante el auto-registro apareceran aqui.
          </Vacio>
        ) : (
          <div className="tabla-envoltorio">
            <table className="tabla tabla--usuarios">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Alta</th>
                  <th className="tabla__acciones">Acciones</th>
                </tr>
              </thead>

              <tbody>
                {usuarios.map((usuario) => {
                  const esLaPropia = usuario.id === sesion?.id;
                  const enCurso = ocupado === usuario.id;

                  return (
                    <tr key={usuario.id} className={usuario.activo ? '' : 'tabla__fila--inactiva'}>
                      <td>
                        <div className="celda-usuario">
                          <span className="celda-usuario__nombre">
                            {usuario.nombre}
                            {esLaPropia && <span className="celda-usuario__propio"> (usted)</span>}
                          </span>
                          <span className="celda-usuario__correo">{usuario.email}</span>
                        </div>
                      </td>

                      <td>
                        <Insignia variante={usuario.rol === 'ADMIN_COMEX' ? 'acento' : 'neutro'}>
                          {usuario.rolNombre}
                        </Insignia>
                      </td>

                      <td>
                        <Insignia variante={usuario.activo ? 'exito' : 'neutro'}>
                          {usuario.activo ? 'Activa' : 'Desactivada'}
                        </Insignia>
                      </td>

                      <td className="celda-fecha">{fechaLegible(usuario.creado_en)}</td>

                      <td className="tabla__acciones">
                        {/* El boton no se oculta, se deshabilita con el motivo
                            visible. Es mas honesto que una pantalla donde la
                            accion simplemente no existe: quien pregunta por que
                            no puede tocar su propia cuenta obtiene respuesta. */}
                        <div className="acciones-fila">
                          {usuario.rol === 'ANALISTA' ? (
                            <button
                              type="button"
                              className="boton boton--secundario boton--pequeno"
                              disabled={esLaPropia || enCurso}
                              onClick={() => setConfirmacion({
                                usuario,
                                cambio: promover(usuario),
                                titulo: 'Promover a Administrador',
                                texto: 'Promover',
                                cuerpo: `${usuario.nombre} podra eliminar cotizaciones, cargar tarifas y administrar las cuentas del sistema.`,
                              })}
                            >
                              Promover
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="boton boton--secundario boton--pequeno"
                              disabled={esLaPropia || enCurso}
                              onClick={() => setConfirmacion({
                                usuario,
                                cambio: degradar(usuario),
                                titulo: 'Degradar a Analista',
                                texto: 'Degradar',
                                cuerpo: `${usuario.nombre} perdera el acceso al modulo de administracion y a las acciones de eliminacion.`,
                              })}
                            >
                              Degradar
                            </button>
                          )}

                          {usuario.activo ? (
                            <button
                              type="button"
                              className="boton boton--peligro boton--pequeno"
                              disabled={esLaPropia || enCurso}
                              onClick={() => setConfirmacion({
                                usuario,
                                cambio: cambiarEstado(usuario, false),
                                titulo: 'Desactivar la cuenta',
                                texto: 'Desactivar',
                                peligro: true,
                                cuerpo: `${usuario.nombre} no podra iniciar sesion. Su historial de cotizaciones se conserva intacto y la cuenta puede reactivarse mas tarde.`,
                              })}
                            >
                              Desactivar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="boton boton--secundario boton--pequeno"
                              disabled={enCurso}
                              onClick={() => setConfirmacion({
                                usuario,
                                cambio: cambiarEstado(usuario, true),
                                titulo: 'Reactivar la cuenta',
                                texto: 'Reactivar',
                                cuerpo: `${usuario.nombre} volvera a poder iniciar sesion con las mismas credenciales.`,
                              })}
                            >
                              Reactivar
                            </button>
                          )}
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

      {/* La bitacora se muestra aparte, como tabla completa. Ponerla en una
          fila desplegable mezclaria fechas de alta con fechas de accion y la
          lectura seria mucho mas lenta. */}
      <div className="tarjeta">
        <h2 className="tarjeta__titulo">Bitacora de accesos</h2>

        {cargandoLista ? null : datos?.usuarios?.length === 0 ? (
          <p className="tarjeta__texto">Sin registros.</p>
        ) : (
          <div className="tabla-envoltorio">
            <table className="tabla tabla--bitacora">
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Accion</th>
                  <th>Detalle</th>
                  <th>Ejecutada por</th>
                  <th>Fecha</th>
                </tr>
              </thead>

              <tbody>
                {usuarios.flatMap((usuario) =>
                  (usuario.auditoria ?? []).map((evento) => {
                    const etiqueta = ETIQUETA_ACCION[evento.accion] ?? {
                      texto: evento.accion,
                      variante: 'neutro',
                    };

                    return (
                      <tr key={`${usuario.id}-${evento.id}`}>
                        <td>
                          <div className="celda-usuario">
                            <span className="celda-usuario__nombre">{usuario.nombre}</span>
                            <span className="celda-usuario__correo">{usuario.email}</span>
                          </div>
                        </td>

                        <td>
                          <Insignia variante={etiqueta.variante}>{etiqueta.texto}</Insignia>
                        </td>

                        <td className="celda-detalle">{evento.detalle ?? '—'}</td>

                        <td>
                          {evento.administrador_email ? (
                            <span className="celda-actor">{evento.administrador_email}</span>
                          ) : (
                            <span className="celda-actor celda-actor--sistema">
                              Auto-registro
                            </span>
                          )}
                        </td>

                        <td className="celda-fecha">{fechaLegible(evento.creado_en)}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>

            {usuarios.every((u) => (u.auditoria ?? []).length === 0) && (
              <p className="tarjeta__texto">Todavia no hay acciones registradas.</p>
            )}
          </div>
        )}
      </div>

      {confirmacion && (
        <ModalConfirmacion
          titulo={confirmacion.titulo}
          textoConfirmar={confirmacion.texto}
          peligro={confirmacion.peligro}
          cargando={ocupado === confirmacion.cambio.id}
          onCancelar={() => setConfirmacion(null)}
          onConfirmar={() => aplicar(confirmacion.cambio)}
        >
          <p>{confirmacion.cuerpo}</p>
          <p className="modal__nota">
            Esta accion queda registrada en la bitacora con su fecha y responsable.
          </p>
        </ModalConfirmacion>
      )}
    </div>
  );
}