# Deep CDP field test — findings & improvement plan

Run: 106 sites (14 CZ + 62 international ad-heavy + 30 clean references), each
checked **deep** (landing → scroll → open 2 in-domain articles → scroll each)
over CDP against a real browser with the extension installed/enabled. Driver:
`validation/deep-cdp.mjs` (worker-pool + queue). Two passes were merged: a
16-wide pass (fast, but the first wave timed out under contention) and a 6-wide
gap-fill (`--navtimeout=60000`) that recovered the timed-out sites.

**Result: 105/106 loaded, 73 fully clean, 1 persistent nav failure (gnu.org).**

## True extension false-positives (must fix)

Only **4** real FPs, all the same root cause — the Seznam consent flow:

| Site                                            | Symptom                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| novinky.cz, sport.cz, seznamzpravy.cz, super.cz | Opening an article redirects to `cmp.seznam.cz/nastaveni-souhlasu`, which renders **blank** |

Root cause (diagnosed live over CDP):

1. On the landing page the Seznam CMP is an in-page iframe. Our consent handler
   runs **top-frame only**, so it never makes a consent choice — it just hides
   the overlay. With no decision stored, Seznam **hard-redirects article views**
   to the dedicated full-page CMP at `cmp.seznam.cz`.
2. On `cmp.seznam.cz` the wall **is** the whole page. Our handler hid
   `.szn-cmp-dialog-container` → blank white page. (Independently, Seznam's CMP
   also fails to populate its own UI there — its scripts load but render nothing,
   consistent with its own anti-adblock; even un-hidden the dialog is empty.)

**Verified site-side, not our FP:** with the extension **disabled**,
`cmp.seznam.cz` is _still_ blank (text=0, dialog `childElementCount=0`, no
buttons). Seznam's CMP refuses to render its UI in this automated
Chrome-for-Testing profile regardless of our extension — so the blank is the
site's own anti-automation/anti-adblock, not something we cause. On a normal
everyday-Chrome profile the CMP renders and the user makes a one-time choice,
after which articles open.

**Shipped in this PR (defensive):** consent handler now (a) never hides a wall
that would blank the page (`wouldBlankPage`, ≥90% of rendered text + <150 chars
remaining → keep), and (b) won't hide tiny inline links that merely carry a
consent token (`isHideableWall`, e.g. Seznam footer `a.atm-cmp-link`). This
guarantees we never _contribute_ to the blank.

**Not pursued — iframe-reject:** running reject inside the CMP iframe was
considered, but since the CMP renders no UI at all (verified above) there is
nothing to click; it would be dead code.

## Remaining ad gaps (filter-improvement targets)

| Site        | Still-visible ads                                                              | Idea                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| aktualne.cz | `*.imedia.cz` Sklik iframes (300×250/300×300), e.g. `c-oa/c-ko/c-ng.imedia.cz` | Strengthen CZ network-as-hide for `imedia.cz` iframe sources; verify EasyList-CZ coverage                                     |
| super.cz    | first-party `www.super.cz` 300×250 / 300×600 slots                             | Add a super.cz cosmetic rule (current `[class*="ssp-advert"]` misses these — capture the real slot marker)                    |
| vox.com     | `div#div-gpt-ad-*.dfp_ad--held-area` GPT slots reserving space                 | `[id^="div-gpt-ad"]` matches but the **held-area wrapper** keeps its box; hide `.dfp_ad--held-area` / collapse reserved space |

(foxnews `a.more-subsection-link` and weather.com footer link are measurement
noise — tiny nav/footer links, not ads.)

## Consent walls still showing (handler-improvement targets)

| Site                 | CMP                                            | Idea                                                                                        |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| wikihow.com          | Google Funding Choices (`div.fc-consent-root`) | Add FC reject ("Do not consent" / "Manage options")                                         |
| denik.cz             | Didomi (`body.didomi-popup-open`)              | Our Didomi reject didn't fire on landing (self-resolved on articles); revisit selector/text |
| foxnews.com, vox.com | site CMP                                       | Add reject selectors                                                                        |

(techradar/pcgamer "consent" = the Future plc **newsletter** `input#emailInput`,
not a CMP — a newsletter-hide candidate, not consent.)

## Harness notes

- 16-wide overwhelms a single laptop browser → first-wave nav timeouts (mislabeled
  as clean until fixed). 6-wide + 60 s timeout is the sweet spot; 0-page sites are
  now flagged `NAV_ERROR`.
- `CRITICAL_BLANK` (text < 200) over-flags naturally-short/SPA pages
  (example.com=127 chars, openstreetmap=96, archive.org SPA, latimes bot-wall).
  Treat `CRITICAL_BLANK` as a real FP **only** when paired with `CONSENT_REDIRECT`
  or on a known content site; otherwise it's a measurement artifact.

## Zero-FP confirmation

73 sites fully clean, including every developer/reference site (mozilla, github,
stackoverflow, gov.uk, nasa, wikipedia, python, nodejs, debian, postgresql, …)
and most ad-heavy news/recipe/tech sites (idnes, blesk, theguardian, theverge,
tomshardware, healthline, foodnetwork, …). No content removed on any of them.
