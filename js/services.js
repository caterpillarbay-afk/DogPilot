// Externe, kostenlose Dienste:
// - Ortssuche: Photon (komoot, OpenStreetMap-Daten), kein Schlüssel; ersatzweise Nominatim (OSMF)
// - Routing: TomTom (mit eigenem Schlüssel, inkl. Live-Verkehr), sonst Valhalla von FOSSGIS e.V.,
//   ersatzweise OSRM von FOSSGIS e.V.
// - Höhenprofil: Valhalla /height (FOSSGIS)
// - Wetter: Open-Meteo, kein Schlüssel
// - Ladesäulen-Belegung: MobiData BW (NVBW), Open ChargePoint DataBase, kein Schlüssel
// - Baustellen und Sperrungen: Autobahn GmbH des Bundes (verkehr.autobahn.de), kein Schlüssel

import { decodePolyline, encodePolyline, simplifyByDistance, parseCoordinates } from './geo.js';
import { summarizeLive } from './data.js';
import { autobahnRoads, motorwayChanges } from './traffic.js';

const VALHALLA = 'https://valhalla1.openstreetmap.de';
const OSRM = 'https://routing.openstreetmap.de/routed-car';
const TIMEOUT_MS = 20000;

async function getJson(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || TIMEOUT_MS) });
  } catch (err) {
    throw new Error(err.name === 'TimeoutError' ? 'Zeitüberschreitung – bitte erneut versuchen' : 'Keine Internetverbindung');
  }
  if (!res.ok) throw new Error(`Dienst antwortet nicht (HTTP ${res.status})`);
  return res.json();
}

const postJson = (url, body) => getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------- Ortssuche ----------

function photonLabel(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const main = p.name || street || p.city || '';
  const city = p.city || p.town || p.village || '';
  const place = city && city !== main ? [p.postcode, city].filter(Boolean).join(' ') : '';
  const sub = [street && street !== main ? street : '', place || (p.state !== main ? p.state : ''), p.country && p.countrycode !== 'DE' ? p.country : '']
    .filter(Boolean).join(', ');
  return { main, sub };
}

// Eingefügte Koordinaten direkt übernehmen; die Adresse dazu ist nur Beschriftung (Photon-Rückwärtssuche)
async function coordinatePlace([lat, lon]) {
  const sub = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  try {
    const d = await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=de`, { timeout: 5000 });
    const p = d.features?.[0]?.properties;
    if (p) {
      const { main, sub: place } = photonLabel(p);
      if (main) return [{ main, sub: [place, sub].filter(Boolean).join(' · '), lat, lon }];
    }
  } catch { /* Beschriftung ist optional */ }
  return [{ main: 'Koordinaten', sub, lat, lon }];
}

// Beschriftung für den aktuellen Standort: „Alzey, Carl-Theodor-Straße 12“ – Ort zuerst, damit die
// Fahrtübersicht „Alzey → Chiemsee“ zeigt. Ohne Netz oder Treffer: null.
export async function placeLabel(lat, lon) {
  try {
    const d = await getJson(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=de`, { timeout: 5000 });
    const p = d.features?.[0]?.properties;
    if (!p) return null;
    const city = p.city || p.town || p.village || p.name || '';
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    return [city, street].filter(Boolean).join(', ') || null;
  } catch {
    return null;
  }
}

async function searchPhoton(query, near) {
  const params = new URLSearchParams({ q: query, limit: '6', lang: 'de' });
  if (near) { params.set('lat', near[0]); params.set('lon', near[1]); }
  const d = await getJson(`https://photon.komoot.io/api/?${params}`, { timeout: 8000 });
  return (d.features || []).map(f => ({ ...photonLabel(f.properties), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
    street: f.properties.type === 'street' ? f.properties.name : null,
    road: f.properties.street || null, housenumber: f.properties.housenumber || null,
    city: f.properties.city || f.properties.town || f.properties.village || null }));
}

