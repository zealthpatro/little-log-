# Current Instrumentation Architecture

Scanned 2026-09-24, origin/main `036bb308`.

- **SDK and version:** none. `firebase/analytics` is present inside the vendored Firebase compat
  bundle (`app/vendor/firebase/10.12.2/`) and is never initialised or called. `package.json` is not
  tracked in git.
- **Initialization:** none. The acquisition snippet is an inline `<script>` in `<head>` of
  `app/index.html` and the marketing pages, running before any app code.
- **Client vs server:** both. Client writes attribution into the user's own documents. The Worker
  counts page loads and records operational health.
- **Call routing:** no wrapper. Client writes go directly to Firestore through `LL.db` in the places
  that need them. Server-side page counting routes through the single `env.ASSETS.fetch` choke point,
  so it covers every HTML response without per-route code.
- **Identity:** Firebase Auth uid. The household id `{hid}` groups members, babies and care logs.
- **Storage:** Firestore (`users.acq`, `users.referredBy`, `waitlist`, `ops`, `pushLedger`,
  `campaigns`; `pageStats` is read-only history now). D1 holds the page counter (`cubby-games`
  tables `page_stats` and `page_stats_total`), newsletter subscribers and the gender game. Cloudflare's log
  stream holds `console.error` output transiently.
- **Environment:** `FIREBASE_SERVICE_ACCOUNT` (Worker secret). The analytics tools need
  `tools/serviceAccountKey.json` (gitignored).
- **Error handling:** server writes are non-blocking (`ctx.waitUntil`) and log on failure. A failed
  counter cannot fail a page request. Client attribution writes are try/catch and silent.
- **Shutdown/flush:** not applicable. Server writes complete inside `waitUntil`; there is no client
  queue to flush.
- **Reporting:** `tools/analytics.js` + `tools/funnel.js` (funnel, retention, wedge),
  `tools/page_stats.js` (routes, 404s), `tools/ops.js` (local dashboard on 127.0.0.1 with full
  records). All run by hand. `tools/weekly_health.sh` via launchd is the one scheduled reporter.

## Patterns worth preserving

- **The single choke point for page counting.** One call covers every page and every 404.
- **Fire-and-forget with a visible failure.** The comment above `recordPageView` in `worker.js` states
  the rule: a counter must never add latency or turn a D1 error into a failed request, but it must log.
- **Collapsing paths into a fixed set of buckets before storage** (`statsKey`), so the counter cannot
  become a directory of invite tokens, and random paths cannot grow the table.
- **Bounded anonymous writes.** The counter is throttled per address (per /48 on IPv6) and stops for
  the UTC day at `PAGE_STATS_DAILY_CAP` (default 5000), so a flood cannot spend the D1 that also holds
  account-deletion cleanup and the guest game. It never touches the family Firestore.
- **Deriving the funnel from records the product already keeps**, so measuring activation costs no
  new collection.
- **Attribution owned by the user**, written onto their own document rather than a separate store.
