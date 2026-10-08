// Laden und Entpacken der automatisch erzeugten Datendateien
// (charging-stations.json, rest-areas.json, vehicle-database.json).

// Ausstattungs-Bits – identisch mit F in scripts/build-rest-areas.mjs
export const FEATURES = {
  toilets: 1, food: 2, shop: 4, fuel: 8, water: 16, picnic: 32,
  playground: 64, dogPark: 128, park: 256, forest: 512, meadow: 1024,
};

export function decodeChargers(d) {
  return d.punkte.map(([lat, lon, kw, n, b]) => ({ lat, lon, kw, points: n, operator: d.betreiber[b] || '' }));
}

export function decodeRestAreas(d) {
  return d.punkte.map(([lat, lon, nameIdx, type, flags]) => ({
    lat, lon, name: d.namen[nameIdx] || '', type: ['rastplatz', 'rastanlage', 'autohof'][type] || 'rastplatz', flags,
  }));
}

const has = (flags, ...bits) => bits.some(b => flags & b);

// Hund: Grün in Gassi-Entfernung zählt am meisten, Hundewiese ist das Optimum
export function dogScore(flags) {
  if (flags == null) return null;
  const F = FEATURES;
  let s = 1;
  if (has(flags, F.dogPark)) s += 2.5;
  else if (has(flags, F.park, F.forest, F.meadow)) s += 2;
  if (has(flags, F.picnic)) s += 0.75;
  if (has(flags, F.water)) s += 0.75;
  return Math.min(5, Math.round(s * 10) / 10);
}

// Mensch: WC, Essen, Einkauf
export function humanScore(flags) {
  if (flags == null) return null;
  const F = FEATURES;
  let s = 1;
  if (has(flags, F.toilets)) s += 1.5;
  if (has(flags, F.food)) s += 1.5;
  if (has(flags, F.shop, F.fuel)) s += 0.75;
  if (has(flags, F.water)) s += 0.25;
  return Math.min(5, Math.round(s * 10) / 10);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadChargers() {
  const d = await fetchJson('charging-stations.json');
  return { list: decodeChargers(d), datenstand: d.datenstand || d.stand };
}

export async function loadRestAreas() {
  const d = await fetchJson('rest-areas.json');
  return { list: decodeRestAreas(d), datenstand: d.stand };
}

export async function loadVehicles() {
  const list = await fetchJson('vehicle-database.json');
  if (!Array.isArray(list) || !list.length) throw new Error('Fahrzeugliste leer');
  return list;
}
