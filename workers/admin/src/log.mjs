/* The access log: every look the team takes, in a chain nobody can edit without it showing.
 *
 * Spec §9.2, S16 to S18. Append-only: this module has an INSERT and SELECTs and nothing else, and a gate
 * scans every file under workers/ for an UPDATE or DELETE against access_log or access_log_hids.
 *
 *   hash = sha256( prev_hash + "\n" + canonical JSON of the row's own columns + "\n" + its sorted hids )
 *
 * so editing a row, removing a row, or adding or removing a household from a row's list breaks the chain
 * at that row. The newest row is also mirrored as admin_meta.log_head in the same atomic batch, and every
 * new row chains to that head, not to whatever row is newest: deleting the newest rows (which no chain can
 * see on its own) stops the log, and the dashboard with it, naming the missing entries, and their numbers
 * are never reused. The Monday digest carries the head outside the database (S19).
 *
 * `detail` holds fixed keys with fixed-vocabulary values only. Search text, names, addresses and free
 * text cannot be written: a value outside its list throws before anything is stored (S18; F7 accepted:
 * reason codes and an optional R-0001 request number, never free text).
 */
export const GENESIS = '0'.repeat(64);

export const ACTIONS = Object.freeze(['view_overview', 'view_household', 'view_records', 'view_shared_entry',
  'export_csv', 'export_request', 'nudge_intent', 'nudge_outcome', 'erase_dry_run', 'erase_intent',
  'erase_outcome', 'manual_access', 'denied']);

export const TABS = Object.freeze(['people', 'households', 'visits', 'events', 'signins', 'devices', 'access']);
export const STAGE_FILTERS = Object.freeze(['any', 'pregnant', 'baby', 'none']);
export const SAVED_VIEWS = Object.freeze(['no_first_entry', 'one_logging', 'invite_waiting']);
export const RANGES = Object.freeze(['today', '7', '30', '90']);
export const PAGES = Object.freeze(['household', 'manual_access']);
export const MANUAL_REASONS = Object.freeze({
  family_asked: 'Family asked me to look at their record',
  data_recovery: 'Data recovery they asked for',
  legal_request: 'Legal request',
});
export const DENY_REASONS = Object.freeze(['no_jwt', 'malformed_jwt', 'bad_alg', 'no_kid', 'unknown_kid',
  'certs_unavailable', 'bad_signature', 'bad_aud', 'bad_iss', 'expired', 'not_yet_valid', 'service_token',
  'no_email', 'not_listed', 'host', 'origin', 'method', 'not_configured']);

const DETAIL = {
  tab: (v) => TABS.includes(v),
  stage: (v) => STAGE_FILTERS.includes(v),
  view: (v) => SAVED_VIEWS.includes(v),
  range: (v) => RANGES.includes(v),
  page: (v) => PAGES.includes(v),
  own: (v) => v === 'hidden' || v === 'shown',
  searched: (v) => v === true,
  rows: (v) => Number.isInteger(v) && v >= 0 && v <= 10000000,
  page_no: (v) => Number.isInteger(v) && v >= 1 && v <= 100000,
  reason: (v) => DENY_REASONS.includes(v) || Object.prototype.hasOwnProperty.call(MANUAL_REASONS, v),
  request: (v) => typeof v === 'string' && /^R-\d{4}$/.test(v),
};

export function checkDetail(detail) {
  const d = detail || {};
  if (typeof d !== 'object' || Array.isArray(d)) throw new Error('log_detail_shape');
  for (const k of Object.keys(d)) {
    if (!Object.prototype.hasOwnProperty.call(DETAIL, k)) throw new Error('log_detail_key');
    if (!DETAIL[k](d[k])) throw new Error('log_detail_value');
  }
  return d;
}

export function canonical(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x === undefined ? null : x);
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}';
}

export async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function actorId(email) { return (await sha256hex(String(email).trim().toLowerCase())).slice(0, 16); }

function rowHashInput(prev, row, hids) {
  const own = { seq: row.seq, at: row.at, actor: row.actor, actor_id: row.actor_id, action: row.action,
    target_hid: row.target_hid || null, target_uid: row.target_uid || null, detail: row.detail,
    country: row.country || null, ray: row.ray || null };
  return prev + '\n' + canonical(own) + '\n' + [...new Set(hids)].sort().join(',');
}

