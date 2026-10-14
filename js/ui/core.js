// DogPilot – Gemeinsamer Zustand und kleine Hilfen für alle Ansichten.

import { icon } from '../icons.js';
import { duration } from '../format.js';
import { saveSettings } from '../store.js';
import { loadChargers, loadRestAreas, loadChargerSites, loadVehicles, loadVehicleSpecs } from '../data.js';

export const APP_VERSION = '2.0.0';
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const state = {
  settings: null,
  data: { chargers: null, restAreas: null, sites: null, vehicles: null, errors: {} },
  dataPromise: null,
  form: null,          // { from, to, departure, startSoc }
  computing: null,     // Fortschrittstext während der Berechnung
  error: null,
  onboardingStep: 0,
  draftDogs: null,
  live: {},            // Live-Belegung der Ladestopps (siehe refreshLive)
  traffic: {},         // Autobahn-Meldungen je Straßenliste (siehe refreshTraffic)
  drive: { on: false }, // Fahrt-Modus mit Sprachansagen (siehe startDrive)
  arrived: false,      // Fahrt-Modus hat das Ziel erkannt → „Angekommen?“ sofort zeigen
  tripCtx: null,       // Route & Ladesäulen der aktuellen Fahrt im Speicher (für Alternativen)
};

// ---------- Hilfen ----------

let toastTimer;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export const save = () => saveSettings(state.settings);
export const trip = () => state.settings.lastTrip;
// 120 → „2 Stunden“, 150 → „2 h 30 min“
export const hours = min => min % 60 ? duration(min) : `${min / 60} ${min === 60 ? 'Stunde' : 'Stunden'}`;
export const breakLabel = st => st.dogs === false ? 'Pause' : 'Gassi-Pause';   // ältere Fahrten: mit Hunden
export const placeName = p => p.label.split(',')[0];   // „Alzey, Rheinland-Pfalz“ → „Alzey“
export const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

export function loadData(force = false) {
  if (state.dataPromise && !force) return state.dataPromise;
  const d = state.data;
  d.errors = {};
  const wrap = (key, fn) => fn().then(v => { d[key] = v; }).catch(err => { d.errors[key] = err.message; });
  state.dataPromise = Promise.all([
    wrap('chargers', loadChargers),
    wrap('restAreas', loadRestAreas),
    wrap('sites', loadChargerSites),
    wrap('vehicles', loadVehicles),
    wrap('specs', loadVehicleSpecs),
  ]);
  return state.dataPromise;
}

export function defaultDeparture() {
  const d = new Date(Date.now() + 5 * 60000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return d;
}

export function avatar(photo, fallbackIcon, cls = '') {
  return `<span class="avatar ${cls}">${photo ? `<img src="${photo}" alt="">` : icon(fallbackIcon)}</span>`;
}

export const field = (label, inner, hint = '') =>
  `<label class="field"><span class="field-label">${label}</span>${inner}${hint ? `<p class="hint">${hint}</p>` : ''}</label>`;

export const numberInput = (id, value, { min, max, step = 1, suffix = '', placeholder = '' }) =>
  `<span class="input-wrap"><input class="input" id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value ?? ''}"${placeholder ? ` placeholder="${placeholder}"` : ''}>${suffix ? `<span class="suffix">${suffix}</span>` : ''}</span>`;

export function readNumber(id, min, max) {
  const v = parseFloat(String($('#' + id)?.value).replace(',', '.'));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
}


export function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'plan', arg: parts[1] };
}

export function emptyState(ic, text, href, label) {
  return `<div class="empty">${icon(ic)}<p>${text}</p><button class="btn btn-primary" type="button" data-href="${href}">${label}</button></div>`;
}

export const emptyForm = () => ({ from: null, to: null, timeMode: 'depart', departure: defaultDeparture(), arriveBy: new Date(defaultDeparture().getTime() + 6 * 3600000), startSoc: 80, load: 'normal', withDogs: false });

// render() zeichnet die aktuelle Ansicht neu; die App (js/app.js) meldet ihre Funktion hier an
let renderImpl = () => {};
export const setRender = fn => { renderImpl = fn; };
export function render() { renderImpl(); }
