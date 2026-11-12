/* What was served, and what 404'd. First-party page counts, read from D1.
 *
 *   node tools/page_stats.js                  last 5 days
 *   node tools/page_stats.js 14               last 14 days
 *   node tools/page_stats.js 5 404            only the routes that 404'd
 *   node tools/page_stats.js 30 --firestore   the OLD history, kept in Firestore pageStats (to 2026-11)
 *   node tools/page_stats.js --self-test      render synthetic rows; needs no credentials
 *
 * WHERE THE COUNTS LIVE. The Worker's recordPageView writes them to the cubby-games D1, table
 * page_stats, one row per (day, bucket, status class). This reads it through `npx wrangler d1 execute`,
 * which uses the Cloudflare login already on this machine, the same way tools/funnel_report.js does.
 * They used to be Firestore writes, one per anonymous 404, on the free plan whose daily write quota is
 * shared with every family; a stranger in a loop could have spent it. The old documents were kept, and
 * --firestore still reads them (needs `npm i firebase-admin` and tools/serviceAccountKey.json, gitignored).
 *
 * WHY THIS IS A LOCAL SCRIPT AND NOT AN ENDPOINT. A public /api/stats would mean inventing an admin
 * auth story for one report, and a page-count endpoint that leaks which guest pages and households
 * exist is exactly the sort of thing that looks harmless until it is not. Reading it from a machine that
 * already holds the Cloudflare login costs nothing and adds no surface.
 *
 * WHAT IT CANNOT TELL YOU. Since the move to D1 a route is a BUCKET, not a path: '/articles/*' says an
 * article link 404'd, not which one, and '/:other', '/:asset' and '/:probe' hold everything else. That
 * is the price of a table random paths cannot grow. For the exact path, `npx wrangler tail cubby` while
 * reproducing it. There are no visitors, sessions or journeys either: no ids, no IPs, no query strings.
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const ARGS = process.argv.slice(2);
const FLAGS = ARGS.filter((a) => a.startsWith('--'));
const POS = ARGS.filter((a) => !a.startsWith('--'));
const DAYS = Math.max(1, Math.min(90, parseInt(POS[0], 10) || 5));
const ONLY = (POS[1] || '').trim();
const DB = 'cubby-games';
const CLASSES = ['ok', 'n404', 'n4xx', 'n5xx'];   // worker.js recordPageView's cls values

function dayKeys(n, now) {
  const out = [];
  for (let i = 0; i < n; i++) { out.push(new Date(now - i * 86400000).toISOString().slice(0, 10)); }
  return out.reverse();
}

/* rows: [{ path, ok, n404, n4xx, n5xx }], already summed over the window. Returns the printed lines. */
function render(rows, days, only, source) {
  const lines = [];
  const L = (s) => lines.push(s == null ? '' : s);
  let list = rows.slice();
  if (only === '404') list = list.filter((r) => r.n404 > 0);
  list.sort((a, b) => (only === '404' ? b.n404 - a.n404 : (b.ok + b.n404) - (a.ok + a.n404)));
  const tot = rows.reduce((t, r) => ({ ok: t.ok + r.ok, n404: t.n404 + r.n404, n4xx: t.n4xx + r.n4xx, n5xx: t.n5xx + r.n5xx }),
    { ok: 0, n404: 0, n4xx: 0, n5xx: 0 });

  L('\n  ' + days[0] + ' → ' + days[days.length - 1] + '   (' + days.length + ' days, ' + source + ')\n');
  if (!list.length) {
    L(source === 'Firestore'
      ? '  Nothing in the old Firestore history for these days. It covers 2026-08-20 until the move to D1.'
      : '  Nothing recorded in D1 for these days yet. For days before the move, run with --firestore.');
    L('');
    return lines;
  }
  L('  ' + 'route'.padEnd(46) + 'ok'.padStart(8) + '404'.padStart(8) + '4xx'.padStart(7) + '5xx'.padStart(7));
  L('  ' + '-'.repeat(76));
  for (const r of list.slice(0, 60)) {
    L('  ' + String(r.path).slice(0, 45).padEnd(46)
      + String(r.ok).padStart(8) + String(r.n404).padStart(8)
      + String(r.n4xx).padStart(7) + String(r.n5xx).padStart(7));
  }
  L('  ' + '-'.repeat(76));
  L('  ' + 'total'.padEnd(46) + String(tot.ok).padStart(8) + String(tot.n404).padStart(8)
    + String(tot.n4xx).padStart(7) + String(tot.n5xx).padStart(7));
  if (tot.n404 > 0) L('\n  ' + tot.n404 + ' request(s) hit a page that does not exist. Run with `404` to see which.');
  L('');
  return lines;
}

