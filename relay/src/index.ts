import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import QRCode from 'qrcode';
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts';
import { config } from './config.ts';
import { hub, state } from './hub.ts';
import {
  answerQuestion, askAll, allSessions, decideApproval, interruptSession, restoreSessions, scanRepos,
  openSessionOnDesk, sendToSession, startSession, stopSession,
} from './sessions.ts';
import { statusReport } from './status.ts';
import { cleanDictation } from './dictation.ts';
import { demoHandle, startDemo } from './demo.ts';
import { installLink } from '../scripts/links.ts';
import { handleHook, seedExternal } from './external.ts';
import { notePid, startDeskWatch } from './desk.ts';
import { codes, totpEnabled, tryUnlock, vaultNow, type TotpAccount } from './totp.ts';

// ---------- auth ----------
function tokenOk(t: string | null | undefined): boolean {
  if (!t) return false;
  const a = Buffer.from(t);
  const b = Buffer.from(config.token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- static files (the built glasses app) ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

function serveStatic(urlPath: string, res: http.ServerResponse) {
  const root = config.glassesDist;
  let file = path.join(root, path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  if (!fs.existsSync(file)) {
    return res
      .writeHead(503, { 'content-type': 'text/plain' })
      .end('Glasses app not built yet. Run `npm run build` in the project root.');
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const k = url.searchParams.get('k') ?? req.headers['x-shell-token']?.toString();
  try {
    if (url.pathname === '/healthz') return res.writeHead(200).end('ok');

    // Claude Code hooks from every other session on this machine (see relay/src/external.ts).
    if (url.pathname === '/hooks' && req.method === 'POST') {
      if (!tokenOk(k)) return res.writeHead(401).end();
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > 2 * 1024 * 1024) return res.writeHead(413).end();
        chunks.push(c as Buffer);
      }
      let body: any = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return res.writeHead(400).end('{}');
      }
      notePid(String(body?.session_id ?? ''), Number(req.headers['x-claude-pid']));
      const out = config.demo ? {} : await handleHook(body);
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    }

    // For the menu bar app: a small status summary (token required, no secrets in it).
    if (url.pathname === '/status.json') {
      if (!tokenOk(k)) return res.writeHead(401).end();
      const asks = new Set([...state.approvals, ...state.questions].map((a) => a.sessionId));
      const body = {
        ok: true,
        demo: config.demo,
        publicUrl: config.publicUrl,
        lens: hub.connected,
        sessions: state.sessions.length,
        working: state.sessions.filter((s) => s.status === 'running' || s.status === 'starting').length,
        needsYou: state.sessions.filter((s) => asks.has(s.id) || s.status === 'waiting').length,
        approvals: state.settings.approvals,
        totp: state.integrations.totp,
        groq: state.integrations.groq,
      };
      return res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
    }

    if (url.pathname === '/install') {
      if (!tokenOk(k)) return res.writeHead(401).end('Add ?k=<SHELL_TOKEN>');
      const link = installLink(config.publicUrl || `https://${req.headers.host}`, config.token);
      const qr = await QRCode.toDataURL(link, { margin: 2, width: 360 });
      return res.writeHead(200, { 'content-type': 'text/html' }).end(installPage(link, qr));
    }

    if (url.pathname.startsWith('/api/')) return res.writeHead(404).end();
    serveStatic(url.pathname, res);
  } catch (e) {
    console.error('[http]', e);
    if (!res.headersSent) res.writeHead(500).end('error');
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname !== '/ws' || !tokenOk(url.searchParams.get('k'))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// 2FA unlock is per connection, never shared state.
const unlocked = new WeakMap<WebSocket, number>();
const demoVault: TotpAccount[] = [
  { id: 'd1', issuer: 'GitHub', account: 'me', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 },
  { id: 'd2', issuer: 'Discord', account: 'me', secret: 'KRSXG5CTMVRXEZLU', algorithm: 'SHA1', digits: 6, period: 30 },
  { id: 'd3', issuer: 'AWS', account: 'root', secret: 'GEZDGNBVGY3TQOJQ', algorithm: 'SHA1', digits: 6, period: 30 },
];

wss.on('connection', (ws: WebSocket) => {
  hub.add(ws);
  const alive = { ok: true };
  ws.on('pong', () => (alive.ok = true));
  const ping = setInterval(() => {
    if (!alive.ok) return ws.terminate();
    alive.ok = false;
    ws.ping();
  }, 25_000);
  ws.on('close', () => {
    clearInterval(ping);
    hub.remove(ws);
  });
  ws.on('message', async (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      await handle(ws, msg);
    } catch (e) {
      reply(ws, { t: 'error', text: (e as Error).message.slice(0, 200) });
    }
  });
});

function reply(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

async function handle(ws: WebSocket, msg: ClientMsg) {
  // Messages every mode handles the same way.
  switch (msg.t) {
    case 'status.check':
      return reply(ws, { t: 'status.report', report: await statusReport(config.demo ? state.sessions : allSessions()) });
    case 'totp.unlock': {
      if (!config.demo && !totpEnabled()) return reply(ws, { t: 'totp.locked', reason: '2FA not set up (docs/TWO_FACTOR.md)' });
      const r = config.demo
        ? msg.seq.join(' ') === 'up up down down' ? { ok: true as const } : { ok: false as const, reason: 'demo pattern: up up down down' }
        : tryUnlock(msg.seq);
      if (!r.ok) return reply(ws, { t: 'totp.locked', reason: r.reason, triesLeft: 'triesLeft' in r ? r.triesLeft : undefined });
      unlocked.set(ws, Date.now() + 60_000);
      console.log('[2fa] unlocked for 60 s');
    }
    // falls through: send the codes right away
    case 'totp.list': {
      const until = unlocked.get(ws) ?? 0;
      if (Date.now() > until) return reply(ws, { t: 'totp.locked' });
      let accounts: TotpAccount[];
      try {
        accounts = config.demo ? demoVault : vaultNow();
      } catch (e) {
        return reply(ws, { t: 'totp.locked', reason: `vault: ${(e as Error).message}` });
      }
      return reply(ws, { t: 'totp.codes', codes: codes(accounts), unlockedUntil: until });
    }
    case 'totp.lock':
      unlocked.delete(ws);
      return reply(ws, { t: 'totp.locked' });
    case 'dictation.clean':
      return reply(ws, {
        t: 'dictation.cleaned',
        reqId: msg.reqId,
        text: state.settings.dictationCleanup ? await cleanDictation(msg.text, msg.context) : msg.text,
      });
    case 'settings.set':
      Object.assign(state.settings, msg.patch);
      hub.saveSettings();
      return hub.changed();
    case 'rules.clear':
      state.settings.learnedRules = [];
      hub.saveSettings();
      return hub.changed();
    case 'refresh':
      if (!config.demo) {
        state.repos = scanRepos();
        await seedExternal();
      }
      return hub.changed();
  }

  if (config.demo) {
    demoHandle(msg);
    return;
  }

  switch (msg.t) {
    case 'session.start':
      if (!config.claudeAvailable) throw new Error('Claude is not configured on the relay (see relay/.env)');
      await startSession(msg.repo, msg.prompt, msg.name);
      return;
    case 'session.send':
      return sendToSession(msg.id, msg.text);
    case 'session.stop':
      return stopSession(msg.id);
    case 'session.openDesk':
      return reply(ws, { t: 'notify', text: await openSessionOnDesk(msg.id), level: 'good' });
    case 'session.interrupt':
      return interruptSession(msg.id);
    case 'approval.decide':
      return decideApproval(msg.id, msg.decision);
    case 'question.answer':
      return answerQuestion(msg.id, msg.answers);
    case 'ask':
      return askAll(msg.target, msg.text);
  }
}

function installPage(link: string, qr: string) {
  return `<!doctype html><meta name=viewport content="width=device-width"><title>Install ClaudeProd</title>
<body style="background:#272822;color:#F8F8F2;font:16px ui-monospace,monospace;padding:24px;max-width:520px">
<h2 style="color:#FF6188">Install Claude Productivity For Meta Display</h2>
<p>Scan with your phone's camera. The Meta AI app opens and asks to add the app to your glasses.</p>
<img src="${qr}" width=320 height=320 style="background:#fff;padding:8px;border-radius:8px">
<p>On the phone itself? <a style="color:#66D9EF" href="${link}">Tap here instead</a>.</p>
<p style="color:#A39E87">The link carries your relay token. Don't share this page or the QR code.</p></body>`;
}

// ---------- start ----------
server.listen(config.port, () => {
  console.log(`\n[relay] listening on http://localhost:${config.port}${config.demo ? '  (DEMO mode)' : ''}`);
  console.log(`[relay] glasses app: ${config.glassesDist}`);
  console.log(`[relay] install page: ${config.publicUrl || 'http://localhost:' + config.port}/install?k=<SHELL_TOKEN>\n`);
});

if (config.demo) {
  startDemo();
} else {
  restoreSessions();
  seedExternal();
  startDeskWatch();
  setInterval(seedExternal, 2 * 60_000);
  state.integrations.totp = totpEnabled();
  setInterval(() => {
    state.repos = scanRepos();
    state.integrations.totp = totpEnabled(); // lights up after `npm run 2fa:import`, no restart
    hub.changed();
  }, 60_000);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log('[relay] shutting down');
    server.close();
    process.exit(0);
  });
}
