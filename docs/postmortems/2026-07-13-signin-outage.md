# Post-mortem — Sign-in outage (Google + Apple)

- **Date:** 2026-07-13
- **Severity:** P0 (the front door — new sign-ins and re-logins failed)
- **Duration:** intermittent through the day, surfaced + fixed 2026-07-13
- **Status:** RESOLVED (commit 9fd888b, sw v176)
- **Author:** engineering (with Claude)

## What happened
Users hitting Google or Apple sign-in were redirected to `https://little-cubby.com/__/auth/handler?...` and got the Cubby **404 page** instead of the Firebase auth handler, so the OAuth flow could never complete. Reproduced in a clean incognito window (so not a browser-cache issue). The same endpoint returned **200** when curled from a European Cloudflare edge, but **404** for the affected client/region — an inconsistency across Cloudflare edges/deploys.

## Impact
- **Who:** cannot be individually identified. A failed sign-in never creates a user identity, and the 404 occurred at Cloudflare (the Worker) *before* the request reached Firebase Auth, so no user-level record exists. Scale/timing is only estimable from Cloudflare analytics (count of 4xx on `/__/auth/*`).
- **Already-signed-in users were NOT affected** — existing sessions persist locally; only *new* sign-ins and re-authentications were blocked.
- Likely a small population given the beta stage, weighted heavily toward our own testing during the day.

## Root cause
Sign-in depended on a **custom same-domain Worker proxy** (`worker.js` proxies the reserved Firebase `/__/auth/*` namespace to `little-log-a9caa.firebaseapp.com`) so the OAuth popup would show the branded `little-cubby.com`. That proxy is an extra, fragile hop that can fail — during Worker redeploys and inconsistently across edges — where Firebase's own hosting would not. We put the single most critical flow behind a **cosmetic** dependency, with **no health check** to catch a failure.

> Note: the *exact* mechanism of why the proxy 404'd for one edge while returning 200 for another (regional propagation vs. deploy-in-flight vs. a conditional Worker path) was **not fully proven**. We fixed it structurally — by removing the dependency — which makes the exact mechanism moot. Confirmed by: removing the proxy from the auth path fixed sign-in.

## 5 Whys
1. **Why did sign-in fail?** The OAuth redirect to `little-cubby.com/__/auth/handler` returned the site's 404 page instead of the Firebase auth handler.
2. **Why did that URL 404?** The Cloudflare Worker that proxies `/__/*` to firebaseapp.com did not serve the proxied response for that request/edge and fell through to the static-asset 404.
3. **Why was the proxy able to not-serve it?** Sign-in was routed through a custom Worker proxy for Firebase's reserved auth namespace — an extra hop that is fragile across redeploys and edges, unlike Firebase's own hosting.
4. **Why did sign-in depend on that fragile proxy?** We chose a **branded auth domain** purely for cosmetics (popup shows our domain), which *requires* proxying Firebase's auth endpoints through our Worker — trading reliability of the most critical flow for a cosmetic gain.
5. **Why was that reliability risk taken, and why did a *user* find it first?** Sign-in was never designated **tier-0** with a reliability requirement, and there was **no monitoring/alerting on the auth path** (no synthetic check on `/__/auth/handler`, no alert on 404s). A latent, intermittent failure in the most critical flow could therefore exist and only surface via a user report.

**Root cause (5th why):** we optimized the most critical flow for cosmetics over reliability, with no health check — so a fragile dependency failed silently.

## Contributing factors (blameless)
- **8 rapid deploys** in one day (each redeploys the whole-site Worker) increased the odds of transient `/__/*` blips and muddied diagnosis.
- An **App Check change shipped the same day was a red herring** — it added a false lead (we suspected App Check enforcement) and cost time before the proxy was isolated. App Check was only ever in Monitor mode, never enforced, so it never blocked anything.
- **"Works from my edge" ≠ "works globally":** curl returned 200 from one Cloudflare PoP while the user's PoP returned 404. Single-edge verification gave false confidence.

## What fixed it
Reverted `authDomain` from the branded `little-cubby.com` proxy to Firebase's own always-on `little-log-a9caa.firebaseapp.com` (the fallback the code comment already documented). Sign-in no longer touches our Worker → immune to deploys and regional proxy issues. Trade-off: the OAuth popup shows `firebaseapp.com` (cosmetic). Email magic-link flow unaffected.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Move auth off the Worker proxy (authDomain → firebaseapp.com) | Fix | DONE (9fd888b) |
| 2 | Add a synthetic sign-in health check (GET the live auth handler, expect 200; alert on 404) | Prevent | TODO |
| 3 | Treat sign-in as **tier-0**: any change touching auth or Worker routing requires a real end-to-end sign-in test (Google **and** Apple), not just curl | Process | TODO |
| 4 | Verify prod from **multiple regions/edges**, not one, before declaring healthy | Process | TODO |
| 5 | Batch deploys; don't ship a storm of pushes, especially near auth changes | Process | TODO |
| 6 | Apple caveat documented: if Apple fails on firebaseapp.com, add `https://little-log-a9caa.firebaseapp.com/__/auth/handler` to the Services ID Return URLs | Doc | DONE (memory) |

## Lessons
- The most critical flow should sit on the most reliable path, even at a cosmetic cost.
- Every breakage gets a documented 5-Whys post-mortem (this file is the first; see `TEMPLATE.md`).
- A red-herring change shipped alongside an incident slows diagnosis — ship risky/optional changes (like App Check) separately, with their own end-to-end test.
