localStorage.setItem('app-cache-version', '2026-05-21-v2');
const legacyLoads = Number(sessionStorage.getItem('legacy-page-loads') ?? '0');
sessionStorage.setItem('legacy-page-loads', String(legacyLoads + 1));

navigator.serviceWorker.addEventListener('controllerchange', () => {
  window.location.reload();
});

window.addEventListener('load', () => {
  navigator.serviceWorker.register('/sw.js');
});
