// DogPilot – Fahrtübersicht, Stopp-Details, Live-Belegung, Ankunft/Verbrauch lernen, Alternativen.

import { icon } from '../icons.js';
import { esc, num, duration, shortDuration, clock, dayLabel } from '../format.js';
import { FEATURES } from '../data.js';
import { placeLabel, getLiveStatus } from '../services.js';
import { prepareTrip, planFromContext, DRIVER_MAX_DRIVE_MIN } from '../trip.js';
import { learnFactor } from '../energy.js';
import { googleMapsUrl } from '../navlink.js';
import { pct } from './forms.js';
import { LOAD, plan } from './plan.js';
import { trafficCard } from './traffic.js';
import { driveCard } from './drive.js';
import { state, toast, save, trip, hours, breakLabel, placeName, go, loadData, field, numberInput, readNumber, emptyState, emptyForm, render } from './core.js';

// ---------- Ergebnis ----------

export function socBar(from, to) {
  const a = Math.max(0, Math.min(100, from)), b = Math.max(a, Math.min(100, to));
  return `<div class="soc"><span>${Math.round(from)} %</span><div class="soc-bar" aria-hidden="true"><span class="from" style="width:${a}%"></span><span class="add" style="left:${a}%;width:${b - a}%"></span></div><span>${Math.round(to)} %</span></div>`;
}

// dogs: Fahrt mit Hunden (ältere Fahrten ohne Angabe: ja)
export function scores(st, dogs = trip()?.withDogs !== false) {
  if (st.dog == null) return `<div class="scores"><span>${icon('info')} Ausstattung unbekannt</span></div>`;
  return `<div class="scores">${dogs ? `<span title="Hund">${icon('paw-print')} Hund ${num(st.dog, 1)}/5</span>` : ''}<span title="Mensch">${icon('coffee')} Mensch ${num(st.human, 1)}/5</span></div>`;
}


// „Ankunft bis …“: späteste Abfahrt und verbleibender Puffer (passt sich an, wenn Stopps gewechselt werden)
export function arrivalPlan(t) {
  if (!t.arriveBy) return '';
  const dep = new Date(t.departure), arr = new Date(t.arrivalAt), by = new Date(t.arriveBy);
  const slack = Math.round((by - arr) / 60000);
  const byLabel = `${dayLabel(by, arr) === 'heute' ? '' : dayLabel(by, arr) + ', '}${clock(by)} Uhr`;
  const past = !t.replanned && dep < new Date();
  const cls = slack < 0 || past ? 'warn' : 'info';
  return `<div class="notice ${cls}" style="margin-top:12px">${icon(cls === 'warn' ? 'triangle-alert' : 'clock')}<span>
    <b>${t.replanned ? `Ankunft bis ${byLabel}` : `Spätestens losfahren: ${dayLabel(dep) === 'heute' ? '' : dayLabel(dep) + ', '}${clock(dep)} Uhr`}</b><br>
    Geplante Ankunft ${clock(arr)} Uhr · ${slack >= 0 ? `${duration(slack)} Puffer bis ${byLabel}` : `${duration(-slack)} nach ${byLabel}`}
    ${past ? '<br>Diese Abfahrtszeit ist schon vorbei – der Puffer wird knapp.' : ''}</span></div>`;
}

// Nach der Ankunft: Akkustand abfragen und daraus den Verbrauch lernen (learnFactor)
export function arrivalCard(t) {
  if (t.feedback || !t.lastLeg) return '';
  const arrival = new Date(t.arrivalAt).getTime();
  if (!state.arrived && Date.now() < arrival - 45 * 60000) return '';
  if (Date.now() > arrival + 3 * 86400000) return '';
  return `<div class="card" style="margin-top:12px" id="arrivalCard">
    <div class="card-head">${icon('flag')} Angekommen?</div>
    <p class="muted small" style="margin:0 0 10px">Mit dem Akkustand am Ziel lernt DogPilot deinen echten Verbrauch – die nächsten Fahrten werden genauer.</p>
    <div class="grid-2">
      ${field('Akku am Ziel', numberInput('fbSoc', '', { min: 0, max: 100, suffix: '%', placeholder: `Plan: ${t.arrivalSoc}` }))}
      ${t.lastLeg.name ? field(`Geladen bis (${esc(t.lastLeg.name.split(',')[0])})`, numberInput('fbFrom', Math.round(t.lastLeg.fromSoc), { min: 1, max: 100, suffix: '%' })) : ''}
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-secondary" type="button" data-action="fb-skip">Überspringen</button>
      <button class="btn btn-primary" type="button" data-action="fb-save">Übernehmen</button>
    </div>
    ${state.fbError ? `<div class="notice error" style="margin-top:12px">${icon('circle-alert')}<span>${esc(state.fbError)}</span></div>` : ''}
  </div>`;
}

