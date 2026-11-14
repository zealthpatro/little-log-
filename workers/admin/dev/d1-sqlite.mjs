/* A D1-shaped database over REAL SQLite (node:sqlite), for the tests and the local preview only.
 * Never deployed: workers/admin/dev/ is outside the Worker's entry graph, and `workers` is fenced by
 * .assetsignore. Real SQL, real constraints, and batch() is one transaction like D1's, so a failed
 * statement rolls the whole batch back.
 *
 * `hooks.before(sql, args)` may throw, to stage a database failure on a chosen statement.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

const norm = (args) => args.map((a) => (a === undefined ? null : (typeof a === 'boolean' ? (a ? 1 : 0) : a)));
const plain = (r) => (r ? Object.assign({}, r) : null);

export function makeD1(opts) {
  opts = opts || {};
  const db = new DatabaseSync(':memory:');
  const hooks = opts.hooks || {};
  const log = [];
  function stmt(sql, args) {
    const s = {
      _sql: sql, _args: args,
      bind: (...a) => stmt(sql, a),
      runSync() {
        if (hooks.before) hooks.before(sql, args);
        log.push(sql);
        const r = db.prepare(sql).run(...norm(args));
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      async run() { return s.runSync(); },
      async first(col) {
        if (hooks.before) hooks.before(sql, args);
        const r = plain(db.prepare(sql).get(...norm(args)));
        return r && col ? r[col] : r;
      },
      async all() {
        if (hooks.before) hooks.before(sql, args);
        return { success: true, results: db.prepare(sql).all(...norm(args)).map(plain) };
      },
    };
    return s;
  }
  return {
    prepare: (sql) => stmt(sql, []),
    /* Synchronous inside, so nothing can interleave with an open transaction. */
    async batch(list) {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
    raw: db,
    log,
    /* Every row of every table, as one string: what a test greps for a leaked value. */
    dump() {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
      return tables.map((t) => t + ':' + JSON.stringify(db.prepare('SELECT * FROM "' + t + '"').all())).join('\n');
    },
  };
}

export function applySqlFile(d1, file) { d1.raw.exec(fs.readFileSync(file, 'utf8')); return d1; }
