import { register, go, back, replace } from '../nav.ts';
import { store, send, localNotify } from '../store.ts';
import { C, ago, agoText, bar, btn, esc, footer, header, icon, md, statusColor } from '../ui.ts';
import { clearComposer, composerBox, composerButtons, mountComposer } from './composer.ts';
import { on, onEach } from './util.ts';
import { fresh, phase, prime } from '../fresh.ts';
import type { Approval, Question, SessionInfo } from '../../../shared/protocol.ts';

// ---------------- Claude hub ----------------
// One big "how's everything going?" button, the question inbox, and an ask bar.
let checking = false;
/** Which inline reply boxes are open: 'ask' on the hub, the session id on a session / conversation. */
const open = new Set<string>();
const toggle = (k: string, on: boolean) => (on ? open.add(k) : open.delete(k), store.emit());

/**
 * "How's everything going?": ask the relay for a report; the status screen opens when it lands.
 * Pinched again while it's checking (say, by accident the first time), it cancels.
 */
function checkStatus() {
  if (checking) {
    checking = false;
    store.statusCancelled = true;
    send({ t: 'status.cancel' });
    localNotify('status check cancelled', 'info');
  } else {
    checking = true;
    store.statusCancelled = false;
    send({ t: 'status.check' });
    localNotify('asking each session how it is going… pinch again to cancel', 'info');
  }
  store.emit();
}

/**
 * The hub's contents, shared by the home screen and the 'claude' screen: "how's everything going?",
 * whatever's waiting on you, then `nav` (the caller's own buttons or tiles), then the ask bar
 * (dictate / handwrite, and who to ask) and the quick-send phrases.
 */
/**
 * "How's everything going?", alive: a heartbeat trace runs through the icon and a sheen sweeps across
 * the button; while a check runs both speed up and the label counts the sessions being asked.
 * Phases come from the clock, so re-renders don't restart them.
 */
function statusButton(key = 'status', idle = "how's everything going?", cls = 'primary big main-action') {
  const beat = checking ? 700 : 1800;
  const asking = (store.state?.sessions ?? []).filter((x) => x.status !== 'stopped').length;
  const label = checking ? (asking ? `asking ${asking} session${asking === 1 ? '' : 's'}` : 'checking') : idle;
  return `<button class="btn ${cls} status-btn${checking ? ' checking' : ''}" data-f="${key}" ${key === 'status' ? 'data-default' : ''}
      style="--beat:-${Date.now() % beat}ms;--sheen:-${Date.now() % 3200}ms">
    <svg class="ekg" width="40" height="22" viewBox="0 0 44 22" aria-hidden="true">
      <path class="base" d="M0 11h10l3-7 5 14 4-10 3 3h19" pathLength="100"/>
      <path class="trace" d="M0 11h10l3-7 5 14 4-10 3 3h19" pathLength="100"/>
    </svg><span>${label}</span>${checking ? `<i class="dots">${`<b style="background:${C.pink};${phase(1200)}"></b>`.repeat(3)}</i><span class="small muted cancel">pinch to cancel</span>` : ''}
  </button>`;
}

export function hubBody(nav: string, label = '', compact = false) {
  {
    const s = store.state;
    const sessions = s?.sessions ?? [];
    const approvals = s?.approvals ?? [];
    const questions = s?.questions ?? [];
    const r = store.report;


    const q = questions[0];
    // Compact (home): one line; pinch it to open the full question on the claude screen.
    const qLine = q
      ? `<button class="item" data-f="question" style="border-color:${C.orange}">
          ${icon('ask', 20, C.orange)}<span class="grow ellipsis"><span class="o">${esc(q.sessionName)} asks</span> · ${esc(q.question)}</span>
        </button>`
      : '';
    const qCard = compact ? qLine : q
      ? `<div class="card warn">
          <div class="label">${esc(q.sessionName)} asks · ${esc(q.header)}${questions.length > 1 ? ` · +${questions.length - 1} more` : ''}</div>
          <div class="clamp2">${esc(q.question)}</div>
          <div class="btns" style="margin-top:6px">${q.options
            .slice(0, 4)
            .map((o, i) => btn(`qa:${i}`, esc(o.label), { cls: 'chip' + (i === 0 ? ' primary' : '') }))
            .join('')}${btn('qa:type', 'type…', { cls: 'chip', icon: 'mic' })}</div>
        </div>`
      : '';

    const aCard = approvals.length
      ? `<button class="item" data-f="approvals" style="border-color:${C.orange}">
          ${icon('check', 20, C.orange)}<span class="grow"><span class="o">${approvals.length} approval${approvals.length > 1 ? 's' : ''}</span> · ${esc(approvals[0].sessionName)}: ${esc(approvals[0].title)}</span>
        </button>`
      : '';

    return `${label}
      <div class="row" style="gap:8px">
        ${statusButton()}
        ${r ? btn('report', `last · ${agoText(r.at)}`, { cls: 'big side' }) : ''}
      </div>
      ${aCard}
      ${qCard}
      ${nav}`;
  }
}

