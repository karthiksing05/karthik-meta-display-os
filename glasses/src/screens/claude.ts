import { register, go, back, replace } from '../nav.ts';
import { store, send, localNotify } from '../store.ts';
import { C, ago, agoText, bar, btn, esc, footer, header, icon, md, statusColor } from '../ui.ts';
import { clearComposer, composerBox, composerButtons, mountComposer } from './composer.ts';
import { on, onEach } from './util.ts';
import type { Approval, Question, SessionInfo } from '../../../shared/protocol.ts';

// ---------------- Claude hub ----------------
// One big "how's everything going?" button, the question inbox, and an ask bar.
let checking = false;
/** Which inline reply boxes are open: 'ask' on the hub, the session id on a session / conversation. */
const open = new Set<string>();
const toggle = (k: string, on: boolean) => (on ? open.add(k) : open.delete(k), store.emit());

/** "How's everything going?": ask the relay for a report; the status screen opens when it lands. */
function checkStatus() {
  checking = true;
  send({ t: 'status.check' });
  localNotify("checking how everything's going…", 'info');
  store.emit();
}

/**
 * The hub's contents, shared by the home screen and the 'claude' screen: "how's everything going?",
 * whatever's waiting on you, then `nav` (the caller's own buttons or tiles), then the ask bar
 * (dictate / handwrite, and who to ask) and the quick-send phrases.
 */
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
        ${btn('status', checking ? 'checking…' : "how's everything going?", { cls: 'primary big main-action', icon: 'pulse', def: true })}
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
// Every session, one line each, ones waiting on you first. Pinch a line to open that session.
register('report', {
  render() {
    const r = store.report;
    if (!r) return `${header('status')}<main class="center muted">No report yet.</main>`;
    const live = new Map((store.state?.sessions ?? []).map((x) => [x.id, x]));
    let lastGroup = '';
    const rows = r.lines
      .map((l) => {
        const now = live.get(l.id);
        const status = now?.status ?? l.status;
        const group = l.needsYou ? 'needs you' : status === 'running' || status === 'starting' ? 'working' : status === 'stopped' ? 'earlier' : 'your turn';
        const head = group !== lastGroup ? `<div class="label">${group}</div>` : '';
        lastGroup = group;
        return `${head}<button class="item msg" data-f="rl:${l.id}"${l.needsYou ? ` style="border-color:${C.orange}"` : ''}>
          <i class="status" style="background:${statusColor(status)};margin-top:6px"></i>
          <span class="grow">
            <span class="row"><span class="y ellipsis grow">${esc(l.session)}</span>${now ? `<span class="small muted">${ago(now.lastActivity)}</span>` : ''}</span>
            <span class="small" style="display:block;color:${l.needsYou ? C.orange : C.fg}">${esc(l.text)}</span>
            ${l.change ? `<span class="small" style="display:block;color:${/^no change/i.test(l.change) ? C.cm : C.cyan}">since last · ${esc(l.change)}</span>` : ''}
          </span>
        </button>`;
      })
      .join('');
    return `${header('status', C.pink)}
    <main class="scroll">
      <button class="item msg" data-f="overview" data-default>
        <span class="grow"><span class="label" style="display:block">claude · ${agoText(r.at)}${r.previousAt ? ` · vs check ${agoText(r.previousAt)}` : ''}</span>
        <span style="display:block">${esc(r.headline)}</span></span>
      </button>
      ${btn('recheck', checking ? 'checking…' : 'check again', { icon: 'pulse', cls: 'chip' })}
      <div class="list">${rows || '<div class="muted center">No sessions.</div>'}</div>
    </main>
    ${footer('swipe to scroll · pinch a session to open it')}`;
  },
  mount(root) {
    onEach(root, 'rl:', (id) => (store.state?.sessions.some((x) => x.id === id) ? go('session', { id }) : localNotify('that session is gone')));
    on(root, 'overview', () => {
      const r = store.report;
      if (r) go('message', { title: 'how it\'s going', role: 'claude', at: r.at, text: r.headline });
    });
    on(root, 'recheck', () => {
      checking = true;
      send({ t: 'status.check' });
      store.emit();
    });
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
  return `${x.source === 'external' ? '<span class="src c">ext</span>' : ''}${x.kind === 'chat' ? '<span class="src v">chat</span>' : ''}${
    x.desk ? `<span class="src g">${x.desk === 'vscode' ? 'vs code' : 'term'}</span>` : ''
  }`;
}
const deskName = (x: SessionInfo) => (x.desk === 'vscode' ? 'VS Code tab' : 'terminal');

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
    const asks = new Set([...(s?.approvals ?? []), ...(s?.questions ?? [])].map((a) => a.sessionId));
    const placed = new Set<string>();
    const groups = GROUPS.map(([label, test]) => {
      const items = list.filter((x) => !placed.has(x.id) && test(x, asks)).sort((a, b) => b.lastActivity - a.lastActivity);
      items.forEach((x) => placed.add(x.id));
      return items.length ? `<div class="label">${label} · ${items.length}</div>${items.map(sessionRow).join('')}` : '';
    }).join('');
    return `${header('sessions', C.pink)}
    <main class="scroll">
      <div class="btns">${btn('new', 'new session', { icon: 'plus' })}${btn('chat', 'chat', { icon: 'ask' })}</div>
      <div class="list">${groups || '<div class="muted center">No sessions yet.</div>'}</div>
    </main>
    ${footer('pinch to open · ext = terminal / vs code / remote control')}`;
  },
  mount(root) {
    onEach(root, 's:', (id) => go('session', { id }));
    on(root, 'new', () => go('newSession'));
    on(root, 'chat', () => go('compose', { kind: 'new', repo: '', title: 'chat with claude' }));
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
    const said = lastClaude(x);
    const phrases = s?.phrases ?? [];
    const replying = open.has(id);
    const diff = x.kind === 'code' && x.diffStat.files ? `<span class="g">+${x.diffStat.added}</span><span class="p">−${x.diffStat.removed}</span><span class="v">${x.diffStat.files}f</span>` : '';
    return `${header(x.name, C.yellow)}
    <main class="scroll">
      <div class="row small"><i class="status" style="background:${statusColor(x.status)}"></i><span style="color:${statusColor(x.status)}">${x.status}</span>
        <span class="c ellipsis">${esc(x.kind === 'chat' ? 'chat' : x.branch || x.repo)}</span>${tags(x)}<span class="grow"></span>${diff}${x.costUsd ? `<span class="muted">$${x.costUsd.toFixed(2)}</span>` : ''}</div>
      ${x.progress != null && x.status !== 'stopped' ? bar(x.progress, statusColor(x.status)) : ''}
      ${busy || !said ? `<div class="small ellipsis" style="color:${x.status === 'waiting' ? C.orange : C.cm}">${esc(x.activity)}</div>` : ''}
      ${
        said
          ? `<button class="item msg" data-f="said"><span class="grow"><span class="label" style="display:block">claude · ${agoText(said.at)} · pinch to read all</span><span class="clamp6" style="display:block">${md(said.text)}</span></span></button>`
          : ''
      }
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
      <div class="btns">${btn('status', checking ? 'checking…' : "how's everything going?", { cls: 'chip', icon: 'pulse' })}${phrases.map((p, i) => btn(`ph:${i}`, esc(p.label), { cls: 'chip' })).join('')}</div>
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
    const said = x && lastClaude(x);
    on(root, 'said', () => {
      if (x && said) go('message', { title: x.name, role: 'claude', at: said.at, text: said.text });
    });
    mountReply(root, x, id);
    onEach(root, 'ph:', (i) => {
      const p = s?.phrases[Number(i)];
      if (!p) return;
      send({ t: 'session.send', id, text: p.text });
      localNotify(`sent: ${p.label} → ${x?.name ?? 'session'}`);
    });
    on(root, 'interrupt', () => send({ t: 'session.interrupt', id }));
    on(root, 'stop', () => send({ t: 'session.stop', id }));
  },
});

// ---------------- Conversation: the whole transcript, one focusable entry per message ----------------
// Runs of tool calls are folded into one line. Long messages are cut short here: pinch one to open
// it in the reader, where up/down scrolls through that message alone and back returns here.
function foldedRows(x: SessionInfo) {
  const rows: { role: string; text: string; at: number }[] = [];
  for (const t of x.transcript) {
    const prev = rows[rows.length - 1];
    if (t.role === 'tool' && prev?.role === 'tool') {
      prev.text += ` · ${t.text}`;
      prev.at = t.at;
    } else rows.push({ ...t });
  }
  return rows.slice(-40);
}
const ROLE_CLS: Record<string, string> = { you: 'p', claude: 'c', tool: 'muted', steps: 'muted', system: 'o' };

register('transcript', {
  render({ id }) {
    const x = store.state?.sessions.find((v) => v.id === id);
    if (!x) return `${header('conversation')}<main class="center muted">Session not found.</main>`;
    const replying = open.has(id);
    const items = foldedRows(x)
      .map(
        (r, i, all) => `<button class="item msg" data-f="m:${i}" ${i === all.length - 1 && !replying ? 'data-default' : ''}>
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
