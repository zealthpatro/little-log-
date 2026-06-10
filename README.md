# Cubby 🐻

A warm, private, shareable baby-tracker PWA. Feeds, sleep, nappies, pumping, growth,
milestones, medicine, vaccines, illness, photos and keepsakes — with real multi-caregiver
sharing, per-person bear avatars, and WHO/CDC growth-percentile charts. Fronted by a public
marketing + SEO site (home, features, articles, pricing, FAQ, programmatic vaccine schedules).

- **Live:** https://little-cubby.com (custom domain) — also https://cubby.saurav-918.workers.dev
- **App:** https://little-cubby.com/app/ · **Marketing/SEO:** everything at the root `/`
- **Repo:** https://github.com/zealthpatro/little-log-
- **Hosting:** Cloudflare (Workers static assets) — auto-deploys on push to `main`
- **Backend:** Firebase (Google sign-in + Firestore) — project `little-log-a9caa`, free **Spark** plan

> The app is fully cloud-hosted and always-on. No local machine is required to keep it
> running — `localhost` is only for development.
> Last refreshed: 2026-06-09.

---

## 1. Architecture at a glance

Two halves, one Cloudflare deploy: a **static marketing/SEO site at `/`** (indexable, no
service worker) and the **PWA at `/app/`** (Google sign-in, service-worker cached).

```
Phone / browser
   │
   ├─ /  (marketing + SEO — static, indexable)
   │   ├─ index.html ............ marketing home (5-tab nav, hero carousel, proof, pricing)
   │   ├─ features/ pricing/ faq/ articles/ ... the other tabs
   │   ├─ vaccination-schedule/{uk,us,uae}/, de/impfkalender/ ... programmatic SEO pages
   │   ├─ articles/<slug>/ ...... sourced content library (see §10, content engine)
   │   ├─ site.css (marketing) + vax.css (articles/vaccine) ... shared styles
   │   └─ sitemap.xml robots.txt og/*.png ... SEO plumbing
   │
   └─ /app/  (the PWA — behind Google sign-in)
       ├─ index.html ........... the whole app (single-file vanilla JS UI, ~4.3k lines)
       ├─ firebase-init.js ..... Firebase config + init (auth, Firestore, offline cache)
       ├─ store-firebase.js .... auth gate + real-time sync engine + sharing/family UI
       ├─ cubby-extras.js ...... bear avatars (SVG), custom time/date pickers, "When" strip
       ├─ landing.js ........... signed-out landing + Pro/paywall copy
       ├─ growth-data.js ....... WHO + CDC growth percentile tables (generated)
       ├─ pregnancy-data.js .... week-by-week + antenatal data (Phase 1 data; UI WIP)
       └─ sw.js ................ service worker (CACHE little-log-vNN; network-first HTML)
            │
            ▼
       Firebase Auth (Google)  +  Cloud Firestore (shared "household" doc + subcollections)

   Cloudflare serves the static files;  Firestore stores + syncs the app data.
```

> The app was originally at root and moved to `/app/`. Root `/sw.js` is now a self-unregister
> stub and root `index.html` redirects installed/standalone clients to `/app/`, so existing
> testers migrate cleanly.

**Key idea:** the original app kept all state in a single global `state` object persisted via a
`Store`/`PhotoStore` abstraction. `store-firebase.js` swaps that persistence for Firestore
**without rewriting the ~20 logging functions** — it overrides `persist()` and `PhotoStore`,
and runs a diff-based sync engine. The app code still just mutates `state` and calls `persist()`.

---

## 2. File map

