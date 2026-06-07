# Cubby — handoff / resume notes

Quick orientation for picking this project back up (read `README.md` for the full picture).

## What this is
**Cubby** 🐻 — a shared baby-tracker PWA, **live and in real use** by the owner + family.
Don't break production. Make a change → verify → push (auto-deploys).

- Live: https://little-cubby.com (custom domain) · https://cubby.saurav-918.workers.dev (fallback)
- Repo: https://github.com/zealthpatro/little-log- (branch `main`)
- Backend: Firebase `little-log-a9caa` (Google auth + Firestore, free Spark plan)

## The 30-second model
- `index.html` = the whole app (vanilla JS, single global `state`, `render()` re-renders all).
- `store-firebase.js` = auth + cloud sync (overrides `persist()`/`PhotoStore`; real-time listeners;
  family/sharing UI). App code never calls Firestore directly.
- `cubby-extras.js` = bear avatars + custom time/date pickers + the unified "When" time strip.
- `growth-data.js` = WHO/CDC percentile tables.
- Data lives in `households/{hid}` (see README §3). Events are a subcollection; rest is the `app` blob.

## Dev loop
```bash
python3 -m http.server 8080         # http://localhost:8080 (Google sign-in works on localhost)
# edit files...
node --check store-firebase.js cubby-extras.js growth-data.js   # always
# verify in browser; then:
# bump CACHE in sw.js (little-log-vN)
git add -A && git commit -m "..." && git push     # Cloudflare auto-deploys in ~1 min
```
Tip: the preview/SW caches aggressively — unregister SW + clear caches to see fresh changes.
To verify a deploy: `curl -s "https://cubby.saurav-918.workers.dev/?cb=$RANDOM" | grep <marker>`.

## Gotchas
- Editing JS strings: watch for accidental literal newlines inside `'...'` (broke a build once).
- Bump `sw.js` `CACHE` or clients keep old assets.
- New live domain → add it to Firebase Authorized domains or Google sign-in fails.
- Firestore rules live in `firestore.rules` **and** must be published in the Firebase console
  (the console copy is the source of truth at runtime).

## Decisions on record
- In-app notifications only (no Blaze / no card). Push deferred.
- Photos in Firestore (base64), not Firebase Storage (avoids Blaze).
- Growth: WHO default; CDC toggle; IAP n/a for under-5.
- One shared household; Google sign-in.

## Next planned
- **Send-email flow** for invites (server-sent). Options being decided: EmailJS (client-side,
  free, no Blaze) vs Firebase "Trigger Email" extension (Blaze + SMTP). See README §9.