export const GENESIS_ANCHOR = Object.freeze({ seq: 0, hash: GENESIS });

/* The log's tail no longer matches its head record: entries were deleted, rewritten or written past it.
   Every route that would show family data answers 503 and names the entries (index.mjs). */
export class LogBroken extends Error {
  constructor(b) { super('log_broken_' + b.why); this.code = 'log_broken'; this.why = b.why; this.from = b.from; this.to = b.to; }
}

/* The words for a broken tail, one sentence, naming the entries. */
export function brokenLine(b) {
  const one = b.from === b.to;
  const which = one ? 'Entry ' + b.from + ' of the access log' : 'Entries ' + b.from + ' to ' + b.to + ' of the access log';
  if (b.why === 'missing') return which + (one ? ' is missing.' : ' are missing.');
  if (b.why === 'unheaded') return which + (one ? ' was' : ' were') + ' not written by the dashboard.';
  if (b.why === 'replaced') return which + ' was changed after it was written.';
  const also = b.from > 0 && b.to >= b.from ? (one ? ', and so is entry ' + b.from : ', and so are entries ' + b.from + ' to ' + b.to) : '';
  return 'The record of the newest access log entry is missing' + also + '.';
}

const parseAnchor = (v) => {
  let a = null; try { a = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; }
  return a && Number.isInteger(a.seq) && a.seq >= 0 && /^[0-9a-f]{64}$/.test(String(a.hash)) ? { seq: a.seq, hash: String(a.hash) } : null;
};

/* Resume records: the founder looked into a break, and the chain carries on (docs/ADMIN-DEPLOY.md, "If the
   access log breaks"; the command copies the view log_resume_next in 0001_init.sql). One record names one
   range of missing entries and what the next entry chains to:
     log_resume:<to> = "<from>:<hash>"
   <to> is the highest number handed out when the founder looked, <from> the first missing one, and <hash> the
   head record's (or, with the head record gone, the newest entry's). A resume never hides anything: its
   range stays a named gap on the Access log tab for good, and entries deleted below it later are a new break,
   never folded into it. A record whose <from> is past its <to> names no gap (an entry was replaced, or
   written past the head) and only lets the chain carry on. */
function resumesFrom(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r.key);
    if (!k.startsWith('log_resume:')) continue;
    const to = Number(k.slice(11));
    const v = /^(\d+):([0-9a-f]{64})$/.exec(String(r.value));
    if (Number.isInteger(to) && to > 0 && v && Number(v[1]) > 0) m.set(to, { from: Number(v[1]), hash: v[2] });
  }
  return m;
}
export async function loadResumes(db) {
  return resumesFrom(((await db.prepare("SELECT key, value FROM admin_meta WHERE key LIKE 'log_resume:%'").all()).results) || []);
}

/* Entries lo..hi are missing. Do resume records name them, from the top down, with the record at hi carrying on
   to `hash` (what the entry after the gap chains to; null when the caller has no entry to compare)?
   { gaps } when they do; { uncoveredTo } naming the highest number no record covers; null when hi has none. */
function resumedSpan(resumes, lo, hi, hash) {
  const top = resumes.get(hi);
  if (!top || top.from > hi || (hash != null && top.hash !== hash)) return null;
  const gaps = [];
  let cur = hi;
  while (cur >= lo) {
    const r = resumes.get(cur);
    if (!r || r.from > cur) return { uncoveredTo: cur };
    gaps.unshift({ from: Math.max(r.from, lo), to: cur });
    cur = r.from - 1;
  }
  return { gaps };
}

/* Of floor+1..hi (above the newest entry, up to the high-water mark), the lowest and highest numbers no
   resume record names; null when every one is named. */
function unresumed(resumes, floor, hi) {
  const cover = (n) => { for (const [to, r] of resumes) if (r.from <= n && n <= to) return { from: r.from, to }; return null; };
  let lo = floor + 1;
  for (let c; lo <= hi && (c = cover(lo));) lo = c.to + 1;
  let top = hi;
  for (let c; top >= lo && (c = cover(top));) top = c.from - 1;
  return lo <= top ? { from: lo, to: top } : null;
}

