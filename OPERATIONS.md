# Cubby — Operations & quality (right-sized for 0 → 10k active / 3k paid)

Deliberately lean. This is startup hygiene, not enterprise. The full CI/lighthouse/a11y/branch-protection
program is intentionally deferred until there's scale to justify it.

## Before you push (the gate)
The pre-commit hook (`.githooks/pre-commit`, wired via `git config core.hooksPath .githooks`) already:
- blocks an `app/*` change that didn't bump the service-worker `CACHE` in `app/sw.js`;
- `node --check`s every staged `app/*.js`.

Run these by hand before an **app** push (catches what the hook can't):
```sh
node tools/serve.js &              # serve the repo on :8080
node tools/validate.js             # JSON-LD parses, sitemap balanced, FAQ schema==visible lockstep
node tools/smoke.js http://localhost:8080/app/   # fails on uncaught error / missing global
node tools/uitest.js               # authed UI: dead taps + the contrast gate, both themes
node tools/perf_check.js           # jitter gate: render budgets on a real 4-month history
node tools/shot.js http://localhost:8080/<page>/ /tmp/x.png 390 full   # eyeball any page (see tools/shot.js)
```
`tools/uitest.js` and `tools/perf_check.js` both drive the logged-in app through the localhost-only
`?e2e=1` boot hook. **Run perf_check after anything that touches rendering.** It seeds four months of
real logging (2,500+ events) and measures at 4x CPU throttle, because the failure it exists to catch is
invisible in a screenshot: the app spent months rebuilding its whole shell on every render and building
every event ever logged into the Log tab, which is ~500ms of frozen phone per repaint. Budgets are ~4x
the measured numbers, so it fails on a regression in kind (full-shell rebuild, unwindowed list,
per-second document sweep), not on laptop noise.

## If a push breaks prod — rollback
- **Site/app (Cloudflare):** the dashboard keeps every deployment → Deployments → **Rollback** to the last good one (instant). Or `git revert` + push.
- **Service worker stuck:** bump `app/sw.js` CACHE and redeploy; the SW is network-first for HTML/JS so a bump clears stale assets.
- **Firestore rules:** the pre-hardening rules are the parent of commit `c2e3389` in git history — paste that back into the Firebase console (rules deploy is NOT via git push).

## Scaling to 10k (FOUNDER actions — needed before a few hundred active users)
1. **Firestore Spark → Blaze.** Spark caps at ~50k reads + 20k writes **per day**; the app's real-time
   `onSnapshot` listeners burn reads continuously, so the free tier breaks at a few *hundred* active users and
   the app stops working. Upgrade to Blaze (pay-as-you-go) early and set a **budget alert**. At 3k subs
   (~$27k MRR) the backend bill (~$50–150/mo) is <1% of revenue — do not migrate for cost.
2. **Backups.** Blaze unlocks scheduled Firestore exports — turn one on. It's irreplaceable family health data.
3. **Recommended next build (mine):** lean first-party **error monitoring** — `window.onerror` +
   `unhandledrejection` → POST to the Worker → a table in the existing `cubby-games` D1 (no new infra). So you
   *see* breakage across users instead of waiting for a report.

## Portability (cheap insurance, no work now)
The data layer is abstracted: `index.html` has a `Store` interface and all Firebase lives in
`app/store-firebase.js`. Keep it that way (no `firebase`/`onSnapshot` calls leaking into `index.html`). That
keeps a future backend swap (e.g. to Cloudflare D1) a contained job rather than a rewrite. Don't pre-build for it.

## Tooling map
- `tools/serve.js` — local static server (:8080)
- `tools/shot.js` — headless screenshots (the mcp preview tool is broken here; uses the system Chrome)
- `tools/smoke.js` — app load smoke test
- `tools/validate.js` — marketing static validation
- `tools/uitest.js` — authed-UI harness: dead taps + WCAG contrast in both themes (`?e2e=1`)
- `tools/perf_check.js` — jitter gate: render/tick budgets on a seeded 4-month history (`?e2e=1`)
- `tools/gen_sitemap.py` — stamps article lastmods
- `test/` — Firestore rules emulator test (needs Java): `cd test && npm i && npm run test:rules`
