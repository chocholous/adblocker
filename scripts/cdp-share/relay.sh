#!/usr/bin/env bash
# Inbox/outbox relay for cloud-session -> local-session requests.
# Runs the relay server + its own Cloudflare quick tunnel and prints the endpoint
# the cloud session POSTs to. Independent of the CDP harness (start.sh).
#
# Env (defaults; secret auto-generated unless pinned):
#   RELAY_PORT    listen port           (default 9224)
#   RELAY_SECRET  shared secret / gate  (auto: openssl rand -hex 16)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

RELAY_PORT="${RELAY_PORT:-9224}"
RELAY_SECRET="${RELAY_SECRET:-$(openssl rand -hex 16)}"
LOG_DIR="$ROOT/.cdp-logs"
mkdir -p "$LOG_DIR" "$ROOT/.cdp-relay"

# Načti CDP_ENDPOINT (zapsaný start.sh), aby ho server mohl vrátit přes /config.
ENVFILE="$ROOT/scripts/cdp-share/endpoints.local.env"
[ -f "$ENVFILE" ] && . "$ENVFILE"
export RELAY_PORT RELAY_SECRET CDP_ENDPOINT

PIDS=()
cleanup() {
  echo; echo "==> Relay shutting down…"
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Starting relay server (:$RELAY_PORT)"
node "$ROOT/scripts/cdp-share/relay-server.mjs" >"$LOG_DIR/relay.log" 2>&1 &
PIDS+=("$!")
sleep 0.5

echo "==> Starting Cloudflare quick tunnel for relay"
cloudflared tunnel --url "http://localhost:$RELAY_PORT" >"$LOG_DIR/relay-tunnel.log" 2>&1 &
PIDS+=("$!")

PUBLIC=""
for i in $(seq 1 60); do
  PUBLIC="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/relay-tunnel.log" | head -1 || true)"
  [ -n "$PUBLIC" ] && break
  sleep 0.5
done

BASE="${PUBLIC}/${RELAY_SECRET}"

# Zapiš endpoint do gitignorovaného souboru, ze kterého ho čtou cloud-client.sh
# i local-reply.sh (upsert — zachovej případný CDP_ENDPOINT z start.sh).
ENVFILE="$ROOT/scripts/cdp-share/endpoints.local.env"
if [ -n "$PUBLIC" ]; then
  touch "$ENVFILE"
  grep -v '^RELAY_BASE=' "$ENVFILE" 2>/dev/null > "$ENVFILE.tmp" || true
  printf "RELAY_BASE='%s'\n" "$BASE" >> "$ENVFILE.tmp"
  mv "$ENVFILE.tmp" "$ENVFILE"
fi
echo
echo "============================================================"
if [ -n "$PUBLIC" ]; then
  echo "  Relay is LIVE"
  echo "  Base (cloud session) : $BASE"
  echo "  POST request : curl -X POST $BASE/inbox -d '{\"text\":\"…\"}'"
  echo "  GET results  : curl $BASE/outbox?since=0"
else
  echo "  Tunnel URL not detected — check $LOG_DIR/relay-tunnel.log"
  echo "  Secret : $RELAY_SECRET (port $RELAY_PORT)"
fi
echo "  Local data : $ROOT/.cdp-relay/{inbox,outbox}.jsonl"
echo "============================================================"
echo "  Ctrl-C to stop."
wait
