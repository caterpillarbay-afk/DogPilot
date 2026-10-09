// Simuliert die 10 UAT-Testfahrten mit echten Diensten (Photon, Valhalla, Open-Meteo)
import fs from 'node:fs';
import { decodeChargers, decodeRestAreas, decodeSites } from '../js/data.js';
import { searchPlaces } from '../js/services.js';
import { computeTrip } from '../js/trip.js';
const chargers = decodeChargers(JSON.parse(fs.readFileSync('charging-stations.json')));
const restAreas = decodeRestAreas(JSON.parse(fs.readFileSync('rest-areas.json')));
const sites = decodeSites(JSON.parse(fs.readFileSync('charger-sites.json')));
const settings = { vehicle: { capacityKWh: 77, carMaxKw: 175, consumptionKWh100: 19 }, charging: { minChargerKw: 150, reserveSoc: 10, arrivalSoc: 15, maxChargeSoc: 80, minBreakMin: 15, maxDriveMin: 120, corridorKm: 2 }, keys: {} };
const place = async q => { const r = (await searchPlaces(q))[0]; return { label: r.main, lat: r.lat, lon: r.lon }; };
const from = await place('Alzey');
const dep = new Date(); dep.setUTCHours(6, 0, 0, 0); dep.setUTCDate(dep.getUTCDate() + 1);
for (const [dest, userPauses] of [['Niebüll', 4], ['München', 2], ['Freiburg im Breisgau', 1], ['Flensburg', 3], ['Jena', 1], ['Lübeck', 3], ['Magdeburg', 2], ['Garmisch-Partenkirchen', 2], ['Stralsund', 4], ['Sankt Peter-Ording', 3]]) {
  try {
    const to = await place(dest);
    const { trip: t } = await computeTrip({ from, to, departure: dep, startSoc: 85, load: 'full', settings, chargers, restAreas, sites });
    const legs = []; let prev = 0;
    for (const s of t.stops) { legs.push(`${Math.round(s.alongKm - prev)}km`); prev = s.alongKm; }
    legs.push(`${Math.round(t.lengthKm - prev)}km`);
    console.log(`\n### ${dest}: ${Math.round(t.lengthKm)} km, Fahrzeit ${Math.floor(t.driveMin / 60)}:${String(Math.round(t.driveMin % 60)).padStart(2, '0')} h, ${t.consumptionKWh100.toFixed(1)} kWh/100km, ${t.temperature?.toFixed?.(0)}°C, Stopps ${t.stops.length} (Nutzer: ${userPauses}), Ankunft ${t.arrivalSoc}%`);
    console.log('  Abschnitte:', legs.join(' | '));
    for (const s of t.stops) console.log(`  ${s.kind === 'charge' ? 'LADEN' : 'GASSI'} km ${Math.round(s.alongKm)} ${s.name} ${s.maxKw ? Math.round(s.maxKw) + 'kW' : ''} ${s.arriveSoc}%→${s.targetSoc ?? '-'}% ${s.stopMin}min`);
    if (t.warnings.length) console.log('  Hinweise:', t.warnings.join(' | '));
  } catch (e) { console.log(`\n### ${dest}: FEHLER ${e.message}`); }
}
