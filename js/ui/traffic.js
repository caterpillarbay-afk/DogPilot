// DogPilot – Baustellen & Sperrungen (Autobahn GmbH) in der Fahrtübersicht.

import { icon } from '../icons.js';
import { esc, num, clock, dayLabel } from '../format.js';
import { getAutobahnEvents } from '../services.js';
import { eventsAlongRoute, groupEvents, RAMP_LABEL, JUNCTION_LABEL } from '../traffic.js';
import { RouteLine } from '../geo.js';
import { state, trip } from './core.js';

// ---------- Baustellen und Sperrungen (Autobahn GmbH) ----------
// Nur Anzeige: DP plant nicht automatisch um. Rohdaten je Straßenliste max. 10 min alt;
// welche Meldungen gelten, hängt von den Durchfahrtszeiten ab und wird bei jedem Rendern neu bestimmt.
export const TRAFFIC_MAX_AGE_MS = 10 * 60000;
export const TRAFFIC_LABEL = { closure: 'Sperrung', warning: 'Verkehrsmeldung', roadworks: 'Baustelle' };
export const trafficKey = t => t.roads.join(',');

// Routenlinie der Fahrt und geplante Uhrzeit je Routen-km (Fahrzeit plus Stopps davor);
// die Linie misst etwas anders als der Routendienst, daher scale auf Fahrt-km
export const timingCache = new WeakMap();
export function tripTiming(t) {
  if (timingCache.has(t)) return timingCache.get(t);
  const line = new RouteLine(t.points);
  const scale = t.lengthKm / line.lengthKm, minPerKm = t.driveMin / t.lengthKm;
  const plannedAt = km => {
    const prev = t.stops.filter(st => st.alongKm <= km).at(-1);
    const base = prev ? new Date(prev.departAt).getTime() : new Date(t.departure).getTime();
    return new Date(base + (km - (prev ? prev.alongKm : 0)) * minPerKm * 60000);
  };
  const timing = { line, scale, minPerKm, plannedAt };
  timingCache.set(t, timing);
  return timing;
}

export function tripEvents(t) {
  const { line, scale, plannedAt } = tripTiming(t);
  return eventsAlongRoute(state.traffic[trafficKey(t)].items, line, lineKm => plannedAt(lineKm * scale), new Date(), 0.4, t.junctions || [])
    .map(e => ({ ...e, alongKm: e.alongKm * scale }));
}

// Art und Zustand einer einzelnen Meldung, z. B. „Überleitung im Autobahnkreuz gesperrt · bis 22:00 Uhr“
// short: Art steht schon über der Liste – nur „gesperrt“ / „Baustelle“
export function eventLabel(e, short = false) {
  const rampClosed = e.ramp && (e.kind === 'closure' || e.blocked);
  const label = e.ramp
    ? (short ? (rampClosed ? 'gesperrt' : TRAFFIC_LABEL[e.kind]) : `${RAMP_LABEL[e.rampType] || RAMP_LABEL.ramp}${rampClosed ? ' gesperrt' : e.kind === 'roadworks' ? ': Baustelle' : ''}`)
    : e.blocked ? 'gesperrt' : TRAFFIC_LABEL[e.kind];
  const u = e.until && new Date(e.until), uDay = u && dayLabel(u, new Date(e.at));
  return `${label}${u ? ` · bis ${uDay === 'heute' ? '' : uDay + ', '}${clock(u)} Uhr` : ''}${e.delayMin ? ` · +${e.delayMin} min` : ''}`;
}

