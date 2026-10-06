/**
 * pages/Registro.jsx
 * -----------------------------------------------------------------
 * Alta de cuenta de Analista mediante codigo de invitacion.
 *
 * El codigo NO se escribe con ayuda del navegador ni se guarda. Es una credencial
 * y el unico filtro que separa "un analista nuevo" de "cualquiera con el
 * formulario abierto", asi que se maneja como se maneja una contrasena: en
 * memoria, se limpia al salir, y nunca aparece en un log.
 *
 * El medidor de contrasena es la pieza central de esta pantalla. Las reglas
 * son las del backend, y estan replicadas aqui solo para dar feedback
 * inmediato; la validacion que decide es la del servidor.
 */

import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alerta, Campo, Cargador } from '../components/Comunes';

/**
 * Reglas de complejidad, en el mismo orden que usa el backend.
 * `cumplida` es lo que permite activar el boton; el resto es orientativo.
 */
const REGLAS = [
  { id: 'largo', texto: 'Al menos 8 caracteres', prueba: (c) => c.length >= 8 },
  { id: 'minuscula', texto: 'Una letra minuscula', prueba: (c) => /[a-z]/.test(c) },
  { id: 'mayuscula', texto: 'Una letra mayuscula', prueba: (c) => /[A-Z]/.test(c) },
  { id: 'numero', texto: 'Un numero', prueba: (c) => /[0-9]/.test(c) },
  { id: 'especial', texto: 'Un caracter especial (! @ # $ % &)', prueba: (c) => /[^A-Za-z0-9]/.test(c) },
];

