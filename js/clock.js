// Eigene runde Uhr für die Uhrzeit (statt des Android-Uhrfensters, das bei großer Schrift über den
// Bildschirmrand ragt). Stunden: außen 1–12, innen 13–00 wie bei Android; Minuten in 5er-Schritten.
// Größe richtet sich nach dem Bildschirm, „Abbrechen“/„Übernehmen“ bleiben immer sichtbar.

const pad = n => String(n).padStart(2, '0');

// Wert aus einem Tipp aufs Zifferblatt. x, y: Abstand zur Mitte, bezogen auf den Radius (−1 … 1, y nach unten)
export function dialValue(x, y, mode) {
  const angle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;   // 0° = oben, im Uhrzeigersinn
  const step = Math.round(angle / 30) % 12;
  if (mode === 'minute') return step * 5;
  const inner = Math.hypot(x, y) < 0.62;
  return inner ? (step === 0 ? 0 : step + 12) : (step === 0 ? 12 : step);
}

const POS = (i, r) => [50 + r * Math.sin(i * Math.PI / 6), 50 - r * Math.cos(i * Math.PI / 6)];

function dialSvg(mode, h, m) {
  const marks = [];
  if (mode === 'hour') {
    for (let i = 0; i < 12; i++) {
      const outer = i === 0 ? 12 : i, inner = i === 0 ? 0 : i + 12;
      marks.push({ v: outer, label: outer, r: 40, big: true }, { v: inner, label: pad(inner), r: 26, big: false });
    }
  } else {
    for (let i = 0; i < 12; i++) marks.push({ v: i * 5, label: pad(i * 5), r: 40, big: true });
  }
  const sel = mode === 'hour' ? h : m;
  const target = marks.find(k => k.v === sel) || (mode === 'minute' ? { v: m, r: 40 } : null);
  const idx = v => (mode === 'hour' ? v % 12 : v / 5);
  const [hx, hy] = target ? POS(idx(target.v), target.r) : [50, 50];
  return `<svg viewBox="0 0 100 100" class="clock-dial" role="img" aria-label="${mode === 'hour' ? 'Stunde wählen' : 'Minute wählen'}">
    <circle cx="50" cy="50" r="48" class="face" />
    <line x1="50" y1="50" x2="${hx}" y2="${hy}" class="hand" />
    <circle cx="50" cy="50" r="1.6" class="hand-dot" />
    ${target ? `<circle cx="${hx}" cy="${hy}" r="6.5" class="sel" />` : ''}
    ${marks.map(k => { const [x, y] = POS(idx(k.v), k.r); return `<text x="${x}" y="${y}" class="${k.big ? 'big' : 'small'} ${k.v === sel ? 'on' : ''}" dy="0.35em">${k.label}</text>`; }).join('')}
  </svg>`;
}

// openClock({ hours, minutes, title, presets: [[h, m], …], onPick(h, m) })
export function openClock({ hours, minutes, title = 'Uhrzeit', presets = [], onPick }) {
  let h = hours, m = Math.round(minutes / 5) * 5 % 60, mode = 'hour';
  const root = document.createElement('div');
  root.className = 'clock-sheet';
  document.body.append(root);
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const draw = () => {
    root.innerHTML = `<div class="clock-backdrop" data-c="cancel"></div>
      <div class="clock-card" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="clock-time"><button type="button" class="${mode === 'hour' ? 'on' : ''}" data-c="hour">${pad(h)}</button><span>:</span><button type="button" class="${mode === 'minute' ? 'on' : ''}" data-c="minute">${pad(m)}</button></div>
        ${presets.length ? `<div class="clock-presets">${presets.map(([ph, pm], i) => `<button type="button" class="chip" data-p="${i}">${i === 0 && ph === null ? 'Jetzt' : `${ph}:${pad(pm)}`}</button>`).join('')}</div>` : ''}
        <div class="clock-wrap">${dialSvg(mode, h, m)}</div>
        <div class="clock-actions"><button type="button" class="btn btn-secondary" data-c="cancel">Abbrechen</button><button type="button" class="btn btn-primary" data-c="ok">Übernehmen</button></div>
      </div>`;
  };
  draw();

  // Tippen und Ziehen auf dem Zifferblatt; nach der Stunde geht es mit den Minuten weiter
  let dragging = false;
  const pick = e => {
    const svg = root.querySelector('.clock-dial');
    const b = svg.getBoundingClientRect();
    const x = (e.clientX - b.left - b.width / 2) / (b.width / 2), y = (e.clientY - b.top - b.height / 2) / (b.height / 2);
    if (Math.hypot(x, y) > 1.05) return;
    if (mode === 'hour') h = dialValue(x, y, 'hour'); else m = dialValue(x, y, 'minute');
    root.querySelector('.clock-wrap').innerHTML = dialSvg(mode, h, m);
    root.querySelector(`[data-c="${mode}"]`).textContent = pad(mode === 'hour' ? h : m);
  };
  root.addEventListener('pointerdown', e => { if (e.target.closest('.clock-dial')) { dragging = true; e.preventDefault(); pick(e); } });
  root.addEventListener('pointermove', e => { if (dragging) pick(e); });
  root.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (mode === 'hour') { mode = 'minute'; draw(); }
  });
  root.addEventListener('click', e => {
    const c = e.target.closest('[data-c]')?.dataset.c, p = e.target.closest('[data-p]')?.dataset.p;
    if (p != null) {
      const [ph, pm] = presets[+p];
      if (ph === null) { const n = new Date(); onPick(n.getHours(), n.getMinutes()); } else onPick(ph, pm);
      close();
    } else if (c === 'hour' || c === 'minute') { mode = c; draw(); }
    else if (c === 'cancel') close();
    else if (c === 'ok') { onPick(h, m); close(); }
  });
}