/* D1 rows are (path, cls, n); fold them into one line per path. */
function foldD1(results) {
  const rows = new Map();
  for (const x of results) {
    const r = rows.get(x.path) || { path: x.path, ok: 0, n404: 0, n4xx: 0, n5xx: 0 };
    if (CLASSES.indexOf(x.cls) >= 0) r[x.cls] += Number(x.n || 0);
    rows.set(x.path, r);
  }
  return [...rows.values()];
}

function readD1(days) {
  // The day is built here from a Date, never from input, so it is safe inside the SQL string.
  const sql = "SELECT path, cls, SUM(n) AS n FROM page_stats WHERE day >= '" + days[0] + "' GROUP BY path, cls";
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  return foldD1((j[0] && j[0].results) || []);
}

async function readFirestore(days) {
  /* The MODULAR entry points, not the legacy `admin.credential.cert`. firebase-admin v13+ moved to
     subpath exports and the old namespaced form is undefined, so the legacy call throws
     "Cannot read properties of undefined (reading 'cert')". This script shipped with that bug because
     it was written, committed and documented WITHOUT ever being run once. */
  let initializeApp, cert, getFirestore, sa;
  try {
    ({ initializeApp, cert } = require('firebase-admin/app'));
    ({ getFirestore } = require('firebase-admin/firestore'));
  } catch (e) { console.error('\n  Missing firebase-admin. Run:  npm i firebase-admin\n'); process.exit(1); }
  try { sa = require(path.join(__dirname, 'serviceAccountKey.json')); }
  catch (e) { console.error('\n  Missing tools/serviceAccountKey.json (gitignored — ask the founder).\n'); process.exit(1); }

  initializeApp({ credential: cert(sa) });
  const db = getFirestore();
  const snap = await db.collection('pageStats').where('day', 'in', days.slice(-10)).get()
    .catch(async () => db.collection('pageStats').get());   // `in` caps at 10; fall back to a full read
  const rows = new Map();
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (days.indexOf(d.day) < 0) return;
    const k = d.path || '(unknown)';
    const r = rows.get(k) || { path: k, ok: 0, n404: 0, n4xx: 0, n5xx: 0 };
    r.ok += Number(d.nOk || 0); r.n404 += Number(d.n404 || 0);
    r.n4xx += Number(d.n4xx || 0); r.n5xx += Number(d.n5xx || 0);
    rows.set(k, r);
  });
  return [...rows.values()];
}

(async () => {
  if (FLAGS.includes('--self-test')) {
    let pass = 0, fail = 0;
    const ok = (name, cond) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } };
    console.log('\npage stats self-test\n');
    const folded = foldD1([
      { path: '/app/*', cls: 'n404', n: 3 }, { path: '/app/*', cls: 'ok', n: 2 },
      { path: '/:other', cls: 'n404', n: 7 }, { path: '/:probe', cls: 'n404', n: 1 }, { path: '/x', cls: 'path', n: 9 },
    ]);
    const app = folded.find((r) => r.path === '/app/*');
    ok('D1 rows fold into one line per bucket', folded.length === 4 && app.n404 === 3 && app.ok === 2);
    ok('an unknown status class is ignored, never written over the path', folded.find((r) => r.path === '/x').path === '/x');
    const days = dayKeys(5, Date.UTC(2026, 10, 12));
    ok('the window is the last N UTC days, oldest first', days.length === 5 && days[0] === '2026-11-08' && days[4] === '2026-11-12');
    const out = render(folded, days, '', 'D1').join('\n');
    ok('the busiest bucket prints first', out.indexOf('/:other') < out.indexOf('/app/*'));
    ok('totals add up', /total\s+2\s+11\s+0\s+0/.test(out));
    const only = render(folded, days, '404', 'D1').join('\n');
    ok('`404` keeps only buckets that 404\'d', only.indexOf('/x') < 0 && only.indexOf('/:probe') >= 0);
    ok('an empty D1 window points at the old history', render([], days, '', 'D1').join('\n').indexOf('--firestore') >= 0);
    console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
    process.exit(fail ? 1 : 0);
  }

  const days = dayKeys(DAYS, Date.now());
  let rows, source;
  if (FLAGS.includes('--firestore')) { rows = await readFirestore(days); source = 'Firestore'; }
  else {
    try { rows = readD1(days); source = 'D1'; }
    catch (e) {
      const full = String((e && ((e.stdout || '') + (e.stderr || '') + (e.message || ''))) || e);
      const msg = full.split('\n').filter((l) => /error|ERROR|fail|auth|login/i.test(l)).slice(0, 4).join('\n  ') || full.trim().slice(-400);
      if (/no such table/i.test(full)) { rows = []; source = 'D1'; }   // nothing has been counted since the deploy yet
      else {
        console.error('\nCould not read D1 through wrangler:\n  ' + msg + '\nIs `npx wrangler whoami` logged in to the Cubby account?\n');
        process.exit(1);
      }
    }
  }
  console.log(render(rows, days, ONLY, source).join('\n'));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
