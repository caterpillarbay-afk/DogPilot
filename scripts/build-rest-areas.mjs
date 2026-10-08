#!/usr/bin/env node
// Erzeugt rest-areas.json aus OpenStreetMap: alle Rastanlagen und Rastplätze in Deutschland samt
// Ausstattung im Umkreis – für Mensch (WC, Essen, Shop) und Hund (Hundewiese, Park, Wald, Wiese,
// Picknickplatz, Trinkwasser).
//
// Eingabe: GeoJSON-Sequenz, erzeugt aus dem Geofabrik-Deutschland-Extrakt mit osmium
// (siehe .github/workflows/rest-areas.yml):
//   osmium tags-filter germany-latest.osm.pbf <Filter> -o filtered.osm.pbf
//   osmium export filtered.osm.pbf -f geojsonseq -o features.geojsonseq
// Aufruf (Node >= 18, keine Abhängigkeiten):  node scripts/build-rest-areas.mjs features.geojsonseq
// Ausgabe (im Repo-Root), Daten © OpenStreetMap-Mitwirkende, ODbL:
//   rest-areas.json    – Rastanlagen mit Ausstattung, gemessen vom Gelände der Anlage
//   charger-sites.json – Fußwege von jedem Schnelllade-Standort (≥ 50 kW, aus charging-stations.json)
//                        zu WC, Essen, Einkauf, Wasser, Picknick, Spielplatz, Hundewiese und Grün

import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'rest-areas.json');
const OUT_SITES = join(ROOT, 'charger-sites.json');
const CHARGERS = join(ROOT, 'charging-stations.json');
const SITE_MIN_KW = 50;        // Schnelllader, für die Fußwege berechnet werden
const SITE_MERGE_M = 80;       // Ladepunkte näher beieinander gelten als ein Standort
const SITE_MAX_M = 600;        // weiter entfernte Einrichtungen zählen nicht
const INPUT = process.argv[2];
const AMENITY_RADIUS_M = 250; // Einrichtungen, die zur Anlage selbst gehören
const GREEN_RADIUS_M = 300;   // Park, Wald, Wiese: in ca. 4 Minuten zu Fuß erreichbar
const DOG_PARK_RADIUS_M = 600; // eine eingezäunte Hundewiese lohnt auch einen längeren Weg
const M_PER_DEG = 111320;

// Ausstattungs-Bits (gleiche Reihenfolge wie FEATURES in js/data.js der App)
const F = {
  toilets: 1, food: 2, shop: 4, fuel: 8, water: 16, picnic: 32,
  playground: 64, dogPark: 128, park: 256, forest: 512, meadow: 1024,
};