/* What the tail looks like now: the newest row (re-hashed with its households, so a change to its content
   shows even with its hash column left alone), the head record, the cron's verified tip, the resumes, and
   AUTOINCREMENT's high-water mark (sqlite_sequence: the highest number access_log ever held, which a DELETE
   never lowers; proven on Miniflare's D1, the plan's status notes). ONE statement, so one snapshot: read in
   two, another request's entry could land between them, and the head record would stand one past the newest
   entry it had just read, which looks exactly like a deleted entry (V2-6: a false "Access log broken" for a
   look that merely overlapped another). One SHA-256. */
async function tailState(db) {
  const t = await db.prepare('SELECT l.seq, l.at, l.actor, l.actor_id, l.action, l.target_hid, l.target_uid, l.detail, l.country, l.ray, l.prev_hash, l.hash, '
    + '(SELECT json_group_array(h.hid) FROM access_log_hids AS h WHERE h.seq = l.seq) AS hids, '
    + "(SELECT seq FROM sqlite_sequence WHERE name = 'access_log') AS hw, "
    + "(SELECT json_group_array(json_array(m.key, m.value)) FROM admin_meta AS m WHERE m.key = 'log_head' OR m.key = 'log_check' OR m.key LIKE 'log_resume:%') AS meta "
    + 'FROM (SELECT 1) AS one LEFT JOIN (SELECT * FROM access_log ORDER BY seq DESC LIMIT 1) AS l ON 1').first();
  let meta = [];
  try { meta = JSON.parse((t && t.meta) || '[]').map((kv) => ({ key: String(kv[0]), value: kv[1] })); } catch (e) { meta = []; }
  const headRow = meta.find((r) => r.key === 'log_head');
  const checkRow = meta.find((r) => r.key === 'log_check');
  let tip = null; try { tip = checkRow ? parseAnchor(JSON.parse(checkRow.value).tip) : null; } catch (e) { tip = null; }
  const hw = t && t.hw != null && Number.isInteger(Number(t.hw)) ? Number(t.hw) : 0;
  let last = null;
  if (t && t.seq != null) {
    let hids = [];
    try { hids = JSON.parse(t.hids || '[]'); } catch (e) { hids = [null]; }
    const intact = Array.isArray(hids) && hids.every((h) => typeof h === 'string')
      && await sha256hex(rowHashInput(t.prev_hash, t, hids)) === String(t.hash);
    last = { seq: Number(t.seq), hash: String(t.hash), intact };
  }
  return {
    last,
    hasHead: !!headRow, head: headRow ? parseAnchor(headRow.value) : null,
    tip, hw, resumes: resumesFrom(meta),
  };
}

/* The highest entry number ever handed out, as far as the database can tell: the newest row, the head record,
   the cron's checkpoint and the high-water mark. The next entry takes the number after it, so a number is
   never handed out twice, whatever was deleted or rewound. */
const highWater = (s) => Math.max(s.last ? s.last.seq : 0, s.head ? s.head.seq : 0, s.tip ? s.tip.seq : 0, s.hw || 0);

/* Does the tail still match the head record, with nothing handed out past it? null when it does. Otherwise the
   break: which entries (from..to, for the words; numbers a resume record already names are not named again
   as if new), what the chain would carry on from (anchor), and `hi`, the high-water mark a resume record
   must name. */
function brokenTail(s) {
  const L = s.last, H = s.head, hi = highWater(s);
  const floor = L ? L.seq : 0;
  const span = unresumed(s.resumes, floor, hi) || { from: floor + 1, to: hi };   // from > to: nothing past the newest entry
  if (!H) {
    if (L || s.hasHead) return { why: 'no_head', from: span.from, to: span.to, anchor: L, hi };
    return hi > 0 ? { why: 'missing', from: span.from, to: span.to, anchor: null, hi } : null;
  }
  if (L && L.seq > H.seq) return { why: 'unheaded', from: H.seq + 1, to: L.seq, anchor: H, hi };
  if (L && L.seq === H.seq && (L.hash !== H.hash || !L.intact)) return { why: 'replaced', from: H.seq, to: H.seq, anchor: H, hi };
  if (hi > floor) return { why: 'missing', from: span.from, to: span.to, anchor: H, hi };
  return null;
}

