# Little Log, Cloudflare handoff

This folder is a ready-to-deploy static PWA. Drop it into a repo and hand it to Claude Code.

## What is here

```
index.html              the whole app (single file: HTML + CSS + JS)
manifest.webmanifest     PWA manifest (name, icons, theme)
sw.js                    service worker (offline + clean updates)
_headers                 Cloudflare: keep sw.js and manifest uncached
icons/                   app icons (192, 512, maskable, apple-touch, favicon)
README.md                full project doc, architecture, and the sharing plan
```

The app persists to `localStorage` on whatever device and browser opens it. No backend yet.

## Preview locally

```bash
cd little-log-pwa
python3 -m http.server 8080
# visit http://localhost:8080
```

Use a server (not file://) so the service worker and storage behave correctly.

## Deploy to Cloudflare Pages

Option A, dashboard: create a Pages project, connect the repo (or direct-upload this folder), no build command, output directory is the folder root.

Option B, CLI:

```bash
npm install -g wrangler
wrangler login
wrangler pages deploy little-log-pwa --project-name little-log
```

Cloudflare prints the live URL. Add a custom domain in the Pages settings if you want.

## Updating

After editing `index.html` (or any asset), bump the cache name in `sw.js` (for example `little-log-v2`) so clients pick up the new version, then redeploy. `_headers` already prevents `sw.js` and the manifest from being cached, so the update propagates on the next visit.

## Install on a phone

Open the live URL in mobile Safari or Chrome, then "Add to Home Screen". It launches full-screen with the icon, and works offline.

## Known drawback of this phase (read before the beta)

This is single-device. Data lives in `localStorage` for that one browser:

- Not shared across phones, and not a backup.
- iOS Safari can evict `localStorage` after roughly 7 days of no use, so a long gap can lose data. Tell beta users, or move to the cloud phase before a serious beta.
- Roughly a 5MB cap; downscaled photo thumbnails fit, but heavy photo use will hit it.

## Next phase: accounts and sharing

The full design (roles, Firestore security rules, invite flow, build order, trade-offs) is in `README.md`, section 6. Short version: two parents and a nanny on the same baby needs auth, a shared baby document with an owner role, and real-time sync. Firebase is the faster path for that; Cloudflare (Pages + Workers + D1 + an auth provider) keeps it one-vendor but is more wiring. Either way, that phase is a real build, best done in Claude Code where it can run the deploys.
