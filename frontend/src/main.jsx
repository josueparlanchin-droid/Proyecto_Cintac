/**
 * main.jsx
 * -----------------------------------------------------------------
 * Punto de entrada de la aplicacion React.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ProveedorAuth } from './context/AuthContext';

import './styles/tokens.css';
import './styles/base.css';
import './styles/componentes.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ProveedorAuth>
        <App />
      </ProveedorAuth>
    </BrowserRouter>
  </StrictMode>,
);