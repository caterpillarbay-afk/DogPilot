// Fahrt-Modus: Sprachansagen unterwegs. Reine Funktionen (wann wird was angesagt, mit welchem Text),
// damit sie ohne GPS und Sprachausgabe testbar sind. Ansagt wird nur, was Google Maps nicht weiß.
import { FEATURES } from './data.js';
import { clock } from './format.js';
import { RAMP_LABEL, JUNCTION_LABEL } from './traffic.js';

// Vorlauf in Minuten
export const LEAD_MIN = { break: 10, charge: 15, closure: 10 };

const mins = m => Math.max(1, Math.round(m));
const until = d => (d.toDateString() === new Date().toDateString() ? '' : d.toLocaleDateString('de-DE', { weekday: 'long' }) + ', ') + clock(d) + ' Uhr';
const meters = m => m < 1000 ? `${Math.round(m / 10) * 10} Metern` : `${(m / 1000).toFixed(1).replace('.', ',')} Kilometern`;

// „A6 | Weinsberg - Bretzfeld“ → „auf der A6 zwischen Weinsberg und Bretzfeld“
function where(title) {
  const m = /^(A\d+)\s*\|\s*(.+?)(?:\s+-\s+(.+))?$/.exec(title || '');
  if (!m) return `– ${title}`;
  return m[3] ? `auf der ${m[1]} zwischen ${m[2]} und ${m[3]}` : `auf der ${m[1]} bei ${m[2]}`;
}

export function breakText(st, min) {
  const f = st.restArea?.flags ?? 0;
  const green = f & FEATURES.dogPark ? ' Dort gibt es eine Hundewiese.'
    : f & (FEATURES.park | FEATURES.forest | FEATURES.meadow) ? ' Dort gibt es Grün zum Laufen.' : '';
  return `In etwa ${mins(min)} Minuten Gassi-Pause: ${st.name}.${green}`;
}

// live: Ergebnis von summarizeLive ({ free, busy, broken, total }) oder null
export function chargeText(st, min, live) {
  let text = `In etwa ${mins(min)} Minuten Ladestopp: ${st.name}, ${Math.round(st.maxKw)} Kilowatt.`;
  if (live?.total) {
    if (live.free) text += ` Gerade sind ${live.free} von ${live.total} Ladepunkten frei.`;
    else if (live.busy) text += ` Gerade sind alle ${live.total} Ladepunkte belegt.`
      + (st.alternatives?.length ? ` In der App findest du ${st.alternatives.length === 1 ? 'eine Alternative' : `${st.alternatives.length} Alternativen`}.` : '');
    else text += ' Alle gemeldeten Ladepunkte sind gestört.';
  }
  const w = st.walk || {};
  if (w.dogPark != null) text += ` Hundewiese in ${meters(w.dogPark)}.`;
  else if (w.green != null) text += ` Grün in ${meters(w.green)}.`;
  return text;
}

export function closureText(e, km) {
  const dist = `in etwa ${Math.max(1, Math.round(km))} Kilometern`;
  if (e.ramp) {
    const at = JUNCTION_LABEL[e.junction] || 'an einer Anschlussstelle';
    return `Achtung: ${at[0].toUpperCase() + at.slice(1)} ${dist}: ${RAMP_LABEL[e.rampType] || RAMP_LABEL.ramp} gesperrt, ${e.subtitle}. Bitte prüfe, ob das dich betrifft.`;
  }
  return `Achtung: ${dist[0].toUpperCase() + dist.slice(1)} Sperrung ${where(e.title)}.${e.until ? ` Sie gilt bis ${until(new Date(e.until))}.` : ''}`;
}

export function delayText(delayMin, arrival, arriveBy) {
  let text = `Du liegst etwa ${Math.round(delayMin)} Minuten hinter dem Plan. Neue Ankunft gegen ${clock(arrival)} Uhr.`;
  if (arriveBy) {
    const slack = Math.round((arriveBy - arrival) / 60000);
    text += slack >= 0 ? ` Bis ${clock(arriveBy)} Uhr bleiben noch ${slack} Minuten Puffer.` : ` Das ist ${-slack} Minuten nach ${clock(arriveBy)} Uhr.`;
  }
  return text;
}

export const OFF_ROUTE_TEXT = 'Du bist nicht mehr auf der geplanten Route. Wenn du umgeleitet wirst, tippe in DogPilot auf „Ab hier neu planen“.';