export async function saveFeedback(skip) {
  const t = trip(), v = state.settings.vehicle;
  state.fbError = null;
  if (skip) { t.feedback = { skipped: true }; await save(); render(); return; }
  const actual = readNumber('fbSoc', 0, 100), from = t.lastLeg.name ? readNumber('fbFrom', 1, 100) : t.lastLeg.fromSoc;
  if (actual == null || from == null) { state.fbError = 'Bitte den Akkustand eintragen.'; render(); return; }
  const prev = t.learned || 1;
  const r = learnFactor(prev, { fromSoc: from, actualSoc: actual, plannedKWh: t.lastLeg.kWh, capacityKWh: v.capacityKWh });
  t.feedback = { actualSoc: actual, fromSoc: from, ratio: r?.ratio ?? null };
  if (r) {
    v.learned = { factor: r.factor, trips: (v.learned?.trips || 0) + 1 };
    const diff = Math.round((r.ratio - 1) * 100);
    toast(Math.abs(diff) < 3 ? 'Verbrauch wie geplant – passt!' : `Verbrauch ${Math.abs(diff)} % ${diff > 0 ? 'höher' : 'niedriger'} als geplant – DogPilot plant jetzt mit ${pct(r.factor)}`);
  } else toast('Abschnitt zu kurz zum Lernen – trotzdem danke!');
  state.arrived = false;
  await save();
  render();
}

// Unterwegs: Fahrt ab dem aktuellen Standort neu planen (z. B. nach einer Umleitung) – Ziel, Beladung
// und „Ankunft bis …“ bleiben, nur der Akkustand wird abgefragt
export function replanCard(t) {
  if (!state.replanOpen) return `<button class="btn btn-secondary block" type="button" data-action="replan-open" style="margin-top:12px">${icon('locate')} Ab hier neu planen</button>`;
  return `<div class="card" style="margin-top:12px">
    <div class="card-head">${icon('locate')} Ab hier neu planen</div>
    <p class="muted small" style="margin:0 0 10px">Von deinem aktuellen Standort nach ${esc(placeName(t.to))}${t.arriveBy ? `, Ankunft bis ${clock(new Date(t.arriveBy))} Uhr` : ''}.</p>
    ${field('Akku jetzt', numberInput('replanSoc', state.replanSoc ?? '', { min: 1, max: 100, suffix: '%', placeholder: 'z. B. 45' }))}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-secondary" type="button" data-action="replan-cancel">Abbrechen</button>
      <button class="btn btn-primary" type="button" data-action="replan-go" ${state.computing ? 'disabled' : ''}>${state.computing ? `${icon('loader-circle', 'spin')} ${esc(state.computing)}` : 'Neu planen'}</button>
    </div>
    ${state.replanError ? `<div class="notice error" style="margin-top:12px">${icon('circle-alert')}<span>${esc(state.replanError)}</span></div>` : ''}
  </div>`;
}