function distM(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Einrichtungen (kleiner Radius) und Grünflächen (großer Radius) – Abstand zur echten Geometrie
function featureOf(t) {
  const a = t.amenity, l = t.leisure, lu = t.landuse, n = t.natural;
  if (a === 'toilets') return [F.toilets, AMENITY_RADIUS_M];
  if (a === 'restaurant' || a === 'fast_food' || a === 'cafe') return [F.food, AMENITY_RADIUS_M];
  if (a === 'fuel') return [F.fuel, AMENITY_RADIUS_M];
  if (a === 'drinking_water') return [F.water, AMENITY_RADIUS_M];
  if (t.shop === 'convenience' || t.shop === 'kiosk') return [F.shop, AMENITY_RADIUS_M];
  if (l === 'picnic_table' || t.tourism === 'picnic_site') return [F.picnic, AMENITY_RADIUS_M];
  if (l === 'playground') return [F.playground, AMENITY_RADIUS_M];
  if (l === 'dog_park') return [F.dogPark, DOG_PARK_RADIUS_M];
  if (l === 'park' || lu === 'recreation_ground') return [F.park, GREEN_RADIUS_M];
  if (lu === 'forest' || n === 'wood') return [F.forest, GREEN_RADIUS_M];
  if (lu === 'meadow' || n === 'grassland' || n === 'heath') return [F.meadow, GREEN_RADIUS_M];
  return null;
}

// Ausstattung, die direkt an der Anlage getaggt ist
function ownFlags(t) {
  let f = 0;
  if (t.toilets === 'yes') f |= F.toilets;
  if (t.drinking_water === 'yes') f |= F.water;
  if (t.picnic_table === 'yes') f |= F.picnic;
  if (t.fuel === 'yes') f |= F.fuel;
  return f;
}

// Umriss-Rechteck einer GeoJSON-Geometrie: [minLat, minLon, maxLat, maxLon]
function bbox(geometry) {
  let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
  const walk = c => {
    if (typeof c[0] === 'number') {
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
      if (c[0] < minLon) minLon = c[0];
      if (c[0] > maxLon) maxLon = c[0];
    } else for (const x of c) walk(x);
  };
  walk(geometry.coordinates);
  return minLat === Infinity ? null : [minLat, minLon, maxLat, maxLon];
}

if (!INPUT) throw new Error('Aufruf: node scripts/build-rest-areas.mjs features.geojsonseq');

async function* features() {
  const rl = createInterface({ input: createReadStream(INPUT), crlfDelay: Infinity });
  for await (let line of rl) {
    line = line.replace(/^\x1e/, '').trim();   // GeoJSON-Sequenz: optionales Record-Separator-Zeichen
    if (line) yield JSON.parse(line);
  }
}

// Kürzester Abstand (Meter) von Punkt p zu einer Geometrie; 0, wenn p in einer Fläche liegt.
// Lokale ebene Näherung um p – genau genug für Abstände unter einigen Kilometern.
function distanceToGeometry(p, g) {
  const kx = Math.cos(p[0] * Math.PI / 180) * M_PER_DEG, ky = M_PER_DEG;
  const xy = c => [(c[0] - p[1]) * kx, (c[1] - p[0]) * ky];   // GeoJSON: [lon, lat]
  const segDist = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2)) : 0;
    return Math.hypot(a[0] + t * dx, a[1] + t * dy);
  };
  const lineDist = coords => {
    let d = Infinity, prev = xy(coords[0]);
    if (coords.length === 1) return Math.hypot(prev[0], prev[1]);
    for (let i = 1; i < coords.length; i++) { const cur = xy(coords[i]); d = Math.min(d, segDist(prev, cur)); prev = cur; }
    return d;
  };
  // Punkt-in-Polygon (gerade/ungerade über alle Ringe, damit Löcher berücksichtigt sind)
  const polygonDist = rings => {
    let inside = false, d = Infinity;
    for (const ring of rings) {
      d = Math.min(d, lineDist(ring));
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = xy(ring[i]), [xj, yj] = xy(ring[j]);
        if ((yi > 0) !== (yj > 0) && 0 < (xj - xi) * (0 - yi) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside ? 0 : d;
  };
  switch (g.type) {
    case 'Point': return lineDist([g.coordinates]);
    case 'MultiPoint': case 'LineString': return lineDist(g.coordinates);
    case 'MultiLineString': return Math.min(...g.coordinates.map(lineDist));
    case 'Polygon': return polygonDist(g.coordinates);
    case 'MultiPolygon': return Math.min(...g.coordinates.map(polygonDist));
    default: return Infinity;
  }
}

// 1. Durchgang: Anlagen
const areas = [];
let lines = 0;
for await (const feat of features()) {
  lines++;
  const t = feat.properties || {};
  if (t.highway !== 'services' && t.highway !== 'rest_area') continue;
  const b = feat.geometry && bbox(feat.geometry);
  if (!b) continue;
  const name = (t.name || '').trim();
  areas.push({
    p: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], b, g: feat.geometry, flags: ownFlags(t), name,
    services: t.highway === 'services',
    autohof: /autohof|truck ?stop/i.test(name),
  });
}
console.log(`${lines} Objekte gelesen, davon ${areas.length} Anlagen`);
if (areas.length < 500) throw new Error(`Nur ${areas.length} Anlagen – Eingabe unvollständig?`);

