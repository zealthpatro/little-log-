# Cubby — Changelog

## v0.9.0 — beta (2026-06) — first close-group test build
The full journey from a single-file local app to a shared, cloud-synced product.

**Platform**
- Cloud backend: Firebase Auth (Google sign-in) + Cloud Firestore real-time sync.
- One shared "household" per family; owner vs caregiver roles enforced by security rules.
- Hosted on Cloudflare (auto-deploys on push); installable PWA, offline-capable.

**Sharing & people**
- Invite by email (Copy link / mailto email button / relationship + co-owner).
- Remove member; first-run setup (pick your bear + relationship).
- Per-person and per-baby **bear avatars** (fur + accessory), changeable.
- Entry attribution — "logged by <relationship>" with the person's mini bear.

**Logging**
- Unified **time strip** across all flows (feed, diaper, sleep, pump, activity): one tap to set
  date + time via a custom warm picker.
- Sleep: live timer + past nap with "still sleeping (ongoing)" toggle; shared live timers.

**Health**
- Fever → see-doctor nudge (age-aware) + 24h home banner.
- Doctor-visit summary (last 7 days, copyable/shareable) + upcoming-appointment banner.
- **Growth charts**: WHO (0–24mo) + CDC (0–36mo) percentile bands with Boy/Girl selector and
  "latest ~Nth percentile" readout (data sourced from official CDC/WHO files).

**Beta**
- In-app **Send feedback** (Settings + 👨‍👩‍👧 menu) → Firestore `feedback` (read in console).
- New-user welcome/expectations note; version stamp (this file).

**Docs**
- `README.md` (architecture/data model/deploy), `HANDOFF.md` (resume guide), `EMAIL.md`
  (email scaling plan).

---
_Conventions: bump this file + `sw.js` CACHE on each release; see README §10._
