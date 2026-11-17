/* The D1 shim's twin on the REAL engine: workerd's own D1, run locally and offline by Miniflare (offline is
 * enforced, not assumed: Miniflare starts with `cf: false`, and its thread refuses and records any socket
 * to anything but loopback; see d1-miniflare-host.mjs).
 * Tests only; never deployed (workers/admin/dev/ is outside every Worker's entry graph, and `workers` is
 * fenced by .assetsignore). test/usage-d1-engine.test.js is the gate that uses it.
 *
 * WHY. Every usage test ran on node:sqlite through d1-sqlite.mjs. D1 is SQLite too, but not the same one: it
 * refuses BEGIN and SAVEPOINT, a bound `undefined`, more than 100 bound parameters, a compound SELECT of more
 * than 5 terms (orphanSweep's UNION has 4), a LIKE or GLOB pattern over 50 bytes, and some functions
 * (sqlite_version() among them); it runs its own SQLite build; it bills rows written per index entry. The
 * shim takes all of those. So the same scenarios run here with every statement executed by workerd's D1
 * binding, exactly as production code calls it; test/usage-d1-engine.test.js asserts each limit but the
 * functions on D1 itself, and that the shim takes 101 parameters, 6 terms and a 51-byte pattern.
 *
 * HOW. makeD1() keeps the shim's surface, synchronous `raw` included, so a test switches engine with one
 * environment variable (CUBBY_D1_ENGINE=miniflare, read by d1-sqlite.mjs) and no other change. One worker
 * thread (d1-miniflare-host.mjs) owns one Miniflare with a pool of D1 databases; this thread waits for each
 * answer with Atomics.wait. Each makeD1() takes the next database of the pool (CUBBY_D1_POOL, 512). workerd
 * listens on CUBBY_D1_PORT (unset or 0: a free port the OS picks); Miniflare's own loopback server always
 * takes an OS-picked port. workerd is disposed when the process exits, and before it dies of a SIGTERM, SIGINT,
 * SIGHUP or SIGALRM (start(), below); a signal it does not catch (SIGKILL, SIGQUIT, ...) leaves it running.
 *
 * SHADOW (CUBBY_D1_SHADOW=1). Every statement also runs on a node:sqlite twin (the shim's own engine), and
 * every answer is compared: rows, changes, and whether it failed. A difference is recorded, not thrown: the
 * code under test always gets D1's answer, so it behaves as it would in production. With CUBBY_D1_REPORT
 * set, the counts, D1's own meta (rows_written, rows_read) and the first differences are appended to that
 * file as one JSON line when the process exits.
 *
 * THE SYNCHRONOUS `raw`. A test seeds and inspects through raw.exec / raw.prepare(sql).run|get|all, as on
 * node:sqlite. D1 refuses BEGIN, so raw writes between raw.exec('BEGIN') and raw.exec('COMMIT') are held and
 * sent at COMMIT as D1 batches of up to RAW_CHUNK statements (a read in between sends them first); such a
 * write's `changes` cannot be known when run() returns, and reading it throws rather than inventing one.
 */
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* The Miniflare (and so workerd) this gate is pinned to: what wrangler 4.162.0 ships. CI installs exactly
   this version; on a Mac it is found in npx's cache. MINIFLARE_PATH says where to look instead, and is held to
   the same pin: another build's limits and meter may differ from the ones measured here, so it is refused
   unless MINIFLARE_ANY_VERSION=1 says that is meant. */
export const MINIFLARE_PIN = '5.20261113.0-beta';
const RAW_CHUNK = 1000;
const WAIT_MS = 180000;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

