# Overfit audit — are our hand-written rules site-specific?

Concern: are we tuning to our ~108-site corpus instead of the real web? This
audit classifies every rule we ship **by hand** (the filter ENGINE built from
EasyList/EasyPrivacy/uBO/AdGuard/EasyList-CZ/Peter-Lowe's is the web-scale layer
and is out of scope — it's the opposite of overfitting).

Classification:

- **generic** — a convention used across the web (e.g. `ins.adsbygoogle`)
- **vendor** — targets an ad/CMP _platform_ → covers every site using it
- **network** — a multi-site publisher network (broader than one site)
- **site** — a single site's bespoke markup (the only true overfit)

## `DEFAULT_SETTINGS.hideSelectors`

| Selector(s)                                                                                                                                                                                 | Class   | Covers                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------- |
| `[data-ad]`, `[id*="sponsored"]`, `[class*="sponsored"]`, `[aria-label="advertisement"]`                                                                                                    | generic | web-wide convention                                |
| `[class~="ads"]`, `[class*="ad-slot"]`, `[class*="ad-unit"]`, `[class*="ad-container"]`                                                                                                     | generic | web-wide convention                                |
| `[id^="div-gpt-ad"]`, `iframe[id^="google_ads_iframe"]`, `[data-google-query-id]`, `ins.adsbygoogle`, `iframe[src*="doubleclick"]`, `iframe[src*="googlesyndication"]`, `[class*="dfp_ad"]` | vendor  | Google GPT/AdSense/DFP                             |
| `[id*="taboola"]`, `[class*="taboola"]`, `[id*="outbrain"]`, `[class*="outbrain"]`                                                                                                          | vendor  | Taboola / Outbrain                                 |
| `[class*="ssp-advert"]`, `[id^="sklik"]`, `[class*="sklik"]`, `iframe[src*="imedia.cz"]`                                                                                                    | vendor  | Seznam SSP/Sklik/imedia (all Seznam-network sites) |
| `#onetrust-banner-sdk`, `#onetrust-consent-sdk`, `.onetrust-pc-dark-filter`                                                                                                                 | vendor  | OneTrust CMP                                       |
| `[class*="newsletter"]`, `[id*="newsletter"]`, `.newsletter-wall`, `.cookie-banner`                                                                                                         | generic | common conventions                                 |
| `[id^="cpexSubs"]`                                                                                                                                                                          | network | CPEx sub-wall (CNC: blesk/reflex/…)                |

**Result: 0 site-specific selectors.** Everything is generic-convention or
vendor/network-level. The narrowest is `cpexSubs` (a publisher _network_, not one
site).

## Consent `REJECT_SELECTORS` / `ACCEPT_SELECTORS`

All vendor-level CMP markers: OneTrust, Didomi, Cookiebot, Quantcast, TrustArc,
Usercentrics, Termly, Osano, Klaro, Google Funding Choices, Sourcepoint, Seznam/
CNC. **0 site-specific.** The text heuristics (reject/accept/pay) are language
patterns, not site selectors, and are gated behind a consent-context check.

## Conclusion & guardrails

We are **not** overfitting at the rule level — supplements target ad _platforms_
and CMP _vendors_, which generalize across the long tail by construction. To keep
it that way:

1. **Never add a `site`-class selector just to make a corpus site go green.** If
   a single site leaks ads, prefer pushing the gap into the network filter lists.
2. New consent/ad rules must be **vendor- or network-level** (justified by the
   landscape survey's frequency data — see `deep-cdp.mjs --fresh` + the
   `vendors` survey block), not by one site.
3. The corpus is a **validation/false-positive set**, exercised with `--fresh`
   rotation over **unseen** sites so green ≠ memorization.
