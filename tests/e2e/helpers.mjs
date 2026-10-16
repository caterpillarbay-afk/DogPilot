// Gemeinsame Hilfen für die Browser-Tests (Playwright + node:test).
// Alle externen Dienste sind nachgestellt: die Tests laufen ohne Netz und liefern immer dasselbe.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { encodePolyline } from '../../js/geo.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---------- statischer Webserver für die App ----------

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

export function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

// ---------- Teststrecke Hamburg → München (~775 km) ----------

const WP = [[53.55, 10.0], [52.37, 9.73], [51.31, 9.48], [50.55, 9.68], [49.79, 9.95], [49.45, 11.08], [48.76, 11.42], [48.14, 11.58]];
export const PTS = [];
for (let i = 0; i < WP.length - 1; i++) {
  const [a, b] = [WP[i], WP[i + 1]];
  for (let t = 0; t < 1; t += 0.005) PTS.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
}
PTS.push(WP.at(-1));
export const PLACES = { Hamburg: [53.55, 10.0], München: [48.14, 11.58], Prien: [47.856, 12.346] };

// Rastanlagen links und rechts der Strecke
function restAreas() {
  const namen = [], punkte = [];
  for (let i = 10; i < PTS.length; i += 25) {
    const [la, lo] = PTS[i];
    namen.push('Rastanlage ' + i); punkte.push([la, lo + 0.002, namen.length - 1, i % 50 ? 1 : 0, i % 3 ? (1 | 2 | 512) : (1 | 1024 | 128)]);
    namen.push('Gegenseite ' + i); punkte.push([la, lo - 0.002, namen.length - 1, 1, 1 | 2]);
  }
  return { quelle: 'test', stand: '2026-10-01', felder: [], ausstattungBits: {}, namen, punkte };
}

// Meldungen der Autobahn GmbH auf der A7 (Teststrecke): Sperrung, Überleitung am Autobahnwechsel (3 Richtungen),
// Abfahrt zum Vorbeifahren, Baustelle, Baustelle in Gegenrichtung (muss fehlen), künftige Baustelle (muss fehlen)
function autobahnItems(kind) {
  const P = i => ({ lat: PTS[i][0], long: PTS[i][1] });
  const ext = (i, j) => `${PTS[i][0]},${PTS[i][1]},${PTS[j][0]},${PTS[j][1]}`;
  const fmt = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const range = `${fmt(new Date(Date.now() - 86400000))} bis zum ${fmt(new Date(Date.now() + 9 * 86400000))} Uhr.`;
  const it = (id, i, j, extra = {}) => ({ identifier: id, title: `A7 | Test ${id}`, subtitle: ' Hamburg -> München', coordinate: P(i), extent: ext(i, j), isBlocked: 'false', future: false, description: ['Beschreibung ' + id], ...extra });
  const wechsel = (id, sub, extra) => it(id, 1195, 1196, { title: 'A7 | Test Wechsel', subtitle: ` AK Test (aus Richtung ${sub})`, ...extra });
  return {
    closure: [
      it('Vollsperrung', 300, 305, { isBlocked: 'true', description: ['Die Baustelle ist zu folgenden Zeiträumen gültig:', range] }),
      wechsel('W1', 'Hamburg', {}),
      it('Abfahrt', 350, 351, { subtitle: ' AS Test (aus Richtung Hamburg)' }),
    ],
    warning: [],
    roadworks: [
      wechsel('W2', 'Lußhardt', {}), wechsel('W3', 'Wiesloch', {}),
      it('Baustelle', 200, 204), it('Gegenrichtung', 405, 400), it('Zukunft', 250, 255, { future: true }),
      it('Rampenprogramm', 600, 604, { title: 'A7 | Rampenprogramm Test' }),
    ],
  }[kind];
}

// ---------- Browser mit allen nachgestellten Diensten ----------

