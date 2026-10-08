// Service Worker: App und Daten "netzwerk zuerst" – online immer die aktuelle Version,
// offline die zuletzt geladene. Externe Dienste (Routing, Wetter, Karte) werden nicht zwischengespeichert.
const CACHE = 'dogpilot-v3';
const SHELL = [
  './', 'index.html', 'manifest.json', 'logo.svg', 'icon-192.png', 'css/app.css',
  'js/app.js', 'js/icons.js', 'js/format.js', 'js/store.js', 'js/data.js', 'js/services.js', 'js/trip.js',
  'js/geo.js', 'js/energy.js', 'js/planner.js', 'js/legal.js', 'js/map.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || Response.error())),
  );
});
