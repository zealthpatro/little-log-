#!/usr/bin/env node
/* What are families doing in Cubby? The daily funnel snapshots, read from D1.
 *
 *   node tools/funnel_report.js              the latest snapshot, the last 14 days of job health, 7-day steps
 *   node tools/funnel_report.js --days 30    a longer history
 *   node tools/funnel_report.js --self-test  render a synthetic snapshot; needs no credentials
 *
 * The snapshots are written by the Worker's cron (runFunnelSnapshot in worker.js) from the derivation
 * in workers/funnel/core.mjs, so this prints the same numbers the Monday digest mails. It reads D1
 * through `npx wrangler d1 execute`, which uses the Cloudflare login already on this machine; there is
 * no Firestore key involved and no per-household detail anywhere in what it reads.
 *
 * THE FIRST THING IT PRINTS IS WHETHER THE JOB IS ALIVE. The report that preceded this, a launchd job,
 * failed on every run for three weeks while exiting 0, and nothing said so. A report that only shows
 * numbers cannot tell you the numbers stopped arriving.
 */
const path = require('path');
const { execFileSync } = require('child_process');

const ARGS = process.argv.slice(2);
const DAYS = Number((ARGS[ARGS.indexOf('--days') + 1]) || 14) || 14;
const DB = 'cubby-games';
const STAGES = ['trying', 'pregnancy', 'baby', 'none'];
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '-');

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const j = JSON.parse(out.slice(out.indexOf('[')));
  return (j[0] && j[0].results) || [];
}

