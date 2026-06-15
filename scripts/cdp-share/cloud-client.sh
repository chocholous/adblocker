#!/usr/bin/env bash
###############################################################################
# cloud-client.sh — průvodce pro CLOUD session (jak řídit lokální harness)
#
# Lokální stroj vystavuje přes Cloudflare tunely DVA kanály:
#
#   1) SHARED CDP  — reálný Chrome s nahraným adblock pluginem (.output/chrome-mv3).
#      Cloud session ho ovládá přes Playwright `connectOverCDP(<CDP_ENDPOINT>)`.
#      = otevírání stránek, testování kosmetického skrývání, screenshoty…
#
#   2) RELAY       — inbox/outbox kanál. Cloud session POSTne textový požadavek
#      do inboxu; lokální session ho zpracuje a výsledek zapíše do outboxu,
#      který si cloud GETne. = "pošli lokální session úkol a vyzvedni výsledek".
#
# Oba endpointy jsou EFEMÉRNÍ (Cloudflare quick tunnel) — po každém restartu
# start.sh / relay.sh se URL i secret změní. Po restartu přepiš CONFIG níže.
###############################################################################

set -euo pipefail

# ── CONFIG ───────────────────────────────────────────────────────────────────
# Endpointy (URL + secret) jsou EFEMÉRNÍ a TAJNÉ → nikdy se necommitují.
# Zdroje (v tomto pořadí priority):
#   1) proměnné prostředí RELAY_BASE / CDP_ENDPOINT
#   2) gitignorovaný soubor endpoints.local.env (lokálně ho píší start.sh/relay.sh)
# Na CLOUD session (jiný stroj) prostě exportuj hodnoty, které ti vypsaly skripty:
#   export RELAY_BASE='https://<rand>.trycloudflare.com/<secret>'
#   export CDP_ENDPOINT='https://<rand>.trycloudflare.com/<secret>'
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$DIR/endpoints.local.env" ] && . "$DIR/endpoints.local.env"
RELAY_BASE="${RELAY_BASE:-}"
CDP_ENDPOINT="${CDP_ENDPOINT:-}"
# ─────────────────────────────────────────────────────────────────────────────

require_relay() { [ -n "$RELAY_BASE" ] || { echo "RELAY_BASE není nastaven — exportuj ho (viz hlavička skriptu)." >&2; exit 2; }; }
require_cdp()   { [ -n "$CDP_ENDPOINT" ] || { echo "CDP_ENDPOINT není nastaven — exportuj ho (viz hlavička skriptu)." >&2; exit 2; }; }

usage() {
  cat <<EOF
Použití: ./cloud-client.sh <příkaz> [argumenty]

  init <bootstrap-url> Jednorázový bootstrap: stáhne config a zapíše endpoints.local.env.
                       <bootstrap-url> = celá relay base i s tokenem (vč. /secret).
  send "<text>"        Pošle požadavek do inboxu. Vrátí {id, guid, status:pending}.
  status <guid>        Vypíše aktuální stav požadavku (pending|processing|done|error).
  wait <guid>          Pollne stav, dokud není done/error; pak vypíše celý záznam.
  ask "<text>"         send + wait: pošle úkol, počká na done/error a vrátí výsledek.
  results [since]      Vypíše hotové výsledky (outbox) s id > since (default 0).
  inbox [status]       Vypíše požadavky; volitelně filtr (pending|processing|done|error).
  health               Přehled počtů podle stavu.
  cdp                  Ověří shared CDP (verze Chrome + ws endpoint).

Stavy požadavku:  pending → processing → done | error
Endpointy (z CONFIG nahoře / prostředí):
  RELAY_BASE   = $RELAY_BASE
  CDP_ENDPOINT = $CDP_ENDPOINT
EOF
}

# Vytáhne hodnotu "guid" z JSON odpovědi (bez závislosti na jq).
json_guid() { grep -Eo '"guid":"[^"]+"' | head -1 | sed 's/.*:"//; s/"//'; }

cmd="${1:-help}"; shift || true
# Endpoint je potřeba pro vše kromě nápovědy a initu (ten ho teprve nastaví).
case "$cmd" in
  init|cdp|help|--help|-h) ;;
  *) require_relay ;;
esac
case "$cmd" in
  init)
    # Jeden call s tokenem → stáhne config z relaye a zapíše ho do env souboru.
    boot="${1:?chybí bootstrap-url (relay base i s /secret)}"
    boot="${boot%/}"                       # ořízni případné koncové /
    out="$DIR/endpoints.local.env"
    curl -fsS "$boot/config" -o "$out"
    echo "Zapsáno do $out:"; cat "$out"
    echo "Hotovo — teď můžeš: ./cloud-client.sh ask \"…\""
    ;;

  send)
    # POST {"text": "..."} → server přidělí guid a status=pending.
    text="${1:?chybí text požadavku}"
    payload=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$text")
    curl -fsS -X POST "$RELAY_BASE/inbox" -H 'content-type: application/json' -d "$payload"
    echo
    ;;

  status)
    guid="${1:?chybí guid}"
    curl -fsS "$RELAY_BASE/status/$guid"; echo
    ;;

  results)
    since="${1:-0}"
    curl -fsS "$RELAY_BASE/outbox?since=$since"; echo
    ;;

  inbox)
    # Volitelný filtr stavu: ./cloud-client.sh inbox pending
    if [ -n "${1:-}" ]; then curl -fsS "$RELAY_BASE/inbox?status=$1"; else curl -fsS "$RELAY_BASE/inbox"; fi
    echo
    ;;

  health)
    curl -fsS "$RELAY_BASE/health"; echo
    ;;

  wait)
    # Pollni /status/<guid>, dokud stav není terminální (done|error).
    guid="${1:?chybí guid}"
    echo "Čekám na dokončení $guid…" >&2
    for i in $(seq 1 120); do            # ~10 min při 5s intervalu
      rec=$(curl -fsS "$RELAY_BASE/status/$guid")
      st=$(printf '%s' "$rec" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")
      case "$st" in
        done|error) echo "$rec"; exit 0 ;;
        "")         echo "Neznámý guid: $guid" >&2; exit 1 ;;
      esac
      sleep 5
    done
    echo "Timeout — $guid není hotový." >&2; exit 1
    ;;

  ask)
    # Pošli úkol a rovnou počkej na jeho dokončení.
    text="${1:?chybí text požadavku}"
    payload=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$text")
    guid=$(curl -fsS -X POST "$RELAY_BASE/inbox" -H 'content-type: application/json' -d "$payload" | json_guid)
    echo "Odesláno jako $guid, čekám na dokončení…" >&2
    exec "$0" wait "$guid"
    ;;

  cdp)
    # Ověření shared CDP. Pro reálné ovládání použij Playwright (viz níže).
    curl -fsS "$CDP_ENDPOINT/json/version"; echo
    cat <<'EOF'

# Ovládání prohlížeče z cloud session (Playwright):
#   const { chromium } = require('playwright');
#   const b = await chromium.connectOverCDP(process.env.CDP_ENDPOINT);
#   const ctx = b.contexts()[0];
#   const page = ctx.pages()[0] ?? await ctx.newPage();
#   await page.goto('https://example.com');   // plugin je už nahraný
EOF
    ;;

  help|--help|-h) usage ;;
  *) echo "Neznámý příkaz: $cmd" >&2; usage; exit 1 ;;
esac
