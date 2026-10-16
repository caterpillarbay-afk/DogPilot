// DogPilot – Fahrtformular: Start/Ziel mit Ortssuche, Tag und Uhrzeit, Beladung, Hunde, Planen.

import { icon } from '../icons.js';
import { esc, num, clock, dayLabel, toLocalInput, vehicleName } from '../format.js';
import { searchPlaces, placeLabel } from '../services.js';
import { computeTrip, prepareTrip, planFromContext, bufferMinutes, LOAD_FACTORS, DRIVER_MAX_DRIVE_MIN } from '../trip.js';
import { openClock } from '../clock.js';
import { pct, vehicleMissing } from './forms.js';
import { $, $$, state, toast, save, trip, hours, go, loadData, avatar, field, numberInput, readNumber, route, render } from './core.js';

// Tagesauswahl als Kacheln mit Wochentag (der Kalender des Browsers zeigt beim Antippen keinen Wochentag):
// die nächsten 14 Tage, dazu „Anderes Datum“ über den Kalender
export const ymd = d => toLocalInput(d).slice(0, 10);
export const daySummary = d => `${d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}, ${clock(d)} Uhr`;
export function dayPicker(key) {
  const sel = state.form[key], today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, i) => new Date(today.getTime() + i * 86400000));
  if (!days.some(d => ymd(d) === ymd(sel))) days.push(sel);
  const label = d => { const r = dayLabel(d); return r === 'heute' ? 'Heute' : r === 'morgen' ? 'Morgen' : d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', ''); };
  // eigener Rahmen statt field(): ein <label> um die Kacheln würde Taps auf die erste Kachel umleiten
  return `<div class="field" style="margin-top:12px"><span class="field-label">${key === 'arriveBy' ? 'Ankommen am' : 'Abfahrt am'}</span><div class="days" role="radiogroup">
    ${days.map(d => `<button type="button" class="day ${ymd(d) === ymd(sel) ? 'on' : ''}" role="radio" aria-checked="${ymd(d) === ymd(sel)}" data-day="${ymd(d)}">
      <span>${label(d)}</span><b>${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</b></button>`).join('')}
    <span class="day other">${icon('calendar-clock')}<span>Anderes Datum</span><input type="date" id="dayOther" value="${ymd(sel)}" min="${ymd(today)}" aria-label="Anderes Datum"></span>
  </div><p class="hint" id="daySummary">${daySummary(sel)}</p></div>`;
}

// ---------- Planen ----------

// Zeigt, mit welchem Verbrauch geplant wird – so fällt ein falsch eingetragener Grundverbrauch sofort auf
// Puffer für „Ankunft bis …“ (Stau, besetzte Säulen); Auswahl gilt auch für spätere Fahrten
export const BUFFER = {
  tight: { label: 'Knapp', text: '5 % der Fahrzeit + 5 min je Ladestopp' },
  normal: { label: 'Normal', text: '10 % der Fahrzeit + 10 min je Ladestopp' },
  generous: { label: 'Großzügig', text: '20 % der Fahrzeit + 15 min je Ladestopp – z. B. zum Ferienbeginn' },
  custom: { label: 'Eigener', text: 'feste Minuten, unabhängig von der Strecke' },
};

export function bufferField() {
  const t = state.settings.trip, k = BUFFER[t.buffer] ? t.buffer : 'normal';
  return `<div style="margin-top:12px">${field('Puffer', `<div class="chips" role="radiogroup">${Object.entries(BUFFER).map(([b, { label }]) =>
    `<button type="button" class="chip ${k === b ? 'on' : ''}" role="radio" aria-checked="${k === b}" data-buffer="${b}">${label}${b === 'custom' && k === 'custom' ? ` · ${t.customBufferMin} min` : ''}</button>`).join('')}</div>
    ${k === 'custom' ? `<div style="margin-top:8px;max-width:10rem">${numberInput('bufferMin', t.customBufferMin, { min: 5, max: 300, step: 5, suffix: 'min' })}</div>` : ''}`,
    `${BUFFER[k].text} – für Stau, Baustellen und besetzte Säulen. DogPilot rechnet die Abfahrtszeit rückwärts aus.`)}</div>`;
}

// Beladung: Auswahl-Chip, Kurzform in der Fahrtübersicht, Erklärung (Aufschlag aus LOAD_FACTORS)
export const LOAD = {
  normal: { label: 'Normal', short: '', text: 'Alltagsbeladung' },
  roof: { label: 'Mit Dachbox', short: 'mit Dachbox', text: 'Dachbox oder Fahrradträger auf dem Dach' },
  full: { label: 'Voll beladen', short: 'voll beladen', text: 'Urlaubsgepäck bis unters Dach, alle Plätze besetzt, meist mit Dachbox' },
};

export function loadHint(load) {
  const base = state.settings.vehicle.consumptionKWh100;
  const f = LOAD_FACTORS[load] || 1;
  const learned = state.settings.vehicle.learned?.factor || 1;
  return `${LOAD[load]?.text || ''}${f > 1 ? `, +${Math.round((f - 1) * 100)} %` : ''} – geplant mit <b>${num(base * f * learned, 1)} kWh/100 km</b>${f > 1 || learned !== 1 ? ` (dein Verbrauch normal beladen: ${num(base, 1)}${learned !== 1 ? `, aus deinen Fahrten ${pct(learned)}` : ''})` : ''}, dazu Wetter und Steigungen.`;
}

// value: gewählter Ort; sonst bleibt der eingetippte Text stehen (state.form.draft), auch wenn das
// Formular neu gezeichnet wird – etwa beim Umschalten Abfahrt/Ankunft oder der Beladung
export function placeField(id, label, value, placeholder) {
  return `<div class="place" data-place="${id}">
    <label class="sr-only" for="${id}">${label}</label>
    <span class="input-wrap">${icon(id === 'from' ? 'map-pin' : id === 'home' ? 'house' : 'flag')}
      <input class="input" id="${id}" type="text" autocomplete="off" spellcheck="false" placeholder="${placeholder}" value="${esc(value?.label || state.form.draft?.[id] || '')}"
        role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}-list">
    </span>
    <div class="suggest" id="${id}-list" role="listbox" hidden></div>
  </div>`;
}

export function crewBar() {
  const s = state.settings;
  const names = s.dogs.map(d => d.name).filter(Boolean);
  return `<button class="list crew list-row" type="button" data-href="#/settings">
    <span class="avatars">${avatar(s.vehicle.photo, 'car')}${s.dogs.map(d => avatar(d.photo, 'dog')).join('')}</span>
    <span class="grow"><b>${esc(vehicleName(s.vehicle))}</b><br><span class="muted small">${names.length ? 'Mit ' + esc(names.join(' und ')) : 'Ohne Hund'} · ${num(s.vehicle.consumptionKWh100, 1)}&nbsp;kWh/100&nbsp;km normal</span></span>
    ${icon('chevron-right', 'chev')}
  </button>`;
}

export function dataNotice() {
  const e = state.data.errors;
  const missing = [e.chargers && 'Ladesäulen', e.restAreas && 'Rastanlagen'].filter(Boolean);
  if (!missing.length) return '';
  return `<div class="notice ${e.chargers ? 'error' : 'warn'}" style="margin-top:12px">${icon('circle-alert')}<span>${missing.join(' und ')} konnten nicht geladen werden${e.chargers ? ' – ohne Ladesäulen ist keine Planung möglich' : ' – Ausstattung der Stopps ist unbekannt'}. <button class="btn-ghost" type="button" data-action="reload-data">Erneut versuchen</button></span></div>`;
}

export function viewPlan() {
  const f = state.form;
  const busy = Boolean(state.computing);
  return `
    <h2 class="screen-title">Fahrt planen</h2>
    <p class="screen-sub">Ladestopps und Hundepausen auf deiner Route.</p>
    ${crewBar()}
    <div class="card" style="margin-top:12px">
      <div class="route-fields stack">
        ${placeField('from', 'Start', f.from, 'Start – Ort oder Adresse')}
        ${placeField('to', 'Ziel', f.to, 'Ziel – Ort oder Adresse')}
        <button class="icon-btn swap" type="button" id="swap" aria-label="Start und Ziel tauschen">${icon('arrow-up-down')}</button>
      </div>
      <div class="chips" role="radiogroup" aria-label="Zeit angeben als" style="margin-top:16px">
        ${[['depart', 'Abfahrt'], ['arrive', 'Ankunft']].map(([k, label]) => `<button type="button" class="chip ${f.timeMode === k ? 'on' : ''}" role="radio" aria-checked="${f.timeMode === k}" data-tmode="${k}">${label}</button>`).join('')}
      </div>
      ${dayPicker(f.timeMode === 'arrive' ? 'arriveBy' : 'departure')}
      <div class="grid-2 depart-row" style="margin-top:12px">
        <div class="field"><span class="field-label">${f.timeMode === 'arrive' ? 'Ankommen bis (Uhrzeit)' : 'Abfahrt (Uhrzeit)'}</span>
          <button type="button" class="input time-btn" id="tripTime">${clock(f[f.timeMode === 'arrive' ? 'arriveBy' : 'departure'])} Uhr ${icon('clock')}</button></div>
        ${field('Akku bei Abfahrt', numberInput('startSoc', f.startSoc, { min: 5, max: 100, suffix: '%' }))}
      </div>
      <div style="margin-top:12px">${field('Beladung', `<div class="chips" role="radiogroup">${Object.entries(LOAD).map(([k, { label }]) =>
        `<button type="button" class="chip ${f.load === k ? 'on' : ''}" role="radio" aria-checked="${f.load === k}" data-load="${k}">${label}</button>`).join('')}</div>`,
        `<span id="loadHint">${loadHint(f.load)}</span>`)}</div>
      ${state.settings.dogs.length ? `<div style="margin-top:12px">${field('Hunde', `<div class="chips"><button type="button" class="chip ${f.withDogs ? 'on' : ''}" aria-pressed="${f.withDogs}" data-dogs>${icon('paw-print')} Mit Hunden</button></div>`,
        f.withDogs ? `Gassi-Pausen spätestens nach ${hours(state.settings.charging.maxDriveMin || 120)} Fahrt, Stopps mit Grün bevorzugt.` : `Ohne Hunde: Pause spätestens nach ${hours(Math.max(DRIVER_MAX_DRIVE_MIN, state.settings.charging.maxDriveMin || 0))}, Stopps nach WC und Essen.`)}</div>` : ''}
      ${f.timeMode === 'arrive' ? bufferField() : ''}
      <button class="btn btn-primary block" id="planBtn" type="button" style="margin-top:20px" ${busy ? 'disabled' : ''}>
        ${busy ? `${icon('loader-circle', 'spin')} ${esc(state.computing)}` : `${icon('route')} Fahrt planen`}
      </button>
      ${state.error ? `<div class="notice error" style="margin-top:12px" role="alert">${icon('circle-alert')}<span>${esc(state.error)}</span></div>` : ''}
    </div>
    ${dataNotice()}
    ${trip() ? `<button class="list list-row" type="button" data-href="#/trip" style="margin-top:12px">${icon('calendar-clock')}<span class="grow">Letzte Fahrt<br><span class="muted small">${esc(trip().from.label)} → ${esc(trip().to.label)}</span></span>${icon('chevron-right', 'chev')}</button>` : ''}`;
}

// onPick(ort): gewählten Ort übernehmen – Standard: ins Planungsformular (Start bzw. Ziel)
export function bindPlace(root, id, onPick = place => { state.form[id] = place; state.error = null; }) {
  const inp = $('#' + id, root), list = $('#' + id + '-list', root);
  let results = [], active = -1, timer, seq = 0, noHits = false, searching = false;   // noHits: Suche lief, aber ohne Treffer
  const close = () => { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); active = -1; };
  const choose = r => {
    const place = { label: r.sub ? `${r.main}, ${r.sub}` : r.main, lat: r.lat, lon: r.lon };
    inp.value = place.label;
    if (state.form.draft) delete state.form.draft[id];
    close();
    onPick(place);
  };
  const show = () => {
    const opts = [...results];
    // Tipp zur Koordinaten-Eingabe erst, wenn die Suche wirklich nichts gefunden hat
    const tip = !opts.length && searching ? `<div class="suggest-empty">${icon('loader-circle', 'sm spin')}<span class="sub">Suche läuft …</span></div>`
      : !opts.length && noHits ? `<div class="suggest-empty">${icon('search', 'sm')}<span><span class="main">Nichts gefunden</span><br><span class="sub">Tipp: In Google Maps lange auf den Ort tippen, die Koordinaten oben antippen (kopiert) und hier einfügen.</span></span></div>` : '';
    list.innerHTML = tip + opts.map((r, i) => `<button type="button" role="option" data-i="${i}" class="${i === active ? 'active' : ''}">
      ${icon(r.here ? 'locate' : r.home || r.setHome ? 'house' : 'map-pin', 'sm')}<span><span class="main">${esc(r.main)}</span>${r.sub ? `<br><span class="sub">${esc(r.sub)}</span>` : ''}</span></button>`).join('');
    // Antwort kommt erst, wenn das Feld schon verlassen ist: Liste nicht mehr aufklappen (würde andere Knöpfe verdecken)
    list.hidden = (!opts.length && !tip) || document.activeElement !== inp;
    inp.setAttribute('aria-expanded', String(!list.hidden));
    $$('button', list).forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); pick(+b.dataset.i); }));
  };
  const pick = i => {
    const r = results[i];
    if (!r) return;
    if (r.setHome) { close(); go('#/settings/home'); return; }
    if (r.home) { const h = state.settings.home; choose({ main: h.label, sub: '', lat: h.lat, lon: h.lon }); return; }
    if (!r.here) { choose(r); return; }
    if (!navigator.geolocation) { toast('Ortung wird nicht unterstützt'); return; }
    inp.value = 'Standort wird ermittelt …';
    close();
    navigator.geolocation.getCurrentPosition(
      async p => {
        const { latitude: lat, longitude: lon } = p.coords;
        choose({ main: await placeLabel(lat, lon) || 'Aktueller Standort', sub: '', lat, lon });
      },
      () => { inp.value = ''; toast('Standort nicht verfügbar'); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  };
  // Schnellauswahl beim Antippen: Zuhause (oder Hinweis zum Festlegen) und aktueller Standort
  const quick = () => {
    const h = state.settings.home;
    const here = { quick: true, here: true, main: 'Aktueller Standort', sub: '' };
    if (id === 'home') return [here];
    return [h ? { quick: true, home: true, main: 'Zuhause', sub: h.label } : { quick: true, setHome: true, main: 'Zuhause festlegen', sub: 'Einmal eintragen, dann hier mit einem Tipp übernehmen' }, here];
  };
  inp.addEventListener('focus', () => { if (inp.value) inp.select(); results = quick(); active = -1; noHits = false; show(); });
  inp.addEventListener('blur', () => setTimeout(close, 150));
  inp.addEventListener('input', () => {
    if (id in state.form) state.form[id] = null;
    state.form.draft = { ...state.form.draft, [id]: inp.value };
    noHits = false;
    clearTimeout(timer);
    const q = inp.value;
    if (q.trim().length < 2) { results = q ? [] : quick(); searching = false; show(); return; }
    results = []; searching = true; show();
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const near = state.form.from && id === 'to' ? [state.form.from.lat, state.form.from.lon] : null;
        const r = await searchPlaces(q, near, { tomtomKey: state.settings.keys.tomtom });
        if (my !== seq) return;
        results = r; active = -1; noHits = !r.length; searching = false; show();
      } catch (err) {
        if (my === seq) { results = []; searching = false; show(); toast(err.message); }
      }
    }, 250);
  });
  inp.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); show(); e.preventDefault(); }
    // Schnellauswahl (Zuhause, Standort) nur nach Markieren übernehmen, Suchtreffer auch direkt
    else if (e.key === 'Enter' && (active >= 0 || !results[0]?.quick)) { pick(active >= 0 ? active : 0); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
}