/* The founder resumed past exactly this break: the record at the high-water mark carries on from its anchor,
   and resume records name every number between the newest entry and the high-water mark. */
function resumedPast(s, b) {
  const r = b.anchor && s.resumes.get(b.hi);
  return !!r && r.hash === b.anchor.hash && !unresumed(s.resumes, s.last ? s.last.seq : 0, b.hi);
}

/* Append one row (and the households it showed) atomically.
 *
 * Each row chains to the HEAD RECORD (admin_meta.log_head), never to whatever row happens to be newest:
 * prev = head.hash, seq = the high-water mark + 1 (the newest row, the head, the cron's checkpoint and
 * sqlite_sequence, whichever is highest). And when the newest row does not match the head, or a number was
 * handed out past both (the tail was deleted, rewritten, written past, or the head record rewound over it),
 * nothing is appended at all: LogBroken, and the caller answers 503 naming the entries. So deleting the newest
 * entries cannot be covered over by the next look, and a number is never reused. Only a resume record for
 * that exact break lets the chain carry on, from the head, which leaves the deleted entries a permanent,
 * named gap.
 *
 * The insert names its seq explicitly, so two writers that read the same head collide on the primary key and
 * the loser retries on the new head: the chain never forks. Throws if it cannot land; the caller then serves
 * nothing (S16). */
export async function appendLog(db, entry, hids, extra) {
  if (!ACTIONS.includes(entry.action)) throw new Error('log_action');
  const detail = canonical(checkDetail(entry.detail));
  const list = [...new Set((hids || []).filter((h) => typeof h === 'string' && h))].sort();
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = await tailState(db);
    const b = brokenTail(s);
    let anchor;
    if (!b) anchor = s.head || GENESIS_ANCHOR;
    else if (resumedPast(s, b)) anchor = b.anchor;
    else throw new LogBroken(b);
    const row = {
      seq: highWater(s) + 1,
      at: entry.at, actor: entry.actor, actor_id: entry.actor_id, action: entry.action,
      target_hid: entry.target_hid || null, target_uid: entry.target_uid || null, detail,
      country: entry.country || null, ray: entry.ray || null,
    };
    const prev = anchor.hash;
    const hash = await sha256hex(rowHashInput(prev, row, list));
    const stmts = [db.prepare('INSERT INTO access_log (seq, at, actor, actor_id, action, target_hid, target_uid, detail, country, ray, prev_hash, hash) '
      + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(row.seq, row.at, row.actor, row.actor_id, row.action, row.target_hid, row.target_uid, row.detail, row.country, row.ray, prev, hash)];
    for (const h of list) stmts.push(db.prepare('INSERT INTO access_log_hids (seq, hid) VALUES (?, ?)').bind(row.seq, h));
    stmts.push(db.prepare("INSERT INTO admin_meta (key, value, at) VALUES ('log_head', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at")
      .bind(JSON.stringify({ seq: row.seq, hash }), row.at));
    for (const st of extra || []) stmts.push(st);
    try {
      await db.batch(stmts);
      return { seq: row.seq, at: row.at, hash };
    } catch (e) {
      if (/UNIQUE|constraint|PRIMARY/i.test(String((e && e.message) || e))) { if (attempt < 4) await retryWait(attempt); continue; }
      throw e;
    }
  }
  throw new Error('log_contended');
}

/* Two requests that read the same head collide on the primary key, and the loser tries again on the new head.
   A burst (several pages opened at once) used to retry in step and collide again: of twenty at once, five
   landed on the fixture and about ten on Miniflare's D1, and the rest were refused after five tries (V2-6).
   Each loser now waits a random, growing moment first (full jitter: anywhere up to 50, 100, 200, then 400 ms,
   so at most 750 ms in all, and none after the last try), so the burst lands one by one. Measured 14 Nov:
   twenty at once all landed in 8 of 8 bursts on Miniflare's D1 and in 289 of 300 on the test fixture (the
   worst lost seven, with the machine starved of CPU). Wall time only: a wait costs no CPU. */
