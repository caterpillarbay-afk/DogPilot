// Neue App-Version erkennen: Beim Zurückkehren in die App (aus dem Hintergrund) prüfen, ob sich
// die App-Dateien auf dem Server geändert haben (ETag bzw. Last-Modified per HEAD-Anfrage, wenige Bytes).
// Dann neu starten – wie ein frischer Start, mit leerem Fahrtformular.

const APP_FILES = [
  'index.html', 'css/app.css', 'js/app.js', 'js/update.js', 'js/icons.js', 'js/format.js', 'js/store.js', 'js/data.js',
  'js/services.js', 'js/trip.js', 'js/geo.js', 'js/energy.js', 'js/planner.js', 'js/legal.js', 'js/map.js',
  'js/traffic.js', 'js/drive.js',
];
const MIN_INTERVAL_MS = 60 * 1000;

async function stamp(file) {
  const res = await fetch(file, { method: 'HEAD', cache: 'no-store' });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.headers.get('etag') || res.headers.get('last-modified') || res.headers.get('content-length') || '';
}

export const fingerprint = async () => (await Promise.all(APP_FILES.map(stamp))).join('|');

// onUpdate wird höchstens einmal aufgerufen, sobald sich der Stand geändert hat
export function watchForUpdates(onUpdate) {
  let base = null, last = 0, done = false;
  const check = async () => {
    if (done || !navigator.onLine || Date.now() - last < MIN_INTERVAL_MS) return;
    last = Date.now();
    try {
      const now = await fingerprint();
      if (base === null) base = now;
      else if (now !== base) { done = true; onUpdate(); }
    } catch { /* offline oder Server kurz weg: beim nächsten Mal */ }
  };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  return check;
}
