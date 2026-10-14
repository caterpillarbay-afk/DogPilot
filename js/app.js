// DogPilot – Oberfläche: Navigation über #/…-Adressen, Ansichten als Funktionen, die HTML liefern.
// Die Ansichten liegen in js/ui/; hier nur Router, zentrale Klicks und Start.

import { icon } from './icons.js';
import { loadSettings, resetAll, DEFAULT_SETTINGS } from './store.js';
import { unmountMap } from './map.js';
import { watchForUpdates } from './update.js';
import { viewOnboarding, bindOnboarding } from './ui/forms.js';
import { viewPlan, bindPlan } from './ui/plan.js';
import { refreshTraffic } from './ui/traffic.js';
import { speak, startDrive, stopDrive } from './ui/drive.js';
import { saveFeedback, replanFromHere, viewTrip, viewStop, refreshLive, chooseAlternative } from './ui/result.js';
import { viewMap, bindMap, viewSettings, viewSettingsPage, bindSettingsPage, viewLegal, openMenu, shareApp, closeMenu } from './ui/settings.js';
import { $, $$, state, toast, save, trip, go, loadData, route, emptyForm, setRender, render } from './ui/core.js';

// ---------- Router ----------

// Aktuelle Ansicht zeichnen (über render() aus ui/core.js von überall aufrufbar)
function renderApp() {
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
  if (name === 'trip' && trip()) refreshTraffic(trip());
  if (name === 'trip' && trip()) refreshLive(trip().stops.map((st, i) => ({ st, i })).filter(x => x.st.kind === 'charge').map(({ st, i }) => ({ p: st, el: `live-${i}` })));
  const st = name === 'stop' && trip()?.stops[+arg];
  if (st?.kind === 'charge') {
    const targets = force => refreshLive([{ p: st, el: `live-${arg}`, detail: true }, ...(st.alternatives || []).map((a, j) => ({ p: a, el: `live-alt-${j}` }))], force);
    targets(false);
    $('[data-action="live-refresh"]', main)?.addEventListener('click', () => targets(true));
    $$('[data-action="alt"]', main).forEach(b => b.addEventListener('click', () => chooseAlternative(+arg, +b.dataset.alt)));
  }
}

// Klicks auf data-href / data-action zentral behandeln
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-href], [data-action]');
  if (!el) return;
  if (el.dataset.href) { e.preventDefault(); go(el.dataset.href); return; }
  const a = el.dataset.action;
  if (a === 'close-menu') closeMenu();
  if (a === 'share-app') { closeMenu(); shareApp(); return; }
  if (a === 'back') history.length > 1 ? history.back() : go('#/plan');
  if (a === 'replan-open') { state.replanOpen = true; state.replanError = null; render(); return; }
  if (a === 'replan-cancel') { state.replanOpen = false; render(); return; }
  if (a === 'replan-go') { replanFromHere(); return; }
  if (a === 'drive-start') { startDrive(); return; }
  if (a === 'fb-save') { saveFeedback(false); return; }
  if (a === 'fb-skip') { saveFeedback(true); return; }
  if (a === 'learn-reset') { state.settings.vehicle.learned = { factor: 1, trips: 0 }; await save(); $('#learnedHint')?.remove(); toast('Gelernter Verbrauch zurückgesetzt'); return; }
  if (a === 'drive-stop') { stopDrive(); return; }
  if (a === 'drive-repeat') { if (state.drive.last) speak(state.drive.last); return; }
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


setRender(renderApp);

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
  // Neue Version auf dem Server: wie ein frischer Start neu laden (Startseite, leeres Formular)
  watchForUpdates(() => {
    if (state.computing) return;
    // Während des Fahrt-Modus nicht neu laden – erst nach dem Beenden
    if (state.drive.on) { state.drive.pendingUpdate = true; return; }
    toast('Neue Version von DogPilot – wird geladen …');
    setTimeout(() => location.replace(location.pathname), 1200);
  });
}

start();