export default function Registro() {
  const { registrar, autenticado, cargando } = useAuth();
  const navegar = useNavigate();

  const [formulario, setFormulario] = useState({
    nombre: '',
    email: '',
    codigoInvitacion: '',
    password: '',
    passwordRepeticion: '',
  });
  const [error, setError] = useState(null);
  const [exito, setExito] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const [verPassword, setVerPassword] = useState(false);

  /** Evalua las reglas sobre la contrasena actual. */
  const medidor = useMemo(
    () => REGLAS.map((regla) => ({ ...regla, cumplida: regla.prueba(formulario.password) })),
    [formulario.password],
  );

  const faltanReglas = medidor.filter((r) => !r.cumplida).length;

  const contrasenaValida = faltanReglas === 0 && formulario.password.length > 0;
  const repeticionCoincide = formulario.passwordRepeticion.length > 0
    && formulario.password === formulario.passwordRepeticion;

  const formularioCompleto = formulario.nombre.trim() !== ''
    && formulario.email.trim() !== ''
    && formulario.codigoInvitacion.trim() !== ''
    && contrasenaValida
    && repeticionCoincide;

  if (cargando) {
    return (
      <div className="acceso">
        <Cargador texto="Verificando sesion..." />
      </div>
    );
  }

  // Quien ya entro no tiene nada que hacer aqui: el registro es para los que
  // todavia no tienen cuenta.
  if (autenticado) {
    return <Navigate to="/cotizador" replace />;
  }

  function cambiar(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }));
    setError(null);
    setExito(null);
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (!formularioCompleto) return;

    setError(null);
    setExito(null);
    setEnviando(true);

    try {
      const perfil = await registrar({
        nombre: formulario.nombre.trim(),
        email: formulario.email.trim(),
        codigoInvitacion: formulario.codigoInvitacion.trim(),
        password: formulario.password,
        passwordRepeticion: formulario.passwordRepeticion,
      });

      setExito(`Bienvenido, ${perfil.nombre}. Su cuenta de Analista ya esta lista.`);
      // La sesion ya quedo abierta en el registro, asi que no hace falta pasar
      // por el login. El retardo deja leer el mensaje de exito.
      setTimeout(() => navegar('/cotizador', { replace: true }), 1200);
    } catch (fallo) {
      setError({ mensaje: fallo.message, detalle: fallo.detalle, codigo: fallo.codigo });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <div className="acceso__caja acceso__caja--ancha">
        <div className="acceso__cabecera">
          <div className="acceso__logo" aria-hidden="true">C</div>
          <h1 className="acceso__empresa">CINTAC S.A.</h1>
          <p className="acceso__modulo">
            Alta de Analista Comex
          </p>
        </div>

        <div className="acceso__cuerpo">
          <p className="registro__intro">
            Complete sus datos con el codigo de invitacion entregado por Jefatura Comex.
            La cuenta se crea con permisos de Analista; el acceso al modulo de
            administracion se otorga desde la aplicacion.
          </p>

          {error && (
            <Alerta tipo="error" titulo="No fue posible crear la cuenta" detalle={error.detalle}>
              {error.mensaje}
            </Alerta>
          )}

          {exito && <Alerta tipo="exito">{exito}</Alerta>}

          <form onSubmit={enviar} noValidate>
            <Campo etiqueta="Nombre completo" htmlFor="nombre" requerido>
              <input
                id="nombre"
                name="nombre"
                type="text"
                className={`control${error?.detalle?.nombre ? ' control--error' : ''}`}
                value={formulario.nombre}
                onChange={(e) => cambiar('nombre', e.target.value)}
                placeholder="Maria Fernandez"
                autoComplete="name"
                required
                autoFocus
              />
            </Campo>

            <Campo etiqueta="Correo electronico" htmlFor="email-registro" requerido>
              <input
                id="email-registro"
                name="email"
                type="email"
                className={`control${error?.detalle?.email ? ' control--error' : ''}`}
                value={formulario.email}
                onChange={(e) => cambiar('email', e.target.value)}
                placeholder="usuario@cintac.cl"
                autoComplete="username"
                required
              />
            </Campo>

            <Campo etiqueta="Codigo de invitacion" htmlFor="codigoInvitacion" requerido>
              <input
                id="codigoInvitacion"
                name="codigoInvitacion"
                type="password"
                className={`control${error?.detalle?.codigoInvitacion ? ' control--error' : ''}`}
                value={formulario.codigoInvitacion}
                onChange={(e) => cambiar('codigoInvitacion', e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
                required
              />
            </Campo>

            <Campo etiqueta="Contrasena" htmlFor="password-registro" requerido>
              <div className="control-con-boton">
                <input
                  id="password-registro"
                  name="password"
                  type={verPassword ? 'text' : 'password'}
                  className={`control${error?.detalle?.password ? ' control--error' : ''}`}
                  value={formulario.password}
                  onChange={(e) => cambiar('password', e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="boton boton--texto"
                  onClick={() => setVerPassword((v) => !v)}
                  aria-pressed={verPassword}
                >
                  {verPassword ? 'Ocultar' : 'Ver'}
                </button>
              </div>
            </Campo>

            <ul className="medidor" aria-live="polite">
              {medidor.map((regla) => (
                <li
                  key={regla.id}
                  className={`medidor__item${regla.cumplida ? ' medidor__item--cumple' : ''}`}
                >
                  <span className="medidor__marca" aria-hidden="true">
                    {regla.cumplida ? '✓' : '○'}
                  </span>
                  {regla.texto}
                </li>
              ))}
            </ul>

            <Campo
              etiqueta="Repetir contrasena"
              htmlFor="passwordRepeticion"
              requerido
              error={
                formulario.passwordRepeticion.length > 0 && !repeticionCoincide
                  ? 'Las contrasenas no coinciden.'
                  : null
              }
            >
              <input
                id="passwordRepeticion"
                name="passwordRepeticion"
                type={verPassword ? 'text' : 'password'}
                className={`control${formulario.passwordRepeticion.length > 0 && !repeticionCoincide ? ' control--error' : ''}${error?.detalle?.passwordRepeticion ? ' control--error' : ''}`}
                value={formulario.passwordRepeticion}
                onChange={(e) => cambiar('passwordRepeticion', e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </Campo>

            <button
              type="submit"
              className="boton boton--principal boton--bloque boton--grande"
              disabled={enviando || !formularioCompleto}
            >
              {enviando ? <span className="boton__spinner" /> : 'Crear mi cuenta'}
            </button>

            {!formularioCompleto && !enviando ? (
              <p className="registro__ayuda">
                Complete los cinco requisitos de contrasena y la repeticion para continuar.
              </p>
            ) : null}
          </form>

          <p className="acceso__pie">
            {'Ya tiene cuenta? '}
            <Link to="/login">Iniciar sesion</Link>
          </p>
        </div>
      </div>
    </div>
  );
}