// opts.photonDelayMs: langsame Ortssuche; opts.photonDown: Ortssuche fällt aus (→ Nominatim);
// opts.fakeClock: vorspulbare Uhr
export async function openApp(baseUrl, opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: 'dark',
    permissions: ['geolocation'], geolocation: { latitude: PTS[0][0], longitude: PTS[0][1] },
  });
  // Sprachausgabe und Teilen mitschneiden
  await ctx.addInitScript(() => {
    window.__said = []; window.__shared = null;
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    Object.defineProperty(window, 'speechSynthesis', { value: { speak: u => window.__said.push(u.text), cancel() {}, getVoices: () => [] }, configurable: true });
    navigator.share = async d => { window.__shared = d; };
  });
  // Android-App nachstellen: Brücke window.DogPilotAndroid schneidet Aufrufe mit
  if (opts.android) await ctx.addInitScript(() => {
    window.__native = [];
    window.DogPilotAndroid = {
      speak: (text, channel) => window.__native.push(['speak', text, channel]), stop: () => window.__native.push(['stop']),
      keepScreenOn: on => window.__native.push(['screen', on]), saveFile: (name, mime, content) => window.__native.push(['save', name, mime, content]),
      share: (title, text) => window.__native.push(['share', title, text]), version: () => '1.7', ready: () => true,
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  const cs = JSON.parse(fs.readFileSync(path.join(ROOT, 'charging-stations.json')));
  const sitePts = cs.punkte.filter(p => p[2] >= 50 && p[0] > 48 && p[0] < 53.7 && p[1] > 9.3 && p[1] < 11.7)
    .map((p, i) => [p[0], p[1], i % 3 ? 18 : 45, i % 2 ? 32 : 255, 25, 255, i % 4 ? 255 : 12, 255, i % 7 ? 255 : 40, i % 3 ? 9 : 52, i % 3 ? 3 : 2]);
  await ctx.route('**/rest-areas.json', r => r.fulfill({ json: restAreas() }));
  await ctx.route('**/charger-sites.json', r => r.fulfill({ json: { stand: '2026-10-08', punkte: sitePts } }));
  // Update-Erkennung nicht stören lassen
  await ctx.route('**/sw.js', r => r.fulfill({ status: 404, body: '' }));

  const feature = name => { const [lat, lon] = PLACES[name]; return { geometry: { coordinates: [lon, lat] }, properties: { name, city: name, countrycode: 'DE' } }; };
  await ctx.route('https://photon.komoot.io/**', async r => {
    const u = new URL(r.request().url());
    if (u.pathname.startsWith('/reverse')) return r.fulfill({ json: { features: [{ properties: { name: 'Penny', street: 'Carl-Theodor-Straße', housenumber: '12', city: 'Alzey', countrycode: 'DE' } }] } });
    if (opts.photonDown) return r.fulfill({ status: 503, body: 'down' });
    if (opts.photonDelayMs) await new Promise(res => setTimeout(res, opts.photonDelayMs));
    const q = u.searchParams.get('q') || '';
    // Wie Photon echt antwortet: Hausnummer 12 kennt die Karte nur in einer anderen Straße
    if (/theodor/i.test(q)) return r.fulfill({ json: { features: [
      { geometry: { coordinates: [8.1150, 49.7470] }, properties: { type: 'street', name: 'Carl-Theodor-Straße', city: 'Alzey', postcode: '55232', countrycode: 'DE' } },
      { geometry: { coordinates: [8.1000, 49.7400] }, properties: { type: 'house', street: 'Carl-von-Ossietzky-Straße', housenumber: '12', city: 'Alzey', postcode: '55232', countrycode: 'DE' } }] } });
    r.fulfill({ json: { features: /ham/i.test(q) ? [feature('Hamburg')] : /prien/i.test(q) ? [feature('Prien')] : [feature('München')] } });
  });
  await ctx.route('https://nominatim.openstreetmap.org/**', r => r.fulfill({ json: [{ name: 'Prien am Chiemsee', lat: '47.856', lon: '12.346', address: { town: 'Prien am Chiemsee', postcode: '83209', state: 'Bayern', country_code: 'de' } }] }));
  await ctx.route('https://valhalla1.openstreetmap.de/route', r => r.fulfill({ json: { trip: {
    legs: [{ shape: encodePolyline(PTS, 6), maneuvers: [{ begin_shape_index: 0, street_names: ['Hauptstraße'] }, { begin_shape_index: 2, street_names: ['A 7'] }, { begin_shape_index: 1200, street_names: ['A 9'] }] }],
    summary: { length: 775, time: 7.2 * 3600 } } } }));
  // TomTom: Schlüssel „GUT“ liefert eine Route mit Live-Verkehr, alles andere 403
  await ctx.route('https://api.tomtom.com/**', r => {
    const u = new URL(r.request().url());
    if (u.searchParams.get('key') !== 'GUT') return r.fulfill({ status: 403, headers: { 'access-control-allow-origin': '*' }, body: 'Forbidden' });
    if (u.pathname.startsWith('/search/2/geocode/')) return r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { results: [
      { type: 'Point Address', address: { streetName: 'Carl-Theodor-Straße', streetNumber: '12', postalCode: '55232', municipality: 'Alzey', countryCode: 'DE' }, position: { lat: 49.7468, lon: 8.1162 } }] } });
    r.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { routes: [{
      legs: [{ points: PTS.map(([latitude, longitude]) => ({ latitude, longitude })) }],
      summary: { lengthInMeters: 775000, travelTimeInSeconds: 7.5 * 3600, trafficDelayInSeconds: 1200 },
      guidance: { instructions: [{ point: { latitude: PTS[2][0], longitude: PTS[2][1] }, roadNumbers: ['A7'] }] } }] } });
  });
  await ctx.route('https://valhalla1.openstreetmap.de/height', r => r.fulfill({ json: { range_height: Array.from({ length: 390 }, (_, i) => [i * 2000, 100 + 300 * Math.sin(i / 20) ** 2]) } }));
  await ctx.route('https://routing.openstreetmap.de/**', r => r.fulfill({ status: 503, body: '' }));
  await ctx.route('https://api.open-meteo.com/**', r => {
    const now = new Date(), time = [], temp = [];
    for (let h = 0; h < 24 * 30; h++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, h)); time.push(d.toISOString().slice(0, 13) + ':00'); temp.push(6); }
    r.fulfill({ json: [0, 1, 2].map(() => ({ hourly: { time, temperature_2m: temp } })) });
  });
  await ctx.route('https://tile.openstreetmap.org/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'icon-192.png')) }));
  await ctx.route('https://api.mobidata-bw.de/**', r => {
    const lat = +new URL(r.request().url()).searchParams.get('lat');
    const ev = (id, status) => ({ evse_id: id, status, last_updated: '2026-10-08T20:00:00Z', connectors: [{ max_electric_power: 300000 }] });
    const k = Math.round(lat * 100) % 3;
    const evses = k === 0 ? [ev('A1', 'AVAILABLE'), ev('A2', 'CHARGING'), ev('A3', 'AVAILABLE'), ev('A4', 'OUTOFORDER')] : k === 1 ? [ev('B1', 'CHARGING'), ev('B2', 'CHARGING')] : [ev('C1', 'STATIC')];
    r.fulfill({ json: { items: [{ source: 'test', evses }], total_count: 1 } });
  });
  await ctx.route('https://verkehr.autobahn.de/**', r => {
    const parts = new URL(r.request().url()).pathname.split('/'), kind = parts.at(-1), road = parts.at(-3);
    r.fulfill({ json: { [kind]: road === 'A7' ? autobahnItems(kind) : [] } });
  });

  if (opts.fakeClock) await page.clock.install();   // Zeit vorspulbar (Lade-Timer im Fahrt-Modus)
  await page.goto(baseUrl + '/index.html');
  return { browser, ctx, page, errors, close: () => browser.close() };
}