export const RETRY_BASE_MS = 50;
const retryWait = (attempt) => new Promise((resolve) => setTimeout(resolve, Math.random() * RETRY_BASE_MS * 2 ** attempt));

const ROW_COLS = 'seq, at, actor, actor_id, action, target_hid, target_uid, detail, country, ray, prev_hash, hash';
async function hidsBetween(db, lo, hi) {
  const rows = ((await db.prepare('SELECT seq, hid FROM access_log_hids WHERE seq >= ? AND seq <= ?').bind(lo, hi).all()).results) || [];
  const bySeq = new Map();
  for (const h of rows) { const k = Number(h.seq); if (!bySeq.has(k)) bySeq.set(k, []); bySeq.get(k).push(h.hid); }
  return bySeq;
}

/* Walk the chain and name the first entry that does not verify.
 *
 *   opts.from   start AFTER this verified entry, {seq, hash} (default: the beginning). The entry itself is
 *               re-read and re-hashed first, so a checkpoint whose own entry was deleted or edited shows.
 *   opts.limit  verify at most this many entries, then stop with done: false (the Free plan's 10 ms of CPU
 *               per request: the cron walks in chunks and the tab only walks what is newer than the cron).
 *   opts.to     stop after this entry, done: true (the cron's sweep stops where its tip already verified).
 *
 * A gap the founder resumed past (resume records naming exactly those numbers, the top one carrying the hash
 * the next entry chains to) is not a break, and is not hidden either: it comes back in `gaps`, every time.
 * Numbers missing that no record names are a break, even right below a resumed gap. Reaching the end, the head
 * record must be the last entry verified. Entries written meanwhile by another request are walked too. */