### App (`/app/`)
| File | Purpose |
|---|---|
| `app/index.html` | Entire UI + logging logic. Inline `<script>` defines `state`, `render()`, all `open*/save*` sheet functions, growth charts, fever nudge, visit summary, photo studio, tips ticker. |
| `app/firebase-init.js` | Public Firebase web config; initializes `auth`, `db`; enables auth persistence + Firestore offline cache. Exposes `window.LL`. |
| `app/store-firebase.js` | Google sign-in screen; resolves/creates the household; one-time migration of old localStorage data; real-time listeners; diff-based `persist()`; photo storage in Firestore; Family & sharing UI (invite, relationship, remove member, copy/email link); first-run setup. |
| `app/cubby-extras.js` | `cubbyBear()` parametric SVG avatars; per-member/per-baby variants + picker; the custom warm **time picker** and unified **"When?" (date+time)** picker. |
| `app/landing.js` | Signed-out in-app landing screen + Pro/paywall copy (incl. Nutrition tracker). |
| `app/growth-data.js` | `window.GROWTH_REF` = `{who,cdc}.{weight,height}.{M,F}` arrays of `[month,p5,p25,p50,p75,p95]`. Generated from official CDC/WHO data files (see §7). |
| `app/pregnancy-data.js` | `window.PREG` week-by-week (weeks 4-41) + antenatal schedules (UK/US/DE/UAE/generic) + danger signs + condition thresholds. The full pregnancy product ("Mommy To Be") is built on branch `pregnancy-tracker`, unmerged: see `PREGNANCY-HANDOFF-V2.md`. |
| `app/sw.js` | App service worker; bump `CACHE` (`little-log-vN`, currently **v47**) on app asset change. |
| `app/manifest.webmanifest` | PWA manifest (name "Cubby", `start_url`/`scope` = `/app/`, icons). |

### Marketing + SEO (root `/`)
| File | Purpose |
|---|---|
| `index.html` | Marketing home: 5-tab nav, hero carousel, honest proof, real testimonials, pricing widget, Free/Pro comparison. Redirects installed PWA clients to `/app/`. |
| `features/`, `pricing/`, `faq/`, `articles/` | The other four marketing tabs (`pricing/` has the interactive localized Pro widget; `articles/` is the content hub grouped by age). |
| `vaccination-schedule/{uk,us,uae}/`, `de/impfkalender/` | Programmatic SEO vaccine-schedule pages per country (NHS/CDC/MOHAP/STIKO sourced). |
| `articles/<slug>/` | Sourced article pages (BlogPosting JSON-LD, deep-linked sources, disclaimer). |
| `site.css` / `vax.css` | Marketing styles / article + vaccine-page styles (shared). |
| `sitemap.xml`, `robots.txt`, `og/*.png` | SEO plumbing (OG images are PIL-generated 1200x630). |
| `/sw.js` (root) | Self-unregister stub to retire the old root service worker on existing testers. |

### Shared / infra
| File | Purpose |
|---|---|
| `firestore.rules` | Security rules — members-only access, owner vs caregiver, invite-by-email join. |
| `wrangler.toml` | Cloudflare static-assets deploy config (`[assets] directory="./"`). |
| `.assetsignore` | Keeps `tools/`, docs, drafts, node_modules and the service-account key out of the deploy. |
| `.gitignore` | Ignores `tools/serviceAccountKey.json`, node_modules, logs, `.DS_Store`. |
| `_headers` | Cloudflare header hints (CSP/security; keeps sw/manifest uncached). |
| `generate_icons.py` | Pillow script that draws the bear app icons into `icons/`. |
| `tools/serve.js` | Minimal node static server for local preview (replaces broken `python3 -m http.server`). |
| `tools/analytics.js` | Read-only `firebase-admin` usage report (needs the gitignored service-account key). |
| `articles-drafts/` | Git-tracked but **never deployed**; staging for articles awaiting human review. |

---

## 3. Data model (Firestore)

```
households/{hid}
  ownerId: <uid>
  members:    { <uid>: 'owner' | 'caregiver' }      // fast rule checks
  memberInfo: { <uid>: { name, email, photoURL, role, relationship, avatar:{fur,acc}, setupDone } }
  app:        { babies[], settings, milestones[], meds[], vaccines{}, illnesses[], photos[], timers{} }
  updatedAt

households/{hid}/events/{eventId}   // one doc per log entry, includes authorId
households/{hid}/photos/{photoId}   // { data: <base64 thumbnail>, authorId }   (no Firebase Storage)

invites/{emailLowercase}            // { householdId, role, relationship, name, invitedBy, status }
users/{uid}                         // { householdId, name, email }  — private pointer
```

