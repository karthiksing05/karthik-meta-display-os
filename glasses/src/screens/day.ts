import { register, go } from '../nav.ts';
import { store, send, now, token } from '../store.ts';
import { C, ago, btn, clock, esc, footer, header, icon } from '../ui.ts';
import { on, onEach } from './util.ts';

// ---------------- Agenda: today as a timeline ----------------
register('agenda', {
  render() {
    const events = (store.state?.agenda ?? []).filter((e) => e.end > now() - 3600_000);
    const t0 = now();
    return `${header('agenda', C.yellow)}
    <main class="scroll">
      <div class="list">${
        events
          .map((e) => {
            const live = e.start <= t0 && e.end > t0;
            const soon = !live && e.start - t0 < 15 * 60_000 && e.start > t0;
            return `<button class="item" data-f="e:${esc(e.id)}" style="${live ? `border-color:${C.green}` : soon ? `border-color:${C.orange}` : ''}">
              <span class="v" style="width:76px">${clock(e.start)}</span>
              <span class="grow"><span class="y ellipsis" style="display:block">${esc(e.title)}</span>
                <span class="small muted ellipsis" style="display:block">${e.meetUrl ? 'google meet · audio' : esc(e.location ?? '')}${live ? ' · <span class="g">now</span>' : soon ? ' · <span class="o">soon</span>' : ''}</span></span>
              ${e.meetUrl ? icon('video', 20, C.cyan) : e.location ? icon('map', 20, C.cyan) : ''}
            </button>`;
          })
          .join('') || '<div class="center muted">Nothing else today.</div>'
      }</div>
    </main>
    ${footer('pinch an event: join Meet (audio) or get directions')}`;
  },
  mount(root) {
    onEach(root, 'e:', (id) => {
      const e = store.state?.agenda.find((x) => x.id === id);
      if (!e) return;
      if (e.meetUrl) go('meet', { id });
      else if (e.location) go('route', { destination: e.location });
    });
  },
});

// Meet: video isn't possible on the lens; join from the phone and the audio comes through the glasses.
register('meet', {
  render({ id }) {
    const e = store.state?.agenda.find((x) => x.id === id);
    return `${header('meet', C.cyan)}
    <main>
      <div class="y" style="font-size:20px">${esc(e?.title ?? '')}</div>
      <div class="muted">${e ? `${clock(e.start)}–${clock(e.end)}` : ''}</div>
      <div class="card small">Meet video can't run on the lens. Pinch <span class="p">join</span>: the link opens, your phone joins, and the audio plays through the glasses.</div>
      <div class="btns">${btn('join', 'join (audio)', { icon: 'phone', cls: 'primary', def: true })}${btn('prep', 'claude prep', { icon: 'claude' })}</div>
    </main>
    ${footer('back to agenda')}`;
  },
  mount(root, { id }) {
    const e = store.state?.agenda.find((x) => x.id === id);
    on(root, 'join', () => e?.meetUrl && (location.href = e.meetUrl));
    on(root, 'prep', () => go('compose', { kind: 'ask', target: 'all', title: 'prep with claude' }));
  },
});

// ---------------- Mail ----------------
register('mail', {
  render() {
    const mail = store.state?.mail ?? [];
    return `${header('mail', C.orange)}
    <main class="scroll">
      <div class="list">${
        mail
          .map(
            (m) => `<button class="item" data-f="m:${esc(m.id)}">
              <i class="status" style="background:${m.unread ? C.orange : 'transparent'}"></i>
              <span class="grow"><span class="row"><span class="y grow ellipsis">${esc(m.from)}</span><span class="small muted">${ago(m.at)}</span></span>
              <span class="ellipsis" style="display:block">${esc(m.subject)}</span>
              <span class="small muted ellipsis" style="display:block">${esc(m.snippet)}</span></span>
            </button>`,
          )
          .join('') || '<div class="center muted">Inbox zero.</div>'
      }</div>
    </main>
    ${footer('read here · ask claude to draft replies')}`;
  },
  mount(root) {
    onEach(root, 'm:', (id) => go('mailItem', { id }));
  },
});