export async function verifyChain(db, opts) {
  opts = opts || {};
  const from = opts.from && opts.from.seq > 0 ? { seq: Number(opts.from.seq), hash: String(opts.from.hash) } : GENESIS_ANCHOR;
  const limit = opts.limit > 0 ? opts.limit : Infinity;
  const to = opts.to > 0 ? opts.to : Infinity;
  const resumes = opts.resumes || await loadResumes(db);
  const gaps = [];
  let prevHash = from.hash, prevSeq = from.seq, rows = 0;
  const result = (o) => Object.assign({ rows, verifiedTo: prevSeq, verifiedHash: prevHash, gaps }, o);
  const headNow = async () => {
    const r = await db.prepare("SELECT value FROM admin_meta WHERE key = 'log_head'").first();
    return r ? (parseAnchor(r.value) || { bad: true }) : null;
  };

  if (from.seq > 0) {
    const a = await db.prepare('SELECT ' + ROW_COLS + ' FROM access_log WHERE seq = ?').bind(from.seq).first();
    if (!a) {
      /* The checkpoint's own entry is gone: name the whole run of missing entries around it. */
      const before = await db.prepare('SELECT MAX(seq) AS n FROM access_log WHERE seq < ?').bind(from.seq).first();
      const after = await db.prepare('SELECT MIN(seq) AS n FROM access_log WHERE seq > ?').bind(from.seq).first();
      const lo = (Number(before && before.n) || 0) + 1;
      let hi;
      if (after && after.n != null) hi = Number(after.n) - 1;
      else { const h = await headNow(); hi = Math.max(from.seq, (h && h.seq) || 0); }
      const next = after && after.n != null ? await db.prepare('SELECT prev_hash FROM access_log WHERE seq = ?').bind(Number(after.n)).first() : null;
      const span = resumedSpan(resumes, lo, hi, next ? next.prev_hash : ((await headNow()) || {}).hash || '');
      if (span && span.gaps) {
        gaps.push(...span.gaps);
        prevSeq = hi; prevHash = resumes.get(hi).hash;
      } else {
        prevSeq = lo - 1; prevHash = null;
        return result({ ok: false, done: false, brokenAt: lo, gapTo: span ? span.uncoveredTo : hi, why: 'missing' });
      }
    } else {
      const ah = await hidsBetween(db, from.seq, from.seq);
      if (a.hash !== from.hash || await sha256hex(rowHashInput(a.prev_hash, a, ah.get(from.seq) || [])) !== from.hash) {
        prevSeq = from.seq - 1; prevHash = null;
        return result({ ok: false, done: false, brokenAt: from.seq, why: 'edited' });
      }
    }
  }

  const PAGE = 500;
  for (;;) {
    if (prevSeq >= to) return result({ ok: true, done: true });
    if (rows >= limit) return result({ ok: true, done: false });
    const want = Math.min(PAGE, limit - rows);
    const page = ((await db.prepare('SELECT ' + ROW_COLS + ' FROM access_log WHERE seq > ? AND seq <= ? ORDER BY seq ASC LIMIT ?')
      .bind(prevSeq, to === Infinity ? Number.MAX_SAFE_INTEGER : to, want).all()).results) || [];
    if (page.length) {
      const bySeq = await hidsBetween(db, Number(page[0].seq), Number(page[page.length - 1].seq));
      for (const r of page) {
        const seq = Number(r.seq);
        if (seq !== prevSeq + 1) {
          const span = resumedSpan(resumes, prevSeq + 1, seq - 1, r.prev_hash);
          if (span && span.gaps) { gaps.push(...span.gaps); prevSeq = seq - 1; prevHash = r.prev_hash; }
          else return result({ ok: false, done: false, brokenAt: prevSeq + 1, gapTo: span ? span.uncoveredTo : seq - 1, why: 'missing' });
        }
        if (r.prev_hash !== prevHash) return result({ ok: false, done: false, brokenAt: seq, why: 'link' });
        const want2 = await sha256hex(rowHashInput(prevHash, r, bySeq.get(seq) || []));
        if (want2 !== r.hash) return result({ ok: false, done: false, brokenAt: seq, why: 'edited' });
        prevHash = r.hash; prevSeq = seq; rows++;
      }
      if (page.length === want) continue;
    }
    if (to !== Infinity) {
      /* A walk asked to reach `to` (the sweep, up to the cron's checkpoint) that runs out of entries first has
         found them missing: the checkpoint's entry and those before it were deleted after it was verified. */
      if (prevSeq < to) {
        const span = resumedSpan(resumes, prevSeq + 1, to, null);
        if (span && span.gaps) { gaps.push(...span.gaps); prevSeq = to; prevHash = resumes.get(to).hash; return result({ ok: true, done: true }); }
        return result({ ok: false, done: false, brokenAt: prevSeq + 1, gapTo: span ? span.uncoveredTo : to, why: 'missing' });
      }
      return result({ ok: true, done: true });
    }
    /* The end of the log. Nothing may hang past it, and the head record must stand at the last entry. */
    const orphan = await db.prepare('SELECT seq FROM access_log_hids WHERE seq > ? LIMIT 1').bind(prevSeq).first();
    const h = await headNow();
    if (h && !h.bad && h.seq > prevSeq) {
      if (await db.prepare('SELECT 1 AS x FROM access_log WHERE seq > ? LIMIT 1').bind(prevSeq).first()) continue;   // written meanwhile
      const span = resumedSpan(resumes, prevSeq + 1, h.seq, h.hash);
      if (span && span.gaps) { gaps.push(...span.gaps); return result({ ok: true, done: true }); }
      return result({ ok: false, done: false, brokenAt: prevSeq + 1, gapTo: span ? span.uncoveredTo : h.seq, why: 'missing' });
    }
    if (orphan) return result({ ok: false, done: false, brokenAt: prevSeq + 1, gapTo: Number(orphan.seq), why: 'missing' });
    if (h && (h.bad || h.seq !== prevSeq || h.hash !== prevHash)) {
      /* A head that cannot be read, a newest entry that is not the one the head names, or entries past it. */
      return result({ ok: false, done: false, brokenAt: !h.bad && h.seq < prevSeq ? h.seq + 1 : prevSeq, why: 'head' });
    }
    if (!h && prevSeq > 0) return result({ ok: false, done: false, brokenAt: prevSeq, why: 'head' });
    return result({ ok: true, done: true });
  }
}

