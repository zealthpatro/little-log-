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

## 9b. Auth emails (sign-in links) — current state + branded-email decision (11 June 2026)
**What exists today (done):**
- Email **magic-link sign-in** is live alongside Google (`store-firebase.js`: `sendSignInLinkToEmail`
  / `isSignInWithEmailLink` / `signInWithEmailLink`; provider + passwordless toggle enabled in console).
- **Custom sender domain configured for Firebase auth emails**: SPF (`v=spf1
  include:_spf.firebasemail.com ~all`), `firebase=little-log-a9caa` TXT, and two DKIM CNAMEs
  (`firebase1/2._domainkey`) live in Cloudflare DNS on the apex. Auth emails send from
  `noreply@little-cubby.com` (sender name "Cubby", public-facing name "Cubby"). This was needed
  because Gmail silently dropped mail from the shared `firebaseapp.com` sender.

**Decision: no custom HTML for auth emails yet.** Firebase locks the auth-email body
(anti-spam), so the only branding available is sender name + domain + %APP_NAME%, which we've
done. Plain transactional emails also deliver better; that wins for now.

**When the email phase is built, fold sign-in links into it:** a Cloudflare **Worker** (free,
fits the no-Blaze constraint better than Cloud Functions) obtains the link via the Admin API
(`accounts:sendOobCode` with `returnOobLink: true`, service-account OAuth) and sends a branded
template through the transactional ESP (Resend default). One Worker + one ESP then covers
branded invites, sign-in links, and digests. Note: MailChannels' free Workers tier was
discontinued (2024), so an ESP key is required either way.

**SPF caveat for the future split:** the apex SPF currently includes only `firebasemail.com`.
When adding an ESP, send marketing/transactional from **subdomains** (`mail.`/`news.`, per §2)
with their own SPF/DKIM, and leave the apex record for Firebase auth mail.

## 9c. Did the sign-in email actually go? (16 Nov 2026)
A 2xx from Resend means Resend **accepted** the email, nothing more. Resend answers 2xx for an
address on its suppression list and then never sends it, and a bounce arrives after acceptance. On
16 Nov 2026 a new Gmail address asked for a code three times; each send was a 2xx, the app said
"Check your inbox: we just emailed you", and nothing arrived in any folder
(`docs/postmortems/2026-11-16-signin-email-not-delivered.md`). Until then Cubby kept no Resend id,
logged nothing and could not learn what happened after acceptance.

**What the Worker does now** (`worker.js`, `signinSent`, `signinMailState`, `signinStatus`):
- Each send (code or link) writes ONE log line: `signin_send {"kind","status","id"}`, or
  `{"kind","status","error"}` on a refusal (Resend's error *name* only; its message can repeat the
  address). Never the address, the code, the link or a token.
- On a 2xx with an id it keeps `{id, kind, at}` in the Cache API for an hour, under a SHA-256 of a
  fresh 128-bit `sendRef`, and returns the `sendRef` to the app. The app never holds Resend's id.
- `POST /api/signin-status {ref}` (same origin; its own limiter bucket `status:<network>` on
  `SIGNIN_RATE_LIMITER`, so polling never spends the code budget) reads
  `GET https://api.resend.com/emails/{id}` and answers ONE word: `sent` (queued, scheduled, sent),
  `delivered` (delivered, opened, clicked, and complained, which Resend defines as delivered and then
  marked as spam), `delayed` (delivery_delayed), `undeliverable` (bounced, suppressed, failed,
  canceled) or `unknown` (anything else, any non-2xx, a timeout of 5 s, a ref it did not mint). The
  email body (it holds the code), the recipient and the subject are never returned or logged.
- Bounded: at most 6 Resend reads per email, at least 4 s apart, and a settled answer (delivered or
  undeliverable) is kept and never asked again. Resend's rate limit is per team (10 a second) and
  shared with every send.
- The Cache API is per data centre, so a status ask that lands in another colo finds nothing and is
  `unknown`. That is the safe direction: the panel then says nothing new.

**What the app does** (`app/store-firebase.js`, the email panel): after a send that came back with a
`sendRef`, while the code panel is open and she is not signed in, it asks at about 8, 20, 45 and 90
seconds and stops at the first settled answer. `undeliverable` replaces "Check your inbox" with "We
couldn’t get that email to <address>, so no code is on its way. Check the address, or continue with
Google or Apple." (For an email that carried no code: "so it won’t arrive".) `delivered` adds "It’s been delivered. If it isn’t in your inbox, have a look in
Spam or Promotions." Anything else changes nothing. The code box, its focus and what she typed are
never touched. A Worker that returns no `sendRef` (older builds) leaves the panel exactly as before.

