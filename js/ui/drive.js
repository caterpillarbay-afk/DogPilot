// DogPilot – Fahrt-Modus: Sprachansagen unterwegs.

import { icon } from '../icons.js';
import { esc, num, duration } from '../format.js';
import { getLiveStatus } from '../services.js';
import { dueAnnouncements, delayStep, breakText, chargeText, closureText, delayText, nextUp, stopTimerDue, arrivalText, OFF_ROUTE_TEXT } from '../drive.js';
import { haversineKm } from '../geo.js';
import { trafficKey, tripTiming, tripEvents, refreshTraffic } from './traffic.js';
import { posKey } from './result.js';
import { native, APK_URL, offerApp } from '../native.js';
import { state, toast, save, trip, placeName, render } from './core.js';

// ---------- Fahrt-Modus: Sprachansagen unterwegs ----------
// DogPilot bleibt im Vordergrund (Handy im Halter am Kabel, Google Maps läuft über Android Auto):
// Bildschirm wach halten, GPS verfolgen, Ansagen per Sprachausgabe des Browsers.
export const DRIVE_PREFS = [['breaks', 'paw-print', 'Pausen'], ['charge', 'zap', 'Ladestopps'], ['closures', 'octagon-x', 'Sperrungen'], ['schedule', 'clock', 'Zeitplan']];
export const OFF_ROUTE_KM = 1.5, OFF_ROUTE_MS = 90000;