function render(rows, stepRows, today) {
  const lines = [];
  const L = (s) => lines.push(s == null ? '' : s);
  L('\nCubby funnel, from the daily snapshots in D1\n');

  L('── Is the snapshot job alive? ──');
  if (!rows.length) {
    L('  NO SNAPSHOT HAS EVER BEEN WRITTEN.');
    L('  Either the Worker with runFunnelSnapshot has not deployed, or it fails before writing. Check `npx wrangler tail cubby`.');
    return lines.join('\n');
  }
  const newest = rows[0].day;
  if (newest !== today) L('  STALE: the newest snapshot is ' + newest + ' and today is ' + today + '. The cron is not writing.');
  const bad = rows.filter((r) => !r.ok);
  L('  ' + (rows.length - bad.length) + ' of the last ' + rows.length + ' days written successfully.');
  for (const r of bad) L('  FAILED ' + r.day + ' after ' + r.attempts + ' attempt(s): ' + (r.reason || 'no reason recorded'));

  const good = rows.find((r) => r.ok);
  if (!good) { L('\n  No successful snapshot in the window, so there are no numbers to show.'); return lines.join('\n'); }
  const s = typeof good.body === 'string' ? JSON.parse(good.body) : good.body;

  /* Everyone first. On its first live run the cohort below was empty (no sign-up in 36 days) and a report
     that led with it said nothing about the twelve households that already existed. */
  const a = s.activity;
  L('\n── Everyone, the last 7 days ──');
  if (!a) L('  (this snapshot predates the whole-base scope)');
  else {
    L('  ' + a.active_households + ' of ' + a.households_total + ' households logged something   '
      + a.households_two_loggers + ' had two different people logging   <- the wedge, this week');
    L('  ' + a.care_entries.total + ' entries   owner ' + a.care_entries.by_author_role.owner + '   caregiver '
      + a.care_entries.by_author_role.caregiver + '   former ' + a.care_entries.by_author_role.former);
    const at = Object.keys(a.care_entries.by_type).sort((x, y) => a.care_entries.by_type[y] - a.care_entries.by_type[x]);
    if (at.length) L('  ' + at.map((t) => t + ' ' + a.care_entries.by_type[t]).join('   '));
  }

  L('\n── New sign-ups: the ' + (s.cohort_days || 30) + ' days to ' + s.day + ', by stage ──');
  if (!STAGES.some((st) => s.funnel[st].created)) L('  No household was created in this window.');
  L('  stage       created  activated  returned  retained  2nd joined  two logging  within 7d  invited  pro');
  for (const st of STAGES) {
    const f = s.funnel[st];
    if (!f.created) continue;
    L('  ' + st.padEnd(11) + String(f.created).padStart(7) + '  '
      + (f.activated + ' ' + pct(f.activated, f.created)).padStart(9) + '  '
      + (f.returned + ' ' + pct(f.returned, f.created)).padStart(8) + '  '
      + (f.retained + ' ' + pct(f.retained, f.created)).padStart(8) + '  '
      + String(f.member_joined).padStart(10) + '  '
      + (f.shared_logging + ' ' + pct(f.shared_logging, f.created)).padStart(11) + '  '
      + String(f.shared_logging_within_7d).padStart(9) + '  '
      + String(f.invite_sent).padStart(7) + '  ' + String(f.pro_waitlisted).padStart(3));
  }
  const tot = (k) => STAGES.reduce((a, st) => a + (s.funnel[st][k] || 0), 0);
  L('  ' + 'all'.padEnd(11) + String(tot('created')).padStart(7) + '  ... two people logging: '
    + tot('shared_logging') + ' of ' + tot('created') + '  <- the wedge');
  L('\n  Time to first entry: ' + Object.keys(s.activation_buckets).map((b) => b + ' ' + s.activation_buckets[b]).join('   '));
  L('  Pregnancy to baby in Cubby: ' + s.transitions.pregnancy_to_baby + '    Trying to pregnancy: ' + s.transitions.trying_to_pregnancy);


  L('\n── Steps that leave no record, last 7 days ──');
  const steps = {};
  for (const r of stepRows) steps[r.key] = (steps[r.key] || 0) + Number(r.n || 0);
  const keys = Object.keys(steps).sort();
  if (!keys.length) L('  none counted yet');
  for (const k of keys) L('  ' + String(steps[k]).padStart(5) + '  ' + k);

  L('\n── Acquisition ──');
  const q = s.acquisition;
  L('  attributed ' + q.attributed + '   referred ' + q.referred + '   ' + Object.keys(q.by_source).map((k) => k + ' ' + q.by_source[k]).join('   '));

  L('\n' + s.retention_note);
  L('Internal households excluded: ' + s.households.internal_excluded
    + (s.households.internal_excluded === 0 ? '   (0 usually means INTERNAL_UIDS is not set, so the founder\'s own households are counted)' : ''));
  L('Firestore reads this snapshot spent: ' + s.reads + '\n');
  return lines.join('\n');
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  if (ARGS.includes('--self-test')) {
    const core = await import('file://' + path.join(__dirname, '..', 'workers', 'funnel', 'core.mjs'));
    /* Anchored to noon UTC. The first version used Date.now(), so after 22:00 UTC the caregiver's entry,
       two hours after the owner's, fell on the next day and the wedge vanished: a test that passed or
       failed depending on the time it was run. */
    const DAY = 86400000, now = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 12);
    const snap = core.snapshot({ now, households: [
      { id: 'a', ownerId: 'o', createdAt: now - 3 * DAY, members: { o: { role: 'owner' }, c: { role: 'caregiver' } }, babyCount: 1,
        entries: [{ time: now - 3 * DAY + 60000, authorId: 'o', type: 'feed' }, { time: now - 3 * DAY + 7200000, authorId: 'c', type: 'feed' }], preg: null },
    ] });
    snap.cohort_days = 30; snap.reads = 12;
    snap.activity = core.activity({ now, households: [{ id: 'z', ownerId: 'o', members: { o: { role: 'owner' }, c: { role: 'caregiver' } },
      entries: [{ time: now - DAY, authorId: 'o', type: 'feed' }, { time: now - DAY + 60000, authorId: 'c', type: 'feed' }] }] });
    const text = render([{ day: today, ok: 1, attempts: 1, body: snap }, { day: '2026-01-01', ok: 0, attempts: 3, reason: 'cohort query 503' }],
      [{ key: 'onboarding.step_reached|stage=baby|step=stage_chosen', n: 4 }], today);
    const stale = render([{ day: '2026-01-01', ok: 1, attempts: 1, body: snap }], [], today);
    const never = render([], [], today);
    let fail = 0; const ok = (n, c) => { console.log('  ' + (c ? 'ok  ' : 'FAIL') + ' ' + n); if (!c) fail++; };
    console.log('\nfunnel report self-test\n');
    /* Every anchor must EXIST before its position means anything: indexOf returns -1 for a renamed heading,
       and "alive < -1" is false for the wrong reason. The first version compared against "Sign-ups" and went
       red the moment that heading was renamed, which only looked like a failure of ordering. */
    const at = (h) => text.indexOf(h);
    const alive = at('Is the snapshot job alive'), week = at('Everyone, the last 7 days'), cohort = at('New sign-ups');
    ok('every heading the order check relies on is present', alive >= 0 && week >= 0 && cohort >= 0, { alive, week, cohort });
    ok('it leads with whether the job is alive, before any number', alive < week && alive < cohort);
    ok('a failed day is printed with its reason', /FAILED 2026-01-01 after 3 attempt\(s\): cohort query 503/.test(text));
    ok('the wedge is on the page', /two people logging: 1 of 1/.test(text));
    ok('everyone\'s week is reported, and BEFORE new sign-ups', /1 of 1 households logged something/.test(text)
       && text.indexOf('Everyone, the last 7 days') < text.indexOf('New sign-ups'));
    const empty = render([{ day: today, ok: 1, attempts: 1, body: Object.assign({}, snap, { funnel: core.snapshot({ now, households: [] }).funnel }) }], [], today);
    ok('an empty cohort says so in words instead of printing a blank table', /No household was created in this window/.test(empty));
    ok('a stale job is called stale', /STALE: the newest snapshot is 2026-01-01/.test(stale));
    ok('no snapshot at all is said out loud, not rendered as an empty table', /NO SNAPSHOT HAS EVER BEEN WRITTEN/.test(never));
    ok('an unset INTERNAL_UIDS is pointed out', /INTERNAL_UIDS is not set/.test(text));
    ok('a step count is shown', /4  onboarding\.step_reached/.test(text));
    console.log('\n' + (fail ? 'FUNNEL-REPORT: FAIL' : 'FUNNEL-REPORT: PASS') + '\n');
    process.exit(fail ? 1 : 0);
  }
  let rows, stepRows;
  try {
    rows = d1('SELECT day, ok, reason, attempts, body FROM funnel_snapshots ORDER BY day DESC LIMIT ' + Math.max(1, Math.min(90, DAYS)));
    const from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    stepRows = d1("SELECT key, SUM(n) AS n FROM funnel_steps WHERE day >= '" + from + "' GROUP BY key");
  } catch (e) {
    const msg = String((e.stderr || e.message || e)).slice(0, 400);
    if (/no such table/.test(msg)) {
      console.log('\nThe funnel tables do not exist in D1 yet. They are created on the first cron tick after the Worker\nwith runFunnelSnapshot deploys, or on the first POST /api/step. Nothing has run yet.\n');
      process.exit(1);
    }
    console.error('\nCould not read D1 through wrangler:\n  ' + msg + '\nIs `npx wrangler whoami` logged in to the Cubby account?\n');
    process.exit(1);
  }
  console.log(render(rows, stepRows, today));
})();