export async function replanFromHere() {
  const t = trip(), soc = readNumber('replanSoc', 1, 100);
  state.replanError = null;
  if (soc == null) { state.replanError = 'Bitte den aktuellen Akkustand eintragen.'; render(); return; }
  state.replanSoc = Math.round(soc);
  state.computing = 'Standort wird ermittelt …';
  render();
  try {
    const p = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Ortung wird nicht unterstützt')); return; }
      navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Standort nicht verfügbar – Ortung erlauben und erneut versuchen.')),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
    state.form = {
      ...emptyForm(), from: { label: await placeLabel(p.coords.latitude, p.coords.longitude) || 'Aktueller Standort', lat: p.coords.latitude, lon: p.coords.longitude }, to: t.to,
      startSoc: state.replanSoc, load: t.load || 'normal', withDogs: t.withDogs !== false, departure: new Date(), replan: true,
      // unterwegs: Abfahrt ist jetzt; „Ankunft bis …“ bleibt nur zum Vergleich
      ...(t.arriveBy ? { arriveBy: new Date(t.arriveBy) } : {}),
    };
    state.computing = null;
    await plan();
    if (!state.error) { state.replanOpen = false; state.replanError = null; render(); toast('Fahrt ab hier neu geplant'); }
  } catch (err) {
    state.computing = null;
    state.replanError = err.message;
    render();
  }
}

