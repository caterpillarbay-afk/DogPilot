// Minimaler Service Worker: erfüllt die Installierbarkeits-Kriterien von Chrome,
// cached aber bewusst nichts – wichtig während der UAT-Phase, damit Tester
// nach jedem Update immer die aktuelle Version sehen, ohne alten Cache.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
