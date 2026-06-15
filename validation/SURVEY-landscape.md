# Landscape survey — what CMPs / ad-tech are actually out there

Run: `deep-cdp.mjs --set=all --fresh=60` over a real browser (58 sites returned
data). This is the evidence base for choosing **vendor-level** rules over
overfitting to a handful of sites. Re-run any time with the same command — the
`vendors` block in the report aggregates the distribution.

## CMP vendors (share of sites)

| Vendor      | Share | Reject by clicking?                                    |
| ----------- | ----- | ------------------------------------------------------ |
| OneTrust    | 26%   | yes — handled                                          |
| Didomi      | 16%   | yes — handled                                          |
| tcf_generic | 16%   | an IAB TCF CMP we didn't name (investigate top ones)   |
| Sourcepoint | 12%   | usually; the German Springer **pay-walls** lack reject |
| Google FC   | 9%    | yes — handled                                          |
| Quantcast   | 7%    | yes — handled                                          |
| TrustArc    | 2%    | yes — handled                                          |

## Ad-tech platforms (share of sites)

adsense **100%** · gpt **69%** · prebid **43%** · amazon_aps 17% · criteo 14% ·
taboola 14% · outbrain 5%

## Decisions this drove

- **Pay-or-Consent accept is a niche** — only a fraction of the 12% Sourcepoint
  sites (the Springer pay-walls). It can't be dismissed by clicking (proven on
  bild: synthetic + native clicks no-op) and isn't verifiable in our automation
  profile (the CMP detects automation, like Seznam). So the accept feature was
  **dropped**; we kept only the general in-iframe **reject** path.
- **The high-coverage consent lever is OneTrust (26%) + Didomi (16%)** — both
  respond to our existing DOM reject. If we ever need more robustness, the
  data-justified next step is **MAIN-world vendor-API reject**
  (`OneTrust.RejectAll()`, `Didomi.setUserDisagreeToAll()`,
  `UC_UI.denyAllConsents()`), not Sourcepoint accept.
- **Ad coverage is dominated by Google** (AdSense 100%, GPT 69%) + header-bidding
  (Prebid 43%) — all covered by the network filter lists + our GPT/AdSense
  hideSelectors. `tcf_generic` (16%) is worth resolving to name the unhandled
  CMPs.
