import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './ProductionApp.jsx';
import './styles.css';
import './compact-answer-screen.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
