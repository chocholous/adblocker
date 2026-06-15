#!/usr/bin/env node
// Watch sources -> `wxt build` -> reload the unpacked extension over CDP.
// Uses Node 22's global WebSocket, so no extra dependency.
//
// Env:
//   CDP_ENDPOINT  local Chrome CDP base (default http://127.0.0.1:9222)
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const WATCH_DIRS = ['entrypoints', 'lib', 'public'].filter((d) => existsSync(path.join(ROOT, d)));

let building = false;
let queued = false;

function build() {
  if (building) { queued = true; return; }
  building = true;
  const t0 = Date.now();
  const p = spawn('npm', ['run', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  p.on('exit', async (code) => {
    building = false;
    if (code === 0) {
      console.log(`[watch] rebuilt in ${Date.now() - t0}ms`);
      await reloadExtension();
    } else {
      console.error(`[watch] build failed (exit ${code})`);
    }
    if (queued) { queued = false; build(); }
  });
}

async function reloadExtension() {
  try {
    const res = await fetch(`${CDP}/json`);
    const targets = await res.json();
    const sw = targets.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
    if (!sw?.webSocketDebuggerUrl) {
      console.log('[watch] extension service worker dormant — reload the page to pick up changes');
      return;
    }
    await cdpEval(sw.webSocketDebuggerUrl, 'chrome.runtime.reload()');
    console.log('[watch] extension reloaded');
  } catch (e) {
    console.log(`[watch] reload skipped: ${e.message}`);
  }
}

function cdpEval(wsUrl, expression) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const done = () => { try { ws.close(); } catch {} resolve(); };
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }));
      // reload() tears down the SW; the socket drops before any reply. Don't wait.
      setTimeout(done, 300);
    });
    ws.addEventListener('error', done);
  });
}

let debounce;
for (const dir of WATCH_DIRS) {
  watch(path.join(ROOT, dir), { recursive: true }, () => {
    clearTimeout(debounce);
    debounce = setTimeout(build, 150);
  });
}
console.log(`[watch] watching ${WATCH_DIRS.join(', ')} — edits rebuild & reload the extension`);
