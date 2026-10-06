/**
 * App.jsx
 * -----------------------------------------------------------------
 * Tabla de rutas de la aplicacion.
 *
 * Estructura de navegacion:
 *   /            -> redirige a /cotizador
 *   /login       -> publica
 *   /registro    -> publica (auto-alta con codigo de invitacion)
 *   /cotizador   -> protegida (dentro del Layout, con barra superior)
 *   /historial   -> protegida
 *   /tarifas     -> protegida + solo ADMIN_COMEX
 *   /usuarios    -> protegida + solo ADMIN_COMEX
 *   *            -> 404
 *
 * Las rutas publicas quedan FUERA del `Layout` a proposito: la barra de
 * navegacion asume una sesion iniciada, y mostrarla en el login o en el
 * registro seria mostrar enlaces que no llevan a ninguna parte.
 */

import { Routes, Route, Navigate } from 'react-router-dom';

import Layout from './components/Layout';
import RutaProtegida, { RutaPorRol } from './components/RutaProtegida';

import Login from './pages/Login';
import Registro from './pages/Registro';
import Cotizador from './pages/Cotizador';
import Historial from './pages/Historial';
import Tarifas from './pages/Tarifas';
import Usuarios from './pages/Usuarios';

export default function App() {
  return (
    <Routes>
      {/* --- Publicas --- */}
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Registro />} />

      {/* --- Protegidas: comparten el Layout --- */}
      <Route
        element={
          <RutaProtegida>
            <Layout />
          </RutaProtegida>
        }
      >
        <Route path="/cotizador" element={<Cotizador />} />
        <Route path="/historial" element={<Historial />} />
        <Route
          path="/tarifas"
          element={
            <RutaPorRol soloAdmin>
              <Tarifas />
            </RutaPorRol>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RutaPorRol soloAdmin>
              <Usuarios />
            </RutaPorRol>
          }
        />
      </Route>

      {/* --- Redirecciones --- */}
      <Route path="/" element={<Navigate to="/cotizador" replace />} />

      {/* --- 404 --- */}
      <Route path="*" element={<Navigate to="/cotizador" replace />} />
    </Routes>
  );
}