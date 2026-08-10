import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import {
  cleanupStaleCaches,
  refreshServiceWorkers,
} from './cache-lifecycle'

const APP_VERSION = __APP_VERSION__;

function mountApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

const serviceWorkers = 'serviceWorker' in navigator
  ? navigator.serviceWorker
  : undefined;

async function bootstrap() {
  try {
    await refreshServiceWorkers(serviceWorkers);
    await cleanupStaleCaches({
      version: APP_VERSION,
      storage: localStorage,
      serviceWorkers,
      cacheStorage: 'caches' in window ? caches : undefined,
    });
  } finally {
    mountApp();
  }
}

void bootstrap();
