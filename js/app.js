// DogPilot – Oberfläche: Navigation über #/…-Adressen, Ansichten als Funktionen, die HTML liefern.

import { icon } from './icons.js';
import { esc, num, duration, shortDuration, clock, dayLabel, dateLabel, toLocalInput, prettyMake, prettyModel, vehicleName } from './format.js';
import { loadSettings, saveSettings, resetAll, resizePhoto, DEFAULT_SETTINGS } from './store.js';
import { loadChargers, loadRestAreas, loadChargerSites, loadVehicles, loadVehicleSpecs, matchVariants, FEATURES } from './data.js';
import { searchPlaces, getChargerStatus } from './services.js';
import { computeTrip, LOAD_FACTORS } from './trip.js';
import { LEGAL } from './legal.js';
import { mountMap, unmountMap, fitRoute, toggleLocate } from './map.js';

const APP_VERSION = '2.0.0';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  settings: null,
  data: { chargers: null, restAreas: null, sites: null, vehicles: null, errors: {} },
  dataPromise: null,
  form: null,          // { from, to, departure, startSoc }
  computing: null,     // Fortschrittstext während der Berechnung
  error: null,
  onboardingStep: 0,
  draftDogs: null,
};

// ---------- Hilfen ----------

let toastTimer;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

const save = () => saveSettings(state.settings);
const trip = () => state.settings.lastTrip;
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };

