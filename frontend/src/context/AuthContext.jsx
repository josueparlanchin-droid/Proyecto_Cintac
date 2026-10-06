/**
 * context/AuthContext.jsx
 * -----------------------------------------------------------------
 * Estado global de autenticacion.
 *
 * Entrega a toda la app: usuario, token, estado de carga y las acciones
 * iniciarSesion / cerrarSesion. Gracias a esto ninguna pantalla necesita
 * leer localStorage ni volver a preguntar por el token.
 *
 * PATRON: se usa el patron "provider + hook". Los componentes nunca
 * importan el objeto del contexto directamente, siempre llaman a useAuth().
 */

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, guardarToken, borrarToken, leerToken, ErrorApi } from '../api/client';

const ContextoAuth = createContext(null);

/**
 * @param {{children: React.ReactNode}} props
 */
export function ProveedorAuth({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  /**
   * Al montar la app se intenta recuperar la sesion.
   *
   * Sin esto, recargar la pagina expulsaria al usuario al login aunque su
   * token siga siendo valido: el token vive en localStorage, pero el estado
   * de React empieza vacio.
   */
  useEffect(() => {
    let vigente = true;

    async function rehidratar() {
      if (!leerToken()) {
        setCargando(false);
        return;
      }

      try {
        const { datos: perfil } = await api.perfil();
        if (vigente) setUsuario(perfil);
      } catch {
        // Token caducado o invalido: se limpia para no reintentar.
        if (vigente) {
          borrarToken();
          setUsuario(null);
        }
      } finally {
        if (vigente) setCargando(false);
      }
    }

    rehidratar();
    return () => {
      vigente = false;
    };
  }, []);

  /**
   * El cliente de la API emite este evento cuando la API responde 401.
   * Centralizarlo aqui evita duplicar el manejo en cada pantalla.
   */
  useEffect(() => {
    function alExpirar() {
      borrarToken();
      setUsuario(null);
    }

    window.addEventListener('cintac:sesion-expirada', alExpirar);
    return () => window.removeEventListener('cintac:sesion-expirada', alExpirar);
  }, []);

  const iniciarSesion = useCallback(async (email, password) => {
    const respuesta = await api.login(email, password);
    guardarToken(respuesta.datos.token);

    // Se pide el perfil completo para obtener tambien `permisos`, que
    // la UI usa para ocultar acciones no permitidas.
    const { datos: perfil } = await api.perfil();
    setUsuario(perfil);

    return perfil;
  }, []);

  /**
   * Alta de cuenta con codigo de invitacion.
   *
   * Reutiliza el mismo camino que `iniciarSesion` a proposito. La API ya
   * devuelve token en el registro, asi que la sesion queda abierta sin un
   * segundo viaje al servidor solo para consequences de permisos.
   */
  const registrar = useCallback(async (datos) => {
    const respuesta = await api.registro(datos);
    guardarToken(respuesta.datos.token);

    const { datos: perfil } = await api.perfil();
    setUsuario(perfil);

    return perfil;
  }, []);

  const cerrarSesion = useCallback(() => {
    borrarToken();
    setUsuario(null);
  }, []);

  /** Valor del contexto. `perfilado` deriva permisos para no repetirlos. */
  const valor = useMemo(
    () => ({
      usuario,
      cargando,
      autenticado: Boolean(usuario),
      esAdmin: usuario?.rol === 'ADMIN_COMEX',
      permisos: usuario?.permisos ?? null,
      iniciarSesion,
      registrar,
      cerrarSesion,
      ErrorApi,
    }),
    [usuario, cargando, iniciarSesion, registrar, cerrarSesion],
  );

  return <ContextoAuth.Provider value={valor}>{children}</ContextoAuth.Provider>;
}

/**
 * Hook de acceso al contexto de autenticacion.
 *
 * Lanza un error explicito si se usa fuera del proveedor: es un fallo de
 * programacion, no algo que pueda ocurrir en la navegacion normal.
 *
 * @returns {object}
 */
export function useAuth() {
  const contexto = useContext(ContextoAuth);

  if (!contexto) {
    throw new Error('useAuth() debe usarse dentro de <ProveedorAuth>.');
  }

  return contexto;
}

export default ProveedorAuth;