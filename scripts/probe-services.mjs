// Temporärer Test: prüft erreichbare kostenlose Dienste (wird vor dem PR wieder entfernt)
const UA = { 'User-Agent': 'DogPilot-Probe (+https://github.com/caterpillarbay-afk/DogPilot)' };
async function probe(name, fn) {
  try { console.log(`\n=== ${name} ===\n` + (await fn()).slice(0, 1500)); }
  catch (e) { console.log(`\n=== ${name} === FEHLER ${e.message}`); }
}
const text = async (url, opt = {}) => { const r = await fetch(url, { ...opt, headers: { ...UA, ...(opt.headers || {}) } }); return `HTTP ${r.status}\n` + await r.text(); };
const HH = { lat: 53.5511, lon: 9.9937 }, MUC = { lat: 48.1374, lon: 11.5755 };
await probe('Photon', () => text('https://photon.komoot.io/api/?q=Lüneburg%20Am%20Sande&limit=2&lang=de'));
let shape = null;
await probe('Valhalla route', async () => {
  const r = await fetch('https://valhalla1.openstreetmap.de/route', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: [HH, MUC], costing: 'auto', units: 'kilometers', directions_type: 'none' }) });
  const j = await r.json(); shape = j.trip?.legs?.[0]?.shape;
  return `HTTP ${r.status} summary=${JSON.stringify(j.trip?.summary)} shapeLen=${shape?.length} keys=${Object.keys(j.trip||j)}`;
});
await probe('Valhalla height', async () => {
  const r = await fetch('https://valhalla1.openstreetmap.de/height', { method: 'POST', headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ encoded_polyline: shape, shape_format: 'polyline6', resample_distance: 2000, range: true }) });
  const j = await r.json(); return `HTTP ${r.status} n=${j.range_height?.length} first=${JSON.stringify(j.range_height?.slice(0,3))} err=${j.error||''}`;
});
await probe('FOSSGIS OSRM', () => text(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${HH.lon},${HH.lat};${MUC.lon},${MUC.lat}?overview=false`));
await probe('Open-Meteo', () => text('https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&hourly=temperature_2m&forecast_days=1&timezone=Europe%2FBerlin'));
await probe('OCM ohne Key', () => text('https://api.openchargemap.io/v3/poi/?output=json&latitude=52.52&longitude=13.41&distance=1&maxresults=2&compact=true'));
await probe('Overpass count', async () => {
  const q = '[out:json][timeout:120];area["ISO3166-1"="DE"][admin_level=2]->.de;(nwr[highway=services](area.de);nwr[highway=rest_area](area.de););out count;';
  return text('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
});
