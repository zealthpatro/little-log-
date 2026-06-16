-- Cubby newsletter subscribers — Cloudflare D1. Deliberately ISOLATED from Firestore family-health
-- data: the marketing email list and the sensitive baby logs never share a store or a credential.
--
-- Apply once (after `wrangler d1 create cubby-newsletter`):
--   npx wrangler d1 execute cubby-newsletter --remote --file=./schema/newsletter.sql
--
-- Written by worker.js -> newsletterSignup() on POST /api/newsletter. Capture only; the send stream
-- (news. subdomain) is Phase 2 (EMAIL.md §2/§8). Export the list later with:
--   npx wrangler d1 execute cubby-newsletter --remote --command "SELECT email,stage,consent_at FROM subscribers WHERE status='subscribed'"

CREATE TABLE IF NOT EXISTS subscribers (
  email_hash   TEXT PRIMARY KEY,                     -- sha256(lowercased email): de-dupes without PII as the key
  email        TEXT NOT NULL,                        -- plaintext, needed to actually send later
  stage        TEXT,                                 -- 'expecting' | 'baby' | 'unknown' (journey segment)
  source       TEXT,                                 -- landing path the signup came from
  utm_source   TEXT,
  utm_campaign TEXT,
  status       TEXT NOT NULL DEFAULT 'subscribed',   -- 'subscribed' | 'unsubscribed'
  unsub_token  TEXT NOT NULL,                         -- one-click unsubscribe token (for the Phase-2 send)
  consent_at   TEXT NOT NULL,                         -- ISO timestamp of the explicit opt-in
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscribers_stage  ON subscribers(stage);
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