// Ersatz, wenn Photon nicht antwortet: Nominatim (OpenStreetMap Foundation), nur bei Bedarf und je Eingabe einmal
async function searchNominatim(query) {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', addressdetails: '1', 'accept-language': 'de' });
  const d = await getJson(`https://nominatim.openstreetmap.org/search?${params}`, { timeout: 8000 });
  return (Array.isArray(d) ? d : []).map(r => {
    const a = r.address || {};
    const city = a.city || a.town || a.village || a.municipality || '';
    const street = [a.road, a.house_number].filter(Boolean).join(' ');
    const main = r.name || street || city || r.display_name?.split(',')[0] || '';
    const place = city && city !== main ? [a.postcode, city].filter(Boolean).join(' ') : '';
    const sub = [street && street !== main ? street : '', place || (a.state !== main ? a.state : ''), a.country_code && a.country_code !== 'de' ? a.country : '']
      .filter(Boolean).join(', ');
    return { main, sub, lat: Number(r.lat), lon: Number(r.lon), street: r.addresstype === 'road' ? a.road || r.name : null, road: a.road || null, housenumber: a.house_number || null, city: city || null };
  });
}

// Hausnummer aus der Eingabe („Carl-Theodor-Straße 12, 55232 Alzey“ → „12“); Postleitzahlen zählen nicht
export function houseNumber(query) {
  const m = /(?:^|[\s,])(\d{1,4}\s?[a-z]?)(?=$|[\s,])/i.exec(String(query || ''));
  return m ? m[1].replace(/\s/g, '').toLowerCase() : null;
}

// Gibt es das Haus „Straße + Nummer“ im selben Ort in den Treffern? Andere Straßen mit derselben Nummer
// zählen nicht – und auch nicht dieselbe Straße woanders („Hauptstraße 2“ gibt es in vielen Orten).
const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
const hasHouse = (list, s, hn) => list.some(r => r.housenumber?.toLowerCase() === hn && same(r.road, s.street) && same(r.city, s.city));

// Kennt die Karte die Hausnummer nicht, liefert die Suche nur die Straße. Dann bleibt die eingetippte
// Nummer in der Beschriftung stehen, mit Hinweis, dass die Straße angesteuert wird.
export function keepHouseNumber(list, hn) {
  if (!hn) return list;
  return list.map(r => r.street && !hasHouse(list, r, hn)
    ? { ...r, main: `${r.street} ${hn}`, sub: [r.sub, 'Hausnummer nicht in der Karte – Ziel ist die Straße'].filter(Boolean).join(' · ') }
    : r);
}

