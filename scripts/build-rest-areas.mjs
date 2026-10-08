#!/usr/bin/env node
// Erzeugt rest-areas.json aus OpenStreetMap (Overpass API): alle Rastanlagen und Rastplätze
// in Deutschland samt Ausstattung im Umkreis – für Mensch (WC, Essen, Shop) und Hund
// (Hundewiese, Park, Wald, Wiese, Picknickplatz, Trinkwasser).
// Aufruf (Node >= 18, keine Abhängigkeiten):  node scripts/build-rest-areas.mjs
// Ausgabe: rest-areas.json im Repo-Root. Daten © OpenStreetMap-Mitwirkende, ODbL.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'rest-areas.json');
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const UA = 'DogPilot-DataBuilder (+https://github.com/caterpillarbay-afk/DogPilot)';
const AMENITY_RADIUS_M = 250; // Einrichtungen, die zur Anlage selbst gehören
const GREEN_RADIUS_M = 600;   // Grün und Hundewiesen in Gassi-Entfernung

// Deutschland (samt Grenzregionen) in Kacheln abfragen – eine einzige Abfrage überfordert die
// öffentlichen Overpass-Server. Grünflächen werden über ihre Randpunkte im Umkreis gefunden, damit
// auch große Wälder zählen, deren Mittelpunkt weit entfernt liegt.
const TILE_DEG = 1.5;
const BOUNDS = { south: 47.2, north: 55.1, west: 5.8, east: 15.1 };

const tileQuery = ([s, w, n, e]) => `
[out:json][timeout:300];
nwr[highway~"^(services|rest_area)$"](${s},${w},${n},${e})->.r;
.r out center tags;
make grp name=amenity; out;
(
  nwr(around.r:${AMENITY_RADIUS_M})[amenity~"^(toilets|restaurant|fast_food|cafe|drinking_water|fuel)$"];
  nwr(around.r:${AMENITY_RADIUS_M})[shop~"^(convenience|kiosk)$"];
  nwr(around.r:${AMENITY_RADIUS_M})[leisure~"^(picnic_table|playground)$"];
  nwr(around.r:${AMENITY_RADIUS_M})[tourism=picnic_site];
  nwr(around.r:${GREEN_RADIUS_M})[leisure=dog_park];
);
out center tags;
make grp name=park; out;
(way(around.r:${GREEN_RADIUS_M})[leisure=park]; way(around.r:${GREEN_RADIUS_M})[landuse=recreation_ground];);
node(w)(around.r:${GREEN_RADIUS_M});
out skel qt;
make grp name=forest; out;
(way(around.r:${GREEN_RADIUS_M})[landuse=forest]; way(around.r:${GREEN_RADIUS_M})[natural=wood];);
node(w)(around.r:${GREEN_RADIUS_M});
out skel qt;
make grp name=meadow; out;
(way(around.r:${GREEN_RADIUS_M})[landuse=meadow]; way(around.r:${GREEN_RADIUS_M})[natural~"^(grassland|heath)$"];);
node(w)(around.r:${GREEN_RADIUS_M});
out skel qt;
`;

function tiles() {
  const out = [];
  for (let s = BOUNDS.south; s < BOUNDS.north; s += TILE_DEG) {
    for (let w = BOUNDS.west; w < BOUNDS.east; w += TILE_DEG) {
      out.push([s, w, Math.min(s + TILE_DEG, BOUNDS.north), Math.min(w + TILE_DEG, BOUNDS.east)].map(x => +x.toFixed(3)));
    }
  }
  return out;
}

// Ausstattungs-Bits (gleiche Reihenfolge wie FEATURES in js/data.js der App)
const F = {
  toilets: 1, food: 2, shop: 4, fuel: 8, water: 16, picnic: 32,
  playground: 64, dogPark: 128, park: 256, forest: 512, meadow: 1024,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function overpass(query) {
  for (let round = 0; round < 2; round++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(6 * 60 * 1000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.remark && /error|timed out|runtime/i.test(json.remark)) throw new Error(json.remark.slice(0, 120));
        return json.elements || [];
      } catch (err) {
        console.warn(`  ${new URL(url).host}: ${err.message}`);
        await sleep(5000);
      }
    }
    await sleep(30000);
  }
  throw new Error('Kein Overpass-Server lieferte Daten.');
}

const pos = el => el.type === 'node' ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null;