export function bindPlan(root) {
  bindPlace(root, 'from');
  bindPlace(root, 'to');
  $('#swap', root).addEventListener('click', () => {
    const f = state.form, d = f.draft || {};
    [f.from, f.to] = [f.to, f.from];
    f.draft = { from: d.to, to: d.from };
    $('#from', root).value = f.from?.label || f.draft.from || '';
    $('#to', root).value = f.to?.label || f.draft.to || '';
  });
  // Tag (Kacheln oder Kalender) und Uhrzeit getrennt; beides setzt Abfahrt bzw. „Ankommen bis“
  const tKey = () => (state.form.timeMode === 'arrive' ? 'arriveBy' : 'departure');
  const setDay = value => {
    const [y, m, d] = value.split('-').map(Number);
    if (!y) return;
    const t = new Date(state.form[tKey()]);
    t.setFullYear(y, m - 1, d);
    state.form[tKey()] = t;
    render();
  };
  $$('[data-day]', root).forEach(b => b.addEventListener('click', () => setDay(b.dataset.day)));
  // gewählter Tag sichtbar, auch wenn er weiter hinten in der Reihe liegt
  const days = $('.days', root), onDay = $('.day.on', root);
  if (days && onDay) days.scrollLeft = Math.max(0, onDay.offsetLeft - days.offsetLeft - days.clientWidth / 2 + onDay.offsetWidth / 2);
  $('#dayOther', root)?.addEventListener('change', e => setDay(e.target.value));
  // eigene runde Uhr (js/clock.js) statt des Android-Uhrfensters
  $('#tripTime', root)?.addEventListener('click', () => {
    const t = new Date(state.form[tKey()]), arrive = tKey() === 'arriveBy';
    openClock({
      hours: t.getHours(), minutes: t.getMinutes(), title: arrive ? 'Ankommen bis' : 'Abfahrt',
      presets: arrive ? [[12, 0], [14, 0], [16, 0], [18, 0]] : [[null, 0], [6, 0], [7, 0], [8, 0], [9, 0]],
      onPick: (h, min) => { const d = new Date(state.form[tKey()]); d.setHours(h, min, 0, 0); state.form[tKey()] = d; render(); },
    });
  });
  $$('[data-tmode]', root).forEach(b => b.addEventListener('click', () => { state.form.timeMode = b.dataset.tmode; render(); }));
  $$('[data-buffer]', root).forEach(b => b.addEventListener('click', () => { state.settings.trip.buffer = b.dataset.buffer; save(); render(); }));
  $('#bufferMin', root)?.addEventListener('change', () => {
    const v = readNumber('bufferMin', 5, 300);
    if (v != null) { state.settings.trip.customBufferMin = Math.round(v); save(); render(); }
  });
  $('[data-dogs]', root)?.addEventListener('click', () => { state.form.withDogs = !state.form.withDogs; render(); });
  $$('[data-load]', root).forEach(b => b.addEventListener('click', () => {
    state.form.load = b.dataset.load;
    $$('[data-load]', root).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
    $('#loadHint', root).innerHTML = loadHint(state.form.load);
  }));
  $('#startSoc', root).addEventListener('change', () => {
    const v = readNumber('startSoc', 5, 100);
    if (v != null) { state.form.startSoc = Math.round(v); $('#startSoc', root).value = state.form.startSoc; }
  });
  $('#planBtn', root).addEventListener('click', plan);
}