// TomTom kennt auch Hausnummern, die in OpenStreetMap fehlen (nur mit eigenem Schlüssel)
async function searchTomTom(query, key) {
  const params = new URLSearchParams({ key, language: 'de-DE', limit: '3', countrySet: 'DE,AT,CH,FR,IT,NL,BE,LU,DK,CZ,PL' });
  const d = await getJson(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(query)}.json?${params}`, { timeout: 6000 });
  return (d.results || []).filter(r => r.address?.streetNumber && r.position).map(r => ({
    main: `${r.address.streetName} ${r.address.streetNumber}`,
    sub: [[r.address.postalCode, r.address.municipality].filter(Boolean).join(' '), r.address.countryCode !== 'DE' ? r.address.country : ''].filter(Boolean).join(', '),
    lat: r.position.lat, lon: r.position.lon, road: r.address.streetName, housenumber: String(r.address.streetNumber), city: r.address.municipality,
  }));
}

export async function searchPlaces(query, near, { tomtomKey } = {}) {
  if (!query || query.trim().length < 2) return [];
  const coords = parseCoordinates(query);
  if (coords) return coordinatePlace(coords);
  let list;
  try {
    list = await searchPhoton(query.trim(), near);
  } catch (err) {
    try { list = await searchNominatim(query.trim()); } catch { throw err; }
  }
  const hn = houseNumber(query);
  // Straße gefunden, das Haus aber nicht: TomTom fragen (falls Schlüssel da)
  if (hn && tomtomKey && list.some(r => r.street && !hasHouse(list, r, hn))) {
    try { list = [...(await searchTomTom(query.trim(), tomtomKey)), ...list]; } catch { /* dann eben ohne */ }
  }
  list = keepHouseNumber(list, hn);
  const seen = new Set();
  return list.filter(r => r.main && !seen.has(r.main + r.sub) && seen.add(r.main + r.sub));
}

// ---------- Routing ----------

// Autobahnen der Route und die Stellen, an denen sie wechselt (für Baustellen-Meldungen)
function roadInfo(steps, extraNames = []) {
  return { roads: autobahnRoads([...steps.flatMap(st => st.names), ...extraNames]), junctions: motorwayChanges(steps) };
}

// Verständlicher Grund, wenn TomTom nicht antwortet (HTTP-Status aus getJson)
export function tomtomReason(err) {
  const m = /HTTP (\d+)/.exec(err?.message || '');
  const code = m ? +m[1] : 0;
  if (code === 401 || code === 403) return 'Schlüssel ungültig oder gesperrt – bitte unter Einstellungen → Erweitert prüfen';
  if (code === 429) return 'Tageskontingent des Schlüssels aufgebraucht';
  return err?.message || 'unbekannter Fehler';
}

// Schlüssel mit einer kurzen Probe-Route prüfen (Alzey Bahnhof → Marktplatz); wirft mit Grund
export async function testTomTomKey(key) {
  await routeTomTom({ lat: 49.7466, lon: 8.1135 }, { lat: 49.7457, lon: 8.1162 }, key);
}

async function routeTomTom(from, to, key) {
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json`
    + `?key=${encodeURIComponent(key)}&traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all&instructionsType=coded`;
  let d;
  try { d = await getJson(url); } catch (err) { throw new Error(tomtomReason(err)); }
  const r = d.routes?.[0];
  if (!r) throw new Error('Keine Route gefunden');
  return {
    provider: 'TomTom (mit Live-Verkehr)',
    points: r.legs.flatMap(l => l.points.map(p => [p.latitude, p.longitude])),
    lengthKm: r.summary.lengthInMeters / 1000,
    durationMin: r.summary.travelTimeInSeconds / 60,
    trafficDelayMin: (r.summary.trafficDelayInSeconds || 0) / 60,
    ...roadInfo((r.guidance?.instructions || []).map(i => ({ lat: i.point?.latitude, lon: i.point?.longitude, names: i.roadNumbers || [] }))),
  };
}

async function routeValhalla(from, to) {
  const d = await postJson(`${VALHALLA}/route`, {
    locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
    costing: 'auto', units: 'kilometers', directions_type: 'maneuvers', language: 'de-DE',
  });
  const leg = d.trip?.legs?.[0];
  if (!leg) throw new Error('Keine Route gefunden');
  const points = decodePolyline(leg.shape, 6);
  return {
    provider: 'Valhalla (FOSSGIS e.V.)',
    points,
    lengthKm: d.trip.summary.length,
    durationMin: d.trip.summary.time / 60,
    trafficDelayMin: null,
    ...roadInfo((leg.maneuvers || []).map(m => ({
      lat: points[m.begin_shape_index]?.[0], lon: points[m.begin_shape_index]?.[1], names: m.street_names || [],
    })), (leg.maneuvers || []).flatMap(m => m.begin_street_names || [])),
  };
}

async function routeOsrm(from, to) {
  const d = await getJson(`${OSRM}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=polyline6&steps=true`);
  const r = d.routes?.[0];
  if (!r) throw new Error('Keine Route gefunden');
  return {
    provider: 'OSRM (FOSSGIS e.V.)',
    points: decodePolyline(r.geometry, 6),
    lengthKm: r.distance / 1000,
    durationMin: r.duration / 60,
    trafficDelayMin: null,
    ...roadInfo(r.legs.flatMap(l => l.steps.map(st => ({ lat: st.maneuver?.location?.[1], lon: st.maneuver?.location?.[0], names: [st.ref, st.name] })))),
  };
}

