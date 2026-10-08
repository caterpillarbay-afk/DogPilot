// Karte mit Route, Stopps und eigener Position (Leaflet, lokal unter vendor/ eingebunden)

import { icon } from './icons.js';
import { esc, clock } from './format.js';

let map = null, layers = null, watchId = null, meMarker = null, follow = false;

const pin = (cls, name) => window.L.divIcon({
  className: '', iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28],
  html: `<div class="pin ${cls}">${icon(name)}</div>`,
});

export function mountMap(el, trip, { focusStop = null } = {}) {
  const L = window.L;
  if (map) { map.remove(); map = null; }
  map = L.map(el, { zoomControl: false, attributionControl: true });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  }).addTo(map);
  layers = L.layerGroup().addTo(map);

  if (!trip) {
    map.setView([51.1, 10.4], 6);
    return;
  }
  const line = L.polyline(trip.points, { color: '#2fd8c4', weight: 5, opacity: 0.9 }).addTo(layers);
  L.marker([trip.from.lat, trip.from.lon], { icon: pin('start', 'map-pin'), title: 'Start' })
    .bindPopup(`<b>Start</b><br>${esc(trip.from.label)}`).addTo(layers);
  L.marker([trip.to.lat, trip.to.lon], { icon: pin('end', 'flag'), title: 'Ziel' })
    .bindPopup(`<b>Ziel</b><br>${esc(trip.to.label)}<br>Ankunft ${clock(new Date(trip.arrivalAt))}`).addTo(layers);
  const markers = trip.stops.map((st, i) => {
    const charge = st.kind === 'charge';
    const m = L.marker([st.lat, st.lon], { icon: pin(charge ? (st.fallback ? 'warn' : 'charge') : 'start', charge ? 'zap' : 'paw-print'), title: st.name })
      .bindPopup(`<b>${i + 1}. ${esc(st.name)}</b><br>${charge ? `Laden ${st.arriveSoc} → ${st.targetSoc} % · ${st.chargeMin} min` : `Gassi-Pause · ${st.stopMin} min`}`
        + `<br>${clock(new Date(st.arriveAt))} Uhr<br><a href="#/stop/${i}">Details</a>`)
      .addTo(layers);
    return m;
  });
  if (focusStop != null && trip.stops[focusStop]) {
    map.setView([trip.stops[focusStop].lat, trip.stops[focusStop].lon], 15);
    markers[focusStop].openPopup();
  } else {
    map.fitBounds(line.getBounds(), { padding: [30, 30] });
  }
  // Größe nach dem Einblenden neu berechnen
  setTimeout(() => map && map.invalidateSize(), 50);
}

export function fitRoute(trip) {
  if (!map || !trip) return;
  map.fitBounds(window.L.latLngBounds(trip.points), { padding: [30, 30] });
}

// Ortung ein/aus. onError(message) bei Fehlern, Rückgabe: aktiv ja/nein
export function toggleLocate(onError) {
  if (watchId != null) { stopLocate(); return false; }
  if (!navigator.geolocation) { onError('Ortung wird von diesem Browser nicht unterstützt'); return false; }
  follow = true;
  watchId = navigator.geolocation.watchPosition(pos => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (!map) return;
    if (!meMarker) meMarker = window.L.marker(ll, { icon: window.L.divIcon({ className: '', iconSize: [18, 18], html: '<div class="me-dot"></div>' }), zIndexOffset: 1000 }).addTo(map);
    else meMarker.setLatLng(ll);
    if (follow) { map.setView(ll, Math.max(map.getZoom(), 13)); follow = false; }
  }, err => {
    onError(err.code === 1 ? 'Standortzugriff wurde nicht erlaubt' : 'Standort nicht verfügbar');
    stopLocate();
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  return true;
}

export function stopLocate() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (meMarker) { meMarker.remove(); meMarker = null; }
}

export function unmountMap() {
  stopLocate();
  if (map) { map.remove(); map = null; }
}
