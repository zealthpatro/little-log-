# Cubby Pro — Lemon Squeezy (Merchant of Record) go-live

> **Decision (2026-06):** Pro billing uses **Lemon Squeezy (MoR)**, not raw Stripe — as a UAE-based
> founder selling worldwide, the MoR handles all global VAT/GST/sales-tax remittance, so we never
> register or file foreign tax. `worker-lemonsqueezy.js` is **built but NOT live**; `worker.js`
> (Stripe) is kept for reference. Pricing is unchanged: **$9/mo or $90/yr, 7-day trial.**
> Nothing charges anyone until every step below is done; the app keeps showing **"Register for Pro"**.

## Critical path (in order — earlier steps block later ones)

1. **UAE business license** — a freelancer/trade permit (legal entity to receive revenue). Lemon
   Squeezy onboards a *business*, not an individual. This is the real long-pole; confirm specifics
   with a local advisor. *(Everything below is blocked until this exists.)*
2. **Lemon Squeezy account + store** — sign up, create the store, complete payout + identity (KYC).
3. **Product + two variants** — one product "Cubby Pro" with variants **$9/month** and **$90/year**,
   each with a **7-day free trial** enabled. Note each **variant id**.
4. **API key + webhook** — create an API key; add a webhook pointing at the deployed worker's
   `/webhook`, subscribed to the **subscription_*** events, and note its **signing secret**.
5. **Deploy + wire the worker** (below), then **test in Lemon Squeezy TEST MODE**, then flip live.

## Worker setup (after steps 1–4)

In `workers/pro-billing/`:
- Point wrangler at the LS worker: set `main = "worker-lemonsqueezy.js"` in `wrangler.toml`
  (or rename it over `worker.js`). The Stripe file can be deleted once LS is verified live.
- **Vars** (`wrangler.toml`): `ALLOWED_ORIGINS` (e.g. `https://little-cubby.com`),
  `LS_STORE_ID`, `LS_VARIANT_MONTHLY`, `LS_VARIANT_ANNUAL`.
- **Secrets** (`npx wrangler secret put …`): `LEMONSQUEEZY_API_KEY`, `LS_WEBHOOK_SECRET`,
  `FIREBASE_SA_KEY` (the one-line service-account JSON — same key the analytics/sign-in workers use;
  it already has Firestore access since the Stripe worker used it).
- `npx wrangler deploy`.

## Client wiring (one tiny change, then it's automatic)

The entitlement the worker writes (`active|status` with vocabulary `trialing|active|past_due|paused|
canceled`) is **normalized to match the existing client**, so **`isPro()` and every gate are unchanged**.
At go-live, only:
- Set `PRO_CFG.checkoutUrl` → the worker's `/checkout`, and `PRO_CFG.portalUrl` → `/portal`, in
  `app/index.html`; bump `app/sw.js` CACHE; push. The Pro sheet flips from "Register for Pro" to the
  real trial-checkout automatically (empty `checkoutUrl` is what shows the waitlist today).
- Manage-subscription: the worker stores `pro.portalUrl` on each webhook, so the app can open it
  directly, or call `/portal {subId}` for a fresh link (`subId` is on `window.LL.pro`).

## Test in TEST MODE before going live (do not skip)

1. Lemon Squeezy **test mode** (test store / test keys). 2. From the app, start the trial → complete
the test checkout. 3. Confirm `households/{hid}.pro.active` flips **true** and a second device unlocks
live. 4. Cancel from the customer portal → confirm it flips back. 5. Let the trial "convert" (LS test
clock) → confirm `subscription_payment_success` keeps it active. Only then swap in live keys.

## How a dollar flows (unchanged from the Stripe design)

```
app "Start 7-day free trial" --POST /checkout {hid,email,plan}--> LS hosted checkout (card)
   LS --signed webhook (subscription_*)--> worker /webhook --service-account--> households/{hid}.pro
   real-time snapshot --> every device: window.LL.pro -> isPro() -> features unlock live
```
One subscription covers the whole household. The worker is the ONLY writer of `.pro`
(`firestore.rules` `proUnchanged()` rejects every client write), so no one can self-grant Pro.

## Until all of the above: nothing changes

`PRO_CFG.checkoutUrl` stays empty → the app shows **"Register for Pro" (Aug 2026)** and writes the
`waitlist`. Keep filling the waitlist + reading the funnel report; flip billing on at launch.
