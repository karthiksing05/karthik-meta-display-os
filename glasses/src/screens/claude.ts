import { register, go, back, replace } from '../nav.ts';
import { store, send } from '../store.ts';
import { C, ago, agoText, bar, btn, esc, footer, header, icon, statusColor } from '../ui.ts';
import { on, onEach } from './util.ts';
import type { Approval, Question, SessionInfo } from '../../../shared/protocol.ts';

// ---------------- Claude hub ----------------
// One big "how's everything going?" button, the question inbox, and an ask bar.
let askTarget: 'all' | string = 'all';
let checking = false;

register('claude', {
  render() {
    const s = store.state;
    const sessions = s?.sessions ?? [];
    const approvals = s?.approvals ?? [];
    const questions = s?.questions ?? [];
    const r = store.report;
    const targetName = askTarget === 'all' ? 'all sessions' : sessions.find((x) => x.id === askTarget)?.name ?? 'all sessions';

    const reportCard = r
      ? `<div class="card">
          <div class="label">claude · ${agoText(r.at)}</div>
          <div>${esc(r.headline)}</div>
          ${r.lines
            .slice(0, 4)
            .map(
              (l) =>
                `<div class="row small"><i class="status" style="background:${statusColor(l.status)}"></i><span class="y">${esc(l.session)}</span><span class="muted ellipsis grow">${esc(l.text)}</span></div>`,
            )
            .join('')}
        </div>`
      : '';

    const q = questions[0];
    const qCard = q
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

    return `${header('claude', C.pink)}
    <main class="scroll">
      ${btn('status', checking ? 'checking…' : "how's everything going?", { cls: 'primary big', icon: 'pulse', def: true })}
      ${reportCard}
      ${aCard}
      ${qCard}
      <div class="row">
        ${btn('ask', `ask ${esc(targetName)}…`, { icon: 'ask', cls: 'grow wide' })}
        ${btn('target', '▾', { cls: 'chip' })}
      </div>
      <div class="btns">
        ${btn('sessions', `sessions · ${sessions.length}`, { icon: 'sessions' })}
        ${btn('new', 'new', { icon: 'plus' })}
        ${btn('chip:tests', 'run the tests', { cls: 'chip' })}
        ${btn('chip:summary', 'summarize changes', { cls: 'chip' })}
        ${btn('chip:commit', 'commit what works', { cls: 'chip' })}
      </div>
    </main>
    ${footer('pinch = select · ▾ cycles who you ask')}`;
  },
  mount(root) {
    const s = store.state;
    on(root, 'status', () => {
      checking = true;
      send({ t: 'status.check' });
    });
    on(root, 'approvals', () => go('approval'));
    on(root, 'sessions', () => go('sessions'));
    on(root, 'new', () => go('newSession'));
    on(root, 'target', () => {
      const ids = ['all', ...(s?.sessions.filter((x) => x.status !== 'stopped').map((x) => x.id) ?? [])];
      askTarget = ids[(ids.indexOf(askTarget) + 1) % ids.length] ?? 'all';
      store.emit();
    });
    on(root, 'ask', () => go('compose', { kind: 'ask', target: askTarget, title: 'ask claude' }));
    const chips: Record<string, string> = {
      tests: 'Run the test suite and tell me in one line what failed, if anything.',
      summary: 'In two short sentences: what have you changed so far and what is left?',
      commit: 'Commit the work that is done and passing, with a clear message. Do not push.',
    };
    onEach(root, 'chip:', (k) => send({ t: 'ask', target: askTarget, text: chips[k] }));
    const q = s?.questions[0];
    if (q) {
      onEach(root, 'qa:', (k) => {
        if (k === 'type') return go('compose', { kind: 'answer', questionId: q.id, question: q.question, title: 'answer' });
        send({ t: 'question.answer', id: q.id, answers: { [q.question]: q.options[Number(k)].label } });
      });
    }
  },
});

// Stop the "checking…" label when the report lands.
store.on(() => {
  if (checking && store.report && Date.now() - store.report.at < 60_000) checking = false;
});

// ---------------- Sessions list ----------------
function sessionRow(x: SessionInfo) {
  return `<button class="item" data-f="s:${x.id}">
    <i class="status" style="background:${statusColor(x.status)}"></i>
    <span class="grow">
      <span class="row"><span class="y ellipsis grow">${esc(x.name)}</span><span class="small muted">${esc(x.repo)} · ${ago(x.lastActivity)}</span></span>
      <span class="small muted ellipsis" style="display:block">${esc(x.activity)}</span>
      ${x.progress != null ? bar(x.progress, statusColor(x.status)) : ''}
    </span>
  </button>`;
}

