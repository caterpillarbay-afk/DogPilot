// Geometrie-Hilfen: Entfernungen, Routen-Polylinie mit Kilometrierung und
// schnelle Projektion beliebiger Punkte auf die Route (Abstand + Routen-km).

const R_KM = 6371.0088;
const RAD = Math.PI / 180;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Dekodiert Google/Valhalla-Polylines (precision 5 oder 6) zu [[lat, lon], …]
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision, out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lon += d;
    }
    out.push([lat / factor, lon / factor]);
  }
  return out;
}

export function encodePolyline(points, precision = 6) {
  const factor = 10 ** precision;
  let out = '', pLat = 0, pLon = 0;
  const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lat, lon] of points) {
    const la = Math.round(lat * factor), lo = Math.round(lon * factor);
    out += enc(la - pLat) + enc(lo - pLon);
    pLat = la; pLon = lo;
  }
  return out;
}

// Dünnt eine Polylinie auf einen Mindestabstand zwischen Punkten aus (Start/Ende bleiben)
export function simplifyByDistance(points, minKm) {
  if (points.length < 3) return points.slice();
  const out = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    if (haversineKm(last[0], last[1], points[i][0], points[i][1]) >= minKm) { out.push(points[i]); last = points[i]; }
  }
  out.push(points[points.length - 1]);
  return out;
}

// Route mit kumulierten Kilometern und Raster-Index der Segmente
// Koordinaten aus eingefügtem Text lesen, z. B. aus Google Maps:
// "54.7886, 8.8291" · "54,7886 8,8291" · "N 54.7886 E 8.8291" · 54°47'19.0"N 8°49'44.8"E · Links mit @lat,lon oder q=lat,lon
// Liefert [lat, lon] oder null
export function parseCoordinates(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon) ? [lat, lon] : null;
  const sign = (v, h) => /[SW]/i.test(h || '') ? -Math.abs(v) : v;

  // Link mit Koordinaten
  const url = t.match(/[@=/](-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  if (/^https?:\/\//i.test(t)) return url ? valid(+url[1], +url[2]) : null;

  // Grad, Minuten, Sekunden
  const dms = [...t.matchAll(/(?<![\d.,])(\d{1,3})\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″”]|''|′′)\s*)?([NSEWO])/gi)];
  if (dms.length === 2) {
    const deg = m => sign(+m[1] + (+(m[2] || '0').replace(',', '.')) / 60 + (+(m[3] || '0').replace(',', '.')) / 3600, m[4]);
    const latM = dms.find(m => /[NS]/i.test(m[4])), lonM = dms.find(m => /[EWO]/i.test(m[4]));
    return latM && lonM ? valid(deg(latM), deg(lonM)) : null;
  }

  // Dezimalgrad mit Punkt (Trenner Komma, Semikolon oder Leerzeichen) oder mit Komma (Trenner Semikolon oder Leerzeichen)
  const H1 = '([NS])?\\s*', H2 = '\\s*([NS])?', H3 = '([EWO])?\\s*', H4 = '\\s*([EWO])?';
  const dot = new RegExp(`^${H1}(-?\\d{1,2}\\.\\d+)°?${H2}\\s*[,;\\s]\\s*${H3}(-?\\d{1,3}\\.\\d+)°?${H4}$`, 'i');
  const comma = new RegExp(`^${H1}(-?\\d{1,2},\\d+)°?${H2}\\s*(?:[;\\s]|,\\s)\\s*${H3}(-?\\d{1,3},\\d+)°?${H4}$`, 'i');
  const m = t.match(dot) || t.match(comma);
  if (!m) return null;
  const n = v => +v.replace(',', '.');
  return valid(sign(n(m[2]), m[1] || m[3]), sign(n(m[5]), m[4] || m[6]));
}

export class RouteLine {
  constructor(points, cellDeg = 0.05) {
    if (!points || points.length < 2) throw new Error('Route braucht mindestens zwei Punkte');
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      this.cum.push(this.cum[i - 1] + haversineKm(a[0], a[1], b[0], b[1]));
    }
    this.lengthKm = this.cum[this.cum.length - 1];
    this.cellDeg = cellDeg;
    this.grid = new Map();
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i], points[i + 1]];
      const la0 = Math.floor(Math.min(a[0], b[0]) / cellDeg), la1 = Math.floor(Math.max(a[0], b[0]) / cellDeg);
      const lo0 = Math.floor(Math.min(a[1], b[1]) / cellDeg), lo1 = Math.floor(Math.max(a[1], b[1]) / cellDeg);
      for (let x = la0; x <= la1; x++) for (let y = lo0; y <= lo1; y++) {
        const k = x + ':' + y;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(i);
      }
      minLat = Math.min(minLat, a[0], b[0]); maxLat = Math.max(maxLat, a[0], b[0]);
      minLon = Math.min(minLon, a[1], b[1]); maxLon = Math.max(maxLon, a[1], b[1]);
    }
    this.bbox = { minLat, maxLat, minLon, maxLon };
  }

  // Nächster Punkt der Route: { offsetKm (seitlicher Abstand), alongKm (Routen-km), side } oder null,
  // wenn weiter als maxKm entfernt
  project(lat, lon, maxKm) {
    const pad = maxKm / 111 + this.cellDeg;
    const { minLat, maxLat, minLon, maxLon } = this.bbox;
    if (lat < minLat - pad || lat > maxLat + pad || lon < minLon - pad * 2 || lon > maxLon + pad * 2) return null;
    const r = Math.ceil(maxKm / 111 / this.cellDeg);
    const cx = Math.floor(lat / this.cellDeg), cy = Math.floor(lon / this.cellDeg);
    const seen = new Set();
    let best = null;
    const kx = Math.cos(lat * RAD);
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r - 1; y <= cy + r + 1; y++) {
      for (const i of this.grid.get(x + ':' + y) || []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const [a, b] = [this.points[i], this.points[i + 1]];
        // lokale ebene Näherung (genau genug für Abstände < 50 km)
        const ax = a[1] * kx, ay = a[0], bx = b[1] * kx, by = b[0], px = lon * kx, py = lat;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const qLat = ay + t * dy, qLon = (ax + t * dx) / kx;
        const d = haversineKm(lat, lon, qLat, qLon);
        if (d <= maxKm && (!best || d < best.offsetKm)) {
          // Seite in Fahrtrichtung (Kreuzprodukt): rechts < 0 < links
          const cross = dx * (py - ay) - dy * (px - ax);
          best = { offsetKm: d, alongKm: this.cum[i] + t * (this.cum[i + 1] - this.cum[i]), side: cross > 0 ? 'left' : 'right' };
        }
      }
    }
    return best;
  }

  // Punkt auf der Route bei km
  pointAt(km) {
    const k = Math.max(0, Math.min(this.lengthKm, km));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= k) lo = mid; else hi = mid; }
    const seg = this.cum[hi] - this.cum[lo] || 1, t = (k - this.cum[lo]) / seg;
    const [a, b] = [this.points[lo], this.points[hi]];
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  }
}
