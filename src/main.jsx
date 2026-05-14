import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ProductionApp.jsx';
import './styles.css';
import './styles/wagerLayoutFix.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
