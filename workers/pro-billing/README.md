# Cubby Pro billing Worker

The payment loop for Cubby Pro (Base plan, $59/year with a 7-day trial). A single Cloudflare
Worker (free tier) that creates Stripe Checkout sessions, receives Stripe webhooks, and writes
the entitlement to `households/{hid}.pro` in Firestore. No Blaze, no servers, ~$0/month.

```
app "Start 7-day free trial"          Stripe                      this Worker
        │  POST /checkout  ─────────▶ Checkout (trial sub) ──pay──▶ webhook ─▶ Firestore
        │                                                           households/{hid}.pro
        ◀────────────────── real-time snapshot flips isPro() ───────────────────┘
```

## One-time setup (about 20 minutes)

1. **Stripe** (test mode first):
   - Create a product "Cubby Pro" with a recurring **yearly price of $59** -> copy the `price_...` id.
   - Developers > API keys -> copy the secret key (`sk_test_...` / later `sk_live_...`).
2. **Firebase service account**: Firebase console > Project settings > Service accounts >
   Generate new private key. Keep the JSON private (same one as `tools/serviceAccountKey.json`,
   which is gitignored). You'll paste it as a secret in step 4.
3. **Deploy the Worker** (from this directory):
   ```bash
   npx wrangler deploy
   ```
4. **Secrets**:
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   npx wrangler secret put STRIPE_PRICE_ID
   npx wrangler secret put FIREBASE_SA_KEY     # paste the service-account JSON as one line
   ```
5. **Stripe webhook**: Developers > Webhooks > Add endpoint ->
   `https://cubby-pro-billing.<your-account>.workers.dev/webhook`
   with events: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Copy the signing secret:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
6. **(Recommended) Billing portal**: Stripe > Settings > Billing > Customer portal -> activate,
   allow cancellations. The Worker's `/portal` endpoint then powers "Manage subscription".
7. **Publish the Firestore rules**: `firestore.rules` now blocks ALL client writes to the `pro`
   field (the Worker's admin credentials bypass rules). Paste the updated rules into the
   Firebase console and publish. **The entitlement is not tamper-proof until you do this.**
8. **Point the app at the Worker**: in `app/index.html`, set
   ```js
   const PRO_CFG = {
     checkoutUrl: 'https://cubby-pro-billing.<your-account>.workers.dev/checkout',
     portalUrl:   'https://cubby-pro-billing.<your-account>.workers.dev/portal',
     ...
   ```
   then bump `app/sw.js` CACHE and push. Until these URLs are set, the Pro sheet safely
   falls back to the waitlist.

## Test the loop (Stripe test mode)
1. Open the app on localhost, Settings > Cubby Pro > Start 7-day free trial.
2. Pay with card `4242 4242 4242 4242`, any future date/CVC.
3. You return to `/app/?pro=success`; within a couple of seconds the webhook writes
   `households/{hid}.pro` and every device in the household flips to Pro live.
4. Cancel from the portal -> `customer.subscription.updated/deleted` flips it back
   (a 3-day grace period in `isPro()` smooths renewals).

## Notes
- `until` = Stripe `current_period_end`; `active` covers `trialing | active | past_due`.
- The household id travels as `client_reference_id` and subscription `metadata.hid`.
- One subscription covers the whole household (family-friendly by design).
- This directory is excluded from the static-site deploy via `.assetsignore`.
