# Cubby 🐻

A warm, private, shareable baby-tracker PWA. Feeds, sleep, nappies, pumping, growth,
milestones, medicine, vaccines, illness, photos and keepsakes — with real multi-caregiver
sharing, per-person bear avatars, and WHO/CDC growth-percentile charts.

- **Live app:** https://little-cubby.com (custom domain) — also https://cubby.saurav-918.workers.dev
- **Repo:** https://github.com/zealthpatro/little-log-
- **Hosting:** Cloudflare (Workers static assets) — auto-deploys on push to `main`
- **Backend:** Firebase (Google sign-in + Firestore) — project `little-log-a9caa`, free **Spark** plan

> The app is fully cloud-hosted and always-on. No local machine is required to keep it
> running — `localhost` is only for development.

---

## 1. Architecture at a glance

```
Phone / browser
   │
   ├─ index.html ............ the whole app (single-file vanilla JS UI, ~3.5k lines)
   ├─ firebase-init.js ...... Firebase config + init (auth, Firestore, offline cache)
   ├─ store-firebase.js ..... auth gate + real-time sync engine + sharing/family UI
   ├─ cubby-extras.js ....... bear avatars (SVG), custom time/date pickers, "When" strip
   ├─ growth-data.js ........ WHO + CDC growth percentile tables (generated)
   └─ sw.js ................. service worker (offline shell, network-first HTML)
        │
        ▼
   Firebase Auth (Google)  +  Cloud Firestore (shared "household" doc + subcollections)
        │
   Cloudflare serves the static files;  Firestore stores + syncs the data.
```

**Key idea:** the original app kept all state in a single global `state` object persisted via a
`Store`/`PhotoStore` abstraction. `store-firebase.js` swaps that persistence for Firestore
**without rewriting the ~20 logging functions** — it overrides `persist()` and `PhotoStore`,
and runs a diff-based sync engine. The app code still just mutates `state` and calls `persist()`.

---

## 2. File map

| File | Purpose |
|---|---|
| `index.html` | Entire UI + logging logic. Inline `<script>` defines `state`, `render()`, all `open*/save*` sheet functions, growth charts, fever nudge, visit summary. |
| `firebase-init.js` | Public Firebase web config; initializes `auth`, `db`; enables auth persistence + Firestore offline cache. Exposes `window.LL`. |
| `store-firebase.js` | Google sign-in screen; resolves/creates the household; one-time migration of old localStorage data; real-time listeners; diff-based `persist()`; photo storage in Firestore; Family & sharing UI (invite, relationship, remove member, copy/email link); first-run setup. |
| `cubby-extras.js` | `cubbyBear()` parametric SVG avatars; per-member/per-baby variants + picker; the custom warm **time picker** and unified **"When?" (date+time)** picker (intercepts native `<input type=time>`). |
| `growth-data.js` | `window.GROWTH_REF` = `{who,cdc}.{weight,height}.{M,F}` arrays of `[month,p5,p25,p50,p75,p95]`. Generated from official CDC/WHO data files (see §7). |
| `firestore.rules` | Security rules — members-only access, owner vs caregiver, invite-by-email join. |
| `wrangler.toml` | Cloudflare static-assets deploy config (`[assets] directory="./"`). |
| `.assetsignore` | Keeps source/docs out of the public deploy. |
| `sw.js` | Service worker; bump `CACHE` (`little-log-vN`) on every deploy. |
| `manifest.webmanifest` | PWA manifest (name "Cubby", icons, theme). |
| `generate_icons.py` | Pillow script that draws the bear app icons into `icons/`. |
| `_headers` | Cloudflare/Netlify header hints (keeps sw/manifest uncached). |

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
- **Keepsakes:** photo studio, monthly memory card, birth poster, milestones, twins support.
- Light/night themes; offline-capable PWA; installable to home screen.

---

## 6. Develop & deploy

### Local preview
```bash
cd little-log-pwa
python3 -m http.server 8080      # then open http://localhost:8080
```
`localhost` is a Firebase-authorized domain by default, so Google sign-in works locally.
After editing, hard-reload (the service worker is network-first for HTML); to fully reset,
unregister the SW + clear caches in DevTools, or bump `CACHE` in `sw.js`.

### Deploy (automatic)
Cloudflare Pages/Workers is connected to the GitHub repo. **Every push to `main` auto-deploys.**
Just:
```bash
git add -A && git commit -m "..." && git push
```
Bump `const CACHE = 'little-log-vN'` in `sw.js` whenever assets change so clients update.

### Deploy (manual, if ever needed)
```bash
npx wrangler deploy        # uses wrangler.toml ([assets] directory="./")
```

### Required when the live domain changes
Add the domain under **Firebase Console → Authentication → Settings → Authorized domains**
(currently `little-cubby.com`, `cubby.saurav-918.workers.dev`, `localhost`, `little-log-a9caa.firebaseapp.com`).

---

## 7. Regenerating growth data

`growth-data.js` is generated from official files (run from `/tmp` or anywhere):
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
| Firebase web config | in `firebase-init.js` (public by design; safe to commit) |

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

---

## 10. Conventions for future changes

- Add a logging field → mutate `state` + call `persist()`. Sync handles the rest.
- New per-entry time → use the `timeStrip('when','Label')` component + `getWhen('when')`.
- New shared data → put it in the `app` blob (`appBlobFromState` / `applyAppBlob`).
- New UI in the family/sharing area → `store-firebase.js`; avatars/pickers → `cubby-extras.js`.
- Always `node --check` each JS file, verify in the preview, bump `sw.js` `CACHE`, then push.
```bash
node --check store-firebase.js && node --check cubby-extras.js && node --check growth-data.js
```