export function speak(text) {
  state.drive.last = text;
  state.drive.lastAt = Date.now();
  // Android-App: über den Navi-Kanal (Android Auto legt die Ansage über Radio und Musik)
  if (native) { native.speak(text, state.settings.drive.audio || 'nav'); return; }
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  const voice = speechSynthesis.getVoices().find(v => v.lang?.toLowerCase().startsWith('de'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

export async function keepAwake() {
  if (native) { if (state.drive.on) native.keepScreenOn(true); return; }
  try { if (state.drive.on && 'wakeLock' in navigator && !state.drive.lock) {
    state.drive.lock = await navigator.wakeLock.request('screen');
    state.drive.lock.addEventListener('release', () => { state.drive.lock = null; });
  } } catch { /* z. B. Energiesparmodus: dann eben ohne */ }
}

export function startDrive() {
  const t = trip();
  if (!t) return;
  if (!navigator.geolocation) { toast('Ortung wird nicht unterstützt'); return; }
  state.drive = { on: true, done: new Set(), level: 0, km: null, offSince: null, offSaid: false, last: '', lastAt: 0, pendingUpdate: false };
  // Erste Ansage direkt beim Tippen – danach darf die Seite weiter sprechen
  speak(`Fahrt-Modus an. Ich melde mich vor ${t.withDogs === false ? 'Pausen' : 'Gassi-Pausen'}, Ladestopps, Sperrungen und wenn du hinter dem Zeitplan liegst.`);
  keepAwake();
  state.drive.watch = navigator.geolocation.watchPosition(onDrivePosition,
    () => { state.drive.gpsError = true; updateDriveCard(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  // Meldungen der Autobahn GmbH regelmäßig auffrischen (refreshTraffic hält sie max. 10 min)
  state.drive.timer = setInterval(() => refreshTraffic(trip()), 5 * 60000);
  // Am Ladestopp/an der Pause kommen kaum GPS-Meldungen – Timer daher unabhängig davon prüfen
  state.drive.tick = setInterval(checkStopTimer, 20000);
  render();
}

// keepSpeech: letzte Ansage (z. B. „am Ziel“) noch zu Ende sprechen lassen
export function stopDrive(keepSpeech = false) {
  const d = state.drive;
  if (d.watch != null) navigator.geolocation.clearWatch(d.watch);
  clearInterval(d.timer);
  clearInterval(d.tick);
  d.lock?.release().catch(() => {});
  if (native) { native.keepScreenOn(false); if (!keepSpeech) native.stop(); }
  else if ('speechSynthesis' in window && !keepSpeech) speechSynthesis.cancel();
  const pending = d.pendingUpdate;
  state.drive = { on: false };
  render();
  if (pending) { toast('Neue Version von DogPilot – wird geladen …'); setTimeout(() => location.replace(location.pathname), 1200); }
}

export async function onDrivePosition(pos) {
  const t = trip(), d = state.drive;
  if (!d.on || !t) return;
  d.gpsError = false;
  const { line, scale, minPerKm, plannedAt } = tripTiming(t);
  const lat = pos.coords.latitude, lon = pos.coords.longitude;
  const now = Date.now(), prefs = state.settings.drive;
  // Am Ziel: Ansage, Akkustand abfragen, Fahrt-Modus beenden
  if (haversineKm(lat, lon, t.to.lat, t.to.lon) <= 0.4) {
    speak(arrivalText(placeName(t.to)));
    state.arrived = true;
    stopDrive(true);
    return;
  }
  // Am Ladestopp bzw. an der Pause (auch abseits der Route, z. B. Autohof): Timer starten
  const dist = st => haversineKm(lat, lon, st.lat, st.lon);
  const here = t.stops.find(st => dist(st) <= 0.4);
  if (here && d.visit?.stop !== here) d.visit = { stop: here, arrivedAt: now, said: new Set() };
  if (d.visit && dist(d.visit.stop) > 1) d.visit = null;
  checkStopTimer();
  const hit = line.project(lat, lon, OFF_ROUTE_KM);
  if (!hit && t.stops.some(st => dist(st) <= OFF_ROUTE_KM + 1)) { d.off = false; updateDriveCard(); return; }   // Umweg zum Stopp
  if (!hit) {
    d.offSince ??= now;
    if (!d.offSaid && now - d.offSince > OFF_ROUTE_MS && prefs.closures) { d.offSaid = true; speak(OFF_ROUTE_TEXT); }
    d.off = true;
    updateDriveCard();
    return;
  }
  d.off = false; d.offSince = null;
  // nach 10 min zurück auf der Route darf die Abweichung wieder angesagt werden
  if (d.offSaid && now - d.lastAt > 10 * 60000) d.offSaid = false;
  const km = hit.alongKm * scale;
  d.km = km;
  const s = state.traffic[t.roads?.length ? trafficKey(t) : ''];
  const events = s?.items ? tripEvents(t) : [];
  for (const a of dueAnnouncements({ stops: t.stops, events, km, minPerKm, prefs, done: d.done })) {
    d.done.add(a.key);
    if (a.kind === 'break') speak(breakText(a.stop, a.min));
    else if (a.kind === 'closure') speak(closureText(a.event, a.km));
    else {
      let live = null;
      try { live = await getLiveStatus(a.stop.lat, a.stop.lon); state.live[posKey(a.stop)] = { data: live, at: Date.now() }; } catch { /* ohne Belegung */ }
      speak(chargeText(a.stop, a.min, live, t.withDogs !== false));
    }
  }
  // Zeitplan: nur während der Fahrt vergleichen (beim Laden oder an der Pause steht man ohnehin)
  const speedKmh = pos.coords.speed != null ? pos.coords.speed * 3.6 : null;
  if (prefs.schedule && (speedKmh == null || speedKmh > 30)) {
    const delay = (now - plannedAt(km)) / 60000;
    const step = delayStep(delay, d.level);
    d.level = step.level;
    if (step.announce) speak(delayText(delay, new Date(new Date(t.arrivalAt).getTime() + delay * 60000), t.arriveBy ? new Date(t.arriveBy) : null));
  }
  updateDriveCard();
}

export function checkStopTimer() {
  const t = trip(), d = state.drive;
  if (!d.on || !d.visit || !t) return;
  const st = d.visit.stop;
  if (!state.settings.drive[st.kind === 'charge' ? 'charge' : 'breaks']) return;
  const i = t.stops.indexOf(st), nxt = t.stops[i + 1];
  const { minPerKm } = tripTiming(t);
  const next = nxt ? { name: nxt.name, min: (nxt.alongKm - st.alongKm) * minPerKm } : { name: placeName(t.to), min: (t.lengthKm - st.alongKm) * minPerKm };
  for (const a of stopTimerDue(d.visit, Date.now(), next)) { d.visit.said.add(a.key); speak(a.text); }
  updateDriveCard();
}

export function driveStatus(t) {
  const d = state.drive;
  if (d.gpsError && d.km == null) return `${icon('circle-alert', 'sm')} Kein GPS – Ortung erlauben`;
  if (d.km == null) return `${icon('loader-circle', 'sm spin')} Warte auf GPS …`;
  if (d.off) return `${icon('triangle-alert', 'sm')} Nicht auf der geplanten Route`;
  if (d.visit) {
    const left = Math.round((d.visit.arrivedAt + d.visit.stop.stopMin * 60000 - Date.now()) / 60000);
    return `${icon(d.visit.stop.kind === 'charge' ? 'zap' : 'paw-print', 'sm')} ${esc(d.visit.stop.name)} · ${left > 0 ? `noch ca. ${duration(left)}` : 'Weiterfahrt laut Plan'}`;
  }
  const { minPerKm } = tripTiming(t);
  const s = state.traffic[t.roads?.length ? trafficKey(t) : ''];
  const next = nextUp({ stops: t.stops, events: s?.items ? tripEvents(t) : [], km: d.km, minPerKm, prefs: state.settings.drive });
  const label = { break: t.withDogs === false ? 'Pause' : 'Gassi-Pause', charge: 'Ladestopp', closure: 'Sperrung' };
  return `${icon('route', 'sm')} km ${num(d.km)} von ${num(t.lengthKm)}${next ? ` · als Nächstes ${label[next.kind]} in ca. ${duration(next.min)}` : ''}`;
}

export function driveCard(t) {
  const d = state.drive;
  const chips = `<div class="chips" style="margin-top:10px">${DRIVE_PREFS.map(([k, ic, label]) =>
    `<button type="button" class="chip ${state.settings.drive[k] ? 'on' : ''}" aria-pressed="${state.settings.drive[k]}" data-dpref="${k}">${icon(ic)} ${label}</button>`).join('')}</div>`;
  if (!d.on) return `<div class="card drive" id="drive" style="margin-top:12px">
    <button class="btn btn-primary block" type="button" data-action="drive-start">${icon('volume-2')} Fahrt-Modus mit Ansagen</button>
    <p class="muted small" style="margin:8px 0 0">Sagt an, was Google Maps nicht weiß. DogPilot dafür geöffnet lassen, Handy im Halter am Ladekabel.</p>
    ${chips}${audioRow()}</div>`;
  return `<div class="card drive on" id="drive" style="margin-top:12px">
    <div class="card-head">${icon('volume-2')} Fahrt-Modus aktiv</div>
    <div class="live" id="drive-status">${driveStatus(t)}</div>
    <p class="small" id="drive-last" style="margin:6px 0 0">${d.last ? `„${esc(d.last)}“` : ''}</p>
    ${chips}${audioRow()}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-secondary" type="button" data-action="drive-repeat">${icon('refresh-cw')} Wiederholen</button>
      <button class="btn btn-secondary" type="button" data-action="drive-stop">${icon('x')} Beenden</button>
    </div></div>`;
}

export const TEST_TEXT = 'Das ist eine Testansage von DogPilot. Wenn du mich hörst, passt alles.';

// Ton-Ausgabe: in der Android-App wählbar; im Browser auf Android Hinweis auf die App
function audioRow() {
  const a = state.settings.drive.audio || 'nav';
  const test = `<button type="button" class="chip" data-action="drive-test">${icon('volume-2')} Testansage</button>`;
  if (native) {
    const opt = (k, label) => `<button type="button" class="chip ${a === k ? 'on' : ''}" aria-pressed="${a === k}" data-daudio="${k}">${label}</button>`;
    return `<div class="muted small" style="margin-top:12px">Ansagen über</div>
      <div class="chips" style="margin-top:6px">${opt('nav', 'Android Auto / Navi')}${opt('media', 'Medien')}${test}</div>
      <p class="muted small" style="margin:6px 0 0">„Android Auto / Navi“ legt die Ansage wie ein Navi über Radio und Musik.</p>`;
  }
  return `<div class="chips" style="margin-top:10px">${test}</div>`
    + (offerApp() ? `<p class="muted small" style="margin:6px 0 0">Im Auto mit Android Auto still? Im Browser kommen Ansagen nur, wenn Android Auto die Tonquelle ist. Die <a href="${APK_URL}">DogPilot-App für Android</a> spricht wie ein Navi – auch über das Radio.</p>` : '');
}

export function updateDriveCard() {
  const t = trip(), st = document.getElementById('drive-status'), last = document.getElementById('drive-last');
  if (!t || !st) return;
  st.innerHTML = driveStatus(t);
  if (last) last.innerHTML = state.drive.last ? `„${esc(state.drive.last)}“` : '';
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
document.addEventListener('click', e => {
  const au = e.target.closest('[data-daudio]');
  if (au) {
    state.settings.drive.audio = au.dataset.daudio;
    save();
    document.querySelectorAll('[data-daudio]').forEach(x => { const on = x === au; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    return;
  }
  const b = e.target.closest('[data-dpref]');
  if (!b) return;
  state.settings.drive[b.dataset.dpref] = !state.settings.drive[b.dataset.dpref];
  save();
  const on = state.settings.drive[b.dataset.dpref];
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', on);
  updateDriveCard();
});