// Einrichtung: Audi Q4 (Variante 1), 22 kWh/100 km, zwei Hunde
export async function onboard(page) {
  await page.waitForSelector('#obNext');
  await page.click('#obNext');
  await page.waitForSelector('#vMake option:nth-child(5)', { state: 'attached' });
  await page.selectOption('#vMake', 'AUDI');
  const model = await page.$eval('#vModel', s => [...s.options].find(o => /Q4/.test(o.textContent))?.value);
  await page.selectOption('#vModel', model);
  await page.waitForSelector('#vVariant');
  await page.selectOption('#vVariant', '1');
  await page.fill('#vConsumption', '22'); await page.dispatchEvent('#vConsumption', 'change');
  await page.click('#obNext');
  for (const [i, name] of ['Schoko', 'Fibi'].entries()) {
    await page.click('#dogAdd');
    await page.fill(`[data-dog-name="${i}"]`, name); await page.dispatchEvent(`[data-dog-name="${i}"]`, 'change');
  }
  await page.click('#obNext');
  await page.click('#obNext');
  await page.waitForSelector('#from');
}

// Ort eintippen und ersten Vorschlag wählen
export async function choosePlace(page, id, text) {
  await page.fill('#' + id, text);
  await page.waitForSelector(`#${id}-list button`);
  await page.click(`#${id}-list button >> nth=0`);
}

// Hamburg → München planen (Abfahrt), wartet auf die Fahrtübersicht
export async function planTrip(page) {
  await choosePlace(page, 'from', 'Hamb');
  await choosePlace(page, 'to', 'Münch');
  await page.click('#planBtn');
  await page.waitForSelector('.timeline', { timeout: 30000 });
}

export const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
