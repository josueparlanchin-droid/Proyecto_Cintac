/**
 * pages/Login.jsx
 * -----------------------------------------------------------------
 * Pantalla de autenticacion.
 *
 * No hay selector de perfil. El correo y la contrasena los escribe cada
 * persona: un formulario que rellena las credenciales de los usuarios de
 * demostracion segun el rol que se elige es un formulario que enseña las
 * claves de la aplicacion a cualquiera que abra la pantalla, y en un sistema
 * con datos de precios de importacion eso no es aceptable.
 *
 * El rol lo determina la cuenta, no la pantalla. Quien tenga permisos de
 * administracion los encuentra en "Usuarios".
 */

import { useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alerta, Campo, Cargador } from '../components/Comunes';

export default function Login() {
  const { iniciarSesion, autenticado, cargando } = useAuth();
  const navegar = useNavigate();
  const ubicacion = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

          <p className="acceso__pie">
            {'No tiene cuenta? '}
            <Link to="/registro">Solicitar acceso con codigo de invitacion</Link>
          </p>
        </div>
      </div>
    </div>
  );
}