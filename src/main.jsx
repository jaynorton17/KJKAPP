import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ProductionApp.jsx';
import './styles.css';
import './styles/wagerLayoutFix.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('KJK app install support failed to start.', error);
    });
  });
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