/* ---- The chain check, sized for Workers Free (10 ms of CPU per request and per cron run) ----
 *
 * One entry verified is one SHA-256 over its canonical JSON. Walking the whole log on every Access-log view
 * grows with the log and passes 10 ms of CPU at about a thousand entries, so:
 *   - the cron (every 15 minutes) walks the chain in chunks and keeps, in admin_meta.log_check, a
 *     verified-to checkpoint `tip` {seq, hash}: everything up to it verified;
 *   - each tick has ONE budget of CHAIN_ROWS_PER_TICK entries: it walks forward from the tip first (after
 *     looks, usually a few entries), then spends what is left on a SWEEP from entry 1 again, up to where the
 *     tip stood when that sweep began, so an edit to an old entry (which the tip, moving forward, would never
 *     re-read) is found within one sweep, and kept as `broken`, however much the dashboard is in use;
 *   - the Access log tab verifies only from the tip, at most TAB_VERIFY_ROWS entries, re-hashing the tip's
 *     own entry first, shows what the sweep found, and says when the last full sweep finished (`swept`).
 * Measured under workerd (Miniflare, Nov 2026; the plan's status notes): one entry's canonical JSON and
 * SHA-256 cost about 7.6 microseconds of CPU, so the 150 a tick and the tab's 100 are about 1.2 and 0.8 ms.
 * The old whole-log walk on every tab view cost 136 ms with a 10,000-entry log (76 ms of it hashing alone). */
export const CHAIN_ROWS_PER_TICK = 150;
export const TAB_VERIFY_ROWS = 100;

const checkFrom = (value) => {
  let v = null; try { v = value ? JSON.parse(value) : null; } catch (e) { v = null; }
  v = v && typeof v === 'object' ? v : {};
  const sweepTo = Number.isInteger(v.sweepTo) && v.sweepTo > 0 ? v.sweepTo : null;
  return { tip: parseAnchor(v.tip), sweep: parseAnchor(v.sweep), sweepTo, swept: v.swept || null, broken: v.broken || null };
};
export async function readChainCheck(db) {
  const r = await db.prepare("SELECT value FROM admin_meta WHERE key = 'log_check'").first();
  return checkFrom(r && r.value);
}

const finding = (r, now) => ({ brokenAt: r.brokenAt, gapTo: r.gapTo || null, why: r.why, verifiedTo: Math.max(0, r.verifiedTo), found: now });

/* One cron run's share of the chain check. Never throws past a database error; returns what it stored.
 *
 * One read brings back the head record, the checkpoint and the resume records. Then one shared budget of
 * `rowsPerTick` entries: forward from the checkpoint to the head first (bounded by the head as it stood at the
 * start, so a look landing mid-tick is left for the next one), then the rest on the sweep. A quiet tick is 6
 * D1 statements (the sweep alone); a tick after looks about 10. Walking forward only, whenever there were new
 * looks, starved the sweep for as long as the dashboard was in use (V2-2), so an old entry deleted or edited
 * was never named. Every append and every Access log view check the tail against the head on their own. */