// e: Gruppe aus groupEvents – mehrere Meldungen derselben Maßnahme an derselben Stelle in einem Eintrag
export function trafficRow(e) {
  const parts = e.parts || [e];
  const hard = !e.ramp && (e.kind === 'closure' || e.blocked);
  const ic = hard ? 'octagon-x' : e.kind === 'warning' ? 'triangle-alert' : e.ramp && e.kind === 'closure' ? 'circle-alert' : 'construction';
  const cls = hard ? 'bad' : e.kind === 'warning' || (e.junction && e.ramp && (e.kind === 'closure' || e.blocked)) ? 'warn' : '';
  const where = e.junction ? ` · <b>${JUNCTION_LABEL[e.junction]}</b>` : '';
  const sameType = parts.every(p => p.ramp && p.rampType === e.rampType);
  const meta = parts.length > 1
    ? `km ${num(e.alongKm)} · ca. ${clock(new Date(e.at))} Uhr${sameType ? ` · ${RAMP_LABEL[e.rampType] || RAMP_LABEL.ramp}` : ''}${where}`
    : `km ${num(e.alongKm)} · ca. ${clock(new Date(e.at))} Uhr · ${eventLabel(e)}${where}${e.subtitle ? ` · ${esc(e.subtitle)}` : ''}`;
  const list = parts.length > 1 ? `<ul class="ev-parts small">${parts.map(p => `<li>${esc(p.subtitle || '–')}: ${eventLabel(p, sameType)}</li>`).join('')}</ul>` : '';
  const details = [...new Set(parts.flatMap(p => p.details))];
  return `<details class="ev ${cls}">
    <summary>${icon(ic, 'sm')}<div><b>${esc(e.title)}</b><br>
      <span class="muted small">${meta}</span>${list}</div></summary>
    <div class="muted small">${details.map(esc).join('<br>')}</div>
  </details>`;
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function trafficCard(t) {
  const head = `<div class="card-head">${icon('construction')} Baustellen &amp; Sperrungen</div>`;
  const s = state.traffic[trafficKey(t)];
  if (!s || s.loading) return `${head}<div class="live"><span class="muted">${icon('loader-circle', 'sm spin')} Meldungen der Autobahn GmbH werden abgerufen …</span></div>`;
  if (!s.items) return `${head}<div class="live"><span class="muted">${icon('circle-alert', 'sm')} Meldungen gerade nicht abrufbar</span></div>`;
  const ev = tripEvents(t);
  // Offen: Sperrungen der Fahrbahn, Verkehrsmeldungen und Meldungen dort, wo die Route auf-, ab- oder
  // auf eine andere Autobahn fährt. Übrige Auf-/Abfahrten (man fährt nur vorbei) und Baustellen eingeklappt.
  const major = groupEvents(ev.filter(e => e.junction || (!e.ramp && (e.kind !== 'roadworks' || e.blocked))));
  const junction = major.filter(e => e.junction).length;
  const ramps = groupEvents(ev.filter(e => e.ramp && !e.junction));
  const works = groupEvents(ev.filter(e => !e.ramp && e.kind === 'roadworks' && !e.blocked));
  const closures = major.filter(e => !e.ramp && (e.kind === 'closure' || e.blocked)).length, warnings = major.length - closures - junction;
  const summary = !ev.length ? `Keine Meldungen zu deiner Durchfahrtszeit auf ${esc(t.roads.join(', '))}.`
    : 'Zur Durchfahrtszeit auf deiner Strecke: ' + [closures ? `<b>${plural(closures, 'Sperrung', 'Sperrungen')}</b>` : '', warnings ? plural(warnings, 'Verkehrsmeldung', 'Verkehrsmeldungen') : '',
      junction ? `<b>${plural(junction, 'Meldung', 'Meldungen')} dort, wo du auf-, ab- oder auf eine andere Autobahn fährst</b>` : '',
      ramps.length ? `${ramps.length} an Auf- und Abfahrten` : '', works.length ? plural(works.length, 'Baustelle', 'Baustellen') : '']
      .filter(Boolean).join(' · ') + '.';
  const group = (list, text) => list.length ? `<details class="ev-more"><summary class="small">${text}</summary>${list.map(trafficRow).join('')}</details>` : '';
  return `${head}
    <p class="small" style="margin:0 0 8px">${summary}</p>
    ${major.map(trafficRow).join('')}
    ${group(ramps, `${ramps.length} an Auf- und Abfahrten anzeigen <span class="muted" style="font-weight:400">(du fährst dort nur vorbei)</span>`)}
    ${group(works, `${plural(works.length, 'Baustelle', 'Baustellen')} anzeigen`)}
    <p class="muted small" style="margin:8px 0 0">${closures ? 'DP plant nicht automatisch um. Folge der Umleitung und tippe danach auf „Ab hier neu planen“. ' : ''}Quelle: Autobahn GmbH des Bundes, Stand ${clock(new Date(s.at))} Uhr. Nur Autobahnen.</p>`;
}

export async function refreshTraffic(t) {
  if (!t?.roads?.length) return;
  const k = trafficKey(t), cur = state.traffic[k];
  const show = () => { const e = document.getElementById('traffic'), cur = trip(); if (e && cur?.roads && trafficKey(cur) === k) e.innerHTML = trafficCard(cur); };
  if (cur?.loading) return;
  if (cur && Date.now() - cur.at < TRAFFIC_MAX_AGE_MS) { show(); return; }
  state.traffic[k] = { loading: true };
  show();
  state.traffic[k] = { items: await getAutobahnEvents(t.roads), at: Date.now() };
  show();
}
