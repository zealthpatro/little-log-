# Every /api call and the app-link file failed in production for three days

**Severity:** P0. **Live:** release pushed 24 Nov 2026 about 05:59 Dubai (main 0428c528). **Fixed:** 27 Nov 2026 18:02 Dubai (main 4e50b5e6, PR #7). **Found by:** the CMO session, while checking the site.

## What families saw
- **Sign-in by code:** typing the six-digit code never worked. The request hit the 404 page (405 for a POST). Sign-in by email link still worked through Firebase's own sender.
- **Invites:** sending an invite failed, and so did the invite preview. That is the second caregiver, the step that matters most.
- **Account deletion:** the server clean-up after deleting an account did not run.
- **Doses and feeds:** logging a dose from a notification did not save.
- **Other broken features:** usage events, newsletter sign-up and the canary.
- **Fresh iPhone installs:** universal links could not open the app, because both apple-app-site-association paths returned 404.

## Timeline (from git log)
- 17 Nov 09:39: d7e82b57 sets `run_worker_first = ["/__/*", "/g/*"]`, so that email sign-in links and shared game links, opened in a browser, reach the Worker instead of the 404 page.
- 24 Nov ~05:59: that change ships in the v379 release.
- 24 to 27 Nov: CI stays green; every test calls the Worker directly, which bypasses the asset layer.
- 27 Nov ~16:00: the CMO session measures 404 and 405 on /api/* and the AASA paths in production.
- 27 Nov 16:30: the fix is proven on the Cloudflare branch preview: /api/health 200, both AASA paths 200, a real 404 still 404.
- 27 Nov 18:02: PR #7 merged. Live checks show 200 on every route.

## Five whys
1. **Why did /api fail?** Cloudflare served it from the asset layer, not the Worker.
2. **Why?** `run_worker_first` was a list, and a list replaces the default. Any path not listed goes to the assets first, and there it matched the 404 page.
3. **Why was the list missing /api?** The 17 Nov fix was written for the two paths it was fixing. Nobody listed every path the Worker serves.
4. **Why did no test catch it?** The tests and gates call worker.js directly, or run it under wrangler/Miniflare without the production asset routing. tools/live_nav_check.js asks production only about /__/ and /g/.
5. **Why was it seen only three days later?** Nothing watched production /api. The canary endpoint itself was one of the broken routes, and no alert fires when the canary is unreachable.

## What changed
- `wrangler.toml` lists `/api/*`, both AASA paths and the bare `/g`. A comment explains that the list replaces the default.
- New gate `worker-first` (tools/worker_first_check.js, tree tier, with a self-test). It reads every route in worker.js and fails any that the list does not cover. It was red on main's list and is green with the fix. Its self-test stages the 24 Nov list, an uncovered new route, and bare `/g` against `/g/*`.

## Still to do
- **Live check:** extend tools/live_nav_check.js (gates.js --live, and the nightly run) to call production /api/health and both AASA paths. The tree gate proves the config; only a live call proves production.
- **Alerting:** alert when the canary is unreachable, not only when it reports a failure.
- **Usage data:** usage events from 24 Nov 05:59 to 27 Nov 18:02 are missing. Mark that window in any metric that uses them.
