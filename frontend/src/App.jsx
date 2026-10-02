/**
 * App.jsx
 * -----------------------------------------------------------------
 * Tabla de rutas de la aplicacion.
 *
 * Estructura de navegacion:
 *   /            -> redirige a /cotizador
 *   /login       -> publica
 *   /cotizador   -> protegida (dentro del Layout, con barra superior)
 *   /historial   -> protegida
 *   /tarifas     -> protegida + solo ADMIN_COMEX
 *   *            -> 404
 */

import { Routes, Route, Navigate } from 'react-router-dom';

import Layout from './components/Layout';
import RutaProtegida, { RutaPorRol } from './components/RutaProtegida';

import Login from './pages/Login';
import Cotizador from './pages/Cotizador';
import Historial from './pages/Historial';
import Tarifas from './pages/Tarifas';

export default function App() {
  return (
    <Routes>
      {/* --- Publica --- */}
      <Route path="/login" element={<Login />} />

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
      </Route>

      {/* --- Redirecciones --- */}
      <Route path="/" element={<Navigate to="/cotizador" replace />} />

      {/* --- 404 --- */}
      <Route path="*" element={<Navigate to="/cotizador" replace />} />
    </Routes>
  );
}