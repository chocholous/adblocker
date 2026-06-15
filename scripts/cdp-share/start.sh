#!/usr/bin/env bash
# Shared-CDP test harness:
#   wxt build -> launch Chrome (CDP + unpacked extension) -> host-rewrite/secret
#   proxy -> Cloudflare quick tunnel. Prints the endpoint the cloud session uses.
#
# Env knobs (all have defaults except the secret, which is auto-generated):
#   CDP_UPSTREAM_PORT  Chrome remote-debugging port   (default 9222)
#   CDP_PROXY_PORT     local proxy port               (default 9223)
#   CDP_SECRET         shared secret / path gate       (auto-generated if unset)
#   CHROME_BIN         Chrome binary path             (default: macOS Google Chrome)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

CDP_UPSTREAM_PORT="${CDP_UPSTREAM_PORT:-9222}"
CDP_PROXY_PORT="${CDP_PROXY_PORT:-9223}"
CDP_SECRET="${CDP_SECRET:-$(openssl rand -hex 16)}"
CHROME_BIN="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
EXT_DIR="$ROOT/.output/chrome-mv3"
PROFILE_DIR="$ROOT/.cdp-profile"
LOG_DIR="$ROOT/.cdp-logs"
mkdir -p "$LOG_DIR"

export CDP_UPSTREAM_PORT CDP_PROXY_PORT CDP_SECRET

echo "==> Building extension (wxt build)"
npm run build >/dev/null

PIDS=()
cleanup() {
  echo; echo "==> Shutting down…"
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Launching Chrome (CDP :$CDP_UPSTREAM_PORT, unpacked extension)"
"$CHROME_BIN" \
  --remote-debugging-port="$CDP_UPSTREAM_PORT" \
  --remote-allow-origins='*' \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$EXT_DIR" \
  --disable-extensions-except="$EXT_DIR" \
  --no-first-run --no-default-browser-check \
  --disable-features=DialMediaRouteProvider \
  about:blank >"$LOG_DIR/chrome.log" 2>&1 &
PIDS+=("$!")

# Wait for Chrome's CDP to answer before exposing it.
echo "==> Waiting for CDP…"
for i in $(seq 1 50); do
  if curl -fsS "http://127.0.0.1:$CDP_UPSTREAM_PORT/json/version" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

echo "==> Starting host-rewrite/secret proxy (:$CDP_PROXY_PORT)"
node "$ROOT/scripts/cdp-share/cdp-proxy.mjs" >"$LOG_DIR/proxy.log" 2>&1 &
PIDS+=("$!")
sleep 0.5

echo "==> Starting Cloudflare quick tunnel"
cloudflared tunnel --url "http://localhost:$CDP_PROXY_PORT" >"$LOG_DIR/tunnel.log" 2>&1 &
PIDS+=("$!")

# Poll the tunnel log for the public hostname.
PUBLIC=""
for i in $(seq 1 60); do
  PUBLIC="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 || true)"
  [ -n "$PUBLIC" ] && break
  sleep 0.5
done

ENDPOINT="${PUBLIC}/${CDP_SECRET}"

# Zapiš endpoint do gitignorovaného souboru pro klienty (upsert — zachovej RELAY_BASE).
ENVFILE="$ROOT/scripts/cdp-share/endpoints.local.env"
if [ -n "$PUBLIC" ]; then
  touch "$ENVFILE"
  grep -v '^CDP_ENDPOINT=' "$ENVFILE" 2>/dev/null > "$ENVFILE.tmp" || true
  printf "CDP_ENDPOINT='%s'\n" "$ENDPOINT" >> "$ENVFILE.tmp"
  mv "$ENVFILE.tmp" "$ENVFILE"
fi
echo
echo "============================================================"
if [ -n "$PUBLIC" ]; then
  echo "  Shared CDP is LIVE"
  echo "  Public endpoint : $ENDPOINT"
else
  echo "  Tunnel URL not detected yet — check $LOG_DIR/tunnel.log"
  echo "  Secret          : $CDP_SECRET   (port $CDP_PROXY_PORT)"
fi
echo "  Local CDP       : http://127.0.0.1:$CDP_UPSTREAM_PORT (no secret, this host only)"
echo "  Cloud session connects with:"
echo "    chromium.connectOverCDP('$ENDPOINT')"
echo "============================================================"
echo "  Ctrl-C to tear everything down."
echo

# Hand off to the rebuild/reload watcher; it keeps the process alive.
CDP_ENDPOINT="http://127.0.0.1:$CDP_UPSTREAM_PORT" \
  node "$ROOT/scripts/cdp-share/watch.mjs" || wait
