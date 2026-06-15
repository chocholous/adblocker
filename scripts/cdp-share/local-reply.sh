#!/usr/bin/env bash
###############################################################################
# local-reply.sh — strana LOKÁLNÍ session: převezmi požadavek a nahlas výsledek.
#
# Životní cyklus, který tahle session dodržuje při on-demand zpracování:
#   1) ./local-reply.sh pending              # co čeká ve frontě
#   2) ./local-reply.sh take  <guid>         # označ jako processing (beru si to)
#   3) … udělej práci (ovládni prohlížeč přes CDP, spusť testy, uprav kód) …
#   4) ./local-reply.sh done  <guid> "<krátký výsledek>"   # nebo:
#      ./local-reply.sh error <guid> "<co se nepovedlo>"
#
# Stav jde přes server (jediný zapisovatel), takže cloud session ho hned vidí
# přes `cloud-client.sh status <guid>` / `wait` / `results`.
###############################################################################
set -euo pipefail

# Endpoint (URL + secret) je tajný → necommituje se. Bere se z env nebo z
# gitignorovaného endpoints.local.env (píše ho relay.sh při startu).
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$DIR/endpoints.local.env" ] && . "$DIR/endpoints.local.env"
RELAY_BASE="${RELAY_BASE:-}"
[ -n "$RELAY_BASE" ] || { echo "RELAY_BASE není nastaven (spusť relay.sh, nebo exportuj RELAY_BASE)." >&2; exit 2; }

# Lokální session běží na stejném stroji jako relay → mluv napřímo přes localhost
# (rychlejší a nezávislé na DNS/propagaci tunelu). Secret = poslední segment URL.
SECRET="${RELAY_BASE##*/}"
RELAY_BASE="http://127.0.0.1:${RELAY_PORT:-9224}/${SECRET}"

post_result() { # guid status [result]
  python3 -c 'import json,sys; print(json.dumps({"guid":sys.argv[1],"status":sys.argv[2],**({"result":sys.argv[3]} if len(sys.argv)>3 else {})}))' "$@" \
    | curl -fsS -X POST "$RELAY_BASE/result" -H 'content-type: application/json' -d @-
  echo
}

cmd="${1:-pending}"; shift || true
case "$cmd" in
  pending)  curl -fsS "$RELAY_BASE/inbox?status=pending"; echo ;;
  take)     post_result "${1:?guid}" processing ;;
  done)     post_result "${1:?guid}" done "${2:-ok}" ;;
  error)    post_result "${1:?guid}" error "${2:-failed}" ;;
  *) echo "Použití: $0 {pending|take <guid>|done <guid> \"<výsledek>\"|error <guid> \"<msg>\"}" >&2; exit 1 ;;
esac