export function hubMount(root: HTMLElement) {
  {
    const s = store.state;
    on(root, 'status', checkStatus);
    on(root, 'report', () => go('report'));
    on(root, 'question', () => go('claude'));
    on(root, 'approvals', () => go('approval'));
    on(root, 'sessions', () => go('sessions'));
    on(root, 'new', () => go('newSession'));
    on(root, 'chat', () => go('compose', { kind: 'new', repo: '', title: 'chat with claude' }));
    const q = s?.questions[0];
    if (q) {
      onEach(root, 'qa:', (k) => {
        if (k === 'type') return go('compose', { kind: 'answer', questionId: q.id, question: q.question, title: 'answer' });
        send({ t: 'question.answer', id: q.id, answers: { [q.question]: q.options[Number(k)].label } });
      });
    }
  }
}

register('claude', {
  render() {
    const n = store.state?.sessions.length ?? 0;
    return `${header('claude', C.orange)}
    <main class="scroll">
      ${hubBody(`<div class="btns">
        ${btn('sessions', `sessions · ${n}`, { icon: 'sessions' })}
        ${btn('new', 'new', { icon: 'plus' })}
        ${btn('chat', 'chat', { icon: 'ask' })}
      </div>`)}
    </main>
    ${footer('pinch to select · back to return')}`;
  },
  mount: hubMount,
});


// Stop the "checking…" label when the report lands.
store.on(() => {
  if (checking && store.report && Date.now() - store.report.at < 60_000) checking = false;
});

// ---------------- "How's everything going?" report ----------------
// Cards you swipe through: the overview first, then one card per session (ones waiting on you first),
// each with where it stands, what changed since the last check, and its own answer. Pinch a session
// card to open that session; ↓ for "check again".
let card = 0;
let cardsFor = 0; // the report the cards were opened on; a new report starts again at the overview
let swiped = { at: 0, dir: 1 }; // the last swipe, so the new card slides in from that side

function groupOf(needsYou: boolean, status: string) {
  return needsYou ? 'needs you' : status === 'running' || status === 'starting' ? 'working' : status === 'stopped' ? 'earlier' : 'your turn';
}

