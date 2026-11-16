-- cubby-usage: Cubby's own usage events (docs/superpowers/specs/2026-11-13-admin-dashboard-design.md §9.1).
-- Written ONLY by the main Worker (POST /api/usage, the daily retention run, the account and household
-- purges, the weekly orphan sweep). The admin Worker reads it and never writes it.
-- Apply: npx wrangler d1 execute cubby-usage --remote --file=./schema/usage.sql
-- Every statement is idempotent, so re-applying is safe.

-- One row per accepted event. Raw rows live 90 days (30 when uid is NULL, 30 for JOURNEY_KEYS); the
-- daily run deletes a signed-in visit WHOLE once its oldest row passes 90 days (workers/usage/core.mjs).
-- WITHOUT ROWID: the (who, id) key is the table itself, so a write touches the table and the four
-- indexes below and no separate key index (D1 bills one written row per row and per index it touches).
CREATE TABLE IF NOT EXISTS usage_events (
  who            TEXT NOT NULL,      -- uid, or 'anon_' || device before sign-in
  id             TEXT NOT NULL,      -- client v4 uuid, validated; INSERT OR IGNORE makes retries harmless
  at             INTEGER NOT NULL,   -- server receive time, ms UTC
  client_at      INTEGER NOT NULL,   -- device time, clamped
  local_day      TEXT NOT NULL,      -- YYYY-MM-DD in the person's time zone
  local_hour     INTEGER NOT NULL,   -- 0 to 23 in the person's time zone
  tz             TEXT NOT NULL,
  uid            TEXT,               -- from the verified token; NULL only before sign-in
  hid            TEXT,               -- stamped from the membership cache; never from the client
  role           TEXT,               -- owner | caregiver
  device         TEXT NOT NULL,
  visit          TEXT NOT NULL,
  platform       TEXT NOT NULL CHECK (platform IN ('ios_app','android_app','home_screen','browser')),
  os             TEXT NOT NULL,      -- coarse, server-derived
  browser        TEXT NOT NULL,      -- coarse, server-derived
  app_version    TEXT NOT NULL,
  native_version TEXT,
  name           TEXT NOT NULL,      -- from the allowlist
  props          TEXT NOT NULL,      -- canonical JSON, sorted keys, allowlisted keys and values only
  PRIMARY KEY (who, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ue_uid_at ON usage_events(uid, at);
CREATE INDEX IF NOT EXISTS ue_hid_at ON usage_events(hid, at);
CREATE INDEX IF NOT EXISTS ue_at     ON usage_events(at);
-- Every row of one person's visit, for retention and the household purge, which remove a visit whole.
CREATE INDEX IF NOT EXISTS ue_visit  ON usage_events(uid, visit);

-- Daily totals, per person, platform and day. Kept until the account is deleted.
-- JOURNEY_KEYS are stored here only as aggregate rows: uid = '' and hid = '' (kept 13 months).
CREATE TABLE IF NOT EXISTS usage_daily (
  local_day TEXT NOT NULL,
  uid       TEXT NOT NULL,
  hid       TEXT NOT NULL DEFAULT '',
  platform  TEXT NOT NULL,
  metric    TEXT NOT NULL CHECK (metric IN ('visits','seconds','screen','feature','signin_failed','save_failed')),
  key       TEXT NOT NULL DEFAULT '',
  n         INTEGER NOT NULL,
  PRIMARY KEY (local_day, uid, platform, metric, key)
);
CREATE INDEX IF NOT EXISTS ud_uid     ON usage_daily(uid);
CREATE INDEX IF NOT EXISTS ud_hid_day ON usage_daily(hid, local_day);

-- A row with no uid (a phone never signed in) goes 30 days after it was last seen, with its anonymous events.
CREATE TABLE IF NOT EXISTS devices (
  device TEXT PRIMARY KEY, uid TEXT, platform TEXT NOT NULL, os TEXT NOT NULL, browser TEXT NOT NULL,
  app_version TEXT NOT NULL, native_version TEXT, push TEXT,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dev_uid ON devices(uid);

CREATE TABLE IF NOT EXISTS membership (
  uid TEXT PRIMARY KEY, hid TEXT, role TEXT,
  notice TEXT,                          -- the person's privacyNoticeSeen at the last read
  checked_at INTEGER NOT NULL
);

-- Phase 4 and phase 3 tables, created now so the account purge erases them from the first day.
CREATE TABLE IF NOT EXISTS nudges (
  id          TEXT PRIMARY KEY,
  hid         TEXT NOT NULL,
  uid         TEXT NOT NULL,
  channel     TEXT NOT NULL CHECK (channel IN ('note','email','push')),
  template    TEXT NOT NULL,
  signal      TEXT,
  body        TEXT NOT NULL,
  link        TEXT,
  sent_by     TEXT NOT NULL,
  state       TEXT NOT NULL CHECK (state IN ('sent','refused','failed')),
  refused_why TEXT,
  at          INTEGER NOT NULL,
  seen_at     INTEGER,
  acted_at    INTEGER
);
CREATE INDEX IF NOT EXISTS nudge_hid_at ON nudges(hid, at);
CREATE INDEX IF NOT EXISTS nudge_uid    ON nudges(uid);

CREATE TABLE IF NOT EXISTS shared_entries (
  id TEXT PRIMARY KEY, hid TEXT NOT NULL, shared_by TEXT NOT NULL, entry_id TEXT NOT NULL,
  entry TEXT NOT NULL,
  at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS se_hid ON shared_entries(hid, expires_at);
CREATE INDEX IF NOT EXISTS se_by  ON shared_entries(shared_by);

CREATE TABLE IF NOT EXISTS usage_refused (day TEXT NOT NULL, reason TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, reason));
-- Day ceilings (events_YYYY-MM-DD, kept 90 days), the cron's day markers, and erase_hid:<hid>: a household
-- purge whose usage rows are not erased yet, written before its document goes and retried every tick.
CREATE TABLE IF NOT EXISTS usage_meta    (key TEXT PRIMARY KEY, value TEXT, at INTEGER);
