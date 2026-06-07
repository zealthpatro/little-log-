# Cubby — Email design & scaling plan

Status: **design only, not built.** Today invites use a `mailto:` button (opens the sender's
mail app) in `store-firebase.js → submitInvite()`. This doc is the plan for real, app-sent email,
written so it can be executed later without re-deciding.

---

## 1. Goals & scale targets
- **Now:** family scale, a handful of invites. Free, no card.
- **Target:** ~5,000 users, ~100,000 emails/month, **including promotional content**.
- Must not jeopardize transactional deliverability (a baby app's fever/appointment/invite
  emails *must* reach the inbox).

## 2. Two email streams (keep them separate)
Mixing marketing and transactional on one domain/IP wrecks transactional inbox placement.
Separate them by **subdomain and provider stream** from the start.

| Stream | Examples | Tooling |
|---|---|---|
| **Transactional** | invite, member-added, fever alert, upcoming-appointment, doctor-summary email, account notices | Cloud Function → ESP API |
| **Marketing / lifecycle** | onboarding drip, weekly digest, feature announcements, promotions | Dedicated marketing platform with lists/segments/unsubscribe/analytics |

DNS: `mail.cubby...` for transactional, `news.cubby...` for marketing. Set up **SPF, DKIM,
DMARC** on each. (Requires a custom domain — `*.workers.dev` can't host email auth, so a custom
domain is a prerequisite for serious sending.)

## 3. Recommended providers (verify current pricing/features at build time)
**Transactional**
- **Amazon SES** — cheapest (~$0.10 / 1,000 → ~$10 at 100k/mo). Bare-bones: you build
  templates/retries/suppression. Best if cost-optimizing and comfortable with AWS.
- **Resend** — excellent DX, React/HTML templates, webhooks, has **Broadcasts** for marketing
  too. ~$20–35/mo at 100k. **Recommended default** for balance of ease + deliverability.
- **Postmark** — best-in-class transactional deliverability; discourages bulk marketing.

**Marketing / lifecycle**
- **Brevo** — transactional *and* marketing in one, cost-effective (~$20–65/mo at volume). Good
  all-rounder, non-dev friendly UI.
- **Loops** / **Customer.io** — product-led lifecycle (events → campaigns), great for drips.
- **Mailchimp / Klaviyo** — full marketing suites, priced per contact; pick if marketers (not
  devs) own campaigns.

**Likely pick:** Resend (transactional) + Brevo or Loops (marketing). Or SES if squeezing cost.

## 4. Why not the "obvious" options at scale
- **EmailJS:** transactional/form tool; sends via your mailbox (≤~2k/day), no deliverability
  infra, no marketing/consent features, public key abusable. Fine for family invites only.
- **Firebase "Trigger Email" extension:** thin SMTP relay (better than EmailJS — server-side,
  your domain) but **transactional-only**; no campaigns/lists/unsubscribe. Usable as the
  transactional path early, but you'll outgrow it for promo.

## 5. Architecture (Firebase stays the data/auth core)
```
Firestore (users, households, consent)
   │  event / explicit trigger
   ▼
Cloud Function  sendTransactionalEmail(type, to, data)
   │  calls ESP API (Resend/SES) using a server-side API key (never in client)
   ▼
ESP  → inbox        (+ webhook → Firestore: delivered/bounced/complained → suppression)

Marketing: scheduled Function or platform-native automations pull the consented user list
(from Firestore via API/export) into the marketing tool; campaigns run there.
```
- Keep one **abstraction**: a single `sendEmail(template, to, vars)` entry point. Today it can be
  EmailJS; later it becomes a callable Cloud Function. Callers (e.g. invite flow) never change.
- The client never holds a sending API key — only the Cloud Function does.

## 6. Firestore additions (build later)
```
users/{uid}
  email, emailVerified
  consent: { transactional:true, marketing:false, updatedAt }   // marketing requires opt-in
  marketingUnsubToken                                           // for one-click unsubscribe
mail_suppression/{emailLowercase}  { reason:'bounce'|'complaint'|'unsub', at }
mail_log/{id}  { to, type, providerId, status, at }             // optional audit
```
Check `mail_suppression` before any send. Honor `consent.marketing` for promo.

## 7. Compliance checklist (promotional)
- Explicit **opt-in** for marketing (separate from transactional). Default off.
- **Unsubscribe** link in every marketing email (one-click), reflected in `consent.marketing`.
- Physical mailing address + sender identity in marketing footer (CAN-SPAM).
- GDPR: lawful basis, data export/delete already feasible (Firestore), record consent timestamp.
- Never put marketing content in transactional emails.

## 8. Phased execution
**Phase 0 — now (optional, free):** EmailJS for invites. One function, no card.
Template vars already chosen: `to_email, inviter_name, baby_name, role, app_link`.

**Phase 1 — transactional, real:** custom domain + DNS (SPF/DKIM/DMARC); enable **Blaze**;
Cloud Function `sendTransactionalEmail` → Resend/SES; add `consent` to user docs; swap invite
send + add fever/appointment/summary emails; wire bounce/complaint webhook → suppression.

**Phase 2 — marketing:** stand up Brevo/Loops; sync consented users; build unsubscribe flow +
token; onboarding drip + weekly digest; separate `news.` subdomain.

**Phase 3 — scale hygiene:** monitor bounce/complaint rates, warm up volume, dashboards,
per-type send caps, retries/backoff in the Function.

## 9. Where it plugs into current code
- Invite send lives in `store-firebase.js → submitInvite()` (currently builds a `mailto`).
  Replace the send with `await sendEmail('invite', email, {inviter_name, baby_name, role, app_link})`.
- Keep `mailto` as the offline/failure fallback.
- New transactional triggers (fever, appointment) can call the same `sendEmail()` from the app
  (Phase 0/EmailJS) or be moved server-side to Firestore-event-driven Functions (Phase 1).

## 10. Decision log
- 2026-06: For family scale, ship/keep free client email (EmailJS or mailto). Do **not** build
  Blaze/ESP yet. Revisit when approaching real users or adding promotional email.
- Transactional ≠ marketing: always separate streams, domains, and consent.