export async function checkChain(db, now, rowsPerTick) {
  const meta = ((await db.prepare("SELECT key, value FROM admin_meta WHERE key IN ('log_check', 'log_head') OR key LIKE 'log_resume:%'").all()).results) || [];
  const st = checkFrom((meta.find((r) => r.key === 'log_check') || {}).value);
  const headRow = meta.find((r) => r.key === 'log_head');
  const head = headRow ? parseAnchor(headRow.value) : null;
  const resumes = resumesFrom(meta);
  const chunk = rowsPerTick || CHAIN_ROWS_PER_TICK;
  let found = null, sweptClean = false, used = 0;
  const behind = !st.tip || !head || head.seq !== st.tip.seq || head.hash !== st.tip.hash;
  if (behind) {
    const r1 = await verifyChain(db, { from: st.tip || GENESIS_ANCHOR, limit: chunk, to: head ? head.seq : 0, resumes });
    used = r1.rows;
    if (r1.ok && head && r1.done && r1.verifiedTo === head.seq && r1.verifiedHash !== head.hash) {
      /* Every entry up to the head verifies, but the newest is not the one the head record names. */
      found = finding({ brokenAt: head.seq, why: 'head', verifiedTo: head.seq - 1 }, now);
    } else if (r1.ok) st.tip = { seq: r1.verifiedTo, hash: r1.verifiedHash };
    else found = finding(r1, now);
  }
  const left = chunk - used;
  if (left > 0 && st.tip && st.tip.seq > 0) {
    if (!st.sweep || !st.sweepTo) st.sweepTo = st.tip.seq;     // a new sweep runs to where the tip stands now
    const r2 = await verifyChain(db, { from: st.sweep || GENESIS_ANCHOR, limit: left, to: st.sweepTo, resumes });
    if (!r2.ok) {
      const f2 = finding(r2, now);
      if (!found || f2.brokenAt < found.brokenAt) found = f2;
      st.sweep = null; st.sweepTo = null;
    } else if (r2.done) { st.swept = { to: r2.verifiedTo, at: now }; st.sweep = null; st.sweepTo = null; sweptClean = true; }
    else st.sweep = { seq: r2.verifiedTo, hash: r2.verifiedHash };
  }
  /* A finding stays until a later sweep of the whole chain comes back clean. */
  if (found) st.broken = found;
  else if (sweptClean) st.broken = null;
  await db.prepare("INSERT INTO admin_meta (key, value, at) VALUES ('log_check', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at")
    .bind(JSON.stringify({ tip: st.tip, sweep: st.sweep, sweepTo: st.sweepTo, swept: st.swept, broken: st.broken }), now).run();
  return st;
}

/* Every gap the founder resumed past, wherever it is (the tab's walk from the tip cannot see the old ones), as
   each resume record named it. */
function resumedGaps(resumes) {
  const out = [];
  for (const [to, r] of resumes) if (r.from <= to) out.push({ from: r.from, to });
  return out;
}

/* What the Access log tab shows: its own walk from the cron's tip, every resumed gap, and the sweep's finding. */
export async function tabChain(db, now) {
  const st = await readChainCheck(db);
  const resumes = await loadResumes(db);
  const r = await verifyChain(db, { from: st.tip || GENESIS_ANCHOR, limit: TAB_VERIFY_ROWS, resumes });
  /* One line per run of missing numbers: a later resume can name a range that holds an earlier one. */
  const all = r.gaps.concat(resumedGaps(resumes)).sort((a, b) => a.from - b.from || b.to - a.to);
  r.gaps = [];
  for (const g of all) {
    const last = r.gaps[r.gaps.length - 1];
    if (last && g.from <= last.to + 1) last.to = Math.max(last.to, g.to);
    else r.gaps.push({ from: g.from, to: g.to });
  }
  if (r.ok && st.broken) return Object.assign({ ok: false, gaps: r.gaps, foundAt: st.broken.found, swept: st.swept }, st.broken);
  return Object.assign(r, { swept: st.swept });
}

/* A refused request leaves one `denied` row with its reason code and ray id, at most one a minute per
   reason, so a scanner cannot flood the log or the database. Never throws: a refusal is a refusal
   whether or not it could be written down. */
export async function recordDenied(db, code, meta) {
  const t = meta.now;
  const deniedAt = meta.throttle;       // per isolate (one per handler), reason -> last write
  const reason = DENY_REASONS.includes(code) ? code : 'not_configured';
  if (t - (deniedAt.get(reason) || 0) < 60000) return false;
  deniedAt.set(reason, t);
  if (!db || typeof db.prepare !== 'function') return false;
  try {
    const key = 'denied:' + reason;
    const last = await db.prepare('SELECT at FROM admin_meta WHERE key = ?').bind(key).first();
    if (last && t - Number(last.at) < 60000) return false;
    await appendLog(db, { at: t, actor: 'unknown', actor_id: '-', action: 'denied', detail: { reason },
      country: meta.country, ray: meta.ray }, [],
      [db.prepare('INSERT INTO admin_meta (key, value, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at').bind(key, reason, t)]);
    return true;
  } catch (e) { return false; }
}