/* Where Miniflare is, or a thrown error that says where it looked and how to fix it. Never a skip. */
export function findMiniflare(root) {
  const describe = (dir) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg || pkg.name !== 'miniflare') return null;
    const wd = readJson(path.join(dir, '..', 'workerd', 'package.json')) || readJson(path.join(dir, 'node_modules', 'workerd', 'package.json'));
    return { dir, version: pkg.version, workerd: wd ? wd.version : 'unknown' };
  };
  if (process.env.MINIFLARE_PATH) {
    const m = describe(process.env.MINIFLARE_PATH);
    if (!m) throw new Error('MINIFLARE_PATH=' + process.env.MINIFLARE_PATH + ' is not a miniflare package folder');
    if (m.version !== MINIFLARE_PIN && process.env.MINIFLARE_ANY_VERSION !== '1') {
      throw new Error('MINIFLARE_PATH=' + process.env.MINIFLARE_PATH + ' is miniflare ' + m.version + ', not the pinned ' + MINIFLARE_PIN
        + ' whose limits and meter this gate measured. Point it at ' + MINIFLARE_PIN + ', or set MINIFLARE_ANY_VERSION=1 to run another build on purpose.');
    }
    return Object.assign(m, { pinned: m.version === MINIFLARE_PIN });
  }
  const seen = [];
  const candidates = [];
  if (root) candidates.push(path.join(root, 'tools', 'node_modules', 'miniflare'));
  const npx = path.join(os.homedir(), '.npm', '_npx');
  try { for (const d of fs.readdirSync(npx)) candidates.push(path.join(npx, d, 'node_modules', 'miniflare')); } catch (e) { /* no npx cache */ }
  for (const c of candidates) {
    const m = describe(c);
    if (!m) continue;
    if (m.version === MINIFLARE_PIN) return Object.assign(m, { pinned: true });
    seen.push(m.dir + ' (' + m.version + ')');
  }
  throw new Error('miniflare ' + MINIFLARE_PIN + ' not found. Looked in tools/node_modules and ~/.npm/_npx/*'
    + (seen.length ? '; found only ' + seen.join(', ') : '') + '. Run `npx wrangler@4.162.0 --version` once (it caches this exact'
    + ' miniflare), install it pinned (`npm install --no-save --prefix tools miniflare@' + MINIFLARE_PIN + '`), or set MINIFLARE_PATH.');
}

/* ---------- the bridge to the worker thread ---------- */

let bridge = null;
export const engineStats = {
  engine: 'miniflare', miniflare: null, port: null, pool: 0, dbs: 0,
  api: { statements: 0, batches: 0, rows_written: 0, rows_read: 0 },
  raw: { statements: 0, batches: 0, rows_written: 0, rows_read: 0 },
  maxParams: 0, maxSqlBytes: 0, shadowed: 0, triggerCounted: 0, mismatchCount: 0, mismatches: [], d1Errors: 0, errorSamples: [],
  outbound: null,   // the sockets Miniflare's thread tried to open beyond loopback (all refused); read at exit
};