register('report', {
  render() {
    const r = store.report;
    if (!r) return `${header('status')}<main class="center muted">No report yet.</main>`;
    if (cardsFor !== r.at) (cardsFor = r.at), (card = 0);
    const n = r.lines.length + 1;
    card = Math.max(0, Math.min(card, n - 1));
    const live = new Map((store.state?.sessions ?? []).map((x) => [x.id, x]));
    const waiting = r.lines.filter((l) => l.needsYou).length;

    let body: string;
    let edge: string = C.pink;
    if (card === 0) {
      const counts = ['needs you', 'working', 'your turn', 'earlier']
        .map((g) => [g, r.lines.filter((l) => groupOf(l.needsYou, live.get(l.id)?.status ?? l.status) === g).length] as const)
        .filter(([, c]) => c)
        .map(([g, c]) => `<span class="${g === 'needs you' ? 'o' : g === 'working' ? 'g' : 'muted'}"><span class="v">${c}</span> ${g}</span>`)
        .join(' · ');
      body = `<span class="label">overview · ${agoText(r.at)}${r.previousAt ? ` · vs check ${agoText(r.previousAt)}` : ''}</span>
        <span class="y" style="font-size:22px;font-weight:700">${r.lines.length} session${r.lines.length === 1 ? '' : 's'}</span>
        <span class="small">${counts || 'nothing running'}</span>
        <span class="report-text" style="-webkit-line-clamp:10">${esc(r.headline)}</span>
        <span class="small muted" style="margin-top:auto">→ swipe for each session</span>`;
    } else {
      const l = r.lines[card - 1];
      const now = live.get(l.id);
      const status = now?.status ?? l.status;
      const group = groupOf(l.needsYou, status);
      if (l.needsYou) edge = C.orange;
      const quiet = !l.change || /^no change/i.test(l.change);
      body = `<span class="row small"><i class="status" style="background:${statusColor(status)}"></i>
          <span class="${group === 'needs you' ? 'o' : group === 'working' ? 'g' : 'muted'}">${group}</span>
          <span class="grow"></span>${now ? `<span class="muted">${ago(now.lastActivity)}</span>` : '<span class="p">gone</span>'}</span>
        <span class="y clamp2" style="font-size:21px;font-weight:700">${esc(l.session)}</span>
        <span class="report-text" style="color:${l.needsYou ? C.orange : C.fg};-webkit-line-clamp:4">${esc(l.text)}</span>
        ${l.change ? `<span class="small" style="color:${quiet ? C.cm : C.cyan}"><span class="label">since last</span> ${esc(l.change)}</span>` : ''}
        ${l.answer ? `<span class="answer"><span class="label">in its words</span><span class="report-text small muted" style="-webkit-line-clamp:${l.change ? 5 : 7}">${esc(l.answer)}</span></span>` : ''}`;
    }
    const dots = Array.from({ length: n }, (_, i) => {
      const color = i === card ? C.pink : i > 0 && r.lines[i - 1].needsYou ? C.orange : '#75715e';
      return `<i class="dot" style="background:${color};${i === card ? 'width:20px;border-radius:4px' : ''}"></i>`;
    }).join('');
    return `${header(`status · ${card + 1}/${n}`, C.pink)}
    <main style="gap:10px">
      <button class="card report-card${Date.now() - swiped.at < 400 ? (swiped.dir > 0 ? ' slide-r' : ' slide-l') : ''}" data-f="card" data-default
        style="border-color:${edge};animation-delay:-${Math.min(400, Date.now() - swiped.at)}ms">${body}</button>
      <div class="row" style="justify-content:space-between">
        <span class="row" style="gap:5px;flex-wrap:wrap;min-width:0">${dots}</span>
        ${statusButton('recheck', 'check again', 'chip')}
      </div>
    </main>
    ${footer(`<span>← → swipe${waiting ? ` · <span class="o">${waiting} need you</span>` : ''} · ${card ? 'pinch to open this session' : 'pinch to read in full'}</span>`)}`;
  },
  key(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false;
    const r = store.report;
    if (!r) return false;
    const next = Math.max(0, Math.min(r.lines.length, card + (e.key === 'ArrowRight' ? 1 : -1)));
    if (next !== card) {
      swiped = { at: Date.now(), dir: next > card ? 1 : -1 };
      card = next;
      store.emit();
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-f="card"]')?.focus());
    }
    return true;
  },
  mount(root) {
    on(root, 'card', () => {
      const r = store.report;
      if (!r) return;
      if (card === 0) return go('message', { title: "how it's going", role: 'claude', at: r.at, text: r.headline });
      const l = r.lines[card - 1];
      if (store.state?.sessions.some((x) => x.id === l.id)) go('session', { id: l.id });
      else localNotify('that session is gone');
    });
    on(root, 'recheck', checkStatus);
  },
});

// ---------------- Sessions list ----------------
// Grouped so the ones that need you come first. `ext` = runs outside the shell (terminal, VS Code,
// Remote Control); `chat` = a one-off with no repo.
const GROUPS: [string, (x: SessionInfo, asks: Set<string>) => boolean][] = [
  ['needs you', (x, asks) => asks.has(x.id) || x.status === 'waiting'],
  ['working', (x) => x.status === 'running' || x.status === 'starting'],
  ['your turn', (x) => x.status === 'idle' || x.status === 'done' || x.status === 'error'],
  ['earlier', () => true],
];

function tags(x: SessionInfo) {
  return `${x.host ? `<span class="src o">${esc(x.host)}</span>` : x.source === 'external' ? '<span class="src c">ext</span>' : ''}${x.notes ? '<span class="src c">notes</span>' : x.kind === 'chat' ? '<span class="src v">chat</span>' : ''}${
    x.desk ? `<span class="src g">${x.desk === 'vscode' ? 'vs code' : 'term'}</span>` : ''
  }`;
}
const deskName = (x: SessionInfo) => (x.desk === 'vscode' ? 'VS Code tab' : 'terminal');

