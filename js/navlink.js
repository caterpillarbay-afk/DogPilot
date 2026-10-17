// Übergabe der Fahrt an Google Maps (Navigation, auch über Android Auto).
// Adressen mit Hausnummer gehen als Text: Google findet das Haus dann selbst. Nur mit Koordinaten nimmt
// Google das Haus, das es dort für das nächste hält (Carl-Theodor-Straße 12 → „Am Damm 12“).
// Orte ohne Hausnummer (Stadt, Rastanlage, Ladesäule) bleiben Koordinaten – als Text wären sie mehrdeutig.
import { houseNumber } from './services.js';

const coords = x => `${x.lat.toFixed(5)},${x.lon.toFixed(5)}`;
// Ältere Einträge tragen den Hinweis noch in der Beschriftung – der gehört nicht in die Adresse
const address = label => label.replace(/ · Hausnummer nicht in der Karte.*$/, '');
export const navTarget = x => (x.label && houseNumber(address(x.label)) ? address(x.label) : coords(x));

export function googleMapsUrl(t) {
  const params = new URLSearchParams({ api: '1', origin: navTarget(t.from), destination: navTarget(t.to), travelmode: 'driving' });
  if (t.stops.length) params.set('waypoints', t.stops.slice(0, 9).map(coords).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}
