/**
 * pages/Login.jsx
 * -----------------------------------------------------------------
 * Pantalla de autenticacion con seleccion de rol.
 *
 * El selector de rol no es decorativo: al elegir "Jefatura Comex" o
 * "Analista Comex" se rellenan las credenciales de ese usuario, lo que
 * hace que la demo de los dos roles en la defensa sea inmediata.
 */

import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alerta, Campo, Cargador } from '../components/Comunes';

/** Usuarios de demostracion association a cada rol. */
const USUARIOS_DEMO = {
  ADMIN_COMEX: { email: 'jefe@cintac.cl', password: 'Jefatura2026', nombre: 'Carla Mendoza', cargo: 'Jefatura Comex' },
  ANALISTA: { email: 'analista@cintac.cl', password: 'Analista2026', nombre: 'Diego Fuentes', cargo: 'Analista Comex' },
};

const OPCIONES_ROL = [
  {
    valor: 'ADMIN_COMEX',
    titulo: 'Jefatura Comex',
    detalle: 'Control total: puede eliminar cotizaciones y cargar tarifas.',
  },
  {
    valor: 'ANALISTA',
    titulo: 'Analista Comex',
    detalle: 'Consulta y genera cotizaciones; sin acceso a eliminacion.',
  },
];

export default function Login() {
  const { iniciarSesion, autenticado, cargando } = useAuth();
  const navegar = useNavigate();
  const ubicacion = useLocation();

  const [rol, setRol] = useState('ADMIN_COMEX');
  const [email, setEmail] = useState(USUARIOS_DEMO.ADMIN_COMEX.email);
  const [password, setPassword] = useState(USUARIOS_DEMO.ADMIN_COMEX.password);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  // Si ya hay sesion activa, no tiene sentido mostrar el formulario.
  if (cargando) {
    return (
      <div className="acceso">
        <Cargador texto="Verificando sesion..." />
      </div>
    );
  }

  if (autenticado) {
    return <Navigate to={ubicacion.state?.desde ?? '/cotizador'} replace />;
  }

  /** Cambiar de rol completa los campos con el usuario correspondiente. */
  function cambiarRol(nuevoRol) {
    setRol(nuevoRol);
    setEmail(USUARIOS_DEMO[nuevoRol].email);
    setPassword(USUARIOS_DEMO[nuevoRol].password);
    setError(null);
  }

  async function enviar(evento) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      await iniciarSesion(email.trim(), password);
      navegar(ubicacion.state?.desde ?? '/cotizador', { replace: true });
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle, codigo: fallo.codigo });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <div className="acceso__caja">
        <div className="acceso__cabecera">
          <div className="acceso__logo" aria-hidden="true">C</div>
          <h1 className="acceso__empresa">CINTAC S.A.</h1>
          <p className="acceso__modulo">
            Cotizador Logistico<br />
            de Importaciones Comex
          </p>
        </div>

        <div className="acceso__cuerpo">
          {error && (
            <Alerta tipo="error" titulo="No fue posible iniciar sesion" detalle={error.detalle}>
              {error.mensaje}
            </Alerta>
          )}

          <form onSubmit={enviar} noValidate>
            <div className="campo">
              <span className="campo__etiqueta">Perfil de acceso</span>
              <div className="selector-rol">
                {OPCIONES_ROL.map((opcion) => (
                  <button
                    key={opcion.valor}
                    type="button"
                    className={`selector-rol__opcion${rol === opcion.valor ? ' selector-rol__opcion--activa' : ''}`}
                    onClick={() => cambiarRol(opcion.valor)}
                    aria-pressed={rol === opcion.valor}
                  >
                    <span className="selector-rol__titulo">{opcion.titulo}</span>
                    <span className="selector-rol__detalle">{opcion.detalle}</span>
                  </button>
                ))}
              </div>
            </div>

            <Campo etiqueta="Correo electronico" htmlFor="email" requerido>
              <input
                id="email"
                name="email"
                type="email"
                className={`control${error?.detalle?.email ? ' control--error' : ''}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@cintac.cl"
                autoComplete="username"
                required
                autoFocus
              />
            </Campo>

            <Campo etiqueta="Contrasena" htmlFor="password" requerido>
              <input
                id="password"
                name="password"
                type="password"
                className={`control${error?.detalle?.password ? ' control--error' : ''}`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </Campo>

            <button type="submit" className="boton boton--principal boton--bloque boton--grande" disabled={enviando}>
              {enviando ? <span className="boton__spinner" /> : 'Iniciar sesion'}
            </button>
          </form>

          <div className="acceso__demo">
            <p className="acceso__demo-titulo">Cuentas de demostracion - clic para cargar</p>

            {Object.entries(USUARIOS_DEMO).map(([clave, usuario]) => (
              <button
                key={clave}
                type="button"
                className="acceso__demo-fila"
                onClick={() => cambiarRol(clave)}
              >
                <span>
                  <strong style={{ display: 'block', fontSize: 'var(--texto-sm)' }}>{usuario.cargo}</strong>
                  <span className="acceso__demo-cred">
                    {usuario.email} / {usuario.password}
                  </span>
                </span>
                <span aria-hidden="true" style={{ color: 'var(--terracota)' }}>→</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}