/**
 * Dead: stopped or errored, or sitting idle for 3 hours. Never one waiting on you, still working,
 * or the notes session. "clear" hides them from the list (the relay keeps them; new activity brings one back).
 */
const DEAD_AFTER = 3 * 3600_000;
function isDead(x: SessionInfo, asks: Set<string>) {
  if (asks.has(x.id) || x.notes) return false;
  if (x.status === 'stopped' || x.status === 'error') return true;
  return (x.status === 'idle' || x.status === 'done') && Date.now() + store.skew - x.lastActivity > DEAD_AFTER;
}
const asksOf = () => new Set([...(store.state?.approvals ?? []), ...(store.state?.questions ?? [])].map((a) => a.sessionId));
const deadIds = () => (store.state?.sessions ?? []).filter((x) => isDead(x, asksOf())).map((x) => x.id);

function sessionRow(x: SessionInfo) {
  return `<button class="item" data-f="s:${x.id}">
    <i class="status" style="background:${statusColor(x.status)}"></i>
    <span class="grow">
      <span class="row"><span class="y ellipsis grow">${esc(x.name)}</span>${tags(x)}<span class="small muted">${ago(x.lastActivity)}</span></span>
      <span class="small ellipsis" style="display:block;color:${x.status === 'waiting' ? C.orange : C.cm}">${esc(x.activity || x.repo)}</span>
      ${x.progress != null && x.status !== 'stopped' ? bar(x.progress, statusColor(x.status)) : ''}
    </span>
  </button>`;
}

register('sessions', {
  render() {
    const s = store.state;
    const list = s?.sessions ?? [];
    const asks = asksOf();
    const dead = list.filter((x) => isDead(x, asks)).length;
    const cleared = s?.cleared ?? 0;
    const placed = new Set<string>();
    const groups = GROUPS.map(([label, test]) => {
      const items = list.filter((x) => !placed.has(x.id) && test(x, asks)).sort((a, b) => b.lastActivity - a.lastActivity);
      items.forEach((x) => placed.add(x.id));
      return items.length ? `<div class="label">${label} · ${items.length}</div>${items.map(sessionRow).join('')}` : '';
    }).join('');
    return `${header('sessions', C.pink)}
    <main class="scroll">
      <div class="btns">${btn('new', 'new session', { icon: 'plus' })}${btn('chat', 'chat', { icon: 'ask' })}${
        dead ? btn('clear', `clear ${dead} dead`, { icon: 'x', cls: 'chip' }) : ''
      }</div>
      <div class="list">${groups || '<div class="muted center">No sessions yet.</div>'}</div>
      ${cleared ? `<div class="btns">${btn('restore', `show ${cleared} cleared`, { cls: 'chip' })}</div>` : ''}
    </main>
    ${footer(`<span><span class="g">${list.length - dead} live</span> · <span class="muted">${dead} dead · ${cleared} cleared</span></span>`)}`;
  },
  mount(root) {
    onEach(root, 's:', (id) => go('session', { id }));
    on(root, 'new', () => go('newSession'));
    on(root, 'chat', () => go('compose', { kind: 'new', repo: '', title: 'chat with claude' }));
    on(root, 'clear', () => {
      const ids = deadIds();
      send({ t: 'sessions.clear', ids });
      localNotify(`cleared ${ids.length} dead session${ids.length === 1 ? '' : 's'}`);
      (root.querySelector('[data-f="new"]') as HTMLElement | null)?.focus();
    });
    on(root, 'restore', () => send({ t: 'sessions.restore' }));
  },
});

// ---------------- One session ----------------
// Top: what Claude last said (pinch to read it all). Then reply (box opens right here) + one-pinch
// phrases. Then todos and controls.
const lastClaude = (x: SessionInfo) => [...x.transcript].reverse().find((t) => t.role === 'claude');

