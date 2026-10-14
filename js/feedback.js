// „Feedback senden“: vorbereitete Mail an die Adresse aus dem Impressum. Enthält nur, was beim
// Nachvollziehen hilft (Version, Gerät, letzte Fahrt mit Ortsnamen) – und geht erst raus, wenn du sie abschickst.
import { CONTACT_MAIL } from './legal.js';

const pad = n => String(n).padStart(2, '0');
const when = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const city = p => String(p?.label || '').split(',')[0] || '?';

// Gerät kurz: „Android 14 · Chrome 141“ statt des ganzen User-Agent
export function deviceLabel(ua) {
  const os = /Android [\d.]+/.exec(ua)?.[0] || (/iPhone|iPad/.test(ua) ? 'iOS ' + (/OS (\d+[_\d]*)/.exec(ua)?.[1] || '').replace(/_/g, '.') : null)
    || (/Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unbekannt');
  const br = /(?:Edg|SamsungBrowser|Firefox|CriOS|Chrome|Version)\/(\d+)/.exec(ua);
  const name = !br ? '' : /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : 'Safari';
  return br ? `${os.trim()} · ${name} ${br[1]}` : os.trim();
}

export function feedbackMail({ version, ua, screen, trip }) {
  const lines = [
    'Hallo,', '',
    'was ist passiert?', '', '',
    'was hättest du erwartet?', '', '',
    '(Screenshots gern als Anhang.)', '',
    '– – – Für die Fehlersuche – – –',
    `DogPilot ${version}`,
    `Gerät: ${deviceLabel(ua)}`,
    `Bildschirm: ${screen}`,
  ];
  if (trip) {
    const dep = new Date(trip.departure);
    lines.push(`Letzte Fahrt: ${city(trip.from)} → ${city(trip.to)}, Abfahrt ${when(dep)}, ${trip.stops?.length ?? 0} Stopps, ${trip.withDogs === false ? 'ohne Hunde' : 'mit Hunden'}, Route: ${trip.provider || '?'}`);
  } else lines.push('Letzte Fahrt: keine');
  const subject = `DogPilot-Feedback (${version})`;
  return `mailto:${CONTACT_MAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}