register('mailItem', {
  render({ id }) {
    const m = store.state?.mail.find((x) => x.id === id);
    if (!m) return `${header('mail')}<main class="center muted">Gone.</main>`;
    return `${header('mail', C.orange)}
    <main>
      <div class="y">${esc(m.from)}</div>
      <div style="font-size:19px">${esc(m.subject)}</div>
      <div class="card">${esc(m.snippet)}</div>
      <div class="btns">${btn('draft', 'claude: draft a reply', { icon: 'claude', cls: 'primary', def: true })}</div>
      <div class="small muted">Drafts are made by a Claude session with the Gmail connector. You review before anything is sent.</div>
    </main>
    ${footer('back to inbox')}`;
  },
  mount(root, { id }) {
    const m = store.state?.mail.find((x) => x.id === id);
    on(root, 'draft', () =>
      m &&
      go('compose', {
        kind: 'ask',
        target: 'all',
        title: `reply to ${m.from}`,
      }),
    );
  },
});

// ---------------- Route ----------------
let locating = false;
let requestedFor = '';

function requestRoute(destination: string) {
  store.route = null;
  store.routeError = '';
  locating = true;
  store.emit();
  const done = (from?: { lat: number; lng: number }) => {
    locating = false;
    send({ t: 'route', destination, from });
  };
  if (!navigator.geolocation) return done();
  navigator.geolocation.getCurrentPosition(
    (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => done(),
    { timeout: 8000, maximumAge: 60_000 },
  );
}

register('route', {
  render(p: { destination?: string }) {
    const r = store.route;
    if (!p.destination) {
      const favs = store.state?.favorites ?? [];
      const next = store.state?.agenda.find((e) => e.location && e.start > now());
      return `${header('maps', C.cyan)}
      <main class="scroll">
        ${next ? btn(`to:${next.location}`, `next: ${esc(next.title)} · ${esc(next.location!)}`, { icon: 'agenda', cls: 'wide primary' }) : ''}
        <div class="label">favorites</div>
        <div class="list">${favs.filter((f) => f.address).map((f) => btn(`to:${f.address}`, esc(f.name), { icon: 'map', cls: 'wide' })).join('') || '<div class="muted small">Add favorites in lists.json on the relay.</div>'}</div>
      </main>${footer('walking directions')}`;
    }
    const mapImg = r?.mapUrl ? `<img src="${esc(r.mapUrl)}&k=${encodeURIComponent(token ?? '')}" width="576" height="250" style="border-radius:10px;display:block" alt="">` : '';
    return `${header('route', C.cyan)}
    <main class="scroll">
      <div class="row"><span class="y grow ellipsis">${esc(p.destination)}</span>${r ? `<span class="v">${r.durationMin} min</span><span class="muted">${r.distanceKm} km</span>` : ''}</div>
      ${locating ? '<div class="muted">finding you…</div>' : ''}
      ${store.routeError ? `<div class="p small">${esc(store.routeError)}</div>` : ''}
      ${mapImg}
      ${r ? `<div class="list">${r.steps.slice(0, 6).map((s, i) => `<div class="row small"><span class="v" style="width:24px">${i + 1}</span><span class="grow">${esc(s.text)}</span><span class="muted">${s.distanceM}m</span></div>`).join('')}</div>` : ''}
      ${btn('refresh', 'update', { icon: 'map' })}
    </main>
    ${footer('Meta’s own Maps app gives turn-by-turn')}`;
  },
  mount(root, p: { destination?: string }) {
    if (!p.destination) {
      onEach(root, 'to:', (dest) => go('route', { destination: dest }));
      return;
    }
    if (requestedFor !== p.destination) {
      requestedFor = p.destination;
      requestRoute(p.destination);
    }
    on(root, 'refresh', () => requestRoute(p.destination!));
  },
});

// ---------------- Links: browser, YouTube, X, LinkedIn, Discord ----------------
register('links', {
  render() {
    const bm = store.state?.bookmarks ?? [];
    return `${header('links', C.cyan)}
    <main class="scroll">
      <div class="small muted">Opens in this window. Middle-finger tap (back) returns to the shell.</div>
      <div class="list">${bm.map((b, i) => `<button class="item" data-f="b:${i}">${icon('globe', 20, C.cyan)}<span class="y grow">${esc(b.name)}</span><span class="small muted ellipsis">${esc(new URL(b.url).hostname)}</span></button>`).join('')}</div>
    </main>
    ${footer('edit bookmarks in lists.json on the relay')}`;
  },
  mount(root) {
    onEach(root, 'b:', (i) => {
      const b = store.state?.bookmarks[Number(i)];
      if (b) location.href = b.url;
    });
  },
});