function distM(a, b) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function featureOf(tags) {
  const a = tags.amenity, l = tags.leisure, lu = tags.landuse, n = tags.natural;
  if (a === 'toilets') return [F.toilets, AMENITY_RADIUS_M];
  if (a === 'restaurant' || a === 'fast_food' || a === 'cafe') return [F.food, AMENITY_RADIUS_M];
  if (a === 'fuel') return [F.fuel, AMENITY_RADIUS_M];
  if (a === 'drinking_water') return [F.water, AMENITY_RADIUS_M];
  if (tags.shop) return [F.shop, AMENITY_RADIUS_M];
  if (l === 'picnic_table' || tags.tourism === 'picnic_site') return [F.picnic, AMENITY_RADIUS_M];
  if (l === 'playground') return [F.playground, AMENITY_RADIUS_M];
  if (l === 'dog_park') return [F.dogPark, GREEN_RADIUS_M];
  if (l === 'park' || lu === 'recreation_ground') return [F.park, GREEN_RADIUS_M];
  if (lu === 'forest' || n === 'wood') return [F.forest, GREEN_RADIUS_M];
  if (lu === 'meadow' || lu === 'grass' || n === 'grassland' || n === 'heath') return [F.meadow, GREEN_RADIUS_M];
  return null;
}

// Ausstattung, die direkt an der Anlage getaggt ist
function ownFlags(tags) {
  let f = 0;
  if (tags.toilets === 'yes') f |= F.toilets;
  if (tags.drinking_water === 'yes') f |= F.water;
  if (tags.picnic_table === 'yes') f |= F.picnic;
  if (tags.fuel === 'yes') f |= F.fuel;
  return f;
}

const areas = [], pois = [], seen = new Set();
const all = tiles();
for (const [i, tile] of all.entries()) {
  const elements = await overpass(tileQuery(tile));
  let group = null, nA = 0, nP = 0;
  for (const el of elements) {
    if (el.type === 'grp') { group = el.tags?.name; continue; }
    const p = pos(el);
    if (!p) continue;
    if (group === null) {
      if (!seen.has(el.type + el.id)) { seen.add(el.type + el.id); areas.push({ el, p }); nA++; }
      continue;
    }
    const bit = group === 'amenity' ? featureOf(el.tags || {}) : [F[{ park: 'park', forest: 'forest', meadow: 'meadow' }[group]], GREEN_RADIUS_M];
    if (bit && bit[0]) { pois.push({ p, bit: bit[0], radius: bit[1] }); nP++; }
  }
  console.log(`Kachel ${i + 1}/${all.length} [${tile.join(', ')}]: ${nA} Anlagen, ${nP} Einrichtungen/Grünpunkte`);
  await sleep(2000);
}
console.log(`${areas.length} Anlagen, ${pois.length} Einrichtungen in der Nähe`);
if (areas.length < 500) throw new Error(`Nur ${areas.length} Anlagen – Antwort unvollständig?`);

// Raster-Index der Anlagen (~0,01°) für die Zuordnung der Einrichtungen
const cell = p => `${Math.floor(p[0] * 100)}:${Math.floor(p[1] * 100)}`;
const grid = new Map();
const out = areas.map(({ el, p }) => {
  const t = el.tags;
  const a = { p, flags: ownFlags(t), name: (t.name || '').trim(), services: t.highway === 'services', autohof: /autohof|truck ?stop/i.test(t.name || '') };
  const k = cell(p);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(a);
  return a;
});
for (const poi of pois) {
  const [ci, cj] = [Math.floor(poi.p[0] * 100), Math.floor(poi.p[1] * 100)];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    for (const a of grid.get(`${ci + di}:${cj + dj}`) || []) {
      if (distM(a.p, poi.p) <= poi.radius) a.flags |= poi.bit;
    }
  }
}

// Doppelte Objekte (gleicher Name, < 80 m) zusammenfassen
const merged = [];
for (const a of out) {
  const dup = merged.find(m => m.name === a.name && distM(m.p, a.p) < 80);
  if (dup) { dup.flags |= a.flags; continue; }
  merged.push(a);
}

const names = [...new Set(merged.map(a => a.name))].sort();
const nIdx = new Map(names.map((n, i) => [n, i]));
const round5 = x => Math.round(x * 1e5) / 1e5;
const data = {
  quelle: 'OpenStreetMap (Overpass API), © OpenStreetMap-Mitwirkende, ODbL',
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
