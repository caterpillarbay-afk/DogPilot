// DogPilot – Formulare für Fahrzeug, Hunde und Lade-Vorlieben sowie die Einführung.

import { icon } from '../icons.js';
import { esc, num, prettyMake, prettyModel } from '../format.js';
import { resizePhoto } from '../store.js';
import { matchVariants } from '../data.js';
import { bindRestore } from './backup.js';
import { $, $$, state, toast, save, go, avatar, field, numberInput, readNumber, render } from './core.js';

// ---------- Fahrzeug-Formular (Einführung und Einstellungen) ----------

export function vehicleFormHtml(v) {
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
      ${learnedHint(v)}
    </div>
    <p class="hint">Ohne passende Variante: Nutzbare Akku-Kapazität (netto) und maximale DC-Ladeleistung findest du im Datenblatt deines Fahrzeugs.</p>`;
}

export const pct = f => `${f >= 1 ? '+' : '−'}${Math.abs(Math.round((f - 1) * 100))} %`;

export function learnedHint(v) {
  const l = v.learned;
  if (!l?.trips) return '';
  return `<p class="hint" id="learnedHint">Aus ${l.trips === 1 ? 'einer Fahrt' : `${l.trips} Fahrten`} gelernt: DogPilot plant mit <b>${pct(l.factor)}</b> auf deinen Verbrauch.
    <button class="btn-ghost" type="button" data-action="learn-reset" style="padding:0;min-height:0">Zurücksetzen</button></p>`;
}

// Schutz vor Verwechslung: Wer hier den Verbrauch voll beladen einträgt, bekommt die Beladung pro Fahrt doppelt aufgeschlagen
export const wltpOf = v => state.data.vehicles?.find(x => x.marke === v.make && x.modell === v.model)?.verbrauchKWh100;

export function consumptionWarning(v) {
  const wltp = wltpOf(v);
  const limit = wltp ? wltp * 1.3 : 26;
  if (!(v.consumptionKWh100 > limit)) return '';
  const ref = wltp ? `${num(v.consumptionKWh100, 1)} kWh liegt mehr als 30 % über dem Normwert dieses Modells (${num(wltp, 1)} kWh).` : `${num(v.consumptionKWh100, 1)} kWh ist für normale Beladung sehr hoch.`;
  return `<div class="notice warn" style="margin-top:8px">${icon('triangle-alert')}<span>${ref} Ist das dein Verbrauch mit Dachbox oder voll beladen? Dann trag hier den Wert <b>normal beladen</b> ein – die Beladung wählst du pro Fahrt, sonst wird sie doppelt gerechnet.</span></div>`;
}

export const variantsOf = v => matchVariants(state.data.specs, v.make, v.model);
export const variantKey = x => `${x.modell}|${x.jahr || ''}|${x.akkuKWh}|${x.dcKw}`;

export function variantField(v) {
  const list = variantsOf(v);
  if (!list.length) return '';
  return `<div style="margin-top:12px">${field('Variante', `<select class="select" id="vVariant"><option value="">Bitte wählen – füllt Akku und Ladeleistung aus</option>${list.map((x, i) =>
    `<option value="${i}" ${variantKey(x) === v.variant ? 'selected' : ''}>${esc(x.modell)}${x.jahr ? ` · ${x.jahr}` : ''} · ${num(x.akkuKWh, 1)} kWh · ${num(x.dcKw)} kW</option>`).join('')}</select>`,
    'Werte aus Open EV Data. Neuere Modelljahre oder Software-Updates können mehr Ladeleistung haben – dann den Wert unten anpassen.')}</div>`;
}

export function vehicleMissing(v) {
  const names = [!(v.capacityKWh > 0) && 'Akku netto', !(v.carMaxKw > 0) && 'max. Ladeleistung', !(v.consumptionKWh100 > 0) && 'Verbrauch'].filter(Boolean);
  return names.length ? `Bitte ${names.join(', ').replace(/, ([^,]*)$/, ' und $1')} eintragen.` : '';
}

export function bindVehicleForm(root, v, onChange) {
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
      if (val != null) {
        // Verbrauch von Hand neu eingetragen: Gelerntes gilt dafür nicht mehr
        if (key === 'consumptionKWh100' && val !== v[key]) v.learned = { factor: 1, trips: 0 };
        v[key] = val; $('#' + id, root).value = val; onChange(false);
      }
      const warn = $('#vConsumptionWarn', root);
      if (warn) warn.innerHTML = consumptionWarning(v);
    });
  }
}

// ---------- Hunde-Formular ----------

export function dogsFormHtml(dogs) {
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

export function bindDogsForm(root, dogs, onChange) {
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

export function chargingFormHtml(c) {
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

export function bindChargingForm(root, c, onChange) {
  $$('[data-minkw]', root).forEach(b => b.addEventListener('click', () => { c.minChargerKw = +b.dataset.minkw; onChange(true); }));
  for (const [id, key, min, max] of [['cArrival', 'arrivalSoc', 5, 60], ['cReserve', 'reserveSoc', 5, 30], ['cMaxCharge', 'maxChargeSoc', 50, 100], ['cBreak', 'minBreakMin', 0, 60], ['cMaxDrive', 'maxDriveMin', 45, 240]]) {
    $('#' + id, root)?.addEventListener('change', () => {
      const val = readNumber(id, min, max);
      if (val != null) { c[key] = Math.round(val); $('#' + id, root).value = c[key]; onChange(false); }
    });
  }
}

// ---------- Einführung ----------

export function viewOnboarding() {
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
      <div class="actions"><button class="btn btn-primary block" id="obNext" type="button">Los geht's</button>
        <label class="btn btn-ghost block" style="margin-top:8px">${icon('upload')} Sicherung wiederherstellen<input type="file" id="backupFile" accept=".json,application/json" hidden></label></div>
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

export function bindOnboarding(root) {
  if (state.onboardingStep === 0) bindRestore(root);
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
