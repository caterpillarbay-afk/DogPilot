// Energiemodell: Verbrauch abhängig von Temperatur, Höhenprofil und Stau,
// sowie Ladezeit nach einer vereinfachten Ladekurve. Alle Werte sind Schätzungen.

const G = 9.81;
const DRIVE_EFFICIENCY = 0.9;  // Anteil der Akku-Energie, der als Vortrieb ankommt
const RECUPERATION = 0.6;      // Anteil der Lageenergie, der bergab zurückgewonnen wird
// Der eingetragene Verbrauch stammt aus echten Fahrten und enthält schon normales Auf und Ab.
// Nur Höhenmeter über dieses übliche Maß (≈ 300 m bergauf je 100 km) hinaus kosten extra.
const TYPICAL_CLIMB_M_PER_KM = 3;

// Temperatur-Aufschlag relativ zum eingetragenen Verbrauch (typische Fahrten bei ~15 °C):
// Heizung und kalter Akku kosten auf der Autobahn bei 0 °C rund +12 %, Klimaanlage ab 28 °C etwas mehr.
export function temperatureFactor(tempC) {
  if (tempC == null || Number.isNaN(tempC)) return 1;
  return 1 + Math.max(0, 15 - tempC) * 0.008 + Math.max(0, tempC - 28) * 0.006;
}

// Stop-and-go im Stau: Aufschlag nach Anteil der Stauzeit an der Fahrzeit, max. +15 %
export function trafficFactor(delayMin, durationMin) {
  if (!delayMin || !durationMin) return 1;
  return 1 + Math.min(0.15, (delayMin / durationMin) * 0.5);
}

// Kumuliertes Energieprofil entlang der Route.
// heights: [[distanzMeter, höheMeter], …] (optional), massKg: Fahrzeug + Zuladung
export class EnergyProfile {
  constructor({ lengthKm, baseKWh100, factor = 1, heights = null, massKg = 2300 }) {
    this.lengthKm = lengthKm;
    this.kWhPerKm = (baseKWh100 / 100) * factor;
    this.km = [0];
    this.kwh = [0];
    this.climbM = 0;
    const pts = (heights && heights.length > 1)
      ? heights.filter(h => h[1] != null).map(([d, h]) => [d / 1000, h])
      : [[0, 0], [lengthKm, 0]];
    // Höhenprofil auf die Routenlänge skalieren (Abweichungen durch Ausdünnung)
    const scale = pts[pts.length - 1][0] > 0 ? lengthKm / pts[pts.length - 1][0] : 1;
    const pot = dh => massKg * G * Math.abs(dh) / 3.6e6;
    const elevKWh = dh => dh > 0 ? pot(dh) / DRIVE_EFFICIENCY : -pot(dh) * RECUPERATION;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const dh = pts[i][1] - pts[i - 1][1];
      segs.push({ dKm: (pts[i][0] - pts[i - 1][0]) * scale, elev: elevKWh(dh) });
      if (dh > 0) this.climbM += dh;
    }
    // Übliches Auf und Ab steckt schon im Verbrauch: höchstens so viel abziehen, wie über den reinen
    // Höhenunterschied Start → Ziel hinaus anfällt, und nicht mehr als das übliche Maß
    const excess = segs.reduce((a, x) => a + x.elev, 0) - elevKWh(pts[pts.length - 1][1] - pts[0][1]);
    const typicalPerKm = pot(TYPICAL_CLIMB_M_PER_KM) * (1 / DRIVE_EFFICIENCY - RECUPERATION);
    const offsetPerKm = Math.max(0, Math.min(excess / lengthKm, typicalPerKm));
    segs.forEach(({ dKm, elev }, i) => {
      const flat = dKm * this.kWhPerKm;
      const e = Math.max(flat * 0.1, flat + elev - offsetPerKm * dKm);
      this.km.push(this.km[i] + dKm);
      this.kwh.push(this.kwh[i] + e);
    });
  }

  // Energie vom Start bis km (lineare Interpolation)
  at(km) {
    const k = Math.max(0, Math.min(this.lengthKm, km));
    let lo = 0, hi = this.km.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.km[m] <= k) lo = m; else hi = m; }
    const span = this.km[hi] - this.km[lo] || 1;
    return this.kwh[lo] + (this.kwh[hi] - this.kwh[lo]) * (k - this.km[lo]) / span;
  }

  between(fromKm, toKm) { return this.at(toKm) - this.at(fromKm); }

  get totalKWh() { return this.at(this.lengthKm); }

  // Weitester km ab fromKm, bei dem der Akku nicht unter minSoc fällt
  reachKm(fromKm, soc, capacityKWh, minSoc) {
    const budget = (soc - minSoc) / 100 * capacityKWh;
    if (budget <= 0) return fromKm;
    if (this.between(fromKm, this.lengthKm) <= budget) return this.lengthKm;
    let lo = fromKm, hi = this.lengthKm;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.between(fromKm, mid) <= budget) lo = mid; else hi = mid;
    }
    return lo;
  }
}

// Vereinfachte Ladekurve: volle Leistung bis 50 %, danach abfallend
export function carPowerFactor(soc) {
  if (soc < 10) return 0.85;
  if (soc <= 50) return 1;
  if (soc <= 80) return 1 - (soc - 50) / 30 * 0.45;   // 100 % → 55 %
  return 0.55 - (soc - 80) / 20 * 0.35;                // 55 % → 20 %
}

// Ladedauer in Minuten von socFrom bis socTo (inkl. 2 Min. Anstecken/Freischalten)
export function chargeMinutes({ capacityKWh, socFrom, socTo, chargerKw, carMaxKw }) {
  if (socTo <= socFrom) return 0;
  let minutes = 2;
  for (let s = Math.floor(socFrom); s < Math.ceil(socTo); s++) {
    const step = Math.min(s + 1, socTo) - Math.max(s, socFrom);
    const kw = Math.max(3, Math.min(chargerKw * 0.95, carMaxKw * carPowerFactor(s)));
    minutes += (capacityKWh * step / 100) / kw * 60 * 1.05; // 5 % Ladeverluste
  }
  return minutes;
}