**Per-device (localStorage, not synced):** `little-log-prefs-v1` = `{ activeBabyId, theme }`.
Everything else (including live nap/feed **timers**) is shared via `households/{hid}.app`.

**Events** are the high-frequency, multi-writer data → their own subcollection (one doc each),
so two caregivers logging at once never clobber each other. The rest of `state` rides in the
`app` blob (last-write-wins, fine for low-frequency profile/settings edits).

**Photos** are stored as base64 thumbnails in a Firestore subcollection (deliberately **not**
Firebase Storage, which would force the paid Blaze plan). Keeps `photoSrc()` synchronous.

---

## 4. Sync engine (store-firebase.js)

- `persist()` is overridden to a **debounced diff push**: it compares `state.events` to the
  last-synced snapshot (`knownEvents`) and writes only added/changed/removed event docs, then
  writes the `app` blob. The app's save functions are untouched.
- Real-time `onSnapshot` listeners on the household doc, `events`, and `photos` merge remote
  changes back into `state` / `PhotoStore.map` and call `render()`.
- `applyingRemote` guard prevents echo loops; a `pushTimer` guard avoids stomping a just-started
  local timer with a stale remote snapshot.
- **Roles:** owner can edit/delete anyone's entries + manage members; caregiver can add and
  edit/delete their own. Enforced in `firestore.rules`.

---

## 5. Features

- **Logging** (all share one **time strip** → tap to set date+time): feed (nursing timer,
  bottle, solids, water), sleep (live timer + past nap with "still sleeping" toggle), diaper,
  pump, activity/notes, growth, medicine, temperature, symptoms, visits.
- **Sharing:** Google sign-in, one shared household, invite by email (Copy link / Email button /
  relationship + co-owner), members list, remove member, first-run bear+relationship setup.
- **Attribution:** every entry shows "logged by <relationship/name>" with the person's mini bear.
- **Avatars:** unique bear per person and per baby (fur + accessory), changeable; baby photo can
  take over (with a "keep bear or use photo?" prompt).
- **Health nudges (in-app):** medicine due, vaccine overdue, illness day counter, **fever →
  see-doctor nudge** + 24h home banner, **upcoming-appointment** banner.
- **Doctor-visit summary:** one tap compiles the last 7 days (feeds/sleep/diapers/growth/
  temps/symptoms/meds/allergies) into a copyable/shareable snapshot.
- **Growth charts:** WHO (0–24mo) + CDC (0–36mo) percentile bands behind the baby's weight/height,
  Boy/Girl selector, "latest ~Nth percentile" readout. (See §7 and §9 on IAP.)
- **Activity photos:** log meal/activity images (e.g. "who ate what") attached to entries.
- **Keepsakes / photo studio:** multiple templates, fonts and palettes, monthly memory card, birth
  poster, "Then & Now", sticker pack, and Instagram-shareable share cards (`composeShareCard`).
- **On-device photo polish (no servers):** one-tap **Auto-enhance** (histogram) and **background
  cutout / sticker-me** via MediaPipe selfie segmentation (lazy-loaded from CDN). Generative AI is
  deferred to post-beta — see `AI-EDITING.md`.
- **Home extras:** rotating **tips ticker** and country-aware vaccine schedule on the app home.
- **Country awareness:** per-baby country + `detectCountry()` (no IP geolocation) drives the
  in-app vaccine schedule (US/UK/UAE/DE) and ties back to the SEO vaccine pages.
- Light/night themes; offline-capable PWA; installable to home screen.

---

## 6. Develop & deploy

### Local preview
```bash
cd little-log-pwa
node tools/serve.js              # static server on http://localhost:8080
                                 # (python3 -m http.server broke in the sandbox; use this)
```
`localhost` is a Firebase-authorized domain by default, so Google sign-in works locally.
The app is at `http://localhost:8080/app/`; the marketing site at `http://localhost:8080/`.
After editing, hard-reload (the app SW is network-first for HTML); to fully reset, unregister
the SW + clear caches in DevTools, or bump `CACHE` in `app/sw.js`.

