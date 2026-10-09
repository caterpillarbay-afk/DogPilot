// Baustellen, Sperrungen und Verkehrswarnungen der Autobahn GmbH entlang der Route (nur Anzeige,
// die Route selbst wird nicht verändert). Reine Funktionen, damit sie ohne Netz testbar sind.

// Straßennamen der Routendienste („A 61“, „A7“, „A 1; E 37“) → Autobahnkennungen der API („A61“)
export function autobahnRoads(names) {
  const roads = new Set();
  for (const n of names) {
    for (const m of String(n || '').matchAll(/(?:^|[^A-Z0-9])A\s?(\d{1,3})(?![0-9])/g)) roads.add('A' + Number(m[1]));
  }
  return [...roads];
}

const dt = (d, t) => {
  const [dd, mm, yy] = d.split('.').map(Number);
  const [h, min] = t.split(':').map(Number);
  return new Date(2000 + yy, mm - 1, dd, h, min);
};

// Gültigkeitszeiträume aus dem Beschreibungstext, z. B.
// „19.10.26 18:00 bis zum 20.10.26 06:00 Uhr.“ oder „09.10.26 von 00:00 bis 12:00 Uhr“
export function parsePeriods(description) {
  const text = (description || []).join('\n');
  const periods = [];
  for (const m of text.matchAll(/(\d\d\.\d\d\.\d\d) (\d\d:\d\d) bis zum (\d\d\.\d\d\.\d\d) (\d\d:\d\d)/g)) {
    periods.push({ from: dt(m[1], m[2]), to: dt(m[3], m[4]) });
  }
  for (const m of text.matchAll(/(\d\d\.\d\d\.\d\d) von (\d\d:\d\d) bis (\d\d:\d\d)/g)) {
    const from = dt(m[1], m[2]), to = dt(m[1], m[3]);
    if (to <= from) to.setDate(to.getDate() + 1);
    periods.push({ from, to });
  }
  return periods;
}

// Richtung der Meldung (Anfang → Ende der Ausdehnung) gegen die Fahrtrichtung der Route an dieser Stelle.
// Ausdehnungen beginnen oft auf Abschnitten, die die Route nicht befährt – daher Vektor statt Projektion.
function sameDirection(line, hit, [aLat, aLon, bLat, bLon]) {
  const kx = Math.cos(aLat * Math.PI / 180);
  const ex = (bLon - aLon) * kx, ey = bLat - aLat;
  if (Math.hypot(ex, ey) < 0.0003) return true;      // unter ~30 m: Richtung unbekannt
  const p = line.pointAt(hit.alongKm - 0.3), q = line.pointAt(hit.alongKm + 0.3);
  return ex * (q[1] - p[1]) * kx + ey * (q[0] - p[0]) >= 0;
}

const arrow = x => String(x || '').trim().replace(/\s*->\s*/g, ' → ');
const KIND = { closure: 0, warning: 1, roadworks: 2 };
const MARGIN_MS = 30 * 60000;

// items: [{ kind: 'closure'|'warning'|'roadworks', ...Rohdaten der API }]
// line: RouteLine; passAt(km) → voraussichtliche Uhrzeit an Routen-km; now: aktuelle Zeit
// Ergebnis: relevante Meldungen in Fahrtrichtung, nach Routen-km sortiert
export function eventsAlongRoute(items, line, passAt, now = new Date(), maxKm = 0.4) {
  const out = new Map();
  for (const it of items) {
    const lat = Number(it.coordinate?.lat), lon = Number(it.coordinate?.long);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const hit = line.project(lat, lon, maxKm);
    if (!hit) continue;
    // Auf-/Abfahrten tragen statt „A → B“ nur die Anschlussstelle („AS …“, „AK … (aus Richtung …)“)
    const ramp = !/->|→/.test(String(it.subtitle || ''));
    const ext = String(it.extent || '').split(',').map(Number);
    if (!ramp && ext.length === 4 && ext.every(Number.isFinite) && !sameDirection(line, hit, ext)) continue;
    const at = passAt(hit.alongKm);
    const periods = parsePeriods(it.description);
    let until = null;
    if (periods.length) {
      const p = periods.find(p => p.from.getTime() - MARGIN_MS <= at.getTime() && at.getTime() <= p.to.getTime() + MARGIN_MS);
      if (!p) continue;
      until = p.to.toISOString();
    } else if (it.kind === 'warning') {
      // Live-Verkehrsmeldungen nur, wenn die Fahrt bald beginnt
      if (at.getTime() - now.getTime() > 3 * 3600000) continue;
    } else if (it.future === true || it.future === 'true') continue;
    const blocked = it.isBlocked === true || it.isBlocked === 'true';
    const ev = {
      id: it.identifier,
      kind: it.kind,
      ramp,
      blocked,
      until,
      title: arrow(it.title),
      subtitle: arrow(it.subtitle),
      alongKm: hit.alongKm,
      at: at.toISOString(),
      delayMin: Number(it.delayTimeValue) || null,
      type: it.display_type || null,
      details: (it.description || []).map(arrow).filter(Boolean),
    };
    const prev = out.get(ev.id);
    if (!prev || KIND[ev.kind] < KIND[prev.kind]) out.set(ev.id, ev);
  }
  return [...out.values()].sort((a, b) => a.alongKm - b.alongKm);
}
