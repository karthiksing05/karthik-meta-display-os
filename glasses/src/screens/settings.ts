import { register } from '../nav.ts';
import { store, send, device } from '../store.ts';
import { C, btn, esc, footer, header, icon } from '../ui.ts';
import { on } from './util.ts';
import type { Settings } from '../../../shared/protocol.ts';

/** Quick settings: every option is one pinch that cycles through its values. */
const cycle = <T,>(list: readonly T[], v: T) => list[(list.indexOf(v) + 1) % list.length];

const PRESET_NOTE: Record<Settings['approvals'], string> = {
  careful: 'asks for everything but reads',
  balanced: 'tests, builds, worktree edits pass',
  trusting: 'asks only for risky commands',
};

register('settings', {
  render() {
    const s = store.state;
    if (!s) return `${header('settings', C.purple)}<main class="center muted">Waiting for the relay…</main>`;
    const st = s.settings;
    const ok = (b: boolean) => (b ? `<span class="g">on</span>` : `<span class="muted">off</span>`);
    const tile = (key: string, ic: string, label: string, value: string, note = '') =>
      `<button class="tile" data-f="${key}" style="height:104px"><span class="t">${icon(ic, 20, C.cyan)}<span class="c small">${label}</span></span><span class="y">${value}</span><span class="s">${note}</span></button>`;
    const i = s.integrations;
    return `${header('settings', C.purple)}
    <main class="scroll">
      <div class="tiles">
        ${tile('approvals', 'check', 'approvals', st.approvals, `learns from ↓ · ${st.learnedRules.length} learned`)}
        ${tile('animation', 'bolt', 'home animation', st.animation)}
        ${tile('background', 'glasses', 'background', st.background, st.background === 'black' ? 'see-through, saves battery' : 'monokai gray')}
        ${tile('cleanup', 'mic', 'dictation cleanup', st.dictationCleanup ? 'on' : 'off', i.groq ? 'groq' : 'local (no groq key)')}
        ${tile('battery', 'glasses', 'battery', `glasses ${device.battery ?? '—'}%`, 'band: see Meta AI app')}
        ${tile('refresh', 'pulse', 'refresh', store.connected ? 'relay ok' : 'offline', 'pinch to re-sync')}
      </div>
      <div class="small muted">${esc(PRESET_NOTE[st.approvals])}. Dangerous commands always ask.</div>
      ${st.learnedRules.length ? `<div class="card small"><div class="label">learned with ↓ always</div>${st.learnedRules.slice(-5).map((r) => `<div class="c">${esc(r)}</div>`).join('')}</div>${btn('clear', 'forget learned', { icon: 'x' })}` : ''}
      <div class="card small">
        claude ${ok(i.claude)} · groq ${ok(i.groq)} · spotify ${ok(i.spotify)}<br>
        google ${ok(i.google)} · maps ${ok(i.maps)} · imessage ${ok(i.messages)}<br>
        photos ${ok(i.photos)} · 2fa ${ok(i.totp)}${i.demo ? '<br><span class="v">demo mode: data is fake</span>' : ''}
      </div>
    </main>
    ${footer('pinch a tile to change it')}`;
  },
  mount(root) {
    const st = store.state?.settings;
    if (!st) return;
    const set = (patch: Partial<Settings>) => send({ t: 'settings.set', patch });
    on(root, 'approvals', () => set({ approvals: cycle(['careful', 'balanced', 'trusting'] as const, st.approvals) }));
    on(root, 'animation', () => set({ animation: cycle(['wave', 'rain', 'life', 'off'] as const, st.animation) }));
    on(root, 'background', () => set({ background: st.background === 'gray' ? 'black' : 'gray' }));
    on(root, 'cleanup', () => set({ dictationCleanup: !st.dictationCleanup }));
    on(root, 'refresh', () => send({ t: 'refresh' }));
    on(root, 'clear', () => send({ t: 'rules.clear' }));
  },
});
