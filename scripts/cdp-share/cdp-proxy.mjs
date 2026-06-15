#!/usr/bin/env node
// CDP host-rewrite + secret-gate proxy.
//
// Why this exists:
//   1. Chrome's remote-debugging endpoint rejects any request whose Host
//      header is not localhost/127.0.0.1 (anti-DNS-rebinding, since v111).
//      A Cloudflare tunnel rewrites Host to the public hostname -> 403.
//      => we forward upstream with Host: localhost.
//   2. /json* responses advertise webSocketDebuggerUrl as ws://localhost:PORT,
//      which a remote client cannot reach. => we rewrite those to the public
//      host the request arrived on (req.headers.host) + the secret prefix.
//   3. The endpoint is full root over the browser, so we gate every request
//      behind a shared secret carried as the first path segment: /<SECRET>/...
//
// All knobs are env vars with defaults (no hardcoded magic in callers):
//   CDP_UPSTREAM_PORT  Chrome --remote-debugging-port      (default 9222)
//   CDP_PROXY_PORT     port this proxy listens on          (default 9223)
//   CDP_SECRET         shared secret / path prefix         (REQUIRED)
//   CDP_UPSTREAM_HOST  upstream host                       (default 127.0.0.1)
import http from 'node:http';
import net from 'node:net';

const UPSTREAM_HOST = process.env.CDP_UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.CDP_UPSTREAM_PORT || 9222);
const PROXY_PORT = Number(process.env.CDP_PROXY_PORT || 9223);
const SECRET = process.env.CDP_SECRET;

if (!SECRET) {
  console.error('[cdp-proxy] CDP_SECRET is required (no default — it gates browser root access).');
  process.exit(1);
}

const PREFIX = `/${SECRET}`;

// Strip the secret prefix; return upstream path or null if the secret is wrong.
function authPath(url) {
  if (url === PREFIX) return '/';
  if (url.startsWith(PREFIX + '/')) return url.slice(PREFIX.length) || '/';
  if (url.startsWith(PREFIX + '?')) return '/' + url.slice(PREFIX.length);
  return null;
}

// Rewrite ws://localhost:PORT/... advertised by Chrome to wss://<publicHost>/<secret>/...
function rewriteBody(body, publicHost) {
  const reLocal = new RegExp(`ws://(?:localhost|127\\.0\\.0\\.1):${UPSTREAM_PORT}`, 'g');
  return body.replace(reLocal, `wss://${publicHost}${PREFIX}`);
}

const server = http.createServer((req, res) => {
  const upstreamPath = authPath(req.url);
  if (upstreamPath === null) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden\n');
    return;
  }
  const publicHost = req.headers.host || `localhost:${PROXY_PORT}`;
  const headers = { ...req.headers, host: `localhost:${UPSTREAM_PORT}` };

  const proxyReq = http.request(
    { host: UPSTREAM_HOST, port: UPSTREAM_PORT, method: req.method, path: upstreamPath, headers },
    (proxyRes) => {
      const ct = String(proxyRes.headers['content-type'] || '');
      // Buffer & rewrite only JSON discovery responses; stream everything else.
      if (ct.includes('application/json')) {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          const out = rewriteBody(Buffer.concat(chunks).toString('utf8'), publicHost);
          const h = { ...proxyRes.headers };
          delete h['content-length'];
          res.writeHead(proxyRes.statusCode || 200, h);
          res.end(out);
        });
      } else {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    },
  );
  proxyReq.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`upstream error: ${e.message}\n`);
  });
  req.pipe(proxyReq);
});

// Raw WebSocket upgrade passthrough (CDP devtools sockets).
server.on('upgrade', (req, clientSocket, head) => {
  const upstreamPath = authPath(req.url);
  if (upstreamPath === null) {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return;
  }
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST, () => {
    const lines = [
      `GET ${upstreamPath} HTTP/1.1`,
      `Host: localhost:${UPSTREAM_PORT}`,
    ];
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host') continue;
      lines.push(`${k}: ${v}`);
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[cdp-proxy] listening 127.0.0.1:${PROXY_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}, gate=/<secret>`);
});
