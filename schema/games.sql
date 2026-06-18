-- Cubby guessing-game store. ISOLATED in its own D1 (cubby-games), deliberately separate from the
-- Firestore family-health data. Holds ONLY the host's chosen public title + {nickname, guess, note}.
-- No mother name, due date, location, or baby record ever touches this database.
CREATE TABLE IF NOT EXISTS games (
  code       TEXT PRIMARY KEY,   -- high-entropy share code (the /g/<code> link)
  title      TEXT,               -- host-chosen public label, e.g. "Our baby"
  host_key   TEXT,               -- secret the host holds; required to reveal
  result     TEXT DEFAULT '',    -- '' | F | M | MF | FF | MM (set at reveal)
  status     TEXT DEFAULT 'open',-- open | revealed
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS guesses (
  id         TEXT PRIMARY KEY,
  code       TEXT,
  nickname   TEXT,
  guess      TEXT,               -- F | M
  note       TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_guesses_code ON guesses(code);