### Deploy (automatic)
Cloudflare Pages/Workers is connected to the GitHub repo. **Every push to `main` auto-deploys.**
Just:
```bash
git add -A && git commit -m "..." && git push
```
- **Marketing/article pages are not SW-cached** → live ~1 min after push, no cache bump needed.
- **App assets are SW-cached** → bump `const CACHE = 'little-log-vN'` in `app/sw.js` when they change.

### Deploy (manual, if ever needed)
```bash
npx wrangler deploy        # uses wrangler.toml ([assets] directory="./")
```

### Required when the live domain changes
Add the domain under **Firebase Console → Authentication → Settings → Authorized domains**
(currently `little-cubby.com`, `cubby.saurav-918.workers.dev`, `localhost`, `little-log-a9caa.firebaseapp.com`).

---

## 7. Regenerating growth data

`app/growth-data.js` is generated from official files (run from `/tmp` or anywhere):
```bash
# WHO (via CDC mirror), 0–24 months
curl -sL "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Boys-Weight-for-age-Percentiles.csv" -o who_b_w.csv
curl -sL "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Girls-Weight-for-age%20Percentiles.csv" -o who_g_w.csv
curl -sL "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Boys-Length-for-age-Percentiles.csv" -o who_b_l.csv
curl -sL "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/growthcharts/WHO-Girls-Length-for-age-Percentiles.csv" -o who_g_l.csv
# CDC infant, 0–36 months
curl -sL "https://www.cdc.gov/growthcharts/data/zscore/wtageinf.csv" -o cdc_wfa.csv
curl -sL "https://www.cdc.gov/growthcharts/data/zscore/lenageinf.csv" -o cdc_lfa.csv
# then parse: see parse_growth.py (extracts [month,p5,p25,p50,p75,p95] per sex/measure)
```
Icons: `python3 generate_icons.py`.

---

## 8. Accounts / config reference

| Thing | Value |
|---|---|
| GitHub | `zealthpatro/little-log-` (SSH key configured locally) |
| Cloudflare project | `cubby` → `cubby.saurav-918.workers.dev` + custom domain `little-cubby.com` |
| Domain | `little-cubby.com` (registered in Cloudflare; added as a Worker Custom Domain) |
| Firebase project | `little-log-a9caa` (Spark / free) |
| Firebase services | Authentication (Google), Cloud Firestore. **No** Storage, **no** Functions. |
| Firebase web config | in `app/firebase-init.js` (public by design; safe to commit) |

Everything runs on **free tiers**. Nothing here requires a card on file.

---

## 9. Known limits & roadmap

- **Push notifications** are **in-app only** (fire while the app is open/installed). True
  background push needs Web Push + Cloud Functions → the paid **Blaze** plan. Deliberately deferred.