**The Resend key must be Full access for any of this to answer.** A Sending-access key gets 401
`restricted_api_key` on `GET /emails/{id}`, which is `unknown`, so with today's key (permission not
yet checked) the panel shows exactly what it showed before and only the log line is new. Resend has no
read-only permission: reading needs Full access, which also lets the key manage domains and read
every email. That trade is the founder's call.

**The cooldown's cache key no longer holds the address.** It is an HMAC (the sign-in code key,
label `cooldown:`) of the normalised address, under `cooldown.cubby.internal/code/` or `/link/`.
Cloudflare's zone analytics list every cache read and write as a subrequest path, and the old key
put each address that asked for a sign-in email there in plain text.

**Logs are not kept yet.** Without `[observability]` in `wrangler.toml`, `signin_send` and
`signin_status` lines are visible only live (`npx wrangler tail cubby`). Workers Logs was left off on
purpose: every `console.*` argument in `worker.js` is clean, but a log event most likely carries its
request's URL, and `/api/invite-peek?t=<invite token>` logs a line when its limiter refuses. Turning
it on (with `[observability.logs] invocation_logs = false`) is the founder's decision.

## 10. Decision log
- 2026-06: For family scale, ship/keep free client email (EmailJS or mailto). Do **not** build
  Blaze/ESP yet. Revisit when approaching real users or adding promotional email.
- 2026-06-11: Magic-link sign-in shipped; Firebase auth emails moved to noreply@little-cubby.com
  (SPF/DKIM in Cloudflare) after Gmail dropped the default sender. Branded auth-email HTML
  deferred to the ESP phase (see §9b), where a Worker + `returnOobLink` takes over sending.
- 2026-06-14: **§9b Worker sender BUILT (code)** on `main` (production deploys from `main`; push =
  live via Cloudflare Workers Builds). `worker.js` now exposes
  `POST /api/send-signin-link`: mints the EMAIL_SIGNIN link via the Identity Toolkit Admin API
  (service-account JWT signed with WebCrypto RS256 -> OAuth token -> `sendOobCode` with
  `returnOobLink:true`) and sends a branded email via Resend. Client (`store-firebase.js`) calls
  the endpoint and falls back to Firebase's own sender if it's unreachable; completion via
  `signInWithEmailLink()` is unchanged. Hardened after an adversarial review (2026-06-14): rejects
  requests whose Origin/Referer don't match the host (closes the no-Origin bypass); per-email
  cooldown uses a normalized key (drops +tags / Gmail dots) and is set only after a confirmed send.
  **Per-IP rate limiting is now done IN-WORKER** (no Cloudflare dashboard rule needed): a Workers
  rate-limiting binding (`wrangler.toml [[unsafe.bindings]]` `SIGNIN_RATE_LIMITER`, **5 requests /
  60s per IP**) is enforced in `worker.js` right after the same-origin check, before any body or
  token work. Over budget it returns **429 + Retry-After**; it fails open if the binding is
  missing. This replaces the previously-planned dashboard Rate Limiting rule and deploys on push.
  The cooldown is per-email/per-colo and is NOT the volume defence; the per-IP limiter is. (Optional
  next-level hardening: Cloudflare Turnstile on the form.) The leaked Resend key was **rotated**
  (2026-06-14; new key lives only as the `RESEND_API_KEY` Worker secret). **Verified live
  2026-06-14.** Accepts the service-account-in-Worker-secret tradeoff (founder go-ahead 2026-06-14)
  -- the only way to custom-send Firebase auth links.
- Transactional != marketing: always separate streams, domains, and consent.
- 2026-11-16: A new Gmail address never received three sign-in emails that Resend accepted. The
  scope (this address, or every Gmail parent) waits on Resend's dashboard. Built the same day (§9c):
  one log line per send with Resend's id, `/api/signin-status` and the panel note for an email that
  could not be delivered, and the cooldown's cache key hashed so no address reaches Cloudflare's
  analytics. Gmail has dropped this product's mail silently before (2026-06-11, above), so a
  `delivered` from Resend does not close the question on its own.