export function viewTrip() {
  const t = trip();
  if (!t) return emptyState('route', 'Noch keine Fahrt geplant', '#/plan', 'Fahrt planen');
  const arrival = new Date(t.arrivalAt), dep = new Date(t.departure);
  const charges = t.stops.filter(s => s.kind === 'charge');
  const chargeMin = charges.reduce((a, s) => a + s.chargeMin, 0);
  const extras = [
    t.temperature != null ? `${icon('thermometer', 'sm')} ${num(t.temperature)} °C` : '',
    t.climbM != null ? `${icon('mountain', 'sm')} ${num(t.climbM)} m bergauf` : '',
    t.trafficDelayMin ? `${icon('timer', 'sm')} ${num(t.trafficDelayMin)} min Stau` : '',
    LOAD[t.load]?.short ? `${icon('car', 'sm')} ${LOAD[t.load].short}` : '',
  ].filter(Boolean);
  let prevKm = 0;
  const minPerKm = t.driveMin / t.lengthKm;
  const leg = km => `<p class="tl-drive">${icon('car', 'sm')} ${num(km - prevKm)} km · ${duration((km - prevKm) * minPerKm)}</p>`;
  const items = t.stops.map((st, i) => {
    const charge = st.kind === 'charge';
    const html = `
      <div class="tl-item">
        <div class="tl-rail"><span class="tl-dot ${charge ? (st.fallback ? 'warn' : 'charge') : ''}">${icon(charge ? 'zap' : 'paw-print')}</span></div>
        <div class="tl-body">
          ${leg(st.alongKm)}
          <button class="stop-card" type="button" data-href="#/stop/${i}">
            <span class="tl-time">${clock(new Date(st.arriveAt))} – ${clock(new Date(st.departAt))} Uhr · ${charge ? `${st.stopMin} min` : `${breakLabel(st)} ${st.stopMin} min`}</span>
            <span class="name">${esc(st.name)} ${icon('chevron-right', 'sm chev')}</span>
            <span class="meta">${charge ? `${num(st.maxKw)} kW · ${st.points} Ladepunkte${st.operators.length ? ' · ' + esc(st.operators.slice(0, 2).join(', ')) : ''}` : `Akku bei Ankunft ca. ${st.arriveSoc} %`}${st.detour.km ? ` · ${num(st.detour.km, 1)} km Umweg` : ''}</span>
            ${charge ? socBar(st.arriveSoc, st.targetSoc) : ''}
            ${charge ? `<span class="live" id="live-${i}">${liveLine(st)}</span>` : ''}
            ${scores(st)}
          </button>
        </div>
      </div>`;
    prevKm = st.alongKm;
    return html;
  }).join('');
  return `
    <button class="btn-ghost back" type="button" data-href="#/plan">${icon('chevron-left')} Fahrt ändern</button>
    <div class="route-head">
      <div class="grow"><div class="title">${esc(placeName(t.from))} → ${esc(placeName(t.to))}</div>
      <div class="muted small">${dayLabel(dep)}, ${clock(dep)} Uhr · ${esc(t.provider)}</div></div>
    </div>
    ${t.tomtomError ? `<div class="notice warn" style="margin-top:12px">${icon('triangle-alert')}<span>TomTom nicht erreichbar: ${esc(t.tomtomError)}. Geplant ohne Live-Verkehr.</span></div>` : ''}
    ${arrivalCard(t)}
    ${arrivalPlan(t)}
    ${driveCard(t)}
    ${replanCard(t)}
    <div class="summary">
      <div class="metric"><div class="label">${icon('flag')} Ankunft</div><div class="value">${clock(arrival)} <small>${dayLabel(arrival, dep) === 'heute' ? '' : dayLabel(arrival, dep)}</small></div></div>
      <div class="metric"><div class="label">${icon('clock')} Dauer</div><div class="value">${shortDuration(t.totalMin)}</div></div>
      <div class="metric"><div class="label">${icon('route')} Strecke</div><div class="value">${num(t.lengthKm)} <small>km</small></div></div>
      <div class="metric"><div class="label">${icon('plug-zap')} Laden</div><div class="value">${charges.length}× <small>${shortDuration(chargeMin)}</small></div></div>
      <div class="metric"><div class="label">${icon('battery')} Am Ziel</div><div class="value">${t.arrivalSoc} <small>%</small></div></div>
      <div class="metric"><div class="label">${icon('gauge')} Verbrauch</div><div class="value">${num(t.consumptionKWh100, 1)} <small>kWh</small></div></div>
    </div>
    ${extras.length ? `<div class="chips" style="margin-top:12px">${extras.map(e => `<span class="chip">${e}</span>`).join('')}</div>` : ''}
    ${t.warnings.length ? `<div style="margin-top:16px">${t.warnings.map(w => `<div class="notice warn">${icon('triangle-alert')}<span>${esc(w)}</span></div>`).join('')}</div>` : ''}
    ${!t.feasible ? `<div class="notice error" style="margin-top:8px">${icon('circle-alert')}<span>Diese Fahrt ist mit den Einstellungen nicht sicher machbar. Prüfe Akkustand, Verbrauch und Ladeleistung.</span></div>` : ''}

    ${t.roads?.length ? `<div class="card traffic" id="traffic" style="margin-top:16px">${trafficCard(t)}</div>` : ''}

    <h3 class="section-title">Ablauf</h3>
    <div class="timeline">
      <div class="tl-item">
        <div class="tl-rail"><span class="tl-dot">${icon('map-pin')}</span></div>
        <div class="tl-body"><div class="tl-time">${clock(dep)} Uhr · Akku ${t.startSoc} %</div><div class="tl-name">${esc(t.from.label)}</div></div>
      </div>
      ${items}
      <div class="tl-item">
        <div class="tl-rail"><span class="tl-dot">${icon('flag')}</span></div>
        <div class="tl-body">${leg(t.lengthKm)}<div class="tl-time">${clock(arrival)} Uhr · Akku ca. ${t.arrivalSoc} %</div><div class="tl-name">${esc(t.to.label)}</div></div>
      </div>
    </div>

    <div class="btn-row" style="margin-top:24px">
      <button class="btn btn-secondary" type="button" data-href="#/map">${icon('map')} Karte</button>
      <a class="btn btn-primary" href="${googleMapsUrl(t)}" target="_blank" rel="noopener">${icon('navigation')} Navigation</a>
    </div>
    <p class="hint">Alle Zeiten und Akkustände sind Schätzungen (Temperatur, Höhenprofil${t.trafficDelayMin != null ? ', Verkehr' : ''} berücksichtigt). „Navigation“ öffnet Google Maps mit allen Stopps als Zwischenziele.</p>`;
}

// ---------- Stopp-Details ----------

export const FEATURE_LIST = [
  ['toilets', 'toilet', 'WC'], ['food', 'utensils', 'Essen'], ['shop', 'store', 'Einkauf'], ['fuel', 'fuel', 'Tankstelle'],
  ['water', 'droplet', 'Trinkwasser'], ['picnic', 'coffee', 'Picknickplatz'], ['playground', 'ferris-wheel', 'Spielplatz'],
  ['dogPark', 'dog', 'Hundewiese'], ['park', 'trees', 'Park'], ['forest', 'trees', 'Wald'], ['meadow', 'trees', 'Wiese'],
];

