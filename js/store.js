// Einstellungen und Fotos dauerhaft im Browser speichern (IndexedDB, nur lokal auf dem Gerät).
// Übernimmt beim ersten Start die Werte der früheren App-Version.

const DB_NAME = 'dogpilot';
const STORE = 'files';
const SETTINGS_KEY = 'settings';
const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  onboarded: false,
  // Akku und Ladeleistung stehen nicht in der Fahrzeugliste – bewusst leer, damit niemand mit fremden Werten plant
  vehicle: { make: '', model: '', capacityKWh: null, consumptionKWh100: 20, carMaxKw: null, photo: null },
  dogs: [],
  charging: { minChargerKw: 150, reserveSoc: 10, arrivalSoc: 15, maxChargeSoc: 80, minBreakMin: 15, maxDriveMin: 120, corridorKm: 2 },
  keys: { tomtom: '', ocm: '' },
  lastTrip: null,
};

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

const get = key => tx('readonly', s => s.get(key)).catch(() => undefined);
const set = (key, value) => tx('readwrite', s => s.put(value, key)).catch(() => undefined);
const del = key => tx('readwrite', s => s.delete(key)).catch(() => undefined);

function merge(base, extra) {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
      ? { ...out[k], ...v } : v;
  }
  return out;
}

// Werte der ersten App-Version übernehmen (einzelne Schlüssel statt eines Objekts)
async function migrateLegacy() {
  const [model, capacity, consumption, minKw, tomtom, photos] = await Promise.all(
    ['vehicleModel', 'vehicleCapacityKWh', 'vehicleConsumptionKWh100', 'minKw', 'tomtomApiKey', 'photos'].map(get));
  const any = [model, capacity, consumption, minKw, tomtom, photos].some(v => v != null);
  if (!any) return null;
  const s = structuredClone(DEFAULT_SETTINGS);
  if (model?.marke) Object.assign(s.vehicle, { make: model.marke, model: model.modell || '' });
  if (capacity > 0) s.vehicle.capacityKWh = capacity;
  if (consumption > 0) s.vehicle.consumptionKWh100 = consumption;
  if (minKw > 0) s.charging.minChargerKw = minKw;
  if (tomtom) s.keys.tomtom = tomtom;
  if (photos?.vehicle) s.vehicle.photo = photos.vehicle;
  s.dogs = ['schoko', 'fibi'].filter(k => photos?.[k]).map(k => ({ id: k, name: k[0].toUpperCase() + k.slice(1), photo: photos[k] }));
  s.onboarded = Boolean(s.vehicle.make);
  // Alte Einzelschlüssel und nicht mehr genutzte Daten entfernen
  await Promise.all(['vehicleModel', 'vehicleCapacityKWh', 'vehicleConsumptionKWh100', 'minKw', 'tomtomApiKey', 'photos',
    'charging', 'chargingUpdatedAt', 'areas', 'areasUpdatedAt'].map(del));
  return s;
}

export async function loadSettings() {
  let stored = await get(SETTINGS_KEY);
  if (!stored) {
    stored = await migrateLegacy();
    if (stored) await set(SETTINGS_KEY, stored);
  }
  return merge(DEFAULT_SETTINGS, stored || {});
}

export const saveSettings = settings => set(SETTINGS_KEY, settings);

export async function resetAll() {
  await tx('readwrite', s => s.clear()).catch(() => undefined);
}

// Foto verkleinern (max. 512 px), damit der Speicher klein bleibt
export function resizePhoto(file, maxPx = 512) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}