- **Automated email** (e.g. invites sent *by Cubby's servers*) isn't built. Current "Email the
  invite" uses a `mailto:` from the sender's own mail app (free). Server-sent email needs either
  the Firebase "Trigger Email" extension (Blaze + SMTP) or a client-side service (e.g. EmailJS).
  **Full design + scaling plan (5k users / 100k+ emails, transactional vs marketing): see [`EMAIL.md`](EMAIL.md).**
- **IAP growth charts**: the IAP 2015 charts cover **5–18 years only**; for under-5, IAP/India use
  **WHO**, which is the app's default. IAP would only matter if Cubby later tracks older children.
- **App-blob writes** are last-write-wins (fine for profile/settings; events are per-doc and safe).
- Removed members keep a stale `users/{uid}.householdId` pointer until they next sign in (they
  lose data access immediately via rules; client just shows an error until re-resolved).
- **Pregnancy product ("Mommy To Be"):** fully built (journey, week view, health trackers, tools,
  ultrasound Moments, birth→baby conversion, /pregnancy/ page, consent governance) on branch
  `pregnancy-tracker`, awaiting PR review/merge. The track is owned by `PREGNANCY-HANDOFF-V2.md`;
  keep `main` sessions for core jobs.
- **Pro / paywall:** localized pricing is live on the marketing site; the in-app Stripe paywall is
  design-only until beta closes — see `PAYWALL.md` and `PRO.md`.
- **On-device only** for photo AI; generative (server/VM Qwen/Seedream) is post-beta — `AI-EDITING.md`.

---

## 10. Marketing site, SEO & content engine

- **Marketing site** (root `/`): 5 tabs (home, features, articles, pricing, FAQ), built static and
  indexable with SoftwareApplication/Organization/FAQPage JSON-LD, OG images, `sitemap.xml`,
  `robots.txt` and `hreflang`. Pricing widget is localized (USD/GBP/EUR/AED/INR, monthly + discounted
  annual). All visuals are original illustrations / initial avatars and all testimonials are real
  (no stock photos, no fabricated proof). Full plan in `SEO.md`.
- **Programmatic vaccine pages**: `vaccination-schedule/{uk,us,uae}/` + `de/impfkalender/`, each
  sourced to the national authority, with a birthday calculator and links into the app at the right
  country (closes the SEO→app loop without IP geolocation).
- **Content engine** (sourced articles, YMYL-safe): a dedicated **Sonnet writer agent** follows
  `CONTENT-RUNBOOK.md` to take the top `[ ]` item from `CONTENT-QUEUE.md`, research official sources
  (NHS/CDC/WHO/AAP), write an original long-form article, self-review, wire the hub card + sitemap,
  publish to `/articles/<slug>/`, and verify live. Rules (no fabrication / no copying / deep-link +
  verify-200 / dated disclaimer / no diagnosis / no em-dashes) are in `CONTENT.md`. Unsourceable
  pieces go to `articles-drafts/` for human review instead of publishing.
  Run it on a cadence, e.g.: `/schedule every Mon, Wed and Fri at 9am — use model Sonnet. Follow
  CONTENT-RUNBOOK.md ... PUBLISH the next [ ] article from CONTENT-QUEUE.md`.

---

## 11. Documentation index

| Doc | What it covers |
|---|---|
| `README.md` | This file: full architecture, file map, data model, deploy. |
| `HANDOFF.md` | Fast resume notes / 30-second mental model. |
| `CHANGELOG.md` | Notable changes over time. |
| `SEO.md` | Marketing/SEO + CRO strategy. |
| `CONTENT.md` / `CONTENT-RUNBOOK.md` / `CONTENT-QUEUE.md` | Article rules / publish pipeline / backlog. |
| `PRO.md` / `PAYWALL.md` | Pro feature list and paywall design (pre-beta). |
| `PREGNANCY.md` | Phased pregnancy-module spec (original; sources list still canonical). |
| `PREGNANCY-HANDOFF.md` | v1 build handoff, superseded (build is done). |
| `PREGNANCY-HANDOFF-V2.md` | **The pregnancy track:** what's built on branch `pregnancy-tracker`, brand state (Mommy To Be / Den), rollout runbook, next-work queue. Start here for any pregnancy work. |
| `ROUTINES.md` | Routines / activity-planning notes. |
| `ONBOARDING.md` | First-run / onboarding notes. |
| `EMAIL.md` | Server-sent email design + scaling plan. |
| `ANALYTICS.md` | Usage-reporting approach (`tools/analytics.js`). |
| `AI-EDITING.md` | Post-beta generative photo-editing plan. |

---

## 12. Conventions for future changes

- Add a logging field → mutate `state` + call `persist()`. Sync handles the rest.
- New per-entry time → use the `timeStrip('when','Label')` component + `getWhen('when')`.
- New shared data → put it in the `app` blob (`appBlobFromState` / `applyAppBlob`).
- New UI in the family/sharing area → `store-firebase.js`; avatars/pickers → `cubby-extras.js`.
- Always `node --check` each JS file, verify in the preview, bump `app/sw.js` `CACHE`, then push.
```bash
node --check app/store-firebase.js && node --check app/cubby-extras.js \
  && node --check app/growth-data.js && node --check app/landing.js \
  && node --check app/pregnancy-data.js
```