export async function getRoute(from, to, { tomtomKey } = {}) {
  const attempts = [
    ...(tomtomKey ? [() => routeTomTom(from, to, tomtomKey)] : []),
    () => routeValhalla(from, to),
    () => routeOsrm(from, to),
  ];
  let lastErr, tomtomError = null;
  for (const [i, attempt] of attempts.entries()) {
    try {
      const route = await attempt();
      return tomtomError ? { ...route, tomtomError } : route;
    } catch (err) {
      lastErr = err;
      if (tomtomKey && i === 0) tomtomError = err.message;   // anzeigen, warum ohne Live-Verkehr geplant wurde
    }
  }
  throw new Error(`Route konnte nicht berechnet werden: ${lastErr?.message || 'unbekannter Fehler'}`);
}

// ---------- Höhenprofil ----------

// Liefert [[distanzMeter, höheMeter], …] im Abstand von ~2 km, oder null
export async function getHeights(points) {
  try {
    const thin = simplifyByDistance(points, 0.5);
    const d = await postJson(`${VALHALLA}/height`, {
      encoded_polyline: encodePolyline(thin, 6), shape_format: 'polyline6', resample_distance: 2000, range: true,
    });
    return Array.isArray(d.range_height) && d.range_height.length > 1 ? d.range_height : null;
  } catch {
    return null;
  }
}

// ---------- Wetter ----------

// Mittlere Temperatur an Start, Mitte und Ziel zur jeweils voraussichtlichen Uhrzeit
export async function getTemperature(samples) {
  try {
    const params = new URLSearchParams({
      latitude: samples.map(s => s.lat.toFixed(3)).join(','),
      longitude: samples.map(s => s.lon.toFixed(3)).join(','),
      hourly: 'temperature_2m', forecast_days: '7', timezone: 'UTC',
    });
    const d = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`, { timeout: 8000 });
    const list = Array.isArray(d) ? d : [d];
    const temps = list.map((loc, i) => {
      const hour = samples[i].at.toISOString().slice(0, 13) + ':00';
      const idx = loc.hourly.time.indexOf(hour);
      return idx >= 0 ? loc.hourly.temperature_2m[idx] : null;
    }).filter(t => t != null);
    return temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  } catch {
    return null;
  }
}

// ---------- Live-Status der Ladesäulen (MobiData BW, OCPDB) ----------

// Ladepunkte im Umkreis mit aktuellem Status (frei/belegt/gestört). Die Betreiber melden ihn nach der
// EU-Verordnung AFIR; MobiData BW (NVBW) bündelt die Meldungen deutschlandweit, frei abrufbar (CC0).
export async function getLiveStatus(lat, lon, radiusM = 250) {
  const params = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), radius: String(radiusM), limit: '25' });
  const d = await getJson(`https://api.mobidata-bw.de/ocpdb/api/public/v1/locations?${params}`, { timeout: 8000 });
  return summarizeLive(d.items);
}

// ---------- Baustellen, Sperrungen, Warnungen (Autobahn GmbH) ----------

const AUTOBAHN = 'https://verkehr.autobahn.de/o/autobahn';
const AUTOBAHN_KINDS = ['closure', 'warning', 'roadworks'];

// Alle Meldungen der genannten Autobahnen; einzelne Ausfälle werden übersprungen.
// Liefert null, wenn gar nichts abrufbar war.
export async function getAutobahnEvents(roads) {
  let ok = 0;
  const lists = await Promise.all(roads.flatMap(road => AUTOBAHN_KINDS.map(async kind => {
    try {
      const d = await getJson(`${AUTOBAHN}/${encodeURIComponent(road)}/services/${kind}`, { timeout: 15000 });
      ok++;
      return (d[kind] || []).map(it => ({ ...it, kind }));
    } catch {
      return [];
    }
  })));
  return ok ? lists.flat() : null;
}
