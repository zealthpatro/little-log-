-- cubby-admin, the admin Worker's own D1 database (spec §9.2). Written ONLY by the admin Worker.
--
-- Apply once, after `npx wrangler d1 create cubby-admin` (docs/ADMIN-DEPLOY.md):
--   npx wrangler d1 migrations apply cubby-admin --remote -c workers/admin/wrangler.toml
--
-- Holds the access log, a directory cache of CURRENT state only, and the read-budget meter. It never
-- holds anything anyone logged: no entry value, no entry time, no record type tied to a day, no baby
-- name, no invitee address, no invite token, no stage history.

-- Append-only. No UPDATE or DELETE of these two tables exists anywhere in code (a gate scans for it).
-- Each row chains to the one before: hash = sha256(prev_hash, the row's own columns, its sorted hids).
CREATE TABLE IF NOT EXISTS access_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor      TEXT NOT NULL,     -- first name from ADMIN_PEOPLE ('unknown' for a refused request)
  actor_id   TEXT NOT NULL,     -- first 16 hex of sha256(lowercased address); never the address
  action     TEXT NOT NULL,     -- fixed list (workers/admin/src/log.mjs ACTIONS)
  target_hid TEXT,
  target_uid TEXT,              -- set whenever the action concerns one person
  detail     TEXT NOT NULL DEFAULT '{}',   -- fixed keys, fixed-vocabulary values; never free text
  country    TEXT,              -- cf-ipcountry; never the IP
  ray        TEXT,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS al_hid ON access_log(target_hid, at);
CREATE INDEX IF NOT EXISTS al_uid ON access_log(target_uid, at);

-- The households a list view or an export showed. Written in the same batch as its row.
CREATE TABLE IF NOT EXISTS access_log_hids (
  seq INTEGER NOT NULL, hid TEXT NOT NULL, PRIMARY KEY (seq, hid)
);
CREATE INDEX IF NOT EXISTS alh_hid ON access_log_hids(hid);

-- Directory cache: CURRENT state only. No history, so no "was pregnant last week" can exist.
-- babies, baby_detail and journey are the two halves the stage is worked out from (the household
-- document gives the babies, the shared pregnancy journey gives the rest); journey is NULL unless the
-- journey is shared with another current member of the household.
CREATE TABLE IF NOT EXISTS dir_households (
  hid TEXT PRIMARY KEY, display_no INTEGER UNIQUE NOT NULL, owner_uid TEXT, owner_first_name TEXT,
  stage TEXT, stage_detail TEXT,
  babies INTEGER NOT NULL DEFAULT 0, baby_detail TEXT, journey TEXT,
  created_at INTEGER, plan TEXT, waitlisted INTEGER, deletion_pending INTEGER, invited_json TEXT,
  last_entry_day TEXT,                    -- YYYY-MM-DD, day level only
  entries_total INTEGER,                  -- a COUNT aggregation, nothing more
  authors_7d INTEGER, kinds_7d TEXT,      -- distinct authors, and coarse kind counts, last 7 days
  is_internal INTEGER NOT NULL DEFAULT 0, refreshed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dir_people (
  uid TEXT PRIMARY KEY, hid TEXT, name TEXT, email TEXT, email_verified INTEGER, relationship TEXT,
  role TEXT, joined_at INTEGER, joined_source TEXT,
  signed_up_at INTEGER, providers TEXT,
  acq_source TEXT, acq_content TEXT, referred INTEGER, push_on INTEGER, quiet TEXT, tz TEXT,
  team_notes TEXT,
  -- Per-person activity: written only from phase 3, NULL before (S45).
  last_sign_in INTEGER, last_refresh INTEGER, entries_7d INTEGER,
  is_internal INTEGER NOT NULL DEFAULT 0, refreshed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dp_hid ON dir_people(hid);

-- Per household per day, for the ranges and the wedge. No uid, no type, no time. Kept 90 days.
CREATE TABLE IF NOT EXISTS dir_household_days (
  day TEXT NOT NULL, hid TEXT NOT NULL, entries INTEGER NOT NULL, authors INTEGER NOT NULL,
  PRIMARY KEY (day, hid)
);
CREATE INDEX IF NOT EXISTS dhd_hid ON dir_household_days(hid);

-- Refresh cursors, the read meter, display_no_next (the high-water mark), the log head.
CREATE TABLE IF NOT EXISTS admin_meta (key TEXT PRIMARY KEY, value TEXT, at INTEGER);
INSERT OR IGNORE INTO admin_meta (key, value, at) VALUES ('display_no_next', '1', 0);

-- What the founder's resume command copies when the access log breaks (docs/ADMIN-DEPLOY.md, "If the access
-- log breaks"), as one record: log_resume:<to> = '<from>:<hash>'. <to> is the highest entry number ever handed
-- out: the newest entry, the head record, the cron's checkpoint and sqlite_sequence (AUTOINCREMENT's own
-- high-water mark, which a DELETE never lowers), whichever is highest. <from> is the first number above the
-- newest entry still there, so one record names the whole run missing below <to>. <hash> is what the next
-- entry chains to: the head record's, or the newest entry's when the head record is gone. So the next number
-- is <to> + 1, never one handed out before, and the range stays named on the Access log tab for good
-- (workers/admin/src/log.mjs, resumesFrom).
CREATE VIEW IF NOT EXISTS log_resume_next AS
WITH
  h AS (SELECT json_extract(value, '$.seq') AS seq, json_extract(value, '$.hash') AS hash FROM admin_meta
        WHERE key = 'log_head' AND json_valid(value) AND json_type(value, '$.seq') = 'integer'
          AND length(json_extract(value, '$.hash')) = 64),
  l AS (SELECT seq, hash FROM access_log ORDER BY seq DESC LIMIT 1),
  top AS (SELECT MAX(COALESCE((SELECT seq FROM h), 0), COALESCE((SELECT seq FROM l), 0),
                     COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'access_log'), 0),
                     COALESCE((SELECT json_extract(value, '$.tip.seq') FROM admin_meta WHERE key = 'log_check' AND json_valid(value)), 0)) AS n)
SELECT 'log_resume:' || top.n AS key,
       (COALESCE((SELECT MAX(seq) FROM access_log WHERE seq <= top.n), 0) + 1)
         || ':' || COALESCE((SELECT hash FROM h), (SELECT hash FROM l)) AS value
FROM top WHERE top.n > 0;
