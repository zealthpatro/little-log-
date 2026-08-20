/* What was served, and what 404'd. First-party page counts, read straight from Firestore.
 *
 *   node tools/page_stats.js            last 5 days
 *   node tools/page_stats.js 14         last 14 days
 *   node tools/page_stats.js 5 404      only the routes that 404'd
 *
 * Setup: npm i firebase-admin  +  the key at tools/serviceAccountKey.json (gitignored, never commit it).
 *
 * WHY THIS IS A LOCAL SCRIPT AND NOT AN ENDPOINT. The counts are written by the Worker under the
 * service account and denied to every client in firestore.rules. Adding a public /api/stats would mean
 * inventing an admin auth story for one report, and a page-count endpoint that leaks which guest pages
 * and households exist is exactly the sort of thing that looks harmless until it is not. Reading it from
 * a machine that already holds the admin key costs nothing and adds no surface.
 *
 * WHAT IT CANNOT TELL YOU. Nothing before 2026-08-20, because nothing was counted before then — this
 * was built the day a user's broken sign-in link could not be counted at all. There are no visitors,
 * sessions or journeys here either: one row per route per day per status class, and deliberately no
 * way to follow a person, because recordPageView stores no ids, no IPs and no query strings.
 */
'use strict';
const path = require('path');
const DAYS = Math.max(1, Math.min(90, parseInt(process.argv[2], 10) || 5));
const ONLY = (process.argv[3] || '').trim();

function dayKeys(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) { out.push(new Date(d.getTime() - i * 86400000).toISOString().slice(0, 10)); }
  return out.reverse();
}

(async () => {
  let admin, sa;
  try { admin = require('firebase-admin'); }
  catch (e) { console.error('\n  Missing firebase-admin. Run:  npm i firebase-admin\n'); process.exit(1); }
  try { sa = require(path.join(__dirname, 'serviceAccountKey.json')); }
  catch (e) { console.error('\n  Missing tools/serviceAccountKey.json (gitignored — ask the founder).\n'); process.exit(1); }

  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const db = admin.firestore();
  const days = dayKeys(DAYS);

  const snap = await db.collection('pageStats').where('day', 'in', days.slice(-10)).get()
    .catch(async () => db.collection('pageStats').get());   // `in` caps at 10; fall back to a full read

  const rows = new Map();
  let totOk = 0, tot404 = 0, tot4xx = 0, tot5xx = 0;
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (days.indexOf(d.day) < 0) return;
    const k = d.path || '(unknown)';
    const r = rows.get(k) || { path: k, ok: 0, n404: 0, n4xx: 0, n5xx: 0 };
    r.ok += Number(d.nOk || 0); r.n404 += Number(d.n404 || 0);
    r.n4xx += Number(d.n4xx || 0); r.n5xx += Number(d.n5xx || 0);
    rows.set(k, r);
    totOk += Number(d.nOk || 0); tot404 += Number(d.n404 || 0);
    tot4xx += Number(d.n4xx || 0); tot5xx += Number(d.n5xx || 0);
  });

  let list = [...rows.values()];
  if (ONLY === '404') list = list.filter((r) => r.n404 > 0);
  list.sort((a, b) => (ONLY === '404' ? b.n404 - a.n404 : (b.ok + b.n404) - (a.ok + a.n404)));

  console.log('\n  ' + days[0] + ' → ' + days[days.length - 1] + '   (' + DAYS + ' days)\n');
  if (!list.length) {
    console.log('  Nothing recorded yet. Counting started 2026-08-20; there is no history before it.\n');
    process.exit(0);
  }
  console.log('  ' + 'route'.padEnd(46) + 'ok'.padStart(8) + '404'.padStart(8) + '4xx'.padStart(7) + '5xx'.padStart(7));
  console.log('  ' + '-'.repeat(76));
  for (const r of list.slice(0, 60)) {
    console.log('  ' + String(r.path).slice(0, 45).padEnd(46)
      + String(r.ok).padStart(8) + String(r.n404).padStart(8)
      + String(r.n4xx).padStart(7) + String(r.n5xx).padStart(7));
  }
  console.log('  ' + '-'.repeat(76));
  console.log('  ' + 'total'.padEnd(46) + String(totOk).padStart(8) + String(tot404).padStart(8)
    + String(tot4xx).padStart(7) + String(tot5xx).padStart(7));
  if (tot404 > 0) console.log('\n  ' + tot404 + ' request(s) hit a page that does not exist. Run with `404` to see which.');
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
