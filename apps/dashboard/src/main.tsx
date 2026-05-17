import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// 强制刷新 Service Worker 缓存
const APP_VERSION = '2026-03-11-v1';
const CACHE_VERSION_KEY = 'app-cache-version';

function mountApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
}

async function clearStaleCache(): Promise<boolean> {
  const storedVersion = localStorage.getItem(CACHE_VERSION_KEY);
  if (storedVersion !== APP_VERSION) {
    console.log(`[Cache] Version changed: ${storedVersion} -> ${APP_VERSION}`);

    // 注销所有 Service Workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
        console.log('[Cache] Service Worker unregistered');
      }
    }

    // 清除所有缓存
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const cacheName of cacheNames) {
        await caches.delete(cacheName);
        console.log(`[Cache] Deleted cache: ${cacheName}`);
      }
    }

    localStorage.setItem(CACHE_VERSION_KEY, APP_VERSION);

    // 强制刷新页面（旧版本升级时），不挂载 React
    if (storedVersion !== null) {
      window.location.reload();
      return true; // 已触发 reload，调用方跳过挂载
    }
  }
  return false;
}

// SW 更新时自动重载，确保新 bundle 生效
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    console.log('[SW] Controller changed, reloading for new bundle...');
    window.location.reload();
  });
}

clearStaleCache().then((reloading) => {
  if (!reloading) {
    mountApp();
  }
});