// Sperrungen, die angesagt werden: Fahrbahn gesperrt, oder gesperrte Auf-/Abfahrt bzw. Überleitung dort,
// wo die eigene Route auf-, ab- oder auf eine andere Autobahn fährt
export const announceable = e => (!e.ramp && (e.kind === 'closure' || e.blocked)) || (e.junction && (e.kind === 'closure' || e.blocked));

// Fällige Ansagen an Routen-km „km“ (Fahrt-km, wie stops[].alongKm).
// done: Set der schon angesagten Schlüssel. Ergebnis: [{ key, kind, min, km, stop | event }]
export function dueAnnouncements({ stops, events = [], km, minPerKm, prefs, done }) {
  const out = [];
  for (const st of stops) {
    const kind = st.kind === 'charge' ? 'charge' : 'break';
    if (!prefs[kind === 'charge' ? 'charge' : 'breaks']) continue;
    const key = `${kind}:${st.lat.toFixed(4)},${st.lon.toFixed(4)}`;
    const dist = st.alongKm - km;
    if (done.has(key) || dist < -0.5) continue;
    const min = Math.max(0, dist) * minPerKm;
    if (min <= LEAD_MIN[kind]) out.push({ key, kind, min, km: dist, stop: st });
  }
  if (prefs.closures) {
    for (const e of events) {
      if (!announceable(e)) continue;
      const key = `closure:${e.id}`, dist = e.alongKm - km;
      if (done.has(key) || dist < 0) continue;
      const min = dist * minPerKm;
      if (min <= LEAD_MIN.closure) out.push({ key, kind: 'closure', min, km: dist, event: e });
    }
  }
  return out.sort((a, b) => a.min - b.min);
}

// Verspätung ansagen in 10-Minuten-Stufen: Stufe steigt → Ansage; unter 5 min → zurück auf 0
export function delayStep(delayMin, level) {
  const next = delayMin < 5 ? 0 : Math.max(level, Math.floor(delayMin / 10));
  return { level: next, announce: next > level };
}

// Nächstes Ereignis für die Statuszeile: { kind, min, name } oder null
export function nextUp({ stops, events = [], km, minPerKm, prefs }) {
  const cands = [
    ...stops.filter(st => st.alongKm > km && prefs[st.kind === 'charge' ? 'charge' : 'breaks'])
      .map(st => ({ kind: st.kind === 'charge' ? 'charge' : 'break', km: st.alongKm - km, name: st.name })),
    ...(prefs.closures ? events.filter(e => announceable(e) && e.alongKm > km).map(e => ({ kind: 'closure', km: e.alongKm - km, name: e.title })) : []),
  ].sort((a, b) => a.km - b.km);
  return cands[0] ? { ...cands[0], min: cands[0].km * minPerKm } : null;
}

// Timer am Ladestopp bzw. an der Gassi-Pause: 5 min vor Ende und am Ende ansagen.
// visit: { stop, arrivedAt (ms), said: Set }, next: { name, min } | null (nächster Halt bzw. Ziel)
export function stopTimerDue(visit, now, next = null) {
  const st = visit.stop, charge = st.kind === 'charge';
  const end = visit.arrivedAt + st.stopMin * 60000;
  const out = [];
  if (st.stopMin >= 10 && now >= end - 5 * 60000 && now < end && !visit.said.has('warn')) {
    out.push({ key: 'warn', text: charge ? `Noch etwa 5 Minuten Laden, dann ist der Akku laut Plan bei ${Math.round(st.targetSoc)} Prozent.` : 'Noch etwa 5 Minuten Gassi-Pause.' });
  }
  if (now >= end && !visit.said.has('done')) {
    const then = next ? ` Nächster Halt: ${next.name}, in etwa ${durationText(next.min)}.` : '';
    out.push({ key: 'done', text: (charge ? `Laut Plan ist der Akku jetzt bei ${Math.round(st.targetSoc)} Prozent. Du kannst weiterfahren.` : 'Die Gassi-Pause ist vorbei. Weiter geht\'s.') + then });
  }
  return out;
}

// „1 Stunde 50 Minuten“ zum Vorlesen
export function durationText(min) {
  const m = Math.max(1, Math.round(min)), h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${m} Minuten`;
  return `${h === 1 ? 'einer Stunde' : `${h} Stunden`}${r ? ` und ${r} Minuten` : ''}`;
}

export const arrivalText = name => `Du bist am Ziel${name ? `: ${name}` : ''}. Trag in DogPilot noch kurz den Akkustand ein, dann lernt die Planung dazu.`;
