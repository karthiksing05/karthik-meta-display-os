import { register } from '../nav.ts';
import { store, send, lockNow } from '../store.ts';
import { C, bar, btn, esc, footer, header, icon } from '../ui.ts';
import { on } from './util.ts';
import type { Settings } from '../../../shared/protocol.ts';

/**
 * Settings: your Mac at a glance (battery, Wi-Fi, what's connected), then the few options there are,
 * each one pinch. Approvals aren't set here: the preset lives in ~/.claude-shell/data/settings.json.
 */
register('settings', {
  render() {
    const s = store.state;
    if (!s) return `${header('settings', C.purple)}<main class="center muted">Waiting for the relay…</main>`;
    const st = s.settings;
    const i = s.integrations;
    const h = s.host;
    const tile = (key: string, ic: string, label: string, value: string, note = '') =>
      `<button class="tile" data-f="${key}" style="height:96px"><span class="t">${icon(ic, 20, C.cyan)}<span class="c small">${label}</span></span><span class="y">${value}</span><span class="s">${note}</span></button>`;

    const batColor = h.battery == null ? C.cm : h.battery <= 20 ? C.pink : h.battery <= 40 ? C.orange : C.green;
    const power = h.battery == null ? 'no battery' : h.charging ? `<span class="g">charging ⚡</span>` : 'on battery';
    const wifi =
      h.wifi === 'connected'
        ? `<span class="g">${esc(h.ssid ?? 'connected')}</span>`
        : h.wifi === 'off'
          ? `<span class="o">wi-fi off</span>`
          : h.wifi === 'down'
            ? `<span class="o">not connected</span>`
            : '<span class="muted">wired / none</span>';
    const dot = (on: boolean, label: string) => `<span class="row" style="gap:6px"><i class="status" style="background:${on ? C.green : C.cm}"></i><span class="${on ? '' : 'muted'}">${label}</span></span>`;
    const wifiOn = h.wifi === 'connected';
    const mac = `<div class="card col" style="gap:18px;padding:16px 18px">
        <div class="label">your mac</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
          <div class="col" style="gap:10px">
            <div class="row" style="gap:10px">${icon('laptop', 24, batColor)}<span class="v" style="font-size:28px;font-weight:700">${h.battery ?? '—'}<span class="small muted">%</span></span></div>
            ${bar((h.battery ?? 0) / 100, batColor)}
            <span class="small muted">${power}</span>
          </div>
          <div class="col" style="gap:10px">
            <div class="row" style="gap:10px;height:34px">${icon(wifiOn ? 'wifi' : 'wifioff', 24, wifiOn ? C.green : C.orange)}<span class="ellipsis">${wifi}</span></div>
            <span class="small muted">wi-fi</span>
          </div>
        </div>
        <div class="row small" style="gap:22px;flex-wrap:wrap;padding-top:14px;border-top:1px solid var(--line)">
          ${dot(store.connected, 'relay')}${dot(i.claude, 'claude')}${dot(i.groq, 'groq')}${dot(i.appLock, 'lock')}
        </div>
        ${i.demo ? '<div class="small v">demo mode: data is fake</div>' : ''}
      </div>`;

    return `${header('settings', C.purple)}
    <main class="scroll" style="gap:14px">
      ${mac}
      <div class="tiles">
        ${tile('sync', 'laptop', 'laptop sync', st.syncToLaptop ? 'on' : 'off', st.syncToLaptop ? 'reopens on your Mac' : 'manual only')}
        ${tile('background', 'glasses', 'background', st.background, st.background === 'black' ? 'see-through' : 'monokai gray')}
        ${i.appLock ? tile('locknow', 'key', 'app lock', 'lock now', 'pinch to lock') : tile('refresh', 'pulse', 'refresh', store.connected ? 'relay ok' : 'offline', 'pinch to re-sync')}
      </div>
      ${i.appLock ? btn('refresh', 're-sync with the relay', { icon: 'pulse' }) : ''}
      ${st.learnedRules.length ? `<div class="card small"><div class="label">always allowed (from ↓ on approvals)</div>${st.learnedRules.slice(-5).map((r) => `<div class="c">${esc(r)}</div>`).join('')}</div>${btn('clear', 'forget these', { icon: 'x' })}` : ''}
    </main>
    ${footer('pinch a tile to change it')}`;
  },
  mount(root) {
    const st = store.state?.settings;
    if (!st) return;
    const set = (patch: Partial<Settings>) => send({ t: 'settings.set', patch });
    on(root, 'background', () => set({ background: st.background === 'gray' ? 'black' : 'gray' }));
    on(root, 'sync', () => set({ syncToLaptop: !st.syncToLaptop }));
    on(root, 'refresh', () => send({ t: 'refresh' }));
    on(root, 'locknow', () => lockNow());
    on(root, 'clear', () => send({ t: 'rules.clear' }));
  },
});
