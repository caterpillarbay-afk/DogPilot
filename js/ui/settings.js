// DogPilot – Karte, Einstellungen, Rechtliches und Menü.

import { icon } from '../icons.js';
import { esc, num, dateLabel, vehicleName } from '../format.js';
import { resizePhoto } from '../store.js';
import { LEGAL } from '../legal.js';
import { feedbackMail } from '../feedback.js';
import { mountMap, fitRoute, toggleLocate } from '../map.js';
import { vehicleFormHtml, bindVehicleForm, dogsFormHtml, bindDogsForm, chargingFormHtml, bindChargingForm } from './forms.js';
import { APP_VERSION, $, $$, state, toast, save, trip, avatar, field, numberInput, readNumber, emptyState, render } from './core.js';

// ---------- Karte ----------

export function viewMap() {
  return `<div class="map-wrap">
    <div id="map" role="region" aria-label="Karte"></div>
    <div class="map-fab">
      <button class="icon-btn" type="button" id="locate" aria-label="Eigene Position anzeigen">${icon('locate')}</button>
      ${trip() ? `<button class="icon-btn" type="button" id="fit" aria-label="Ganze Route zeigen">${icon('route')}</button>` : ''}
    </div>
    ${trip() ? '' : `<div class="map-overlay"><div class="notice info">${icon('info')}<span>Plane eine Fahrt, um Route und Stopps hier zu sehen.</span></div></div>`}
  </div>`;
}

export function bindMap(root, focus) {
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

export function viewSettings() {
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
      ${row('#/settings/advanced', 'key', 'Erweitert', s.keys.tomtom ? 'Schlüssel hinterlegt' : '')}
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
    <h3 class="section-title">Sichern</h3>
    <p class="hint">Fahrzeug, Hunde samt Fotos und deine Vorlieben als Datei – z. B. für ein neues Handy. Schlüssel und Fahrten sind nicht enthalten.</p>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn btn-secondary grow" type="button" data-action="backup-save">${icon('download')} Sichern</button>
      <label class="btn btn-secondary grow">${icon('upload')} Wiederherstellen<input type="file" id="backupFile" accept=".json,application/json" hidden></label>
    </div>
    <h3 class="section-title">Zurücksetzen</h3>
    <button class="btn btn-danger block" type="button" data-action="reset">${icon('trash-2')} Alle Daten löschen</button>`;
}

export function viewSettingsPage(page) {
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
      <label class="row" style="margin-top:12px"><input type="checkbox" id="showKeys"> <span class="small">Schlüssel anzeigen</span></label>
    </div>
    <div class="card">
      ${field('Max. Abstand der Ladesäule zur Route', numberInput('cCorridor', s.charging.corridorKm, { min: 0.5, max: 10, step: 0.5, suffix: 'km' }))}
    </div>`;
  }
  return `<button class="btn-ghost back" type="button" data-href="#/settings">${icon('chevron-left')} Einstellungen</button>
    <h2 class="screen-title">${titles[page]}</h2><div style="height:12px"></div>${body}`;
}

export function bindSettingsPage(root, page) {
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
    for (const [id, key] of [['kTomtom', 'tomtom']]) {
      $('#' + id, root).addEventListener('change', e => { s.keys[key] = e.target.value.trim(); saved(false); });
    }
    $('#showKeys', root).addEventListener('change', e => $$('#kTomtom', root).forEach(i => { i.type = e.target.checked ? 'text' : 'password'; }));
    $('#cCorridor', root).addEventListener('change', () => {
      const v = readNumber('cCorridor', 0.5, 10);
      if (v != null) { s.charging.corridorKm = v; saved(false); }
    });
  }
}

// ---------- Rechtliches, Menü ----------

export function viewLegal(key) {
  const page = LEGAL[key];
  if (!page) return emptyState('file-text', 'Seite nicht gefunden', '#/plan', 'Zur Planung');
  return `<button class="btn-ghost back" type="button" data-action="back">${icon('chevron-left')} Zurück</button>
    <h2 class="screen-title">${page.title}</h2><div class="card prose" style="margin-top:12px">${page.html}</div>`;
}


export function openMenu() {
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
      <button class="list-row" type="button" data-action="share-app">${icon('share-2')}<span class="grow">DogPilot teilen</span></button>
      <a class="list-row" id="feedbackLink" href="${esc(feedbackMail({ version: APP_VERSION, ua: navigator.userAgent, screen: `${screen.width}×${screen.height}`, trip: trip() }))}" data-action="feedback">${icon('message-square')}<span class="grow">Feedback senden</span></a>
      <div class="drawer-foot">DogPilot ${APP_VERSION} · Gemeinsam weiter<br>
        Ladesäulen: ${d.chargers ? dateLabel(d.chargers.datenstand) : '–'} · Rastanlagen: ${d.restAreas ? dateLabel(d.restAreas.datenstand) : '–'}</div>
    </aside>`;
  $('#menuBtn').setAttribute('aria-expanded', 'true');
  $('#drawerRoot .drawer .icon-btn').focus();
}

// Link zur App weitergeben – über das Teilen-Fenster des Handys (WhatsApp, Mail …), sonst in die Zwischenablage
export async function shareApp() {
  const url = new URL('./', location.href).href;
  const text = 'DogPilot – Reise-Co-Pilot für Mensch, Hund & Auto. So installierst du ihn auf Android: '
    + 'Link in Chrome öffnen → ⋮ → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“. '
    + 'iPhone: in Safari öffnen → Teilen → „Zum Home-Bildschirm“.';
  try {
    if (navigator.share) { await navigator.share({ title: 'DogPilot', text, url }); return; }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('Link kopiert – jetzt einfügen und verschicken');
  } catch (err) {
    if (err?.name !== 'AbortError') toast(url);   // Teilen abgebrochen: nichts tun
  }
}

export function closeMenu() {
  $('#drawerRoot').innerHTML = '';
  $('#menuBtn').setAttribute('aria-expanded', 'false');
}