function start() {
  if (bridge) return bridge;
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const mfi = findMiniflare(root);
  /* The main Worker's compatibility_date: it is cubby-usage's only writer. */
  const compat = (/^compatibility_date\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8')) || [])[1];
  if (!compat) throw new Error('d1-miniflare: no compatibility_date in wrangler.toml');
  const sab = new SharedArrayBuffer(4);
  const flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  const worker = new Worker(new URL('./d1-miniflare-host.mjs', import.meta.url), { workerData: { port: port2, flag: sab }, transferList: [port2] });
  worker.unref();
  port1.unref();
  const call = (msg) => {
    Atomics.store(flag, 0, 0);
    port1.postMessage(msg);
    const w = Atomics.wait(flag, 0, 0, WAIT_MS);
    if (w === 'timed-out') throw new Error('d1-miniflare: no answer in ' + WAIT_MS + ' ms for ' + msg.op);
    const got = receiveMessageOnPort(port1);
    if (!got) throw new Error('d1-miniflare: the engine signalled but sent nothing for ' + msg.op);
    return got.message;
  };
  bridge = { call, worker };
  /* A signal sent to this process alone (a harness timeout's kill(), `timeout`, a session stopping a background
     run) used to leave workerd running with PPID 1, holding its port: Node gives the worker thread no signals,
     so Miniflare's own exit hook never ran, and 'exit' (below) does not fire when a signal kills the process.
     So each of these disposes synchronously through the bridge, then takes the handlers away and raises the
     same signal again, so the process still dies of it; if the program has handlers of its own, they decide
     instead. Set before init: a signal that lands while workerd is starting runs this once init has answered
     (a SIGTERM 150 ms into a 510 ms init: the process died of it, its workerd with it, 16 Nov 2026). SIGALRM is
     nightly.sh's watchdog (perl's alarm, then exec): a D1 holder run directly under it died of SIGALRM and left
     workerd listening (16 Nov 2026). Any signal not listed here still does that. */
  const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGALRM'];
  const onSignal = (sig) => {
    try { call({ op: 'dispose' }); } catch (e) { /* the thread did not answer: nothing more can be stopped from here */ }
    for (const s of SIGNALS) process.removeListener(s, onSignal);
    if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
  };
  for (const s of SIGNALS) process.on(s, onSignal);
  const pool = Number(process.env.CUBBY_D1_POOL) || 512;
  const port = Number(process.env.CUBBY_D1_PORT) || 0;
  const r = call({ op: 'init', miniflarePath: mfi.dir, pool, port, compatibilityDate: compat });
  if (!r.ok) {
    bridge = null;
    for (const s of SIGNALS) process.removeListener(s, onSignal);
    throw new Error('d1-miniflare: Miniflare did not start: ' + r.error);
  }
  Object.assign(engineStats, { miniflare: mfi.version + ' (workerd ' + mfi.workerd + ')', port, pool });
  process.on('exit', () => {
    try { engineStats.outbound = outboundAttempts(); } catch (e) { engineStats.outbound = null; /* the test fails a missing record */ }
    if (process.env.CUBBY_D1_REPORT) {
      try { fs.appendFileSync(process.env.CUBBY_D1_REPORT, JSON.stringify(Object.assign({ script: path.basename(process.argv[1] || '') }, engineStats)) + '\n'); } catch (e) { /* the parent fails on a missing report */ }
    }
    try { call({ op: 'dispose' }); } catch (e) { /* the thread dies with the process */ }
  });
  return bridge;
}

/* Every connection beyond loopback that Miniflare's thread tried to open since it started ('host:port', each
   refused there before DNS). Empty is what offline means; [] before the engine has started. */
export function outboundAttempts() {
  if (!bridge) return [];
  const r = bridge.call({ op: 'stats' });
  if (!r.ok) throw new Error('d1-miniflare: no stats from the engine: ' + r.error);
  return r.r.outbound;
}

/* JSON has no undefined; the host restores it so D1 refuses it as production D1 does. */
const enc = (args) => (args || []).map((a) => (a === undefined ? { $u: 1 } : a));

function meterInto(bucket, meta) {
  if (!meta) return;
  bucket.rows_written += Number(meta.rows_written) || 0;
  bucket.rows_read += Number(meta.rows_read) || 0;
}

/* ---------- splitting a SQL file into statements, as `wrangler d1 execute --file` must ---------- */

/* Statements of a script, comments dropped, a trigger body (BEGIN ... END) kept whole. Strings, quoted
   identifiers and comments are skipped as such, so a semicolon inside any of them never splits. */
export function splitSql(text) {
  const out = [];
  let cur = '', depth = 0, word = '';
  const isTrigger = () => /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(cur);
  const endWord = () => {
    if (!word) return;
    const w = word.toUpperCase();
    if (w === 'CASE' || (w === 'BEGIN' && isTrigger())) depth++;
    else if (w === 'END' && depth > 0) depth--;
    word = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') { endWord(); const j = text.indexOf('\n', i); i = j < 0 ? text.length : j - 1; cur += ' '; continue; }
    if (c === '/' && text[i + 1] === '*') { endWord(); const j = text.indexOf('*/', i + 2); i = j < 0 ? text.length : j + 1; cur += ' '; continue; }
    const close = c === "'" ? "'" : c === '"' ? '"' : c === '`' ? '`' : c === '[' ? ']' : null;
    if (close) {
      endWord();
      let j = i + 1;
      for (; j < text.length; j++) { if (text[j] === close) { if (close !== ']' && text[j + 1] === close) { j++; continue; } break; } }
      cur += text.slice(i, j + 1); i = j; continue;
    }
    if (/[A-Za-z0-9_]/.test(c)) { word += c; cur += c; continue; }
    endWord();
    if (c === ';' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  endWord();
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ---------- the shadow comparison ---------- */

const rowJson = (r) => (r === undefined || r === null ? 'null' : JSON.stringify(Object.assign({}, r)));
/* `changes` is compared only for a statement that writes rows: after anything else node:sqlite repeats the
   count of the last write (sqlite3_changes), and D1 says 0. */
const WRITES = /^\s*(INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i;
const changesOf = (sqls, list) => list.map((n, i) => (WRITES.test(sqls[i]) ? n : '-')).join(',');
function canon(op, sql, res, sqls) {
  if (res.err) return 'ERROR';
  if (op === 'run') return WRITES.test(sql) ? 'changes ' + res.changes : 'ok';
  if (op === 'first') return res.col ? JSON.stringify(res.value === undefined ? null : res.value) : rowJson(res.row);
  if (op === 'batch') return 'changes ' + changesOf(sqls, res.changes);
  /* A query plan is compared by its steps only: the node ids and `notused` differ between SQLite builds. */
  if (/^\s*EXPLAIN\b/i.test(sql)) return JSON.stringify(res.rows.map((r) => r.detail));
  const rows = res.rows.map(rowJson);
  if (!/\bORDER\s+BY\b/i.test(sql)) rows.sort();
  return '[' + rows.join(',') + ']';
}
/* D1's meta.changes counts the rows a trigger wrote as well (the change in sqlite3_total_changes), where
   node:sqlite counts the statement's own rows only. The production schema has no trigger, so the twin
   reports both and such a difference is counted apart (triggerCounted), never as a mismatch; a test's
   metering triggers are the only ones there are. */
function compare(op, sql, args, d1, shim, sqls) {
  engineStats.shadowed++;
  const a = canon(op, sql, d1, sqls), b = canon(op, sql, shim, sqls);
  if (a === b) return;
  if ((op === 'run' || op === 'batch') && !d1.err && !shim.err && shim.total !== undefined
    && canon(op, sql, { changes: shim.total }, sqls) === a) { engineStats.triggerCounted++; return; }
  engineStats.mismatchCount++;
  if (engineStats.mismatches.length < 40) {
    engineStats.mismatches.push({ op, sql: String(sql).replace(/\s+/g, ' ').slice(0, 400), args: JSON.stringify(args === undefined ? [] : args, (k, v) => (v === undefined ? '<undefined>' : v)).slice(0, 200),
      d1: d1.err ? 'ERROR ' + d1.err : a.slice(0, 300), shim: shim.err ? 'ERROR ' + shim.err : b.slice(0, 300) });
  }
}
function d1Error(msg, sql) {
  engineStats.d1Errors++;
  if (engineStats.errorSamples.length < 20) engineStats.errorSamples.push(String(msg).slice(0, 200) + ' :: ' + String(sql).replace(/\s+/g, ' ').slice(0, 160));
}

/* ---------- one database ---------- */

/* `shim` is { makeSqliteD1, norm } from d1-sqlite.mjs (passed in, so the two files never import each other). */
export function makeD1(opts, shim) {
  opts = opts || {};
  const b = start();
  const n = engineStats.dbs;
  if (n >= engineStats.pool) throw new Error('d1-miniflare: all ' + engineStats.pool + ' databases of the pool are taken; raise CUBBY_D1_POOL');
  engineStats.dbs++;
  const db = 'DB' + n;
  const hooks = opts.hooks || {};
  const log = [];
  const meter = { statements: 0, batches: 0, rows_written: 0, rows_read: 0 };
  const shadowOn = opts.shadow !== undefined ? !!opts.shadow : process.env.CUBBY_D1_SHADOW === '1';
  const twin = shadowOn ? shim.makeSqliteD1({}) : null;
  const norm = shim.norm;

  function send(bucket, msg, argsForCount) {
    if (argsForCount && argsForCount.length > engineStats.maxParams) engineStats.maxParams = argsForCount.length;
    for (const q of msg.list ? msg.list.map((x) => x.sql) : [msg.sql]) {
      const bytes = Buffer.byteLength(String(q || ''));
      if (bytes > engineStats.maxSqlBytes) engineStats.maxSqlBytes = bytes;
    }
    const r = b.call(Object.assign({ db }, msg));
    bucket.statements += msg.op === 'batch' ? msg.list.length : 1;
    if (msg.op === 'batch') bucket.batches++;
    if (r.ok) {
      if (msg.op === 'batch') (r.r || []).forEach((x) => meterInto(bucket, x && x.meta));
      else meterInto(bucket, r.r && r.r.meta);
    } else d1Error(r.error, msg.sql || (msg.list && msg.list.map((s) => s.sql).join(' ; ')));
    return r;
  }
  /* The twin's answer to the same statement, in the shapes compare() reads. */
  const totalChanges = () => Number(twin.raw.prepare('SELECT total_changes() AS t').get().t);
  function twinOne(op, sql, args, col) {
    try {
      const st = twin.raw.prepare(sql);
      if (op === 'run') { const t0 = totalChanges(); const changes = Number(st.run(...norm(args)).changes); return { changes, total: totalChanges() - t0 }; }
      if (op === 'all') return { rows: st.all(...norm(args)) };
      const row = st.get(...norm(args));
      return col ? { col, value: row ? row[col] : null } : { row: row === undefined ? null : row };
    } catch (e) { return { err: String(e.message || e) }; }
  }
  function twinBatch(list) {
    try {
      twin.raw.exec('BEGIN');
      try {
        const changes = [], total = [];
        for (const s of list) {
          const t0 = totalChanges();
          changes.push(Number(twin.raw.prepare(s.sql).run(...norm(s.args)).changes));
          total.push(totalChanges() - t0);
        }
        twin.raw.exec('COMMIT');
        return { changes, total };
      } catch (e) { twin.raw.exec('ROLLBACK'); throw e; }
    } catch (e) { return { err: String(e.message || e) }; }
  }
  const d1Shape = (op, r, col) => {
    if (!r.ok) return { err: r.error };
    if (op === 'run') return { changes: Number(r.r.meta && r.r.meta.changes) || 0 };
    if (op === 'all') return { rows: r.r.results || [] };
    if (op === 'batch') return { changes: (r.r || []).map((x) => Number(x && x.meta && x.meta.changes) || 0) };
    return col ? { col, value: r.r.row } : { row: r.r.row };
  };

  /* One statement through D1 (and the twin), as the D1 API answers it. first() runs as all() and keeps the
     first row, which is what workerd's D1 client does for first() (the same query, its meta dropped), so
     that statement's rows_written is counted too; first(col) refuses a missing column as D1 does. */
  function one(bucket, op, sql, args, col) {
    const wire = op === 'first' ? 'all' : op;
    const r = send(bucket, { op: wire, sql, params: enc(args) }, args);
    let out = r;
    if (r.ok && op === 'first') {
      const row = (r.r.results || [])[0] || null;
      if (col !== undefined && row && row[col] === undefined) out = { ok: false, error: 'D1_COLUMN_NOTFOUND: Column not found (' + col + ')' };
      else out = { ok: true, r: { row: col !== undefined ? (row ? (row[col] === undefined ? null : row[col]) : null) : row, meta: r.r.meta } };
    }
    if (twin) compare(op, sql, args, d1Shape(op, out, col), twinOne(op, sql, args, col));
    return out;
  }
  const fail = (r) => { throw new Error(r.error); };

  function stmt(sql, args) {
    const s = {
      _sql: sql, _args: args,
      bind: (...a) => stmt(sql, a),
      async run() {
        if (hooks.before) hooks.before(sql, args);
        log.push(sql);
        const r = one(meter, 'run', sql, args);
        if (!r.ok) fail(r);
        meterInto(engineStats.api, r.r.meta); engineStats.api.statements++;
        return r.r;
      },
      async first(col) {
        if (hooks.before) hooks.before(sql, args);
        const r = one(meter, 'first', sql, args, col);
        if (!r.ok) fail(r);
        meterInto(engineStats.api, r.r.meta); engineStats.api.statements++;
        return r.r.row;
      },
      async all() {
        if (hooks.before) hooks.before(sql, args);
        const r = one(meter, 'all', sql, args);
        if (!r.ok) fail(r);
        meterInto(engineStats.api, r.r.meta); engineStats.api.statements++;
        return r.r;
      },
    };
    return s;
  }

  /* ---- the synchronous raw facade ---- */
  let held = null;                    // raw writes inside BEGIN ... COMMIT, sent at COMMIT
  let flushedInTxn = false;
  const rawBucket = engineStats.raw;
  function flushHeld() {
    if (!held || !held.length) return;
    const list = held; held = [];
    for (let i = 0; i < list.length; i += RAW_CHUNK) {
      const part = list.slice(i, i + RAW_CHUNK);
      const r = send(rawBucket, { op: 'batch', list: part.map((s) => ({ sql: s.sql, params: enc(s.args) })) }, null);
      if (twin) compare('batch', part.map((s) => s.sql).join(' ; '), [], d1Shape('batch', r), twinBatch(part), part.map((s) => s.sql));
      if (!r.ok) fail(r);
    }
  }
  const PENDING = Object.freeze(Object.defineProperties({}, {
    changes: { get() { throw new Error('d1-miniflare: this write is held until COMMIT, so its changes are not known yet'); } },
    lastInsertRowid: { get() { throw new Error('d1-miniflare: this write is held until COMMIT, so its rowid is not known yet'); } },
  }));
  function rawRun(sql, args) {
    if (held) { held.push({ sql, args }); return PENDING; }
    const r = one(rawBucket, 'run', sql, args);
    if (!r.ok) fail(r);
    return { changes: Number(r.r.meta && r.r.meta.changes) || 0, lastInsertRowid: Number(r.r.meta && r.r.meta.last_row_id) || 0 };
  }
  function rawRead(op, sql, args) {
    if (held && held.length) { flushHeld(); flushedInTxn = true; }
    const r = one(rawBucket, op, sql, args);
    if (!r.ok) fail(r);
    return op === 'all' ? (r.r.results || []) : (r.r.row === null ? undefined : r.r.row);
  }
  const raw = {
    exec(text) {
      for (const sql of splitSql(String(text))) {
        if (/^BEGIN(\s+(DEFERRED|IMMEDIATE|EXCLUSIVE))?(\s+TRANSACTION)?$/i.test(sql)) {
          if (held) throw new Error('d1-miniflare: BEGIN inside BEGIN');
          held = []; flushedInTxn = false; continue;
        }
        if (/^(COMMIT|END)(\s+TRANSACTION)?$/i.test(sql)) { flushHeld(); held = null; continue; }
        if (/^ROLLBACK(\s+TRANSACTION)?$/i.test(sql)) {
          if (flushedInTxn) throw new Error('d1-miniflare: ROLLBACK after a read inside the transaction sent its writes; D1 cannot undo them');
          held = null; continue;
        }
        rawRun(sql, []);
      }
    },
    prepare(sql) {
      return {
        run: (...a) => rawRun(sql, a),
        get: (...a) => rawRead('first', sql, a),
        all: (...a) => rawRead('all', sql, a),
      };
    },
  };

  return {
    prepare: (sql) => stmt(sql, []),
    /* One D1 batch: one transaction on D1, so a failed statement rolls the whole batch back. The hooks run
       first, statement by statement as in the shim, so a staged failure stops the batch before D1 sees it. */
    async batch(list) {
      for (const s of list) { if (hooks.before) hooks.before(s._sql, s._args); log.push(s._sql); }
      const r = send(meter, { op: 'batch', list: list.map((s) => ({ sql: s._sql, params: enc(s._args) })) }, list.reduce((m, s) => (s._args.length > m.length ? s._args : m), []));
      if (twin) compare('batch', list.map((s) => s._sql).join(' ; '), [], d1Shape('batch', r), twinBatch(list.map((s) => ({ sql: s._sql, args: s._args }))), list.map((s) => s._sql));
      if (!r.ok) fail(r);
      engineStats.api.batches++; engineStats.api.statements += list.length;
      (r.r || []).forEach((x) => meterInto(engineStats.api, x && x.meta));
      return r.r;
    },
    /* D1's own exec(): it splits on newlines, so a statement over several lines fails here as on D1. */
    async exec(sql) {
      const r = send(meter, { op: 'exec', sql }, null);
      if (!r.ok) fail(r);
      return r.r;
    },
    raw,
    log,
    meter,
    /* D1's own first(), not the all()-based one above: for the check that the two agree. */
    realFirst(sql, args, col) {
      const r = send(meter, { op: 'first', sql, params: enc(args || []), col }, args);
      if (!r.ok) fail(r);
      return r.r.row;
    },
    engine: 'miniflare',
    binding: db,
    /* Every row of every table, as one string, as the shim's dump(). */
    dump() {
      const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      return tables.map((t) => t + ':' + JSON.stringify(raw.prepare('SELECT * FROM "' + t + '"').all())).join('\n');
    },
  };
}