// Raster-Index der Anlagen (0,05°), damit jede Einrichtung nur Anlagen in ihrer Nähe prüft
const CELL = 0.05;
const grid = new Map();
for (const a of areas) {
  const k = `${Math.floor(a.p[0] / CELL)}:${Math.floor(a.p[1] / CELL)}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(a);
}

// Schnelllade-Standorte aus dem Ladesäulenregister (Ladepunkte im Umkreis von 80 m zusammengefasst)
const sites = [];
try {
  const ch = JSON.parse(await readFile(CHARGERS, 'utf8'));
  const sGrid = new Map();
  const key = (lat, lon) => `${Math.floor(lat / 0.002)}:${Math.floor(lon / 0.002)}`;
  for (const [lat, lon, kw] of ch.punkte) {
    if (kw < SITE_MIN_KW) continue;
    const [ci, cj] = key(lat, lon).split(':').map(Number);
    let hit = null;
    for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) {
      hit = (sGrid.get(`${ci + di}:${cj + dj}`) || []).find(x => distM(x.p, [lat, lon]) < SITE_MERGE_M) || null;
    }
    if (hit) { if (kw > hit.kw) Object.assign(hit, { p: [lat, lon], kw }); continue; }
    const site = { p: [lat, lon], kw, d: {}, greenKind: 0 };
    sites.push(site);
    const k = key(lat, lon);
    if (!sGrid.has(k)) sGrid.set(k, []);
    sGrid.get(k).push(site);
  }
  console.log(`${sites.length} Schnelllade-Standorte (≥ ${SITE_MIN_KW} kW)`);
} catch (err) {
  console.warn(`charging-stations.json nicht lesbar (${err.message}) – keine Fußwege für Ladestandorte`);
}
const siteGrid = new Map();
for (const s of sites) {
  const k = `${Math.floor(s.p[0] / CELL)}:${Math.floor(s.p[1] / CELL)}`;
  if (!siteGrid.has(k)) siteGrid.set(k, []);
  siteGrid.get(k).push(s);
}

// Welcher Fußweg-Eintrag zu einem Ausstattungs-Bit gehört (Tankstelle zählt als Einkauf)
const SITE_KEY = {
  [F.toilets]: 'wc', [F.food]: 'food', [F.shop]: 'shop', [F.fuel]: 'shop', [F.water]: 'water',
  [F.picnic]: 'picnic', [F.playground]: 'playground', [F.dogPark]: 'dogPark',
  [F.park]: 'green', [F.forest]: 'green', [F.meadow]: 'green',
};
const GREEN_KIND = { [F.park]: 1, [F.forest]: 2, [F.meadow]: 3 };
const GREEN_BITS = F.park | F.forest | F.meadow;
const AREA_PAD_DEG = 0.012;   // größte halbe Ausdehnung einer Rastanlage (~1 km)

// 2. Durchgang: Einrichtungen und Grünflächen mit exaktem Abstand zur Geometrie.
// Einrichtungen (WC, Essen …) zählen ab dem Gelände der Anlage, Grünflächen ab ihrem Mittelpunkt.
let items = 0;
for await (const feat of features()) {
  const t = feat.properties || {};
  const f = featureOf(t);
  if (!f || !feat.geometry) continue;
  const [bit, radius] = f;
  const b = bbox(feat.geometry);
  if (!b) continue;
  items++;
  const [minLat, minLon, maxLat, maxLon] = b;
  const cellsAround = (pad, gridMap, fn) => {
    const padLat = pad / M_PER_DEG, padLon = padLat / Math.cos(minLat * Math.PI / 180);
    const i0 = Math.floor((minLat - padLat) / CELL), i1 = Math.floor((maxLat + padLat) / CELL);
    const j0 = Math.floor((minLon - padLon) / CELL), j1 = Math.floor((maxLon + padLon) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      for (const x of gridMap.get(`${i}:${j}`) || []) {
        const [lat, lon] = x.p;
        if (lat < minLat - padLat || lat > maxLat + padLat || lon < minLon - padLon || lon > maxLon + padLon) continue;
        fn(x);
      }
    }
  };
  const isGreen = (bit & GREEN_BITS) !== 0;
  const itemCenter = [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
  cellsAround(radius + AREA_PAD_DEG * M_PER_DEG, grid, a => {
    if (a.flags & bit) return;
    const d = isGreen ? distanceToGeometry(a.p, feat.geometry) : distanceToGeometry(itemCenter, a.g);
    if (d <= radius) a.flags |= bit;
  });
  if (sites.length) {
    const k = SITE_KEY[bit];
    cellsAround(SITE_MAX_M, siteGrid, s => {
      const d = distanceToGeometry(s.p, feat.geometry);
      if (d <= SITE_MAX_M && !(s.d[k] <= d)) {
        s.d[k] = d;
        if (k === 'green') s.greenKind = GREEN_KIND[bit];
      }
    });
  }
}
console.log(`${items} Einrichtungen und Grünflächen ausgewertet`);

// Doppelte Objekte (gleicher Name, < 80 m) zusammenfassen
const merged = [];
const byName = new Map();
for (const a of areas) {
  const same = byName.get(a.name) || [];
  const dup = same.find(m => distM(m.p, a.p) < 80);
  if (dup) { dup.flags |= a.flags; continue; }
  same.push(a);
  byName.set(a.name, same);
  merged.push(a);
}

const names = [...new Set(merged.map(a => a.name))].sort();
const nIdx = new Map(names.map((n, i) => [n, i]));
const round5 = x => Math.round(x * 1e5) / 1e5;
const data = {
  quelle: 'OpenStreetMap (Geofabrik-Extrakt Deutschland), © OpenStreetMap-Mitwirkende, ODbL',
  stand: new Date().toISOString().slice(0, 10),
  felder: ['lat', 'lon', 'nameIndex', 'typ (0=Rastplatz, 1=Rastanlage, 2=Autohof)', 'ausstattungBits'],
  ausstattungBits: F,
  namen: names,
  punkte: merged.map(a => [round5(a.p[0]), round5(a.p[1]), nIdx.get(a.name), a.autohof ? 2 : a.services ? 1 : 0, a.flags]),
};
const json = JSON.stringify(data);
await writeFile(OUT, json + '\n');
const count = bit => merged.filter(a => a.flags & bit).length;
console.log(`${merged.length} Rastanlagen, davon mit WC ${count(F.toilets)}, Essen ${count(F.food)}, Grün/Hund ${count(F.dogPark | F.park | F.forest | F.meadow)}, ${(json.length / 1e6).toFixed(2)} MB → ${OUT}`);

// Fußwege der Schnelllade-Standorte (in 10 m, 255 = nichts innerhalb 600 m)
const SITE_FIELDS = ['wc', 'food', 'shop', 'water', 'picnic', 'playground', 'dogPark', 'green'];
const enc = d => d == null ? 255 : Math.min(254, Math.round(d / 10));
const sitesData = {
  quelle: 'Bundesnetzagentur (Ladesäulenregister) und OpenStreetMap (© OpenStreetMap-Mitwirkende, ODbL)',
  stand: data.stand,
  felder: ['lat', 'lon', ...SITE_FIELDS.map(f => `${f} (×10 m, 255 = > ${SITE_MAX_M} m)`), 'gruenArt (0 = keine, 1 = Park, 2 = Wald, 3 = Wiese)'],
  punkte: sites.map(s => [round5(s.p[0]), round5(s.p[1]), ...SITE_FIELDS.map(f => enc(s.d[f])), s.greenKind]),
};
const sitesJson = JSON.stringify(sitesData);
await writeFile(OUT_SITES, sitesJson + '\n');
const near = (f, m) => sites.filter(s => s.d[f] != null && s.d[f] <= m).length;
console.log(`${sites.length} Ladestandorte: WC ≤ 300 m ${near('wc', 300)}, Essen ≤ 300 m ${near('food', 300)}, Grün ≤ 150 m ${near('green', 150)}, Hundewiese ≤ 600 m ${near('dogPark', 600)}, ${(sitesJson.length / 1e6).toFixed(2)} MB → ${OUT_SITES}`);
