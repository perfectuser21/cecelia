const CACHE_NAME = 'legacy-navigation-cache';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      '/index.html',
      '/legacy.js',
    ])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match('/index.html'));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => response ?? fetch(event.request)),
  );
});
