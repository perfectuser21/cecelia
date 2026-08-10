localStorage.setItem('app-cache-version', '2026-05-21-v2');

navigator.serviceWorker.addEventListener('controllerchange', () => {
  window.location.reload();
});

window.addEventListener('load', () => {
  navigator.serviceWorker.register('/sw.js');
});
