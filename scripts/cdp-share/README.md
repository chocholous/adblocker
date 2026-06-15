# Shared-CDP test harness

Launches Chrome with the freshly built **unpacked** extension (`.output/chrome-mv3`),
exposes its CDP endpoint through a host-rewriting / secret-gated proxy, and tunnels
it via a Cloudflare **quick tunnel** so a remote (cloud) session can drive the same
browser. A file watcher rebuilds and reloads the extension on source changes.

## Run (local host)

```bash
./scripts/cdp-share/start.sh
```

Prints a public endpoint like:

```
https://<random>.trycloudflare.com/<secret>
```

`Ctrl-C` tears down Chrome, the proxy, and the tunnel.

### Knobs (env vars, all optional)

| var                 | default                       | meaning                          |
| ------------------- | ----------------------------- | -------------------------------- |
| `CDP_UPSTREAM_PORT` | `9222`                        | Chrome `--remote-debugging-port` |
| `CDP_PROXY_PORT`    | `9223`                        | local proxy port                 |
| `CDP_SECRET`        | auto (`openssl rand -hex 16`) | shared secret = URL path gate    |
| `CHROME_BIN`        | macOS Google Chrome           | Chrome binary                    |

> The public URL **and** the secret change on every restart (quick tunnel is
> ephemeral). Re-share the printed endpoint with the cloud session each time, or
> pin `CDP_SECRET=…` to keep the secret stable across restarts.

## Connect (cloud session)

```js
import { chromium } from 'playwright';

const ENDPOINT = process.env.CDP_ENDPOINT; // the printed https://…/secret URL
const browser = await chromium.connectOverCDP(ENDPOINT);
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());

await page.goto('https://example.com');
// drive the page; the Stealth Content Hider extension is already loaded.
```

Python:

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(ENDPOINT)
    page = browser.contexts[0].pages[0]
```

## How it stays secure-ish

- Every request must carry the secret as its **first path segment** (`/<secret>/…`);
  anything else → `403`. CDP is full root over the browser, so do not leak the URL.
- The proxy forwards upstream with `Host: localhost`, satisfying Chrome's
  anti-DNS-rebinding check (which would otherwise `403` tunneled requests).
- Chrome runs with `--remote-allow-origins='*'` so the CDP WebSocket accepts the
  tunneled origin.

## Relay channel (cloud session -> local session)

A separate bridge so the **cloud session sends prompts/requests to this local
session**, and reads results back.

```bash
./scripts/cdp-share/relay.sh
```

Prints a base URL `https://<random>.trycloudflare.com/<secret>`. Wire protocol:

Every request gets a **GUID** and an explicit **status**: `pending → processing →
done | error`. The relay server is the single writer of `.cdp-relay/store.json`,
so both sides go over HTTP (no file races).

| call                                              | direction       | meaning                                           |
| ------------------------------------------------- | --------------- | ------------------------------------------------- |
| `POST /<secret>/inbox` body `{text, meta?}`       | cloud -> local  | queue, returns `{id, guid, status}`               |
| `GET  /<secret>/inbox?status=pending`             | local read      | list the queue (optional filter)                  |
| `GET  /<secret>/status/<guid>`                    | both            | poll one request                                  |
| `GET  /<secret>/outbox?since=N`                   | local -> cloud  | finished results (`done`/`error`)                 |
| `POST /<secret>/result` `{guid, status, result?}` | local -> cloud  | report progress / result                          |
| `GET  /<secret>/config`                           | cloud bootstrap | env file (`RELAY_BASE`+`CDP_ENDPOINT`) for `init` |
| `GET  /<secret>/health`                           | —               | counts by status                                  |

### Cloud session — one-call bootstrap, then drive

The local host prints a **bootstrap URL** (the relay base, secret included) when
`relay.sh` starts. In the cloud session, run `init` once with that URL — it pulls
`/config` and writes both endpoints into a local (gitignored) `endpoints.local.env`,
so every later call is configured automatically:

```bash
# 1) one-time, with the URL the local host gave you (token is in the URL):
./scripts/cdp-share/cloud-client.sh init 'https://<rand>.trycloudflare.com/<secret>'

# 2) from now on it just works — no exports, no editing:
./scripts/cdp-share/cloud-client.sh ask "run e2e and report failures"    # send + wait for done
./scripts/cdp-share/cloud-client.sh send "open seznam.cz and screenshot" # returns {id,guid,status}
./scripts/cdp-share/cloud-client.sh status <guid>                        # poll one
./scripts/cdp-share/cloud-client.sh results                              # all finished
```

`init` fetches `GET /<secret>/config`, which returns the env file contents
(`RELAY_BASE` rebuilt from the request host, `CDP_ENDPOINT` from the relay's
environment). Re-run `init` with the new URL after any harness restart.

### Local session — use `local-reply.sh`

```bash
./scripts/cdp-share/local-reply.sh pending            # see the queue
./scripts/cdp-share/local-reply.sh take  <guid>       # mark processing
# … do the work (drive browser over local CDP :9222, run tests, edit code) …
./scripts/cdp-share/local-reply.sh done  <guid> "short result"   # or: error <guid> "msg"
```

> Autonomous polling (`/loop`) is blocked by the harness safety classifier because
> it would execute arbitrary public-tunnel input. Process on-demand with
> `local-reply.sh`, or (if you accept the risk) run `/loop` yourself from an
> interactive terminal, or switch to a typed/whitelisted request schema.

## Files

- `start.sh` — orchestrates build → Chrome → proxy → tunnel → watcher.
- `cdp-proxy.mjs` — host-rewrite + secret gate + `webSocketDebuggerUrl` rewrite (stdlib only).
- `watch.mjs` — rebuild on change, reload the extension over CDP (Node 22 global `WebSocket`).
- `relay.sh` — relay server + its own quick tunnel (cloud→local request channel).
- `relay-server.mjs` — GUID/status store bridge, secret-gated, single writer (stdlib only).
- `cloud-client.sh` — cloud-side CLI (send/status/wait/ask/results).
- `local-reply.sh` — local-side CLI (pending/take/done/error).
