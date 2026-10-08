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

// Fußwege vom Schnelllader (charger-sites.json): Meter oder null (nichts innerhalb 600 m)
export const SITE_FIELDS = ['wc', 'food', 'shop', 'water', 'picnic', 'playground', 'dogPark', 'green'];
export const GREEN_KIND = ['', 'Park', 'Wald', 'Wiese'];

export function decodeSites(d) {
  return d.punkte.map(p => {
    const walk = {};
    SITE_FIELDS.forEach((f, i) => { walk[f] = p[2 + i] === 255 ? null : p[2 + i] * 10; });
    return { lat: p[0], lon: p[1], walk, greenKind: GREEN_KIND[p[2 + SITE_FIELDS.length]] || '' };
  });
}

// Punkte nach Fußweg: je näher, desto mehr
const steps = (m, table) => {
  if (m == null) return 0;
  for (const [max, pts] of table) if (m <= max) return pts;
  return 0;
};

// Hund, gemessen vom Ladeplatz: Grün direkt am Auto ist das Wichtigste
export function siteDogScore(w) {
  const green = steps(w.green, [[100, 2], [250, 1.5], [400, 1], [600, 0.5]]);
  const dogPark = steps(w.dogPark, [[300, 2.5], [600, 2]]);
  const s = 1 + Math.max(green, dogPark) + steps(w.picnic, [[200, 0.75], [400, 0.4]]) + steps(w.water, [[300, 0.5]]);
  return Math.min(5, Math.round(s * 10) / 10);
}

// Mensch, gemessen vom Ladeplatz: WC und Essen in kurzer Entfernung
export function siteHumanScore(w) {
  const s = 1 + steps(w.wc, [[150, 1.5], [300, 1], [600, 0.5]]) + steps(w.food, [[200, 1.5], [400, 1], [600, 0.5]])
    + steps(w.shop, [[300, 0.75], [600, 0.4]]) + steps(w.water, [[300, 0.25]]);
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

export async function loadChargerSites() {
  const d = await fetchJson('charger-sites.json');
  return { list: decodeSites(d), datenstand: d.stand };
}

// Fahrzeugvarianten mit Akku und DC-Ladeleistung (Open EV Data)
export async function loadVehicleSpecs() {
  const d = await fetchJson('vehicle-specs.json');
  if (!Array.isArray(d.fahrzeuge) || !d.fahrzeuge.length) throw new Error('Fahrzeugvarianten leer');
  return d.fahrzeuge;
}

// Varianten zu Marke und Modell aus der EEA-Liste finden. Die Schreibweisen der beiden Quellen weichen ab
// ("MERCEDES-BENZ"/"Mercedes", "Q4"/"Q4 Sportback e-tron 45"): Vergleich ohne Groß-/Kleinschreibung,
// Leer- und Satzzeichen; erst Präfix des ganzen Modellnamens, sonst gleiches erstes Wort.
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const firstWord = s => norm(String(s || '').trim().split(/\s+/)[0]);
export function matchVariants(specs, make, model) {
  if (!specs?.length || !make || !model) return [];
  const mk = norm(make);
  const brand = specs.filter(v => { const b = norm(v.marke); return b && (b === mk || mk.startsWith(b) || b.startsWith(mk)); });
  if (!brand.length) return [];
  // Markenname am Anfang des Modells entfernen: "TESLA MODEL 3" → "MODEL 3", "ALFA ROMEO JUNIOR" → "JUNIOR"
  const words = String(model).trim().split(/\s+/);
  for (let acc = ''; words.length > 1 && norm(words[0]) && mk.startsWith(acc + norm(words[0]));) acc += norm(words.shift());
  const m = words.join(' ');
  const full = norm(m), first = firstWord(m);
  const byPrefix = brand.filter(v => norm(v.modell).startsWith(full));
  if (byPrefix.length) return byPrefix;
  return first.length >= 2 ? brand.filter(v => firstWord(v.modell) === first) : [];
}

export async function loadVehicles() {
  const list = await fetchJson('vehicle-database.json');
  if (!Array.isArray(list) || !list.length) throw new Error('Fahrzeugliste leer');
  return list;
}
