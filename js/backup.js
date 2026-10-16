// Einstellungen als Datei sichern und wiederherstellen (z. B. beim Handywechsel).
// Reine Funktionen, damit sie ohne Browser testbar sind. Schlüssel (TomTom) und die letzte Fahrt
// kommen bewusst nicht in die Datei – sie wird gern weitergegeben.

export const BACKUP_KIND = 'dogpilot-backup';
const PARTS = ['vehicle', 'dogs', 'charging', 'trip', 'drive'];

export function makeBackup(settings, now = new Date()) {
  const data = {};
  for (const k of PARTS) data[k] = structuredClone(settings[k]);
  return { kind: BACKUP_KIND, version: 1, created: now.toISOString(), settings: data };
}

export const backupFileName = (now = new Date()) => `dogpilot-sicherung-${now.toISOString().slice(0, 10)}.json`;

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

// Text einer Sicherungsdatei → neue Einstellungen (aktuelle bleiben für Schlüssel und letzte Fahrt).
// Wirft einen Fehler mit verständlicher Meldung, wenn die Datei nicht passt.
export function restoreBackup(text, current) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error('Die Datei ist keine DogPilot-Sicherung.'); }
  if (!isObj(b) || b.kind !== BACKUP_KIND || !isObj(b.settings)) throw new Error('Die Datei ist keine DogPilot-Sicherung.');
  if (b.version > 1) throw new Error('Die Sicherung stammt aus einer neueren DogPilot-Version. Bitte erst die App aktualisieren.');
  const s = b.settings, out = structuredClone(current);
  for (const k of ['vehicle', 'charging', 'trip', 'drive']) {
    if (isObj(s[k])) out[k] = { ...out[k], ...s[k] };
  }
  if (isObj(s.vehicle?.learned)) out.vehicle.learned = { ...current.vehicle.learned, ...s.vehicle.learned };
  if (Array.isArray(s.dogs)) {
    out.dogs = s.dogs.filter(d => isObj(d) && typeof d.name === 'string')
      .map((d, i) => ({ ...d, id: String(d.id || `dog${i}`), photo: typeof d.photo === 'string' && d.photo.startsWith('data:image/') ? d.photo : null }));
  }
  if (out.vehicle.photo && !(typeof out.vehicle.photo === 'string' && out.vehicle.photo.startsWith('data:image/'))) out.vehicle.photo = null;
  out.onboarded = current.onboarded || Boolean(out.vehicle.make && out.vehicle.capacityKWh);
  return out;
}
