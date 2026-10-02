/**
 * components/RutaProtegida.jsx
 * -----------------------------------------------------------------
 * Guardia de rutas: impide ver el cotizador sin sesion iniciada.
 *
 * Es una segunda linea de defensa. La autorizacion real la aplica el
 * backend (que responde 401/403 sin importar que se haga la peticion);
 * esto solo evita mostrar una pantalla vacia al usuario.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Cargador } from './Comunes';

/**
 * @param {{children:React.ReactNode}} props
 */
export function RutaProtegida({ children }) {
  const { autenticado, cargando } = useAuth();
  const ubicacion = useLocation();

  // Mientras se rehidrata la sesion no se decide nada: sin este bloque, un
  // F5 en una pagina protegida expulsaria al usuario antes de tiempo.
  if (cargando) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Cargador texto="Verificando sesion..." />
      </div>
    );
  }

  if (!autenticado) {
    // `state.from` permite volver a la pagina que el usuario intentaba ver
    // despues de iniciar sesion.
    return <Navigate to="/login" replace state={{ desde: ubicacion.pathname }} />;
  }

  return children;
}

/**
 * Restringe una seccion a un rol concreto (por ejemplo, Tarifas).
 *
 * @param {{children:React.ReactNode, soloAdmin?:boolean}} props
 */
export function RutaPorRol({ children, soloAdmin = false }) {
  const { esAdmin } = useAuth();

  if (soloAdmin && !esAdmin) {
    return <Navigate to="/cotizador" replace />;
  }

  return children;
}

export default RutaProtegida;