// Fußwege vom Ladeplatz, nächste zuerst (80 m pro Minute)
export const WALK_LIST = [
  ['green', 'trees', 'Grün'], ['dogPark', 'dog', 'Hundewiese'], ['wc', 'toilet', 'WC'], ['food', 'utensils', 'Essen'],
  ['shop', 'store', 'Einkauf'], ['water', 'droplet', 'Trinkwasser'], ['picnic', 'coffee', 'Picknickplatz'], ['playground', 'ferris-wheel', 'Spielplatz'],
];

export function walkCard(st) {
  const rows = WALK_LIST.map(([k, ic, label]) => ({ k, ic, label: k === 'green' && st.greenKind ? st.greenKind : label, m: st.walk[k] }))
    .sort((a, b) => (a.m ?? 1e9) - (b.m ?? 1e9));
  return `<div class="card" style="margin-top:12px">
    <div class="card-head">${icon('paw-print')} Zu Fuß vom Ladeplatz</div>
    <dl class="kv">
      ${rows.map(r => `<dt class="feature ${r.m == null ? 'off' : ''}">${icon(r.m == null ? 'x' : r.ic, 'sm')} ${esc(r.label)}</dt>
        <dd class="${r.m == null ? 'muted' : ''}">${r.m == null ? 'nicht in der Nähe' : r.m < 20 ? 'direkt am Ladeplatz' : `ca. ${num(Math.round(r.m / 10) * 10)} m · ${Math.max(1, Math.round(r.m / 80))} min`}</dd>`).join('')}
    </dl>
  </div>`;
}

