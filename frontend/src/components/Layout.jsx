/**
 * components/Layout.jsx
 * -----------------------------------------------------------------
 * Estructura comun de las pantallas autenticadas: barra superior con
 * navegacion, datos del usuario en sesion y boton de salir.
 */

import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ROLES } from '../utils/formato';

/**
 * Las secciones visibles dependen del rol:
 * el Analista no ve "Tarifas" porque su accion esta reservada a Jefatura.
 */
const ENLACES = [
  { ruta: '/cotizador', etiqueta: 'Cotizador' },
  { ruta: '/historial', etiqueta: 'Historial' },
  { ruta: '/tarifas', etiqueta: 'Tarifas', soloAdmin: true },
];

export default function Layout() {
  const { usuario, cerrarSesion, esAdmin } = useAuth();
  const navegar = useNavigate();

  function salir() {
    cerrarSesion();
    navegar('/login', { replace: true });
  }

  const enlaces = ENLACES.filter((enlace) => !enlace.soloAdmin || esAdmin);

  return (
    <>
      <header className="barra">
        <div className="barra__contenido">
          <NavLink to="/cotizador" className="barra__marca">
            <span className="barra__logo" aria-hidden="true">C</span>
            <span>
              <span className="barra__titulo">Cintac S.A.</span>
              <span className="barra__subtitulo">Cotizador Logistico de Importaciones</span>
            </span>
          </NavLink>

          <nav className="barra__navegacion" aria-label="Navegacion principal">
            {enlaces.map((enlace) => (
              <NavLink
                key={enlace.ruta}
                to={enlace.ruta}
                className={({ isActive }) =>
                  `barra__enlace${isActive ? ' barra__enlace--activo' : ''}`
                }
              >
                {enlace.etiqueta}
              </NavLink>
            ))}

            <div className="barra__usuario">
              <div className="barra__datos">
                <span className="barra__nombre">{usuario?.nombre}</span>
                <span className="barra__rol">{ROLES[usuario?.rol] ?? usuario?.rol}</span>
              </div>

              <button
                type="button"
                className="boton boton--secundario"
                onClick={salir}
                style={{ padding: '0.4rem 0.8rem', fontSize: 'var(--texto-sm)' }}
              >
                Salir
              </button>
            </div>
          </nav>
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </>
  );
}