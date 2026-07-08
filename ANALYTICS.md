# Cubby analytics: how to see beta usage

> **Status (June 2026):** Still no third-party analytics by design; usage is read privately from Cloudflare (traffic) and Firestore (product), now spanning the merged-and-live Baby + Expecting surfaces. Full current state + go-live plan: HANDOFF.md.

There is **no third-party analytics** in Cubby on purpose, that keeps the "no trackers, we never sell your data" promise true. Instead you read your own two private sources: **Cloudflare** (traffic) and **Firestore** (product usage). Nothing about a tester is shared with anyone.

## 1. Traffic (Cloudflare) — visitors, pages, referrers
Use this for the marketing/SEO side (which vaccine pages get hits, where visitors come from, speed).
- Cloudflare dashboard → your `cubby` Worker → **Metrics / Analytics**. Shows requests, unique visitors, status codes, and Web Vitals, with **zero extra script** and no cookies.
- (Optional) For richer per-page numbers, enable **Cloudflare Web Analytics** (Analytics → Web Analytics). It's cookieless and privacy-first. It does add a tiny first-party beacon; skip it if you want to keep "no client analytics at all."

## 2. Product usage (Firestore) — the real signal
Every log, household, photo, feedback and waitlist entry is already in Firestore. Two ways to read it:

### Quick look (no setup): Firebase Console
Firebase console → **Firestore Database**. Browse:
- `users` — how many people signed in.
- `households` — each family; open one to see `members` (caregivers) and `app.babies` (name, birthday, country).
- `households/{id}/events` — the actual logs.
- `feedback` — what testers wrote (Settings → Family & sharing → Send feedback).
- `waitlist` — Pro interest.

Good for a glance, but no aggregation across testers.

### Full report (recommended): the analytics script
`tools/analytics.js` prints a usage report aggregated across **all** testers. It must run server-side with a service account, because the security rules (correctly) stop any browser from reading other families' data.

**One-time setup**
1. Firebase console → **Project settings → Service accounts → Generate new private key**. Save the file as `tools/serviceAccountKey.json`. (It's already git-ignored and never deploys, do not share it.)
2. Install the SDK:
   ```
   cd tools
   npm init -y && npm install firebase-admin
   cd ..
   ```

**Run it any time**
```
node tools/analytics.js
```

**What it reports**
- **Reach**: signed-in users, households, active in last 24h / 7 days, **multi-caregiver households** (the core value prop), returned (2+ days), sticky (7+ days), Pro waitlist size.
- **Logging volume**: total events, average per active household, distinct loggers, and a breakdown by type (feed / sleep / nappy / pump / activity / vaccine / milestone …) with little bars.
- **Moments**: photos saved or tagged, vaccines marked given, milestones.
- **Countries**: which vaccine schedules are in use.
- **Per household**: created, last active, active days, # caregivers, # events, # photos, babies (age + country).
- **Feedback**: every written note, newest first.

## What patterns to watch in a small beta
- **Activation**: do new households log something within a day? (look at created vs first events)
- **Retention**: "Returned (2+ days)" and "Sticky (7+ days)" matter more than raw signups.
- **The wedge**: how many households are **multi-caregiver**? That's Cubby's differentiator.
- **Feature pull**: which event types dominate, and is anyone using **moments/photos** and **vaccines**? Those inform what to put behind Pro (see PAYWALL.md).
- **Qualitative**: read every feedback note; 5 good notes from 20 testers beats any chart.

## Privacy note
The service account can read everything, so treat `serviceAccountKey.json` like a password. Run the script locally, never commit it, never put it in the app. If you ever want scheduled reports, run this script on your own machine via cron, not in the deployed Worker.