export function viewStop(i) {
  const t = trip(), st = t?.stops[i];
  if (!st) return emptyState('map-pin', 'Stopp nicht gefunden', '#/trip', 'Zur Fahrt');
  const charge = st.kind === 'charge';
  const ra = st.restArea;
  const typeLabel = ra ? { rastplatz: 'Rastplatz', rastanlage: 'Rastanlage', autohof: 'Autohof' }[ra.type] : 'Ladestation';
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${st.lat.toFixed(5)},${st.lon.toFixed(5)}&travelmode=driving`;
  return `
    <button class="btn-ghost back" type="button" data-href="#/trip">${icon('chevron-left')} Zur Fahrt</button>
    <div class="detail-hero">
      <span class="badge">${icon(charge ? 'zap' : 'paw-print')}</span>
      <div class="grow"><h2 class="screen-title" style="font-size:22px">${esc(st.name)}</h2>
      <div class="muted small">${typeLabel} · km ${num(st.alongKm)}${st.detour.km ? ` · ${num(st.detour.km, 1)} km Umweg` : ' · direkt an der Route'}</div></div>
    </div>
    <div class="card">
      <div class="card-head">${icon('clock')} ${clock(new Date(st.arriveAt))} – ${clock(new Date(st.departAt))} Uhr</div>
      ${charge ? `${socBar(st.arriveSoc, st.targetSoc)}
      <dl class="kv">
        <dt>Ladezeit</dt><dd>ca. ${st.chargeMin} min</dd>
        <dt>Ladeleistung</dt><dd>bis ${num(st.maxKw)} kW</dd>
        <dt>Ladepunkte</dt><dd>${st.points}</dd>
        ${st.operators.length ? `<dt>Betreiber</dt><dd>${esc(st.operators.join(', '))}</dd>` : ''}
      </dl>
      ${st.fallback ? `<div class="notice warn" style="margin-top:12px">${icon('triangle-alert')}<span>Langsamere Säule als gewünscht – auf diesem Abschnitt ist keine schnellere erreichbar.</span></div>` : ''}
      <div class="live-box" style="margin-top:12px">
        <div class="live" id="live-${i}">${liveLine(st, true)}</div>
        <button class="btn-ghost" type="button" data-action="live-refresh" aria-label="Belegung aktualisieren">${icon('refresh-cw')}</button>
      </div>`
      : `<p class="muted small" style="margin:0">${st.dogs === false ? `Pause für dich – spätestens nach ${hours(Math.max(DRIVER_MAX_DRIVE_MIN, state.settings.charging.maxDriveMin || 0))} Fahrt` : `Pause für den Hund – spätestens nach ${duration(state.settings.charging.maxDriveMin || 120)} Fahrt`}. Akku bei Ankunft ca. ${st.arriveSoc} %.</p>`}
    </div>
    ${state.computing ? `<div class="progress" style="margin-top:12px">${icon('loader-circle', 'spin')} ${esc(state.computing)}</div>` : altCard(st)}
    <h3 class="section-title">${trip()?.withDogs === false ? 'Vor Ort' : 'Für Hund und Mensch'}</h3>
    ${st.dog != null ? `<div class="rating">
      ${trip()?.withDogs === false ? '' : `<div class="metric"><div class="label">${icon('paw-print')} Hund</div><div class="value">${num(st.dog, 1)}<small>/5</small></div></div>`}
      <div class="metric"><div class="label">${icon('coffee')} Mensch</div><div class="value">${num(st.human, 1)}<small>/5</small></div></div>
      <div class="metric"><div class="label">${icon('info')} Typ</div><div class="value" style="font-size:15px">${typeLabel}</div></div>
    </div>` : ''}
    ${st.walk ? walkCard(st) : ''}
    ${ra ? `<div class="card" style="margin-top:12px">
      <div class="card-head">${icon('map-pin')} ${{ rastplatz: 'Auf dem Rastplatz', rastanlage: 'Auf der Rastanlage', autohof: 'Auf dem Autohof' }[ra.type]}</div>
      <div class="features">
      ${FEATURE_LIST.map(([k, ic, label]) => { const on = (ra.flags & FEATURES[k]) !== 0; return `<div class="feature ${on ? '' : 'off'}">${icon(on ? ic : 'x')} ${label}</div>`; }).join('')}
    </div></div>` : ''}
    ${st.walk || ra ? `<p class="hint">${st.walk ? 'Fußwege vom Ladeplatz bis 600 m. ' : ''}${ra ? 'Ausstattung der Anlage: WC und Essen auf dem Gelände oder bis 250 m daneben, Park, Wald und Wiese bis 300 m, Hundewiese bis 600 m. ' : ''}Quelle OpenStreetMap – nicht eingetragene Einrichtungen können trotzdem vorhanden sein.</p>`
    : `<div class="notice info">${icon('info')}<span>Zu diesem Standort sind keine Rastanlagen-Daten bekannt. Ausstattung bitte vor Ort prüfen.</span></div>`}
    <div class="btn-row" style="margin-top:24px">
      <button class="btn btn-secondary" type="button" data-href="#/map/${i}">${icon('map')} Karte</button>
      <a class="btn btn-primary" href="${nav}" target="_blank" rel="noopener">${icon('navigation')} Hinfahren</a>
    </div>`;
}

// ---------- Live-Belegung der Ladestopps ----------
// Zustand je Standort: { loading } | { data, at } | { error, at }, max. 2 min alt.
// Schlüssel über die Position, damit nach einer Neuplanung nichts verrutscht.
export const LIVE_MAX_AGE_MS = 2 * 60000;
export const posKey = p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;

export function liveLine(p, detail = false) {
  const s = p && state.live[posKey(p)];
  if (!s || s.loading) return `<span class="muted">${icon('loader-circle', 'sm spin')} Belegung wird abgerufen …</span>`;
  if (s.error) return `<span class="muted">${icon('circle-alert', 'sm')} Belegung gerade nicht abrufbar</span>`;
  const r = s.data, at = clock(new Date(s.at));
  if (!r) return `<span class="muted">${icon('info', 'sm')} Keine Live-Belegung gemeldet</span>`;
  const cls = r.free ? 'ok' : r.busy ? 'warn' : 'bad';
  const text = r.free ? `${r.free} von ${r.total} frei` : r.busy ? `alle ${r.total} belegt` : `alle ${r.total} gestört`;
  const extra = r.broken && (r.free || r.busy) ? ` · ${r.broken} gestört` : '';
  return `<span class="dot ${cls}"></span><span><b>Jetzt ${text}</b>${extra}${detail ? ` <span class="muted">· Stand ${at} Uhr · Quelle MobiData BW</span>` : ''}</span>`;
}

// targets: [{ p: {lat, lon}, el: Element-ID, detail }]
export async function refreshLive(targets, force = false) {
  await Promise.all(targets.map(async ({ p, el, detail }) => {
    const k = posKey(p), cur = state.live[k];
    const show = () => { const e = document.getElementById(el); if (e) e.innerHTML = liveLine(p, detail); };
    if (cur?.loading) return;
    if (!force && cur && Date.now() - cur.at < LIVE_MAX_AGE_MS) { show(); return; }
    state.live[k] = { loading: true };
    show();
    try { state.live[k] = { data: await getLiveStatus(p.lat, p.lon), at: Date.now() }; }
    catch { state.live[k] = { error: true, at: Date.now() }; }
    show();
  }));
}

// ---------- Alternative Ladestopps ----------

export function altCard(st) {
  if (st.kind !== 'charge' || !st.alternatives?.length) return '';
  const where = a => Math.abs(a.shiftKm) < 0.5 ? 'gleiche Stelle' : `${num(Math.abs(a.shiftKm), 1)} km ${a.shiftKm < 0 ? 'früher' : 'später'}`;
  return `<h3 class="section-title">Andere Schnelllader in der Nähe</h3>
    <div class="stack">${st.alternatives.map((a, j) => `
      <div class="card alt">
        <div class="alt-head"><b>${esc(a.name || a.operators[0] || 'Ladestation')}</b><span class="muted small">${num(a.maxKw)} kW · ${a.points} Ladepunkte</span></div>
        <div class="muted small">${where(a)}${a.detour.km ? ` · ${num(a.detour.km, 1)} km Umweg` : ''}${a.name && !(a.operators.length === 1 && a.operators[0] === a.name) ? ` · ${esc(a.operators.slice(0, 2).join(', '))}` : ''}</div>
        <div class="live" id="live-alt-${j}">${liveLine(a)}</div>
        ${scores(a)}
        <button class="btn btn-secondary block" type="button" data-action="alt" data-alt="${j}" style="margin-top:8px">${icon('zap')} Hier laden</button>
      </div>`).join('')}
    </div>
    <p class="hint">DogPilot rechnet die Fahrt ab dem gewählten Lader neu – Ladezeit, weitere Stopps und Ankunft.</p>`;
}

export async function chooseAlternative(i, j) {
  const t = trip(), st = t?.stops[i], alt = st?.alternatives?.[j];
  if (!alt) return;
  // Frühere Wahl behalten, spätere verwerfen (die Stopps danach verschieben sich ohnehin)
  const forced = Object.fromEntries(Object.entries(t.forced || {}).filter(([k]) => +k < st.chargeIndex));
  forced[st.chargeIndex] = alt.key;
  state.computing = 'Fahrt wird neu berechnet …';
  render();
  try {
    if (!state.tripCtx || state.tripCtx.departure.toISOString() !== t.departure) {
      // Nach einem Neuladen der App: Route & Co. einmal neu holen
      await loadData();
      state.tripCtx = await prepareTrip({
        from: t.from, to: t.to, departure: new Date(t.departure), arriveBy: t.arriveBy ? new Date(t.arriveBy) : null, bufferMin: t.bufferMin, startSoc: t.startSoc, load: t.load, withDogs: t.withDogs !== false, settings: state.settings,
        chargers: state.data.chargers.list, restAreas: state.data.restAreas?.list || [], sites: state.data.sites?.list || [],
      });
    }
    const result = planFromContext(state.tripCtx, forced);
    if (t.replanned) result.replanned = true;
    state.settings.lastTrip = result;
    await save();
    state.computing = null;
    const ni = result.stops.findIndex(x => x.kind === 'charge' && x.chargeIndex === st.chargeIndex);
    toast('Fahrt neu berechnet');
    go(ni >= 0 ? `#/stop/${ni}` : '#/trip');
  } catch (err) {
    state.computing = null;
    toast(err.message);
    render();
  }
}
