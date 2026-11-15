import { device, now, store } from './store.ts';
import type { SessionStatus } from '../../shared/protocol.ts';

// Monokai on gray. Roles: pink = focus/main action, orange = needs you, green = running/on,
// yellow = names, cyan = labels/routes, purple = numbers, grey = comments.
export const C = {
  fg: '#F8F8F2',
  cm: '#A39E87',
  pink: '#FF6188',
  green: '#A6E22E',
  yellow: '#E6DB74',
  orange: '#FD971F',
  purple: '#AE81FF',
  cyan: '#66D9EF',
};

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function ago(t: number | undefined | null): string {
  if (!t) return '';
  const s = Math.max(0, Math.round((now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** "5m ago", or "just now". */
export const agoText = (t: number | undefined | null) => {
  const a = ago(t);
  return a === 'just now' || !a ? a : `${a} ago`;
};

export function clock(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, (m) => m.trim().toLowerCase());
}

export const statusColor = (s: SessionStatus) =>
  ({ running: C.green, starting: C.green, waiting: C.orange, idle: C.cyan, done: C.cyan, error: C.pink, stopped: C.cm })[s];

// ---------- line icons (24px grid, stroke = currentColor) ----------
const P: Record<string, string> = {
  claude: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/>',
  sessions: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>',
  comms: '<path d="M4 5h16v11H9l-5 4z"/>',
  music: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="15" r="3"/><path d="M10 17V5l10-2v12"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
  pause: '<path d="M5 4h5v16H5zM14 4h5v16h-5z" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5v14l10-7zM17 5v14"/>',
  prev: '<path d="M19 5v14L9 12zM7 5v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  pen: '<path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5z"/><path d="m13.5 7 3.5 3.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  down: '<path d="M12 4v16M5 13l7 7 7-7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  phone: '<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  wa: '<path d="M4 20l1.5-4A8 8 0 1 1 8 18.5z"/><path d="M9 9c0 3 3 6 6 6"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  band: '<rect x="8" y="3" width="8" height="18" rx="4"/><path d="M8 9h8M8 15h8"/>',
  glasses: '<circle cx="7" cy="13" r="4"/><circle cx="17" cy="13" r="4"/><path d="M11 13h2M3 13 2 8M21 13l1-5"/>',
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>',
  wifioff: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M3 3l18 18"/>',
  ask: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01"/>',
};

export function icon(name: keyof typeof P | string, size = 22, color = 'currentColor') {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

// ---------- building blocks ----------
/** A focusable button. `key` must be stable across renders so focus survives updates. */
export function btn(key: string, label: string, opts: { icon?: string; cls?: string; attrs?: string; def?: boolean } = {}) {
  return `<button class="btn ${opts.cls ?? ''}" data-f="${esc(key)}" ${opts.def ? 'data-default' : ''} ${opts.attrs ?? ''}>${
    opts.icon ? icon(opts.icon, 20) : ''
  }${label ? `<span>${label}</span>` : ''}</button>`;
}

export function bar(frac: number | null, color = C.green) {
  const pct = Math.round(Math.max(0, Math.min(1, frac ?? 0)) * 100);
  return `<div class="bar"><i style="width:${pct}%;background:${color}"></i></div>`;
}

function battery(level: number | null, label: string, ic: string, charging = false) {
  const color = level == null ? C.cm : level <= 20 ? C.pink : level <= 40 ? C.orange : C.green;
  return `<span class="batt" title="${label}">${icon(ic, 18, C.cm)}<b style="color:${color}">${level == null ? '—' : level + '%'}</b>${charging ? icon('bolt', 12, C.yellow) : ''}</span>`;
}

/** The app's name for headers: "claude" letter by letter in the rainbow, "prod" in white. */
export const BRAND = '\u0000brand';
function brand() {
  const rainbow = [C.pink, C.orange, C.yellow, C.green, C.cyan, C.purple];
  return [...'claude'].map((ch, i) => `<span style="color:${rainbow[i]}">${ch}</span>`).join('') + `<span style="color:${C.fg}">prod</span>`;
}

/** Top bar on every screen: title, connection dot, glasses + Mac battery, Mac Wi-Fi, clock.
 *  (The Neural Band's battery isn't exposed to web apps: getBattery() reports the glasses only.) */
export function header(title: string, color = C.yellow) {
  const s = store.state;
  const dot = store.connected ? C.green : C.pink;
  return `<header>
    <span class="title" style="color:${color}">${title === BRAND ? brand() : esc(title)}</span>
    <span class="hdr-right">
      ${s?.integrations.demo ? '<span class="tag">demo</span>' : ''}
      <i class="dot" style="background:${dot}" title="${store.connected ? 'relay connected' : 'relay offline'}"></i>
      ${battery(device.battery, 'glasses', 'glasses', device.charging)}
      ${s ? battery(s.host.battery, 'mac', 'laptop', s.host.charging) : ''}
      ${s && s.host.wifi ? icon(s.host.wifi === 'connected' ? 'wifi' : 'wifioff', 16, s.host.wifi === 'connected' ? C.green : C.pink) : ''}
      <span class="clock">${clock(now())}</span>
    </span>
  </header>`;
}

export function footer(hint: string) {
  return `<footer>${hint}</footer>`;
}

/** Deterministic abstract cover for items without art. */
export function cover(seed: string, size: number) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = [C.pink, C.purple, C.cyan, C.green, C.orange, C.yellow];
  const a = hues[h % hues.length];
  const b = hues[(h >> 3) % hues.length];
  const cells = Array.from({ length: 16 }, (_, i) => {
    const on = (h >> i) & 1;
    return `<rect x="${(i % 4) * 25}" y="${Math.floor(i / 4) * 25}" width="25" height="25" fill="${on ? a : b}" opacity="${on ? 0.85 : 0.35}"/>`;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" class="cover">${cells}</svg>`;
}

export function art(url: string | null, seed: string, size: number) {
  return url ? `<img class="cover" src="${esc(url)}" width="${size}" height="${size}" alt="">` : cover(seed, size);
}

// ---------- markdown (Claude's messages) ----------
/** Small, safe markdown → HTML: everything is escaped first, then a known subset is styled. */
export function md(src: string): string {
  const out: string[] = [];
  const lines = String(src ?? '').replace(/\r/g, '').split('\n');
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const inline = (t: string) =>
    esc(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/__([^_]+)__/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<u>$1</u>');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^\s*```(\S*)/);
    if (fence) {
      closeList();
      const code: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre class="md-code">${esc(code.join('\n'))}</pre>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      closeList();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue;
        rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
      }
      i--;
      out.push(`<table class="md-table">${rows.map((r, ri) => `<tr>${r.map((c) => (ri ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      out.push(`<div class="md-h md-h${Math.min(h[1].length, 3)}">${inline(h[2])}</div>`);
      continue;
    }
    const ul = l.match(/^\s*[-*+]\s+(.*)$/);
    const ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind} class="md-list">`);
        list = kind;
      }
      const item = (ul ?? ol)![1].replace(/^\[( |x)\]\s*/i, (_m, x) => (x.trim() ? '✓ ' : '☐ '));
      out.push(`<li>${inline(item)}</li>`);
      continue;
    }
    closeList();
    if (/^\s*>\s?/.test(l)) out.push(`<div class="md-quote">${inline(l.replace(/^\s*>\s?/, ''))}</div>`);
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) out.push('<hr class="md-hr">');
    else if (!l.trim()) out.push('<div class="md-gap"></div>');
    else out.push(`<div>${inline(l)}</div>`);
  }
  closeList();
  return `<div class="md">${out.join('')}</div>`;
}