// „Ankunft bis …“: Abfahrt = Ankunft − (Fahrzeit + Stopps + Puffer). Wetter und Zeitplan hängen von der
// Abfahrt ab, daher zweimal nachrechnen; Route und Wetter werden nur bei größerer Verschiebung neu geholt.
export async function planBackwards(args, arriveBy, setProgress) {
  const t = state.settings.trip;
  let departure = new Date(arriveBy.getTime() - 5 * 3600000), ctx = null, trip = null, bufferMin = 0;
  for (let i = 0; i < 3; i++) {
    if (!ctx || Math.abs(departure - ctx.departure) > 45 * 60000) ctx = await prepareTrip({ ...args, departure, arriveBy });
    else ctx = { ...ctx, departure };
    setProgress('Abfahrtszeit wird berechnet …');
    trip = planFromContext(ctx);
    bufferMin = bufferMinutes(t.buffer, trip.driveMin, trip.stops.filter(s => s.kind === 'charge').length, t.customBufferMin);
    const next = new Date(arriveBy.getTime() - (trip.totalMin + bufferMin) * 60000);
    next.setSeconds(0, 0);
    next.setMinutes(Math.floor(next.getMinutes() / 5) * 5);   // auf 5 Minuten früher runden
    if (Math.abs(next - departure) < 60000) break;
    departure = next;
  }
  ctx = { ...ctx, departure, bufferMin };
  return { ctx, trip: planFromContext(ctx) };
}

