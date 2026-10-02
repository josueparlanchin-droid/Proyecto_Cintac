/**
 * components/Comunes.jsx
 * -----------------------------------------------------------------
 * Piezas de interfaz reutilizadas en varias pantallas: alertas, indicador
 * de carga, tarjeta estadistica, insignia y modal de confirmacion.
 *
 * Se agrupan en un solo archivo porque son pequenas y estan relacionadas;
 * dividirlas en siete archivos de diez lineas estorbaria mas de lo que
 * ayudaria.
 */

import { useEffect } from 'react';

// ==================================================================
// Alerta
// ==================================================================
const ICONOS = { error: '⚠', exito: '✓', advertencia: '!', info: 'i' };

/**
 * Mensaje destacado. `detalle` acepta un objeto campo -> mensaje y lo
 * muestra como lista, que es como la API devuelve los errores de validacion.
 *
 * @param {{tipo?:'error'|'exito'|'advertencia'|'info', titulo?:string,
 *          children?:React.ReactNode, detalle?:object, onCerrar?:Function}} props
 */
export function Alerta({ tipo = 'info', titulo, children, detalle, onCerrar }) {
  const campos = detalle ? Object.entries(detalle) : [];

  return (
    <div className={`alerta alerta--${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <span className="alerta__icono" aria-hidden="true">
        {ICONOS[tipo] ?? 'i'}
      </span>

      <div className="alerta__cuerpo">
        {titulo && <strong className="alerta__titulo">{titulo}</strong>}
        {children}

        {campos.length > 0 && (
          <ul style={{ marginTop: '0.4rem', paddingLeft: '1rem', listStyle: 'disc' }}>
            {campos.map(([campo, mensaje]) => (
              <li key={campo}>
                <strong>{campo}:</strong> {mensaje}
              </li>
            ))}
          </ul>
        )}
      </div>

      {onCerrar && (
        <button type="button" onClick={onCerrar} aria-label="Cerrar mensaje" style={{ fontSize: '1.1rem', lineHeight: 1 }}>
          ×
        </button>
      )}
    </div>
  );
}

// ==================================================================
// Indicador de carga
// ==================================================================
export function Cargador({ texto = 'Cargando...' }) {
  return (
    <div style={{ padding: '2.5rem', textAlign: 'center' }}>
      <div className="cargador" role="status" aria-label={texto} />
      {texto && <p style={{ marginTop: '0.75rem', color: 'var(--gris-claro)', fontSize: 'var(--texto-sm)' }}>{texto}</p>}
    </div>
  );
}

// ==================================================================
// Estado vacio
// ==================================================================
export function Vacio({ icono = '📋', titulo, children }) {
  return (
    <div className="vacio">
      <div className="vacio__icono" aria-hidden="true">{icono}</div>
      <h3 className="vacio__titulo">{titulo}</h3>
      {children && <p className="vacio__texto">{children}</p>}
    </div>
  );
}

// ==================================================================
// Tarjeta estadistica
// ==================================================================
/**
 * @param {{etiqueta:string, valor:React.ReactNode, detalle?:string,
 *          variante?:'neutro'|'acento'|'exito'|'info'|'advertencia'}} props
 */
export function Stat({ etiqueta, valor, detalle, variante = 'neutro' }) {
  const clase = variante === 'neutro' ? 'stat' : `stat stat--${variante}`;

  return (
    <div className={clase}>
      <div className="stat__etiqueta">{etiqueta}</div>
      <div className="stat__valor">{valor}</div>
      {detalle && <div className="stat__detalle">{detalle}</div>}
    </div>
  );
}

// ==================================================================
// Insignia
// ==================================================================
export function Insignia({ children, variante = 'neutro' }) {
  return <span className={`insignia insignia--${variante}`}>{children}</span>;
}

// ==================================================================
// Modal de confirmacion
// ==================================================================
/**
 * Se cierra con Escape y al hacer clic fuera, para no dejar al usuario
 * atrapado en un dialogo.
 *
 * @param {{titulo:string, children:React.ReactNode, onConfirmar:Function,
 *          onCancelar:Function, textoConfirmar?:string, peligro?:boolean, cargando?:boolean}} props
 */
export function ModalConfirmacion({
  titulo,
  children,
  onConfirmar,
  onCancelar,
  textoConfirmar = 'Confirmar',
  peligro = false,
  cargando = false,
}) {
  useEffect(() => {
    function alPresionar(e) {
      if (e.key === 'Escape') onCancelar();
    }

    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [onCancelar]);

  return (
    <div className="modal-fondo" onClick={onCancelar} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-modal"
      >
        <div className="modal__cabecera" id="titulo-modal">{titulo}</div>

        <div className="modal__cuerpo">{children}</div>

        <div className="modal__pie">
          <button type="button" className="boton boton--secundario" onClick={onCancelar} disabled={cargando}>
            Cancelar
          </button>
          <button
            type="button"
            className={`boton ${peligro ? 'boton--principal' : 'boton--principal'}`}
            onClick={onConfirmar}
            disabled={cargando}
            style={peligro ? { background: 'var(--error)', boxShadow: '0 4px 12px rgba(179,38,30,.28)' } : undefined}
          >
            {cargando && <span className="boton__spinner" />}
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================================================================
// Campo de formulario
// ==================================================================
/**
 * Envoltura que agrupa etiqueta, control, ayuda y error.
 * Mantiene el HTML semantico correcto (label enlazado al input) sin
 * repetirlo en cada pantalla.
 *
 * @param {{etiqueta:string, ayuda?:string, error?:string, requerido?:boolean,
 *          htmlFor:string, children:React.ReactNode, sufijo?:string}} props
 */
export function Campo({ etiqueta, ayuda, error, requerido, htmlFor, children, sufijo }) {
  return (
    <div className="campo">
      <label className="campo__etiqueta" htmlFor={htmlFor}>
        <span>
          {etiqueta}
          {requerido && <span className="campo__requerido" aria-hidden="true"> *</span>}
        </span>
      </label>

      {sufijo ? (
        <div className="control-envoltorio">
          {children}
          <span className="control__sufijo">{sufijo}</span>
        </div>
      ) : (
        children
      )}

      {error && <div className="campo__error">{error}</div>}
      {!error && ayuda && <div className="campo__ayuda">{ayuda}</div>}
    </div>
  );
}