import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { setupNative } from './native';
import './styles/themes.css';
import './styles/app.css';

setupNative();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
