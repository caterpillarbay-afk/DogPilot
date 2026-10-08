// Externe, kostenlose Dienste:
// - Ortssuche: Photon (komoot, OpenStreetMap-Daten), kein Schlüssel
// - Routing: TomTom (mit eigenem Schlüssel, inkl. Live-Verkehr), sonst Valhalla von FOSSGIS e.V.,
//   ersatzweise OSRM von FOSSGIS e.V.
// - Höhenprofil: Valhalla /height (FOSSGIS)
// - Wetter: Open-Meteo, kein Schlüssel
// - Ladesäulen-Status: Open Charge Map (nur mit eigenem, kostenlosem Schlüssel)

import { decodePolyline, encodePolyline, simplifyByDistance } from './geo.js';

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

export async function searchPlaces(query, near) {
  if (!query || query.trim().length < 2) return [];
  const params = new URLSearchParams({ q: query.trim(), limit: '6', lang: 'de' });
  if (near) { params.set('lat', near[0]); params.set('lon', near[1]); }
  const d = await getJson(`https://photon.komoot.io/api/?${params}`, { timeout: 8000 });
  const seen = new Set();
  return (d.features || []).map(f => {
    const { main, sub } = photonLabel(f.properties);
    return { main, sub, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
  }).filter(r => r.main && !seen.has(r.main + r.sub) && seen.add(r.main + r.sub));
}

// ---------- Routing ----------

async function routeTomTom(from, to, key) {
  const url = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json`
    + `?key=${encodeURIComponent(key)}&traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all`;
  const d = await getJson(url);
  const r = d.routes?.[0];
  if (!r) throw new Error('Keine Route gefunden');
  return {
    provider: 'TomTom (mit Live-Verkehr)',
    points: r.legs.flatMap(l => l.points.map(p => [p.latitude, p.longitude])),
    lengthKm: r.summary.lengthInMeters / 1000,
    durationMin: r.summary.travelTimeInSeconds / 60,
    trafficDelayMin: (r.summary.trafficDelayInSeconds || 0) / 60,
  };
}

async function routeValhalla(from, to) {
  const d = await postJson(`${VALHALLA}/route`, {
    locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
    costing: 'auto', units: 'kilometers', directions_type: 'none',
  });
  const leg = d.trip?.legs?.[0];
  if (!leg) throw new Error('Keine Route gefunden');
  return {
    provider: 'Valhalla (FOSSGIS e.V.)',
    points: decodePolyline(leg.shape, 6),
    lengthKm: d.trip.summary.length,
    durationMin: d.trip.summary.time / 60,
    trafficDelayMin: null,
  };
}

async function routeOsrm(from, to) {
  const d = await getJson(`${OSRM}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=polyline6`);
  const r = d.routes?.[0];
  if (!r) throw new Error('Keine Route gefunden');
  return {
    provider: 'OSRM (FOSSGIS e.V.)',
    points: decodePolyline(r.geometry, 6),
    lengthKm: r.distance / 1000,
    durationMin: r.duration / 60,
    trafficDelayMin: null,
  };
}

export async function getRoute(from, to, { tomtomKey } = {}) {
  const attempts = [
    ...(tomtomKey ? [() => routeTomTom(from, to, tomtomKey)] : []),
    () => routeValhalla(from, to),
    () => routeOsrm(from, to),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try { return await attempt(); } catch (err) { lastErr = err; }
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

// ---------- Ladesäulen-Status (Open Charge Map) ----------

export async function getChargerStatus(lat, lon, key) {
  const params = new URLSearchParams({ output: 'json', latitude: lat, longitude: lon, distance: '0.5', distanceunit: 'KM', maxresults: '10', compact: 'true', verbose: 'false', key });
  const data = await getJson(`https://api.openchargemap.io/v3/poi/?${params}`, { timeout: 10000 });
  let operational = 0, faulted = 0, unknown = 0;
  for (const poi of data) for (const c of poi.Connections || []) {
    if (c.StatusTypeID === 50) operational++;
    else if ([30, 75, 150].includes(c.StatusTypeID)) faulted++;
    else unknown++;
  }
  return { operational, faulted, unknown, total: operational + faulted + unknown };
}