register('sessions', {
  render() {
    const list = store.state?.sessions ?? [];
    return `${header('sessions', C.pink)}
    <main class="scroll">
      <div class="list">${list.map(sessionRow).join('') || '<div class="muted center">No sessions yet.</div>'}</div>
      ${btn('new', 'new session', { icon: 'plus', cls: 'wide' })}
    </main>
    ${footer('pinch to open · back to hub')}`;
  },
  mount(root) {
    onEach(root, 's:', (id) => go('session', { id }));
    on(root, 'new', () => go('newSession'));
  },
});

// ---------------- One session ----------------
register('session', {
  render({ id }) {
    const x = store.state?.sessions.find((s) => s.id === id);
    if (!x) return `${header('session')}<main class="center muted">Session not found.</main>`;
    const lines = x.transcript.slice(-5);
    const pending = store.state?.approvals.filter((a) => a.sessionId === id).length ?? 0;
    return `${header(x.name, C.yellow)}
    <main class="scroll">
      <div class="row small"><i class="status" style="background:${statusColor(x.status)}"></i><span style="color:${statusColor(x.status)}">${x.status}</span>
        <span class="c">${esc(x.branch)}</span><span class="grow"></span>
        <span class="g">+${x.diffStat.added}</span><span class="p">−${x.diffStat.removed}</span><span class="v">${x.diffStat.files}f</span><span class="muted">$${x.costUsd.toFixed(2)}</span></div>
      ${x.progress != null ? bar(x.progress, statusColor(x.status)) : ''}
      ${
        x.todos.length
          ? `<div class="card small">${x.todos
              .slice(0, 5)
              .map((t) => `<div class="${t.done ? 'g' : ''}">${t.done ? '✓' : '·'} ${esc(t.text)}</div>`)
              .join('')}</div>`
          : ''
      }
      <div class="card small">${
        lines
          .map((l) => `<div class="clamp2"><span class="${l.role === 'you' ? 'p' : l.role === 'claude' ? 'c' : 'muted'}">${l.role}</span> ${esc(l.text)}</div>`)
          .join('') || '<span class="muted">nothing yet</span>'
      }</div>
      <div class="btns">
        ${pending ? btn('approve', `approve (${pending})`, { cls: 'primary', icon: 'check', def: true }) : ''}
        ${btn('reply', 'reply', { icon: 'mic', def: !pending })}
        ${btn('status', 'how is it going?', { icon: 'pulse' })}
        ${x.status === 'running' ? btn('interrupt', 'pause', { icon: 'pause' }) : ''}
        ${x.status !== 'stopped' ? btn('stop', 'stop', { icon: 'stop' }) : ''}
      </div>
    </main>
    ${footer('reply opens the composer · dictate or handwrite')}`;
  },
  mount(root, { id }) {
    on(root, 'approve', () => go('approval', { sessionId: id }));
    on(root, 'reply', () => go('compose', { kind: 'session', id, title: 'reply' }));
    on(root, 'status', () => send({ t: 'session.send', id, text: 'Quick status: one or two short sentences, what is done and what is next?' }));
    on(root, 'interrupt', () => send({ t: 'session.interrupt', id }));
    on(root, 'stop', () => send({ t: 'session.stop', id }));
  },
});

// ---------------- New session: pick a repo, then dictate the task ----------------
register('newSession', {
  render() {
    const repos = store.state?.repos ?? [];
    return `${header('new session', C.pink)}
    <main class="scroll">
      <div class="label">pick a repo · each session gets its own branch and worktree</div>
      <div class="list">${
        repos.map((r) => `<button class="item" data-f="r:${esc(r)}">${icon('sessions', 20, C.cyan)}<span class="y">${esc(r)}</span></button>`).join('') ||
        '<div class="muted">No repos found in REPOS_DIR on the relay.</div>'
      }</div>
    </main>
    ${footer('pinch a repo, then say what to do')}`;
  },
  mount(root) {
    onEach(root, 'r:', (repo) => replace('compose', { kind: 'new', repo, title: `new · ${repo}` }));
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