function loadData(force = false) {
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

function defaultDeparture() {
  const d = new Date(Date.now() + 5 * 60000);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return d;
}

function avatar(photo, fallbackIcon, cls = '') {
  return `<span class="avatar ${cls}">${photo ? `<img src="${photo}" alt="">` : icon(fallbackIcon)}</span>`;
}

const field = (label, inner, hint = '') =>
  `<label class="field"><span class="field-label">${label}</span>${inner}${hint ? `<p class="hint">${hint}</p>` : ''}</label>`;

const numberInput = (id, value, { min, max, step = 1, suffix = '', placeholder = '' }) =>
  `<span class="input-wrap"><input class="input" id="${id}" type="number" inputmode="decimal" min="${min}" max="${max}" step="${step}" value="${value ?? ''}"${placeholder ? ` placeholder="${placeholder}"` : ''}>${suffix ? `<span class="suffix">${suffix}</span>` : ''}</span>`;

function readNumber(id, min, max) {
  const v = parseFloat(String($('#' + id)?.value).replace(',', '.'));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
}

// ---------- Fahrzeug-Formular (Einführung und Einstellungen) ----------

function vehicleFormHtml(v) {
  const list = state.data.vehicles;
  const makes = list ? [...new Set(list.map(x => x.marke))] : [];
  const models = list ? list.filter(x => x.marke === v.make) : [];
  return `
    ${!list && !state.data.errors.vehicles ? `<div class="progress">${icon('loader-circle', 'spin')} Fahrzeugliste wird geladen …</div>` : ''}
    ${state.data.errors.vehicles ? `<div class="notice warn">${icon('triangle-alert')}<span>Fahrzeugliste nicht verfügbar. Trage den Verbrauch bitte selbst ein.</span></div>` : ''}
    <div class="grid-2">
      ${field('Marke', `<select class="select" id="vMake"><option value="">Bitte wählen</option>${makes.map(m => `<option value="${esc(m)}" ${m === v.make ? 'selected' : ''}>${esc(prettyMake(m))}</option>`).join('')}</select>`)}
      ${field('Modell', `<select class="select" id="vModel" ${models.length ? '' : 'disabled'}><option value="">${v.make ? 'Bitte wählen' : 'Erst Marke wählen'}</option>${models.map(m => `<option value="${esc(m.modell)}" ${m.modell === v.model ? 'selected' : ''}>${esc(prettyModel(m.marke, m.modell))}</option>`).join('')}</select>`)}
    </div>
    ${variantField(v)}
    <div class="grid-2" style="margin-top:12px">
      ${field('Akku netto', numberInput('vCapacity', v.capacityKWh, { min: 10, max: 200, step: 0.1, suffix: 'kWh', placeholder: 'z. B. 60' }))}
      ${field('Max. Ladeleistung', numberInput('vMaxKw', v.carMaxKw, { min: 11, max: 400, suffix: 'kW', placeholder: 'z. B. 120' }))}
    </div>
    <div class="field" style="margin-top:12px">
      ${field('Verbrauch normal beladen', numberInput('vConsumption', v.consumptionKWh100, { min: 8, max: 60, step: 0.1, suffix: 'kWh/100 km' }),
        'Trag deinen echten Verbrauch normal beladen bei deinem üblichen Autobahntempo ein. Bei Auswahl eines Modells steht hier zunächst der WLTP-Normwert – der liegt meist 10–20 % zu niedrig. Dachbox oder volle Beladung wählst du pro Fahrt; Temperatur und Steigungen rechnet DogPilot automatisch dazu.')}
      <div id="vConsumptionWarn">${consumptionWarning(v)}</div>
    </div>
    <p class="hint">Ohne passende Variante: Nutzbare Akku-Kapazität (netto) und maximale DC-Ladeleistung findest du im Datenblatt deines Fahrzeugs.</p>`;
}

// Schutz vor Verwechslung: Wer hier den Verbrauch voll beladen einträgt, bekommt die Beladung pro Fahrt doppelt aufgeschlagen
const wltpOf = v => state.data.vehicles?.find(x => x.marke === v.make && x.modell === v.model)?.verbrauchKWh100;

function consumptionWarning(v) {
  const wltp = wltpOf(v);
  const limit = wltp ? wltp * 1.3 : 26;
  if (!(v.consumptionKWh100 > limit)) return '';
  const ref = wltp ? `${num(v.consumptionKWh100, 1)} kWh liegt mehr als 30 % über dem Normwert dieses Modells (${num(wltp, 1)} kWh).` : `${num(v.consumptionKWh100, 1)} kWh ist für normale Beladung sehr hoch.`;
  return `<div class="notice warn" style="margin-top:8px">${icon('triangle-alert')}<span>${ref} Ist das dein Verbrauch mit Dachbox oder voll beladen? Dann trag hier den Wert <b>normal beladen</b> ein – die Beladung wählst du pro Fahrt, sonst wird sie doppelt gerechnet.</span></div>`;
}

const variantsOf = v => matchVariants(state.data.specs, v.make, v.model);
const variantKey = x => `${x.modell}|${x.jahr || ''}|${x.akkuKWh}|${x.dcKw}`;

function variantField(v) {
  const list = variantsOf(v);
  if (!list.length) return '';
  return `<div style="margin-top:12px">${field('Variante', `<select class="select" id="vVariant"><option value="">Bitte wählen – füllt Akku und Ladeleistung aus</option>${list.map((x, i) =>
    `<option value="${i}" ${variantKey(x) === v.variant ? 'selected' : ''}>${esc(x.modell)}${x.jahr ? ` · ${x.jahr}` : ''} · ${num(x.akkuKWh, 1)} kWh · ${num(x.dcKw)} kW</option>`).join('')}</select>`,
    'Werte aus Open EV Data. Neuere Modelljahre oder Software-Updates können mehr Ladeleistung haben – dann den Wert unten anpassen.')}</div>`;
}

function vehicleMissing(v) {
  const names = [!(v.capacityKWh > 0) && 'Akku netto', !(v.carMaxKw > 0) && 'max. Ladeleistung', !(v.consumptionKWh100 > 0) && 'Verbrauch'].filter(Boolean);
  return names.length ? `Bitte ${names.join(', ').replace(/, ([^,]*)$/, ' und $1')} eintragen.` : '';
}

function bindVehicleForm(root, v, onChange) {
  $('#vMake', root)?.addEventListener('change', e => {
    v.make = e.target.value; v.model = ''; v.variant = '';
    onChange(true);
  });
  $('#vModel', root)?.addEventListener('change', e => {
    v.model = e.target.value; v.variant = '';
    const hit = state.data.vehicles?.find(x => x.marke === v.make && x.modell === v.model);
    if (hit) v.consumptionKWh100 = hit.verbrauchKWh100;
    onChange(true);
  });
  $('#vVariant', root)?.addEventListener('change', e => {
    const x = variantsOf(v)[+e.target.value];
    if (!x) return;
    Object.assign(v, { variant: variantKey(x), capacityKWh: x.akkuKWh, carMaxKw: x.dcKw });
    onChange(true);
  });
  for (const [id, key, min, max] of [['vCapacity', 'capacityKWh', 10, 200], ['vMaxKw', 'carMaxKw', 11, 400], ['vConsumption', 'consumptionKWh100', 8, 60]]) {
    $('#' + id, root)?.addEventListener('change', () => {
      const val = readNumber(id, min, max);
      if (val != null) { v[key] = val; $('#' + id, root).value = val; onChange(false); }
      const warn = $('#vConsumptionWarn', root);
      if (warn) warn.innerHTML = consumptionWarning(v);
    });
  }
}

// ---------- Hunde-Formular ----------

function dogsFormHtml(dogs) {
  return `
    <div class="stack">
      ${dogs.map((d, i) => `
      <div class="dog-row">
        <label class="photo-btn" aria-label="Foto für ${esc(d.name || 'Hund')} wählen">
          ${avatar(d.photo, 'camera', 'lg')}
          <input type="file" accept="image/*" data-dog-photo="${i}">
        </label>
        <input class="input grow" data-dog-name="${i}" value="${esc(d.name)}" placeholder="Name" maxlength="30" autocomplete="off">
        <button class="icon-btn plain" type="button" data-dog-remove="${i}" aria-label="${esc(d.name || 'Hund')} entfernen">${icon('trash-2')}</button>
      </div>`).join('')}
    </div>
    <button class="btn btn-secondary block" type="button" id="dogAdd" style="margin-top:16px">${icon('plus')} Hund hinzufügen</button>`;
}

function bindDogsForm(root, dogs, onChange) {
  $('#dogAdd', root)?.addEventListener('click', () => { dogs.push({ id: crypto.randomUUID(), name: '', photo: null }); onChange(true); });
  $$('[data-dog-remove]', root).forEach(b => b.addEventListener('click', () => { dogs.splice(+b.dataset.dogRemove, 1); onChange(true); }));
  $$('[data-dog-name]', root).forEach(inp => inp.addEventListener('change', () => { dogs[+inp.dataset.dogName].name = inp.value.trim(); onChange(false); }));
  $$('[data-dog-photo]', root).forEach(inp => inp.addEventListener('change', async () => {
    const file = inp.files?.[0];
    if (!file) return;
    try { dogs[+inp.dataset.dogPhoto].photo = await resizePhoto(file); onChange(true); }
    catch (err) { toast(err.message); }
  }));
}

// ---------- Lade-Vorlieben ----------

function chargingFormHtml(c) {
  const kwOptions = [[50, '50 kW'], [150, '150 kW'], [300, '300 kW']];
  return `
    ${field('Bevorzugte Ladeleistung', `<div class="chips" role="radiogroup">${kwOptions.map(([kw, l]) =>
      `<button type="button" class="chip ${c.minChargerKw === kw ? 'on' : ''}" role="radio" aria-checked="${c.minChargerKw === kw}" data-minkw="${kw}">${icon('zap')} ab ${l}</button>`).join('')}</div>`,
      'Langsamere Säulen werden nur vorgeschlagen, wenn keine schnellere erreichbar ist – mit Hinweis.')}
    <div class="grid-2" style="margin-top:16px">
      ${field('Akku am Ziel mindestens', numberInput('cArrival', c.arrivalSoc, { min: 5, max: 60, suffix: '%' }))}
      ${field('Reserve unterwegs', numberInput('cReserve', c.reserveSoc, { min: 5, max: 30, suffix: '%' }))}
    </div>
    <div class="grid-2" style="margin-top:12px">
      ${field('Laden bis höchstens', numberInput('cMaxCharge', c.maxChargeSoc, { min: 50, max: 100, suffix: '%' }))}
      ${field('Pause mindestens', numberInput('cBreak', c.minBreakMin, { min: 0, max: 60, suffix: 'min' }))}
    </div>
    <div style="margin-top:12px">
      ${field('Pause spätestens nach', numberInput('cMaxDrive', c.maxDriveMin ?? 120, { min: 45, max: 240, step: 15, suffix: 'min Fahrt' }),
        'Spätestens nach dieser Fahrzeit plant DogPilot einen Stopp – wenn möglich an einer Ladesäule, damit während der Pause geladen wird, sonst als Gassi-Pause an einer hundefreundlichen Rastanlage.')}
    </div>
    <p class="hint">Über 80 % lädt fast jedes Elektroauto deutlich langsamer. Während der Pause lädt DogPilot so viel, wie in der Pausenzeit möglich ist, aber nicht mehr als bis zum Ziel nötig.</p>`;
}

function bindChargingForm(root, c, onChange) {
  $$('[data-minkw]', root).forEach(b => b.addEventListener('click', () => { c.minChargerKw = +b.dataset.minkw; onChange(true); }));
  for (const [id, key, min, max] of [['cArrival', 'arrivalSoc', 5, 60], ['cReserve', 'reserveSoc', 5, 30], ['cMaxCharge', 'maxChargeSoc', 50, 100], ['cBreak', 'minBreakMin', 0, 60], ['cMaxDrive', 'maxDriveMin', 45, 240]]) {
    $('#' + id, root)?.addEventListener('change', () => {
      const val = readNumber(id, min, max);
      if (val != null) { c[key] = Math.round(val); $('#' + id, root).value = c[key]; onChange(false); }
    });
  }
}

// ---------- Einführung ----------

function viewOnboarding() {
  const s = state.settings, step = state.onboardingStep;
  const steps = `<div class="steps" aria-hidden="true">${[1, 2, 3].map(i => `<span class="${i <= step ? 'done' : ''}"></span>`).join('')}</div>`;
  if (step === 0) {
    return `<div class="onboarding">
      <div class="welcome">
        <img src="logo.png" alt="">
        <h1>Willkommen bei DogPilot</h1>
        <p class="muted">Dein Reiseplaner für Elektroauto, Mensch und Hund.</p>
      </div>
      <div class="benefits">
        ${[['battery-charging', 'Ladestopps, die passen', 'Geplant auf deiner echten Route – mit Wetter, Steigungen und deinem Verbrauch.'],
           ['dog', 'Pausen für den Hund', 'Rastanlagen mit Wiese, Wald oder Hundewiese werden bevorzugt.'],
           ['shield-check', 'Ohne Konto, ohne Tracking', 'Deine Angaben bleiben auf deinem Gerät.']].map(([ic, t, d]) => `
        <div class="benefit"><span class="badge">${icon(ic)}</span><div><b>${t}</b><div class="muted small">${d}</div></div></div>`).join('')}
      </div>
      <div class="actions"><button class="btn btn-primary block" id="obNext" type="button">Los geht's</button></div>
    </div>`;
  }
  const titles = ['', ['Dein Fahrzeug', 'Damit Reichweite und Ladezeiten stimmen.'], ['Deine Hunde', 'Optional – für die Übersicht und die Planung der Pausen.'], ['Laden und Pausen', 'Du kannst alles später in den Einstellungen ändern.']];
  const body = step === 1 ? vehicleFormHtml(s.vehicle) : step === 2 ? dogsFormHtml(state.draftDogs) : chargingFormHtml(s.charging);
  return `<div class="onboarding">
    ${steps}
    <h2 class="screen-title">${titles[step][0]}</h2>
    <p class="screen-sub">${titles[step][1]}</p>
    <div id="obForm">${body}</div>
    <div class="actions btn-row">
      <button class="btn btn-secondary" id="obBack" type="button">Zurück</button>
      <button class="btn btn-primary" id="obNext" type="button">${step === 3 ? 'Fertig' : 'Weiter'}</button>
    </div>
  </div>`;
}

function bindOnboarding(root) {
  const s = state.settings;
  const step = state.onboardingStep;
  if (step === 1) bindVehicleForm(root, s.vehicle, rerender => rerender && render());
  if (step === 2) bindDogsForm(root, state.draftDogs, rerender => rerender && render());
  if (step === 3) bindChargingForm(root, s.charging, rerender => rerender && render());
  $('#obBack', root)?.addEventListener('click', () => { state.onboardingStep--; render(); });
  $('#obNext', root)?.addEventListener('click', async () => {
    if (step === 1 && vehicleMissing(s.vehicle)) { toast(vehicleMissing(s.vehicle)); return; }
    if (step === 2) s.dogs = state.draftDogs.filter(d => d.name || d.photo).map(d => ({ ...d, name: d.name || 'Hund' }));
    if (step === 3) {
      s.onboarded = true;
      await save();
      go('#/plan');
      return;
    }
    if (step === 1) state.draftDogs = structuredClone(s.dogs);
    state.onboardingStep++;
    await save();
    render();
  });
}

// ---------- Planen ----------

// Zeigt, mit welchem Verbrauch geplant wird – so fällt ein falsch eingetragener Grundverbrauch sofort auf
function loadHint(load) {
  const base = state.settings.vehicle.consumptionKWh100;
  const f = LOAD_FACTORS[load] || 1;
  const what = { normal: 'Alltagsbeladung', roof: 'Dachbox oder Fahrradträger auf dem Dach, +12 %', full: 'Urlaubsgepäck bis unters Dach, alle Plätze besetzt, meist mit Dachbox, +20 %' }[load] || '';
  return `${what} – geplant mit <b>${num(base * f, 1)} kWh/100 km</b>${f > 1 ? ` (dein Verbrauch normal beladen: ${num(base, 1)})` : ''}, dazu Wetter und Steigungen.`;
}

const LOAD_OPTIONS = [['normal', 'Normal'], ['roof', 'Mit Dachbox'], ['full', 'Voll beladen']];

function placeField(id, label, value, placeholder) {
  return `<div class="place" data-place="${id}">
    <label class="sr-only" for="${id}">${label}</label>
    <span class="input-wrap">${icon(id === 'from' ? 'map-pin' : 'flag')}
      <input class="input" id="${id}" type="text" autocomplete="off" spellcheck="false" placeholder="${placeholder}" value="${esc(value?.label || '')}"
        role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}-list">
    </span>
    <div class="suggest" id="${id}-list" role="listbox" hidden></div>
  </div>`;
}

function crewBar() {
  const s = state.settings;
  const names = s.dogs.map(d => d.name).filter(Boolean);
  return `<button class="list crew list-row" type="button" data-href="#/settings">
    <span class="avatars">${avatar(s.vehicle.photo, 'car')}${s.dogs.map(d => avatar(d.photo, 'dog')).join('')}</span>
    <span class="grow"><b>${esc(vehicleName(s.vehicle))}</b><br><span class="muted small">${names.length ? 'Mit ' + esc(names.join(' und ')) : 'Ohne Hund'} · ${num(s.vehicle.consumptionKWh100, 1)}&nbsp;kWh/100&nbsp;km normal</span></span>
    ${icon('chevron-right', 'chev')}
  </button>`;
}

function dataNotice() {
  const e = state.data.errors;
  const missing = [e.chargers && 'Ladesäulen', e.restAreas && 'Rastanlagen'].filter(Boolean);
  if (!missing.length) return '';
  return `<div class="notice ${e.chargers ? 'error' : 'warn'}" style="margin-top:12px">${icon('circle-alert')}<span>${missing.join(' und ')} konnten nicht geladen werden${e.chargers ? ' – ohne Ladesäulen ist keine Planung möglich' : ' – Ausstattung der Stopps ist unbekannt'}. <button class="btn-ghost" type="button" data-action="reload-data">Erneut versuchen</button></span></div>`;
}

function viewPlan() {
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
      <p class="hint">Ort nicht gefunden? In Google Maps lange auf den Ort tippen, die Koordinaten oben antippen (kopiert) und hier einfügen.</p>
      <div class="grid-2 depart-row" style="margin-top:16px">
        ${field('Abfahrt', `<input class="input" id="departure" type="datetime-local" value="${toLocalInput(f.departure)}">`)}
        ${field('Akku bei Abfahrt', numberInput('startSoc', f.startSoc, { min: 5, max: 100, suffix: '%' }))}
      </div>
      <div style="margin-top:12px">${field('Beladung', `<div class="chips" role="radiogroup">${LOAD_OPTIONS.map(([k, label]) =>
        `<button type="button" class="chip ${f.load === k ? 'on' : ''}" role="radio" aria-checked="${f.load === k}" data-load="${k}">${label}</button>`).join('')}</div>`,
        `<span id="loadHint">${loadHint(f.load)}</span>`)}</div>
      <button class="btn btn-primary block" id="planBtn" type="button" style="margin-top:20px" ${busy ? 'disabled' : ''}>
        ${busy ? `${icon('loader-circle', 'spin')} ${esc(state.computing)}` : `${icon('route')} Fahrt planen`}
      </button>
      ${state.error ? `<div class="notice error" style="margin-top:12px" role="alert">${icon('circle-alert')}<span>${esc(state.error)}</span></div>` : ''}
    </div>
    ${dataNotice()}
    ${trip() ? `<button class="list list-row" type="button" data-href="#/trip" style="margin-top:12px">${icon('calendar-clock')}<span class="grow">Letzte Fahrt<br><span class="muted small">${esc(trip().from.label)} → ${esc(trip().to.label)}</span></span>${icon('chevron-right', 'chev')}</button>` : ''}`;
}

function bindPlace(root, id) {
  const inp = $('#' + id, root), list = $('#' + id + '-list', root);
  let results = [], active = -1, timer, seq = 0;
  const close = () => { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); active = -1; };
  const choose = r => {
    state.form[id] = { label: r.sub ? `${r.main}, ${r.sub}` : r.main, lat: r.lat, lon: r.lon };
    inp.value = state.form[id].label;
    close();
    state.error = null;
  };
  const show = () => {
    const opts = [...results];
    list.innerHTML = opts.map((r, i) => `<button type="button" role="option" data-i="${i}" class="${i === active ? 'active' : ''}">
      ${icon(r.here ? 'locate' : 'map-pin', 'sm')}<span><span class="main">${esc(r.main)}</span>${r.sub ? `<br><span class="sub">${esc(r.sub)}</span>` : ''}</span></button>`).join('');
    list.hidden = !opts.length;
    inp.setAttribute('aria-expanded', String(!list.hidden));
    $$('button', list).forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); pick(+b.dataset.i); }));
  };
  const pick = i => {
    const r = results[i];
    if (!r) return;
    if (!r.here) { choose(r); return; }
    if (!navigator.geolocation) { toast('Ortung wird nicht unterstützt'); return; }
    inp.value = 'Standort wird ermittelt …';
    close();
    navigator.geolocation.getCurrentPosition(
      p => choose({ main: 'Aktueller Standort', sub: '', lat: p.coords.latitude, lon: p.coords.longitude }),
      () => { inp.value = ''; toast('Standort nicht verfügbar'); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
  };
  const here = { here: true, main: 'Aktueller Standort', sub: '' };
  inp.addEventListener('focus', () => { if (!inp.value) { results = [here]; show(); } else inp.select(); });
  inp.addEventListener('blur', () => setTimeout(close, 150));
  inp.addEventListener('input', () => {
    state.form[id] = null;
    clearTimeout(timer);
    const q = inp.value;
    if (q.trim().length < 2) { results = q ? [] : [here]; show(); return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const near = state.form.from && id === 'to' ? [state.form.from.lat, state.form.from.lon] : null;
        const r = await searchPlaces(q, near);
        if (my !== seq) return;
        results = r; active = -1; show();
      } catch (err) {
        if (my === seq) { results = []; show(); toast(err.message); }
      }
    }, 250);
  });
  inp.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); show(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(active >= 0 ? active : 0); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  });
}

function bindPlan(root) {
  bindPlace(root, 'from');
  bindPlace(root, 'to');
  $('#swap', root).addEventListener('click', () => {
    [state.form.from, state.form.to] = [state.form.to, state.form.from];
    $('#from', root).value = state.form.from?.label || '';
    $('#to', root).value = state.form.to?.label || '';
  });
  $('#departure', root).addEventListener('change', e => {
    const d = new Date(e.target.value);
    if (!Number.isNaN(d.getTime())) state.form.departure = d;
  });
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

async function plan() {
  const f = state.form;
  state.error = null;
  const missing = vehicleMissing(state.settings.vehicle);
  if (missing) { state.error = missing + ' (Einstellungen → Fahrzeug)'; render(); return; }
  if (!f.from || !f.to) {
    state.error = !f.from ? 'Bitte einen Start aus der Vorschlagsliste wählen.' : 'Bitte ein Ziel aus der Vorschlagsliste wählen.';
    render();
    return;
  }
  const setProgress = text => { state.computing = text; if (location.hash.startsWith('#/plan')) render(); };
  try {
    setProgress('Daten werden geladen …');
    await loadData();
    if (!state.data.chargers) throw new Error('Ladesäulen-Daten konnten nicht geladen werden. Bitte Verbindung prüfen.');
    const result = await computeTrip({
      from: f.from, to: f.to, departure: f.departure, startSoc: f.startSoc, load: f.load, settings: state.settings,
      chargers: state.data.chargers.list, restAreas: state.data.restAreas?.list || [], sites: state.data.sites?.list || [], onProgress: setProgress,
    });
    state.settings.lastTrip = result;
    await save();
    state.computing = null;
    go('#/trip');
  } catch (err) {
    state.computing = null;
    state.error = err.message;
    render();
  }
}

// ---------- Ergebnis ----------

function socBar(from, to) {
  const a = Math.max(0, Math.min(100, from)), b = Math.max(a, Math.min(100, to));
  return `<div class="soc"><span>${Math.round(from)} %</span><div class="soc-bar" aria-hidden="true"><span class="from" style="width:${a}%"></span><span class="add" style="left:${a}%;width:${b - a}%"></span></div><span>${Math.round(to)} %</span></div>`;
}

function scores(st) {
  if (st.dog == null) return `<div class="scores"><span>${icon('info')} Ausstattung unbekannt</span></div>`;
  return `<div class="scores"><span title="Hund">${icon('paw-print')} Hund ${num(st.dog, 1)}/5</span><span title="Mensch">${icon('coffee')} Mensch ${num(st.human, 1)}/5</span></div>`;
}

function googleMapsUrl(t) {
  const p = x => `${x.lat.toFixed(5)},${x.lon.toFixed(5)}`;
  const params = new URLSearchParams({ api: '1', origin: p(t.from), destination: p(t.to), travelmode: 'driving' });
  if (t.stops.length) params.set('waypoints', t.stops.slice(0, 9).map(p).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

function viewTrip() {
  const t = trip();
  if (!t) return emptyState('route', 'Noch keine Fahrt geplant', '#/plan', 'Fahrt planen');
  const arrival = new Date(t.arrivalAt), dep = new Date(t.departure);
  const charges = t.stops.filter(s => s.kind === 'charge');
  const chargeMin = charges.reduce((a, s) => a + s.chargeMin, 0);
  const extras = [
    t.temperature != null ? `${icon('thermometer', 'sm')} ${num(t.temperature)} °C` : '',
    t.climbM != null ? `${icon('mountain', 'sm')} ${num(t.climbM)} m bergauf` : '',
    t.trafficDelayMin ? `${icon('timer', 'sm')} ${num(t.trafficDelayMin)} min Stau` : '',
    t.load && t.load !== 'normal' ? `${icon('car', 'sm')} ${t.load === 'full' ? 'voll beladen' : 'mit Dachbox'}` : '',
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
            <span class="tl-time">${clock(new Date(st.arriveAt))} – ${clock(new Date(st.departAt))} Uhr · ${charge ? `${st.stopMin} min` : `Gassi-Pause ${st.stopMin} min`}</span>
            <span class="name">${esc(st.name)} ${icon('chevron-right', 'sm chev')}</span>
            <span class="meta">${charge ? `${num(st.maxKw)} kW · ${st.points} Ladepunkte${st.operators.length ? ' · ' + esc(st.operators.slice(0, 2).join(', ')) : ''}` : `Akku bei Ankunft ca. ${st.arriveSoc} %`}${st.detour.km ? ` · ${num(st.detour.km, 1)} km Umweg` : ''}</span>
            ${charge ? socBar(st.arriveSoc, st.targetSoc) : ''}
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
      <div class="grow"><div class="title">${esc(t.from.label.split(',')[0])} → ${esc(t.to.label.split(',')[0])}</div>
      <div class="muted small">${dayLabel(dep)}, ${clock(dep)} Uhr · ${esc(t.provider)}</div></div>
    </div>
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

const FEATURE_LIST = [
  ['toilets', 'toilet', 'WC'], ['food', 'utensils', 'Essen'], ['shop', 'store', 'Einkauf'], ['fuel', 'fuel', 'Tankstelle'],
  ['water', 'droplet', 'Trinkwasser'], ['picnic', 'coffee', 'Picknickplatz'], ['playground', 'ferris-wheel', 'Spielplatz'],
  ['dogPark', 'dog', 'Hundewiese'], ['park', 'trees', 'Park'], ['forest', 'trees', 'Wald'], ['meadow', 'trees', 'Wiese'],
];

// Fußwege vom Ladeplatz, nächste zuerst (80 m pro Minute)
const WALK_LIST = [
  ['green', 'trees', 'Grün'], ['dogPark', 'dog', 'Hundewiese'], ['wc', 'toilet', 'WC'], ['food', 'utensils', 'Essen'],
  ['shop', 'store', 'Einkauf'], ['water', 'droplet', 'Trinkwasser'], ['picnic', 'coffee', 'Picknickplatz'], ['playground', 'ferris-wheel', 'Spielplatz'],
];

function walkCard(st) {
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

function viewStop(i) {
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
      ${state.settings.keys.ocm ? `<div id="ocmStatus" style="margin-top:12px"><button class="btn btn-secondary block" type="button" data-action="ocm">${icon('refresh-cw')} Aktuellen Status abrufen</button></div>` : ''}`
      : `<p class="muted small" style="margin:0">Pause für den Hund – nach spätestens 2,5 Stunden Fahrt. Akku bei Ankunft ca. ${st.arriveSoc} %.</p>`}
    </div>
    <h3 class="section-title">Für Hund und Mensch</h3>
    ${st.dog != null ? `<div class="rating">
      <div class="metric"><div class="label">${icon('paw-print')} Hund</div><div class="value">${num(st.dog, 1)}<small>/5</small></div></div>
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

async function loadOcm(i) {
  const st = trip().stops[i], box = $('#ocmStatus');
  box.innerHTML = `<div class="progress">${icon('loader-circle', 'spin')} Status wird abgerufen …</div>`;
  try {
    const r = await getChargerStatus(st.lat, st.lon, state.settings.keys.ocm);
    box.innerHTML = r.total
      ? `<div class="notice ${r.faulted ? 'warn' : 'info'}">${icon(r.faulted ? 'triangle-alert' : 'circle-check')}<span>Open Charge Map: ${r.operational} in Betrieb, ${r.faulted} gestört, ${r.unknown} unbekannt.</span></div>`
      : `<div class="notice info">${icon('info')}<span>Open Charge Map kennt hier keine Statusangaben.</span></div>`;
  } catch (err) {
    box.innerHTML = `<div class="notice error">${icon('circle-alert')}<span>${esc(err.message)}${/403|401/.test(err.message) ? ' – Schlüssel prüfen.' : ''}</span></div>`;
  }
}

// ---------- Karte ----------

function viewMap() {
  return `<div class="map-wrap">
    <div id="map" role="region" aria-label="Karte"></div>
    <div class="map-fab">
      <button class="icon-btn" type="button" id="locate" aria-label="Eigene Position anzeigen">${icon('locate')}</button>
      ${trip() ? `<button class="icon-btn" type="button" id="fit" aria-label="Ganze Route zeigen">${icon('route')}</button>` : ''}
    </div>
    ${trip() ? '' : `<div class="map-overlay"><div class="notice info">${icon('info')}<span>Plane eine Fahrt, um Route und Stopps hier zu sehen.</span></div></div>`}
  </div>`;
}

function bindMap(root, focus) {
  if (!window.L) {
    $('#map', root).innerHTML = `<div class="empty">${icon('map')}<p>Karte konnte nicht geladen werden.</p></div>`;
    return;
  }
  mountMap($('#map', root), trip(), { focusStop: focus });
  $('#locate', root).addEventListener('click', e => {
    const on = toggleLocate(msg => { toast(msg); e.currentTarget?.classList.remove('on'); });
    $('#locate', root).classList.toggle('on', on);
  });
  $('#fit', root)?.addEventListener('click', () => fitRoute(trip()));
}

// ---------- Einstellungen ----------

function viewSettings() {
  const s = state.settings, d = state.data;
  const dogNames = s.dogs.map(x => x.name).join(', ') || 'Keine';
  const row = (href, ic, label, value) => `<button class="list-row" type="button" data-href="${href}">${icon(ic)}<span class="grow">${label}</span><span class="value">${value}</span>${icon('chevron-right', 'chev')}</button>`;
  const dataRow = (ic, label, value) => `<div class="list-row">${icon(ic)}<span class="grow">${label}</span><span class="value">${value}</span></div>`;
  return `
    <h2 class="screen-title">Einstellungen</h2>
    <p class="screen-sub">Alles wird nur auf diesem Gerät gespeichert.</p>
    <div class="list">
      ${row('#/settings/vehicle', 'car', 'Fahrzeug', esc(vehicleName(s.vehicle)))}
      ${row('#/settings/dogs', 'dog', 'Hunde', esc(dogNames))}
      ${row('#/settings/charging', 'battery-charging', 'Laden und Pausen', `ab ${s.charging.minChargerKw} kW`)}
      ${row('#/settings/advanced', 'key', 'Erweitert', s.keys.tomtom || s.keys.ocm ? 'Schlüssel hinterlegt' : '')}
    </div>
    <h3 class="section-title">Daten</h3>
    <div class="list">
      ${dataRow('plug-zap', 'Ladesäulen', d.chargers ? `${num(d.chargers.list.length)} · ${dateLabel(d.chargers.datenstand)}` : d.errors.chargers ? 'Fehler' : '…')}
      ${dataRow('paw-print', 'Fußwege an Schnellladern', d.sites ? `${num(d.sites.list.length)} · ${dateLabel(d.sites.datenstand)}` : d.errors.sites ? 'Nicht verfügbar' : '…')}
      ${dataRow('trees', 'Rastanlagen', d.restAreas ? `${num(d.restAreas.list.length)} · ${dateLabel(d.restAreas.datenstand)}` : d.errors.restAreas ? 'Nicht verfügbar' : '…')}
      ${dataRow('database', 'Fahrzeugmodelle', d.vehicles ? num(d.vehicles.length) : d.errors.vehicles ? 'Fehler' : '…')}
    </div>
    <p class="hint">Die Daten werden monatlich automatisch aus Bundesnetzagentur, OpenStreetMap und EU-Zulassungsdaten aktualisiert.</p>
    <button class="btn btn-secondary block" type="button" data-action="reload-data" style="margin-top:12px">${icon('refresh-cw')} Daten neu laden</button>
    <h3 class="section-title">Zurücksetzen</h3>
    <button class="btn btn-danger block" type="button" data-action="reset">${icon('trash-2')} Alle Daten löschen</button>`;
}

function viewSettingsPage(page) {
  const s = state.settings;
  const titles = { vehicle: 'Fahrzeug', dogs: 'Hunde', charging: 'Laden und Pausen', advanced: 'Erweitert' };
  if (!titles[page]) return emptyState('settings', 'Seite nicht gefunden', '#/settings', 'Einstellungen');
  let body = '';
  if (page === 'vehicle') {
    body = `<div class="row" style="margin-bottom:16px">
        <label class="photo-btn" aria-label="Fahrzeugfoto wählen">${avatar(s.vehicle.photo, 'camera', 'lg square')}<input type="file" accept="image/*" id="vehiclePhoto"></label>
        <div class="grow"><b>${esc(vehicleName(s.vehicle))}</b><div class="muted small">Foto antippen zum Ändern</div></div>
      </div>
      <div class="card">${vehicleFormHtml(s.vehicle)}</div>`;
  } else if (page === 'dogs') {
    state.draftDogs = s.dogs;
    body = `<div class="card">${dogsFormHtml(s.dogs)}</div>`;
  } else if (page === 'charging') {
    body = `<div class="card">${chargingFormHtml(s.charging)}</div>`;
  } else {
    body = `<div class="card">
      ${field('TomTom-Schlüssel (optional)', `<span class="input-wrap">${icon('key')}<input class="input" id="kTomtom" type="password" autocomplete="off" spellcheck="false" value="${esc(s.keys.tomtom)}" placeholder="Nicht hinterlegt"></span>`,
        'Mit eigenem, kostenlosem Schlüssel von developer.tomtom.com berücksichtigt die Route den aktuellen Verkehr. Ohne Schlüssel routet DogPilot über Valhalla bzw. OSRM (FOSSGIS e.V.).')}
      <div style="margin-top:16px">${field('Open-Charge-Map-Schlüssel (optional)', `<span class="input-wrap">${icon('key')}<input class="input" id="kOcm" type="password" autocomplete="off" spellcheck="false" value="${esc(s.keys.ocm)}" placeholder="Nicht hinterlegt"></span>`,
        'Für den aktuellen Status der Ladesäulen. Kostenlos nach Registrierung auf openchargemap.org.')}</div>
      <label class="row" style="margin-top:12px"><input type="checkbox" id="showKeys"> <span class="small">Schlüssel anzeigen</span></label>
    </div>
    <div class="card">
      ${field('Max. Abstand der Ladesäule zur Route', numberInput('cCorridor', s.charging.corridorKm, { min: 0.5, max: 10, step: 0.5, suffix: 'km' }))}
    </div>`;
  }
  return `<button class="btn-ghost back" type="button" data-href="#/settings">${icon('chevron-left')} Einstellungen</button>
    <h2 class="screen-title">${titles[page]}</h2><div style="height:12px"></div>${body}`;
}

function bindSettingsPage(root, page) {
  const s = state.settings;
  const saved = rerender => { save(); toast('Gespeichert'); if (rerender) render(); };
  if (page === 'vehicle') {
    bindVehicleForm(root, s.vehicle, saved);
    $('#vehiclePhoto', root)?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try { s.vehicle.photo = await resizePhoto(file); saved(true); } catch (err) { toast(err.message); }
    });
  }
  if (page === 'dogs') bindDogsForm(root, s.dogs, saved);
  if (page === 'charging') bindChargingForm(root, s.charging, saved);
  if (page === 'advanced') {
    for (const [id, key] of [['kTomtom', 'tomtom'], ['kOcm', 'ocm']]) {
      $('#' + id, root).addEventListener('change', e => { s.keys[key] = e.target.value.trim(); saved(false); });
    }
    $('#showKeys', root).addEventListener('change', e => $$('#kTomtom, #kOcm', root).forEach(i => { i.type = e.target.checked ? 'text' : 'password'; }));
    $('#cCorridor', root).addEventListener('change', () => {
      const v = readNumber('cCorridor', 0.5, 10);
      if (v != null) { s.charging.corridorKm = v; saved(false); }
    });
  }
}

// ---------- Rechtliches, Menü ----------

function viewLegal(key) {
  const page = LEGAL[key];
  if (!page) return emptyState('file-text', 'Seite nicht gefunden', '#/plan', 'Zur Planung');
  return `<button class="btn-ghost back" type="button" data-action="back">${icon('chevron-left')} Zurück</button>
    <h2 class="screen-title">${page.title}</h2><div class="card prose" style="margin-top:12px">${page.html}</div>`;
}

function emptyState(ic, text, href, label) {
  return `<div class="empty">${icon(ic)}<p>${text}</p><button class="btn btn-primary" type="button" data-href="${href}">${label}</button></div>`;
}

function openMenu() {
  const d = state.data;
  const item = (href, ic, label) => `<button class="list-row" type="button" data-href="${href}">${icon(ic)}<span class="grow">${label}</span></button>`;
  $('#drawerRoot').innerHTML = `
    <div class="backdrop" data-action="close-menu"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Menü">
      <div class="drawer-head"><span>Menü</span><button class="icon-btn plain" type="button" data-action="close-menu" aria-label="Menü schließen">${icon('x')}</button></div>
      ${item('#/plan', 'route', 'Fahrt planen')}
      ${item('#/map', 'map', 'Karte')}
      ${item('#/settings', 'settings', 'Einstellungen')}
      <div class="drawer-group">Rechtliches</div>
      ${item('#/legal/impressum', 'scale', 'Impressum')}
      ${item('#/legal/datenschutz', 'shield-check', 'Datenschutz')}
      ${item('#/legal/quellen', 'file-text', 'Quellen und Lizenzen')}
      <div class="drawer-group">Hilfe</div>
      ${item('#/welcome', 'info', 'Einführung erneut zeigen')}
      <div class="drawer-foot">DogPilot ${APP_VERSION} · Gemeinsam weiter<br>
        Ladesäulen: ${d.chargers ? dateLabel(d.chargers.datenstand) : '–'} · Rastanlagen: ${d.restAreas ? dateLabel(d.restAreas.datenstand) : '–'}</div>
    </aside>`;
  $('#menuBtn').setAttribute('aria-expanded', 'true');
  $('#drawerRoot .drawer .icon-btn').focus();
}

function closeMenu() {
  $('#drawerRoot').innerHTML = '';
  $('#menuBtn').setAttribute('aria-expanded', 'false');
}

// ---------- Router ----------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'plan', arg: parts[1] };
}

function render() {
  const s = state.settings;
  const { name, arg } = route();
  const main = $('#main');
  const tabbar = $('#tabbar');
  if (name !== 'map') unmountMap();
  closeMenu();

  if (!s.onboarded || name === 'welcome') {
    tabbar.hidden = true;
    main.innerHTML = viewOnboarding();
    bindOnboarding(main);
    return;
  }
  tabbar.hidden = false;
  const tab = name === 'map' ? 'map' : name === 'settings' ? 'settings' : name === 'legal' ? null : 'plan';
  $$('#tabbar button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));

  const views = {
    plan: () => viewPlan(),
    trip: () => viewTrip(),
    stop: () => viewStop(+arg),
    map: () => viewMap(),
    settings: () => arg ? viewSettingsPage(arg) : viewSettings(),
    legal: () => viewLegal(arg),
  };
  main.innerHTML = (views[name] || views.plan)();
  if (name === 'plan' || !views[name]) bindPlan(main);
  if (name === 'map') bindMap(main, arg != null ? +arg : null);
  if (name === 'settings' && arg) bindSettingsPage(main, arg);
  if (name === 'stop') $('[data-action="ocm"]', main)?.addEventListener('click', () => loadOcm(+arg));
}

// Klicks auf data-href / data-action zentral behandeln
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-href], [data-action]');
  if (!el) return;
  if (el.dataset.href) { e.preventDefault(); go(el.dataset.href); return; }
  const a = el.dataset.action;
  if (a === 'close-menu') closeMenu();
  if (a === 'back') history.length > 1 ? history.back() : go('#/plan');
  if (a === 'reload-data') {
    await loadData(true);
    render();
    toast(Object.keys(state.data.errors).length ? 'Einige Daten fehlen weiterhin' : 'Daten aktualisiert');
  }
  if (a === 'reset') {
    if (!confirm('Fahrzeug, Hunde, Einstellungen und letzte Fahrt auf diesem Gerät löschen?')) return;
    await resetAll();
    state.settings = structuredClone(DEFAULT_SETTINGS);
    state.onboardingStep = 0;
    state.form = emptyForm();
    go('#/plan');
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#drawerRoot').innerHTML) closeMenu(); });

const emptyForm = () => ({ from: null, to: null, departure: defaultDeparture(), startSoc: 80, load: 'normal' });

async function start() {
  state.settings = await loadSettings();
  // Jede neue Planung beginnt mit leerem Formular; die letzte Fahrt bleibt über „Letzte Fahrt“ erreichbar
  state.form = emptyForm();
  state.draftDogs = structuredClone(state.settings.dogs);
  $$('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); });
  $('#menuBtn').addEventListener('click', openMenu);
  $$('#tabbar button').forEach(b => b.addEventListener('click', () => {
    const tab = b.dataset.tab;
    go(tab === 'plan' ? (trip() && route().name !== 'trip' && route().name !== 'plan' ? '#/trip' : '#/plan') : '#/' + tab);
  }));
  window.addEventListener('hashchange', () => {
    if (route().name === 'welcome') { state.onboardingStep = 0; state.draftDogs = structuredClone(state.settings.dogs); }
    render();
    window.scrollTo(0, 0);
  });
  render();
  // Daten im Hintergrund laden; Fahrzeugliste wird in der Einführung gebraucht
  loadData().then(() => {
    const { name } = route();
    if (!state.settings.onboarded || name === 'settings') render();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