/** Dictate / handwrite buttons, or the reply box in their place once opened. */
function replyBox(x: SessionInfo, label: string, def = false) {
  if (open.has(x.id)) return composerBox('reply', x.name);
  return composerButtons('reply', { def, dictate: label || 'dictate' });
}
function mountReply(root: HTMLElement, x: SessionInfo | undefined, id: string) {
  mountComposer(
    root,
    'reply',
    (text) => {
      send({ t: 'session.send', id, text });
      localNotify(`sent → ${x?.name ?? 'session'}`);
    },
    () => toggle(id, true),
    () => toggle(id, false),
  );
}
const closeReplyKey = (e: KeyboardEvent, id: string) => (e.key === 'Escape' && open.has(id) ? (clearComposer('reply'), toggle(id, false), true) : false);

register('session', {
  render({ id }) {
    const s = store.state;
    const x = s?.sessions.find((v) => v.id === id);
    if (!x) return `${header('session')}<main class="center muted">Session not found.</main>`;
    const pending = s?.approvals.filter((a) => a.sessionId === id).length ?? 0;
    const asked = s?.questions.find((q) => q.sessionId === id);
    const ext = x.source === 'external';
    const busy = x.status === 'running' || x.status === 'waiting' || x.status === 'starting';
    const phrases = s?.phrases ?? [];
    const replying = open.has(id);
    const diff = x.kind === 'code' && x.diffStat.files ? `<span class="g">+${x.diffStat.added}</span><span class="p">−${x.diffStat.removed}</span><span class="v">${x.diffStat.files}f</span>` : '';
    return `${header(x.name, C.yellow)}
    <main class="scroll">
      <div class="row small"><i class="status" style="background:${statusColor(x.status)}"></i><span style="color:${statusColor(x.status)}">${x.status}</span>
        <span class="c ellipsis">${esc(x.kind === 'chat' ? 'chat' : x.branch || x.repo)}</span>${tags(x)}<span class="grow"></span>${diff}${ctxGauge(x)}</div>
      ${x.progress != null && x.status !== 'stopped' ? bar(x.progress, statusColor(x.status)) : ''}
      ${x.transcript.length ? liveFeed(x, busy) : `<div class="small ellipsis" style="color:${x.status === 'waiting' ? C.orange : C.cm}">${esc(x.activity)}</div>`}
      <div class="btns">
        ${pending ? btn('approve', `approve (${pending})`, { cls: 'primary', icon: 'check', def: true }) : ''}
        ${asked ? btn('answer', 'answer question', { cls: 'primary', icon: 'ask', def: !pending }) : ''}
        ${replying ? '' : replyBox(x, ext && busy ? 'dictate · after this step' : 'dictate', !pending && !asked)}
        ${btn('history', 'conversation', { icon: 'comms' })}
        ${busy ? '' : btn('desk', x.desk ? `${x.desk === 'vscode' ? 'vs code' : 'terminal'} ↗` : 'open on laptop', { icon: 'laptop' })}
      </div>
      ${replying ? replyBox(x, '') : ''}
      ${
        replying && x.desk && !busy
          ? `<div class="small o">open in a ${deskName(x)} on your laptop: that window won't show this reply. Close it after, then "open on laptop".</div>`
          : ''
      }
      <div class="btns">${btn('status', checking ? 'checking… · cancel' : "how's everything going?", { cls: 'chip', icon: 'pulse' })}${phrases.map((p, i) => btn(`ph:${i}`, esc(p.label), { cls: 'chip' })).join('')}</div>
      ${
        x.todos.length
          ? `<div class="card small">${x.todos
              .slice(0, 6)
              .map((t) => `<div class="${t.done ? 'g' : ''} ellipsis">${t.done ? '✓' : '·'} ${esc(t.text)}</div>`)
              .join('')}</div>`
          : ''
      }
      <div class="btns">
        ${!ext && x.status === 'running' ? btn('interrupt', 'pause', { icon: 'pause' }) : ''}
        ${!ext && busy ? btn('stop', 'stop', { icon: 'stop' }) : ''}
        ${!busy && !pending && !asked && !x.notes ? btn('clear', 'clear from list', { icon: 'x' }) : ''}
      </div>
    </main>
    ${footer(replying ? 'pinch the box to talk · back closes it' : ext && busy ? 'running elsewhere · replies are delivered when it finishes this step' : 'pinch a phrase to send it · or dictate / handwrite')}`;
  },
  key: (e, { id }) => closeReplyKey(e, id),
  mount(root, { id }) {
    const s = store.state;
    const x = s?.sessions.find((v) => v.id === id);
    on(root, 'approve', () => go('approval', { sessionId: id }));
    on(root, 'answer', () => go('claude'));
    on(root, 'history', () => go('transcript', { id }));
    on(root, 'status', checkStatus);
    on(root, 'desk', () => {
      send({ t: 'session.openDesk', id });
      localNotify('opening on your laptop…', 'info');
    });
    on(root, 'said', () => go('transcript', { id }));
    mountReply(root, x, id);
    onEach(root, 'ph:', (i) => {
      const p = s?.phrases[Number(i)];
      if (!p) return;
      send({ t: 'session.send', id, text: p.text });
      localNotify(`sent: ${p.label} → ${x?.name ?? 'session'}`);
    });
    on(root, 'interrupt', () => send({ t: 'session.interrupt', id }));
    on(root, 'stop', () => send({ t: 'session.stop', id }));
    on(root, 'clear', () => {
      send({ t: 'sessions.clear', ids: [id] });
      localNotify(`cleared ${x?.name ?? 'session'} · it comes back if it does anything new`);
      back();
    });
  },
});

// ---------------- Conversation: the whole transcript, one focusable entry per message ----------------
// Runs of tool calls are folded into one line. Long messages are cut short here: pinch one to open
// it in the reader, where up/down scrolls through that message alone and back returns here.
function foldedRows(x: SessionInfo) {
  // k: stable across updates (a run of steps keeps its first step's key while it grows)
  const rows: { role: string; text: string; at: number; k: string }[] = [];
  for (const t of x.transcript) {
    const prev = rows[rows.length - 1];
    if (t.role === 'tool' && prev?.role === 'tool') {
      prev.text += ` · ${t.text}`;
      prev.at = t.at;
    } else rows.push({ ...t, k: `${t.at}:${t.role}:${t.text.slice(0, 32)}` });
  }
  return rows.slice(-40);
}
const ROLE_CLS: Record<string, string> = { you: 'p', claude: 'c', tool: 'muted', steps: 'muted', system: 'o' };
const roleColor = (r: string) => ({ you: C.pink, claude: C.cyan, tool: C.green, system: C.orange })[r] ?? C.cm;

/** Context window use: a small bar, the percentage, and the window size (green, orange past 60%, pink past 80%). */
function ctxGauge(x: SessionInfo) {
  const c = x.context;
  if (!c?.limit) return '';
  const p = Math.min(1, c.used / c.limit);
  const col = p >= 0.8 ? C.pink : p >= 0.6 ? C.orange : C.green;
  const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
  return `<span class="ctx" title="context"><i style="width:${(p * 100).toFixed(0)}%;background:${col}"></i></span><span style="color:${col}">${Math.round(p * 100)}%</span><span class="muted">of ${k(c.limit)}</span>`;
}

/**
 * The session's live feed: the latest messages and steps in a fixed window, newest at the bottom.
 * New ones grow in and flash, bumping the older ones up and out of the top; while it works, a
 * typing row shows what it's doing. Pinch for the whole conversation.
 */
function liveFeed(x: SessionInfo, busy: boolean) {
  const rows = foldedRows(x).slice(-10);
  const scope = `feed:${x.id}`;
  prime(scope, rows.map((r) => ({ key: r.k, sig: r.text })));
  const items = rows
    .map((r) => {
      const f = fresh(scope, r.k, r.text);
      const steps = r.role === 'tool' ? r.text.split(' · ') : [];
      const who = r.role === 'tool' ? `steps <span class="v">${steps.length}</span>` : r.role;
      const body =
        r.role === 'tool'
          ? `<span class="tx ellipsis muted">${esc(steps[steps.length - 1])}</span>`
          : `<span class="tx clamp${r.role === 'claude' ? 3 : 2}">${esc(r.text.replace(/\s+/g, ' ').slice(0, 400))}</span>`;
      return `<div class="fi ${f.cls}" style="--fc:${roleColor(r.role)};${f.style}"><span class="who" style="color:${roleColor(r.role)}">${who}</span>${body}</div>`;
    })
    .join('');
  const dot = x.status === 'waiting' ? C.orange : C.green;
  // The step it's on is already the last line; the typing row then just says it's working.
  const lastRow = rows[rows.length - 1];
  const lastStep = lastRow?.role === 'tool' ? lastRow.text.split(' · ').pop() : '';
  const doing = x.activity && x.activity !== lastStep ? x.activity : x.status === 'waiting' ? 'waiting on you' : 'working…';
  const typing = busy
    ? `<div class="fi typing"><span class="who"><i class="dots">${`<b style="background:${dot};${phase(1200)}"></b>`.repeat(3)}</i></span>
        <span class="tx ellipsis ${x.status === 'waiting' ? 'o' : 'shimmer'}" style="${phase(2400)}">${esc(doing)}</span></div>`
    : '';
  return `<button class="feed${busy ? ' live' : ''}" data-f="said">${items}${typing}</button>`;
}

register('transcript', {
  render({ id }) {
    const x = store.state?.sessions.find((v) => v.id === id);
    if (!x) return `${header('conversation')}<main class="center muted">Session not found.</main>`;
    const replying = open.has(id);
    const rows = foldedRows(x);
    const scope = `tr:${id}`;
    prime(scope, rows.map((r) => ({ key: r.k, sig: r.text })));
    const items = rows
      .map((r) => ({ r, f: fresh(scope, r.k, r.text) }))
      .map(
        ({ r, f }, i, all) => `<button class="item msg ${f.cls}" style="--fc:${roleColor(r.role)};${f.style}" data-f="m:${i}" ${i === all.length - 1 && !replying ? 'data-default' : ''}>
          <span class="grow"><span class="row small"><span class="${ROLE_CLS[r.role] ?? ''}">${r.role === 'tool' ? 'steps' : r.role}</span><span class="grow"></span><span class="muted">${ago(r.at)}</span></span>
          ${r.role === 'tool' ? `<span class="small muted clamp2" style="display:block">${esc(r.text)}</span>` : `<span class="clamp6" style="display:block">${md(r.text)}</span>`}</span>
        </button>`,
      )
      .join('');
    return `${header(x.name, C.yellow)}
    <main class="scroll"><div class="list">${items || '<div class="muted center">Nothing yet.</div>'}</div>
      ${replying ? replyBox(x, '') : `<div class="btns">${replyBox(x, 'dictate')}</div>`}</main>
    ${footer(replying ? 'pinch the box to talk · back closes it' : 'swipe ↑ for older · pinch a message to read it all')}`;
  },
  key: (e, { id }) => closeReplyKey(e, id),
  mount(root, { id }) {
    const x = store.state?.sessions.find((v) => v.id === id);
    if (!x) return;
    const rows = foldedRows(x);
    // Watching the newest message? Follow along as new ones arrive.
    const last = rows.length - 1;
    if (root.querySelector(`[data-f="m:${last}"].fx-new`)) {
      requestAnimationFrame(() => {
        const a = document.activeElement as HTMLElement | null;
        if (a?.dataset.f === `m:${last - 1}` || a?.dataset.f === `m:${last}`) {
          const el = root.querySelector<HTMLElement>(`[data-f="m:${last}"]`);
          el?.focus({ preventScroll: true });
          el?.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
      });
    }
    onEach(root, 'm:', (i) => {
      const r = rows[Number(i)];
      if (!r) return;
      const tool = r.role === 'tool';
      go('message', { title: x.name, role: tool ? 'steps' : r.role, at: r.at, text: tool ? r.text.split(' · ').join('\n') : r.text });
    });
    mountReply(root, x, id);
  },
});

// ---------------- Message reader: one message, full length ----------------
// Up/down scroll through this message only; pinch or back returns to where you were.
register('message', {
  render({ title, role, at, text }) {
    return `${header(title, C.yellow)}
    <main class="reader">
      <div class="row small"><span class="${ROLE_CLS[role] ?? 'muted'}">${esc(role)}</span><span class="grow"></span><span class="muted">${agoText(at)}</span></div>
      ${role === 'steps' ? `<div class="pre small">${esc(text)}</div>` : md(text)}
      <div class="muted small center" style="padding:12px 0">· end ·</div>
    </main>
    ${footer('swipe ↑↓ to scroll · pinch or back to return')}`;
  },
  key(e) {
    const main = document.querySelector<HTMLElement>('main.reader');
    if (!main) return false;
    const step = Math.round(main.clientHeight * 0.7);
    if (e.key === 'ArrowDown') main.scrollBy({ top: step });
    else if (e.key === 'ArrowUp') main.scrollBy({ top: -step });
    else if (e.key === 'Enter') back();
    else return e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    return true;
  },
});

// ---------------- New session: a chat, or pick a repo; then dictate the task ----------------
register('newSession', {
  render() {
    const repos = store.state?.repos ?? [];
    return `${header('new', C.pink)}
    <main class="scroll">
      <button class="item" data-f="chat" data-default>${icon('ask', 20, C.purple)}<span class="grow"><span class="y" style="display:block">chat with claude</span><span class="small muted">no repo · gmail, calendar, drive and your other connectors</span></span></button>
      <div class="label">code · pick a repo (recent first) · gets its own branch and worktree</div>
      <div class="list">${
        repos.map((r) => `<button class="item" data-f="r:${esc(r)}">${icon('sessions', 20, C.cyan)}<span class="y ellipsis">${esc(r)}</span></button>`).join('') ||
        '<div class="muted">No repos found in REPOS_DIR on the relay.</div>'
      }</div>
    </main>
    ${footer('pinch, then say what you want')}`;
  },
  mount(root) {
    on(root, 'chat', () => replace('compose', { kind: 'new', repo: '', title: 'chat with claude' }));
    onEach(root, 'r:', (repo) => replace('compose', { kind: 'new', repo, title: `new · ${repo.split('/').pop()}` }));
  },
});


// ---------------- Approval card ----------------
// Gestures: → approve · ← deny · ↓ always (teaches the preset) · back = decide later
function current(p: { sessionId?: string }): Approval | undefined {
  const list = store.state?.approvals ?? [];
  return (p.sessionId && list.find((a) => a.sessionId === p.sessionId)) || list[0];
}

register('approval', {
  render(p) {
    const a = current(p);
    if (!a) return `${header('approvals', C.orange)}<main class="center"><div><div class="g" style="font-size:22px">${icon('check', 40, C.green)}</div><div>All clear.</div><div class="muted small">back to return</div></div></main>`;
    const total = store.state!.approvals.length;
    const diff = a.diff
      ? `<div class="diff">${a.diff.map((d) => `<div class="${d.kind === '+' ? 'add' : d.kind === '-' ? 'del' : ''}">${d.kind} ${esc(d.text)}</div>`).join('')}</div>`
      : '';
    return `${header(`approve · ${total}`, C.orange)}
    <main>
      <div class="label">${esc(a.sessionName)} · ${esc(a.tool)} · ${agoText(a.at)}</div>
      <div style="font-size:20px" class="y">${esc(a.title)}</div>
      ${diff || `<div class="diff">${esc(a.detail)}</div>`}
      <div class="small muted ellipsis">↓ always remembers: <span class="c">${esc(a.alwaysLabel)}</span></div>
      <div class="gestures">
        ${btn('deny', '← deny', { icon: 'x' })}
        ${btn('always', '↓ always', { icon: 'down' })}
        ${btn('allow', 'approve →', { icon: 'check', cls: 'primary', def: true })}
      </div>
    </main>
    ${footer('swipe → approve · ← deny · ↓ always · back = later')}`;
  },
  mount(root, p) {
    const a = current(p);
    if (!a) return;
    const decide = (decision: 'allow' | 'deny' | 'always') => send({ t: 'approval.decide', id: a.id, decision });
    on(root, 'allow', () => decide('allow'));
    on(root, 'deny', () => decide('deny'));
    on(root, 'always', () => decide('always'));
  },
  key(e, p) {
    const a = current(p);
    if (!a) return false;
    const map: Record<string, 'allow' | 'deny' | 'always'> = { ArrowRight: 'allow', ArrowLeft: 'deny', ArrowDown: 'always' };
    const d = map[e.key];
    if (!d) return false;
    send({ t: 'approval.decide', id: a.id, decision: d });
    return true;
  },
});

// Leave the approval screen automatically once nothing is pending for a few seconds.
let emptySince = 0;
store.on(() => {
  const list = store.state?.approvals ?? [];
  if (list.length) emptySince = 0;
  else if (!emptySince) {
    emptySince = Date.now();
    setTimeout(() => {
      if (emptySince && (store.state?.approvals.length ?? 0) === 0 && location.hash === '#approval') back();
    }, 1500);
  }
});

export type { Question };
