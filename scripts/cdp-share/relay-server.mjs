#!/usr/bin/env node
// Relay s GUID + statusem. Cloud session POSTuje požadavky, lokální session je
// zpracuje a hlásí výsledek — obě strany jdou přes HTTP, takže server je JEDINÝ
// zapisovatel stavu (žádný race na souborech). Secret-gated, path-prefix /<secret>.
//
// Stav každého požadavku: pending -> processing -> done | error.
//
// Wire protokol (vše prefixované /<secret>):
//   POST /<secret>/inbox      {text, meta?}                 -> {id, guid, status}   (cloud -> local)
//   GET  /<secret>/inbox?status=pending                      -> [req...]             (local čte frontu)
//   GET  /<secret>/status/<guid>                             -> req | 404            (poll jednoho)
//   GET  /<secret>/outbox?since=<id>                         -> [hotové req s id>since] (cloud čte výsledky)
//   POST /<secret>/result     {guid, status, result?}        -> req                  (local -> hlásí stav)
//   GET  /<secret>/health                                    -> {ok, counts}
//
// Záznam požadavku:
//   {id, guid, ts, text, meta, status, result, updatedAt}
//
// Env (defaulty; secret bez defaultu — brána kanálu):
//   RELAY_PORT (9224), RELAY_SECRET (REQUIRED), RELAY_DIR (<repo>/.cdp-relay)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.RELAY_PORT || 9224);
const SECRET = process.env.RELAY_SECRET;
const DIR = process.env.RELAY_DIR || path.resolve(import.meta.dirname, '..', '..', '.cdp-relay');

if (!SECRET) {
  console.error('[relay] RELAY_SECRET is required (no default — it gates the channel).');
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });
const STORE = path.join(DIR, 'store.json');
const PREFIX = `/${SECRET}`;
const STATUSES = new Set(['pending', 'processing', 'done', 'error']);

// ── jednoduchý JSON store; server je jediný writer, takže stačí read-modify-write ──
function load() {
  if (!existsSync(STORE)) return { seq: 0, requests: [] };
  try {
    return JSON.parse(readFileSync(STORE, 'utf8'));
  } catch {
    return { seq: 0, requests: [] };
  }
}
function save(state) {
  const tmp = STORE + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STORE); // atomický zápis
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy(); // 1MB strop
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!(url.pathname === PREFIX || url.pathname.startsWith(PREFIX + '/'))) {
    return send(res, 403, { error: 'forbidden' });
  }
  const route = url.pathname.slice(PREFIX.length) || '/';
  const now = () => new Date().toISOString();

  // GET /config — bootstrap: vrátí obsah endpoints.local.env pro cloud session.
  // RELAY_BASE poskládá z příchozího Host (veřejný hostname tunelu) + secret;
  // CDP_ENDPOINT vezme z prostředí (relay.sh ho předá z endpoints.local.env).
  if (req.method === 'GET' && route === '/config') {
    const host = req.headers.host || `localhost:${PORT}`;
    const relayBase = `https://${host}${PREFIX}`;
    const cdp = process.env.CDP_ENDPOINT || '';
    const body = `RELAY_BASE='${relayBase}'\nCDP_ENDPOINT='${cdp}'\n`;
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(body) });
    return res.end(body);
  }

  // GET /health
  if (req.method === 'GET' && route === '/health') {
    const s = load();
    const counts = { pending: 0, processing: 0, done: 0, error: 0 };
    for (const r of s.requests) counts[r.status] = (counts[r.status] || 0) + 1;
    return send(res, 200, { ok: true, total: s.requests.length, counts });
  }

  // GET /inbox?status=pending  (lokální strana čte frontu)
  if (req.method === 'GET' && route === '/inbox') {
    const s = load();
    const want = url.searchParams.get('status');
    const since = Number(url.searchParams.get('since') || 0);
    let out = s.requests.filter((r) => r.id > since);
    if (want) out = out.filter((r) => r.status === want);
    return send(res, 200, out);
  }

  // GET /outbox?since=N  (cloud čte hotové výsledky)
  if (req.method === 'GET' && route === '/outbox') {
    const s = load();
    const since = Number(url.searchParams.get('since') || 0);
    const out = s.requests.filter((r) => r.id > since && (r.status === 'done' || r.status === 'error'));
    return send(res, 200, out);
  }

  // GET /status/<guid>  (poll jednoho požadavku)
  if (req.method === 'GET' && route.startsWith('/status/')) {
    const guid = route.slice('/status/'.length);
    const s = load();
    const r = s.requests.find((x) => x.guid === guid);
    return r ? send(res, 200, r) : send(res, 404, { error: 'unknown guid' });
  }

  // POST /inbox  {text, meta?}  (cloud zařadí požadavek)
  if (req.method === 'POST' && route === '/inbox') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    if (!body.text || typeof body.text !== 'string') {
      return send(res, 400, { error: 'text (string) required' });
    }
    const s = load();
    const id = ++s.seq;
    const entry = {
      id,
      guid: randomUUID(),
      ts: now(),
      text: body.text,
      meta: body.meta ?? null,
      status: 'pending',
      result: null,
      updatedAt: now(),
    };
    s.requests.push(entry);
    save(s);
    console.log(`[relay] inbox #${id} ${entry.guid}: ${body.text.slice(0, 70)}`);
    return send(res, 200, { id, guid: entry.guid, status: entry.status });
  }

  // POST /result  {guid, status, result?}  (lokální strana hlásí postup/výsledek)
  if (req.method === 'POST' && route === '/result') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    if (!body.guid || !STATUSES.has(body.status)) {
      return send(res, 400, { error: 'guid + valid status (pending|processing|done|error) required' });
    }
    const s = load();
    const r = s.requests.find((x) => x.guid === body.guid);
    if (!r) return send(res, 404, { error: 'unknown guid' });
    r.status = body.status;
    if ('result' in body) r.result = body.result;
    r.updatedAt = now();
    save(s);
    console.log(`[relay] result ${body.guid} -> ${body.status}`);
    return send(res, 200, r);
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[relay] listening 127.0.0.1:${PORT}, store=${STORE}, gate=/<secret>`);
});
