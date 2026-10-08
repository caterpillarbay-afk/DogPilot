// Darstellung: Zahlen, Zeiten, Fahrzeugnamen, HTML-Escaping

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
export const num = (n, digits = 0) => (digits ? nf1 : nf0).format(n);

export function duration(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
}

export function shortDuration(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')} h` : `${m} min`;
}

export const clock = d => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

export function dayLabel(d, ref = new Date()) {
  const a = new Date(d); a.setHours(0, 0, 0, 0);
  const b = new Date(ref); b.setHours(0, 0, 0, 0);
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return 'heute';
  if (diff === 1) return 'morgen';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export const dateLabel = iso => iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';

// Wert für <input type="datetime-local"> in lokaler Zeit
export function toLocalInput(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Fahrzeugnamen aus den EEA-Daten (Großbuchstaben) lesbar machen
const UPPER_BRANDS = new Set(['BMW', 'BYD', 'DR', 'DS', 'DFSK', 'FAW', 'JAC', 'KGM', 'MG', 'NIO']);
const KEEP_UPPER = new Set(['GT', 'GTS', 'GTX', 'RS', 'ID', 'EV', 'AMG', 'SUV', 'XL', 'LR', 'SR', 'AWD', 'RWD', '4WD', 'EQ', 'IX', 'ZS', 'DM']);

function titleWord(w) {
  if (!w) return w;
  if (/\d/.test(w) || KEEP_UPPER.has(w) || w.length <= 2) return w;
  return w[0] + w.slice(1).toLowerCase();
}

const titleCase = s => s.split(' ').map(word => word.split('-').map(titleWord).join('-')).join(' ');

export const prettyMake = make => UPPER_BRANDS.has(make) ? make : titleCase(make || '');

export function prettyModel(make, model) {
  let m = model || '';
  if (make && m.startsWith(make + ' ') && m.length > make.length + 1) m = m.slice(make.length + 1);
  return titleCase(m);
}

export const vehicleName = v => v?.make ? `${prettyMake(v.make)} ${prettyModel(v.make, v.model)}`.trim() : 'Kein Fahrzeug gewählt';