export async function plan() {
  const f = state.form;
  state.error = null;
  const missing = vehicleMissing(state.settings.vehicle);
  if (missing) { state.error = missing + ' (Einstellungen → Fahrzeug)'; render(); return; }
  // Ort eingetippt, aber (noch) keinen Vorschlag angetippt – z. B. weil die Ortssuche langsam antwortet:
  // dann den besten Treffer selbst nehmen
  const typed = Object.fromEntries(['from', 'to'].map(id => [id, f[id] ? '' : ($('#' + id)?.value || '').trim()]));
  for (const id of ['from', 'to']) {
    if (f[id] || typed[id].length < 2 || typed[id].startsWith('Standort wird')) continue;
    state.computing = 'Ort wird gesucht …';
    render();
    try {
      const near = id === 'to' && f.from ? [f.from.lat, f.from.lon] : null;
      const [r] = await searchPlaces(typed[id], near, { tomtomKey: state.settings.keys.tomtom });
      if (r) f[id] = { label: r.sub ? `${r.main}, ${r.sub}` : r.main, lat: r.lat, lon: r.lon };
      else state.error = `„${typed[id]}“ nicht gefunden – bitte anders schreiben oder einen Vorschlag aus der Liste wählen.`;
    } catch (err) {
      state.error = `Ortssuche gerade nicht erreichbar (${err.message}).`;
    }
    state.computing = null;
    if (state.error) { render(); return; }
  }
  if (!f.from || !f.to) {
    state.error = !f.from ? 'Bitte einen Start eingeben.' : 'Bitte ein Ziel eingeben.';
    render();
    return;
  }
  const setProgress = text => { state.computing = text; if (['plan', 'trip'].includes(route().name)) render(); };
  try {
    setProgress('Daten werden geladen …');
    await loadData();
    if (!state.data.chargers) throw new Error('Ladesäulen-Daten konnten nicht geladen werden. Bitte Verbindung prüfen.');
    const args = {
      from: f.from, to: f.to, departure: f.departure, startSoc: f.startSoc, load: f.load, withDogs: Boolean(f.withDogs && state.settings.dogs.length), settings: state.settings,
      ...(f.replan && f.arriveBy ? { arriveBy: f.arriveBy } : {}),
      chargers: state.data.chargers.list, restAreas: state.data.restAreas?.list || [], sites: state.data.sites?.list || [], onProgress: setProgress,
    };
    let { ctx, trip: result } = f.timeMode === 'arrive'
      ? await planBackwards(args, f.arriveBy, setProgress)
      : await computeTrip(args);
    if (f.replan) result.replanned = true;
    state.arrived = false;   // „Angekommen?“ gilt für die vorige Fahrt
    state.tripCtx = ctx;
    state.settings.lastTrip = result;
    await save();
    state.computing = null;
    go('#/trip');
  } catch (err) {
    state.computing = null;
    state.error = err.message;
    if (route().name === 'trip') { state.replanOpen = true; state.replanError = err.message; }
    render();
  }
}
