# Post-mortem: the sign-in link and shared game links showed "page not found" in every browser

- **Date:** 2026-11-17
- **Severity:** P1
- **Duration:** 2026-07-08 02:10 +04:00 (commit 9a7839d6) → the v370 deploy (see Status)
- **Status:** OPEN until v370 is live and `node tools/gates.js --live --only=nav-links(live)` passes against production
- **Author:** Claude (main session), for the founder

> Policy: every breakage gets a documented, blameless 5-Whys post-mortem. Where a "why" is inferred
> rather than proven, it says so.

## What happened
During the device test on 16-17 Nov 2026 the founder clicked the "Sign in to Cubby" button in a
sign-in email on a desktop browser. The browser showed Cubby's branded 404 page, "That page moved or never
existed", at `little-cubby.com/__/auth/action?...&mode=signIn&oobCode=...`.

Asked from a script the same URL answered 200 with Firebase's action handler, so the server side looked
fine. Asked with the headers a browser sends on a navigation (`Sec-Fetch-Mode: navigate`,
`Sec-Fetch-Dest: document`) it answered 404 with the branded page. A family game link, `/g/<code>`, did
exactly the same.

## Impact
- **Sign-in link.** Every parent who opened the sign-in link in a browser got the 404 page: desktop,
  Android, iPhone Safari and the installed web app. Before 21 Aug 2026 the sign-in email carried ONLY the
  link, so between 8 Jul and 21 Aug signing in by email in a browser could not succeed at all. From
  21 Aug the same email also carries a 6-digit code, and typing the code worked throughout.
- **Game links.** Every guest who opened a shared family game (`/g/<code>`) in a browser got the 404 page
  from 8 Jul.
- **Not affected:** Google and Apple sign-in (their auth domain is `little-log-a9caa.firebaseapp.com`,
  not this host); the 6-digit code; every page that is a file (`/`, `/app/`, articles); every `/api/*`
  call (none is a navigation); the iOS app's universal link, which opens the app without a browser
  request (it has its own bug, below).
- **Inferred, not proven:** the funnel had recorded no account created by email since about August
  ("0 of 17", memory of 2026-11-16). This outage is consistent with that, but the funnel does not record
  which path a sign-in took.
- No data was exposed. Nobody could be identified from it.

## Root cause
Workers Static Assets answers a navigation request to a path with no file using `not_found_handling`'s
page, and does not invoke the Worker, once the compatibility date is 2025-04-01 or later. Cloudflare
documents this ("navigation requests prefer asset serving"). `wrangler.toml` has had
`compatibility_date = "2025-06-01"` since 7 Jun 2026, and `not_found_handling = "404-page"` since
8 Jul 2026. Both links exist only in `worker.js`: the `/__/*` proxy to Firebase's handler, and the `/g/*`
route that serves `g/index.html`. So from 8 Jul a browser never reached them. Confirmed by measurement on
17 Nov 2026 (`tools/live_nav_check.js`: 0 of 2 against production; a plain request still reached the
Worker).

## 5 Whys
1. **Why did the link show the 404 page?** The asset layer answered the browser's navigation with the
   404 page and never ran `worker.js`, which is the only thing that answers `/__/auth/action`.
2. **Why did the asset layer not run the Worker?** With `not_found_handling` set and a compatibility date
   from 2025-04-01, Cloudflare serves navigations to unmatched paths from the assets. Ours is 2025-06-01,
   and the 404 page was switched on on 8 Jul.
3. **Why was that not seen when the 404 page went in?** It was checked with requests that carry no
   navigation header, which still reach the Worker. On 22 Aug a comment in `wrangler.toml`, "measured on
   the wire", recorded that unmatched paths reach the Worker. That is true of a script and false of a
   browser. (Inferred: neither commit records a browser check of `/__/` or `/g/`.)
4. **Why did no gate catch it in four months?** No check ever asked production the way a browser does.
   The first version of this incident's own check used Node's `fetch()`, which always sends
   `sec-fetch-mode: cors`, and it passed against the broken production. Meanwhile the 6-digit code kept
   sign-in possible, so no parent hit a dead end that reached us.
5. **Why did nothing else signal it?** The asset layer served those 404s without the Worker, so
   `recordPageView`, which counts 404s, never saw a single one. Nothing records whether a sign-in came by
   link or by code. → **Root cause:** the contract between the asset layer and the Worker (which requests
   reach `worker.js`) was assumed from script-shaped requests and never tested as a browser makes them.

## Contributing factors (blameless)
- The default behaviour changed with the compatibility date. The 404 page was a site-wide SEO change,
  and nothing tied it to the two Worker-only links.
- Every tool we have (curl, Node fetch, puppeteer against `tools/serve.js`) either sends no navigation
  header or never goes through Cloudflare.
- The email offers the link as "Tap instead", second to the code, so its failure was quiet.

## What fixed it
`wrangler.toml` `[assets]`: `run_worker_first = ["/__/*", "/g/*"]`. The Worker runs first for those two
paths only, and every other asset is still served without it. Shipped in v370 (see the Status line for
the live check).

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | `run_worker_first` for `/__/*` and `/g/*` | Fix | DONE in v370 |
| 2 | `nav-links(live)`: asks production as a browser does (node:https, navigation headers) for both links; `nav-links` self-test holds its matcher red against our own 404 page and fails a live half that uses `fetch()` | Prevent | DONE in v370 |
| 3 | A static check: every path `worker.js` answers that a browser can navigate to is listed in `run_worker_first` | Prevent | TODO |
| 4 | Record which way a sign-in arrived (link or code), first-party, with no address | Prevent | TODO (funnel) |
| 5 | The iOS app's own handling of the same link reload-loops (`getLaunchUrl` re-routed on every load; the code path never saves the address) | Fix | IN PROGRESS for v371 |
| 6 | After every deploy, run `node tools/gates.js --live` and read nav-links(live) | Process | DONE (this release) |

## Lessons
- "Measured on the wire" means nothing until it says WHICH wire: a script and a browser are different
  clients to Cloudflare.
- A live gate must be seen red against the broken production before its green means anything. This one
  was green first.
