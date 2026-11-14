/* What the phase-1 screens say, and that each saying can go red (admin spec §6.1 to §6.4, S14, S28).
 *
 *   node test/admin-screens.test.js               the suite
 *   node test/admin-screens.test.js --self-test   also break each rule in a temp copy and require RED
 *
 * The real admin handler over SAMPLE families (workers/admin/dev/fixture.mjs), D1 as real SQLite:
 *   1. the CSV export is formula-safe and leaves as a download that is never stored (§6.3, S14);
 *   2. the three phase-1 system checks read the canary through MAIN and the cron and digest records from
 *      cubby-games, and each turns red when its source says so (§6.1);
 *   3. every usage panel says "Waiting for usage events", never a zero (§6, my call 28);
 *   4. "Two people logging" equals the Monday digest's rule (core.mjs sharedLoggingAt) on the same entries;
 *   5. our own accounts are hidden by default, and the overview warns when they are not tagged (S28).
 */
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 400) : '')); } };

/* A small CSV reader: quoted cells, doubled quotes, CRLF rows. */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const checkLine = (html, title) => {
  const m = new RegExp('class="check check-(\\w+)">\\s*<span class="dot" aria-hidden="true"></span>\\s*<div><div class="check-title">' + title
    + '</div><div class="check-line">([^<]*)</div>').exec(html);
  return m ? { state: m[1], line: m[2] } : null;
};
const tile = (html, label) => {
  const m = new RegExp('<div class="tile-label">' + label + '</div><div class="tile-value">([^<]*)</div><div class="tile-sub">([^<]*)</div>').exec(html);
  return m ? { value: m[1], sub: m[2] } : null;
};
const quiet = async (fn) => { const o = [console.log, console.error]; console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { [console.log, console.error] = o; } };

(async () => {
  const F = await imp('workers/admin/dev/fixture.mjs');
  const S = await imp('workers/admin/dev/sample.mjs');
  const core = await imp('workers/funnel/core.mjs');
  const { csvCell } = await imp('workers/admin/src/index.mjs');
  console.log('\nadmin screens: what each phase-1 screen says, and that it can go red');

  console.log('\n1. the CSV export: formula-safe, a download, never stored (§6.3, S14)');
  {
    for (const lead of ['=', '+', '-', '@', '\t', '\r']) {
      ok('a cell that begins with ' + JSON.stringify(lead) + ' gets a leading apostrophe', csvCell(lead + 'SUM(A1)') === '"\'' + lead + 'SUM(A1)"', csvCell(lead + 'SUM(A1)'));
    }
    ok('(companion) an ordinary cell is left alone, its quotes doubled', csvCell('Maya "M"') === '"Maya ""M"""', csvCell('Maya "M"'));
    const fx = await F.buildFixture({ hostile: true });
    await quiet(() => fx.tickUntilDone());
    for (const tab of ['people', 'households', 'access']) {
      const r = await fx.request('/records.csv?tab=' + tab + '&own=show');
      const body = await r.text();
      ok(tab + ' CSV: 200, text/csv, an attachment, no-store', r.status === 200 && /^text\/csv/.test(r.headers.get('content-type') || '')
        && /^attachment; filename="cubby-/.test(r.headers.get('content-disposition') || '') && r.headers.get('cache-control') === 'no-store',
        [r.status, r.headers.get('content-type'), r.headers.get('content-disposition'), r.headers.get('cache-control')]);
      const cells = parseCsv(body).flat();
      const live = cells.filter((c) => /^[=+\-@\t\r]/.test(c));
      ok(tab + ' CSV: no cell a spreadsheet would run as a formula (' + cells.length + ' cells)', live.length === 0, live.slice(0, 4));
    }
    const people = parseCsv(await (await fx.request('/records.csv?tab=people&own=show')).text()).flat();
    ok('the member named =HYPERLINK("http://x") leaves as text: \'=HYPERLINK("http://x")', people.includes('\'=HYPERLINK("http://x")'), people.filter((c) => /HYPERLINK/.test(c)));
  }

  console.log('\n2. the three phase-1 system checks, each from its own source (§6.1)');
  {
    const page = async (opts, mutate) => {
      const fx = await F.buildFixture(opts || {});
      await quiet(() => fx.tickUntilDone());
      if (mutate) mutate(fx);
      return (await fx.request('/')).text();
    };
    let h = await page({});
    let c = checkLine(h, 'Sign-in codes');
    ok('sign-in codes: the canary through MAIN, ok six minutes ago: "Working · test code 6 minutes ago"', c && c.state === 'ok' && c.line === 'Working · test code 6 minutes ago', c);
    c = checkLine(h, 'Reminders sending');
    ok('reminders: push_last_run six minutes ago and push_daily 31 sent: "Working · 31 sent today, 0 failed"', c && c.state === 'ok' && c.line === 'Working · 31 sent today, 0 failed', c);
    c = checkLine(h, 'Weekly report email');
    ok('weekly report: last sent 31 Aug, long before this Monday: red, "Not sending · last good run 31 Aug"', c && c.state === 'bad' && c.line === 'Not sending · last good run 31 Aug', c);
    c = checkLine(h, 'Saving and sync');
    ok('saving and sync waits for phase 2: "Waiting for usage events"', c && c.state === 'off' && c.line === 'Waiting for usage events', c);

    h = await page({ canary: { ok: false, code: 'failing', ageSeconds: 600 } });
    c = checkLine(h, 'Sign-in codes');
    ok('the canary reporting a failed test code turns the check red', c && c.state === 'bad' && /^Not working · the last test code failed$/.test(c.line), c);
    h = await page({ env: { MAIN: undefined } });
    c = checkLine(h, 'Sign-in codes');
    ok('no MAIN binding: "Not connected yet", never a green', c && c.state === 'off' && c.line === 'Not connected yet', c);
    h = await page({}, (fx) => fx.games.raw.prepare("UPDATE ops_state SET updated_at = ? WHERE key = 'push_last_run'").run(S.NOW - 2 * 3600000));
    c = checkLine(h, 'Reminders sending');
    ok('the push cron silent for two hours turns the check red', c && c.state === 'bad' && c.line === 'Not running · last run 120 minutes ago', c);
    h = await page({}, (fx) => fx.games.raw.prepare("UPDATE ops_state SET value = json_object('day', '2026-11-12', 'sent', 9, 'failed', 2) WHERE key = 'push_daily'").run());
    c = checkLine(h, 'Reminders sending');
    ok('yesterday\'s tally is not today\'s: "0 sent today, 0 failed"', c && c.line === 'Working · 0 sent today, 0 failed', c);
    h = await page({ digestLast: '2026-11-09' });
    c = checkLine(h, 'Weekly report email');
    ok('the digest sent this Monday (9 Nov): "Working · sent 9 Nov"', c && c.state === 'ok' && c.line === 'Working · sent 9 Nov', c);
    h = await page({ digestLast: '2026-11-09' }, (fx) => fx.games.raw.prepare("UPDATE funnel_snapshots SET ok = 0, attempts = 2 WHERE day = '2026-11-13'").run());
    c = checkLine(h, 'Weekly report email');
    ok('today\'s funnel snapshot failing turns it red and says which attempt', c && c.state === 'bad' && /today's snapshot failed \(attempt 2 of 3\)$/.test(c.line.replace(/&#39;/g, "'")), c);
  }

  console.log('\n3. every usage panel waits for usage events, never shows a zero (§6, my call 28)');
  {
    const fx = await F.buildFixture({});
    await quiet(() => fx.tickUntilDone());
    const h = await (await fx.request('/')).text();
    for (const label of ['Active today', 'Active this week', 'Went quiet']) {
      const t = tile(h, label);
      ok('tile "' + label + '": a dash and "Waiting for usage events", no number', t && t.value === '–' && t.sub === 'Waiting for usage events', t);
    }
    for (const title of ['What people use', 'Time in Cubby', 'Where they use it']) {
      const i = h.indexOf('>' + title + '</h2>');
      const card = i >= 0 ? h.slice(i, h.indexOf('</section>', i)) : '';
      ok('card "' + title + '" says "Waiting for usage events"', /<p class="waiting">Waiting for usage events<\/p>/.test(card), card.slice(0, 200));
    }
    ok('"Who to help next" waits for families to be told (phase 3), and names nobody', /This list names people, so it switches on only after families have been told what our team can see\./.test(h));
    const hh = await (await fx.request('/household/' + fx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_maya'").get().display_no)).text();
    for (const title of ['Who uses what, last 30 days', 'Visits, last 48 hours']) {
      const i = hh.indexOf('>' + title + '</h2>');
      const card = i >= 0 ? hh.slice(i, hh.indexOf('</section>', i)) : '';
      ok('household card "' + title + '" says "Waiting for usage events"', /<p class="waiting">Waiting for usage events<\/p>/.test(card), card.slice(0, 200));
    }
    const rec = await (await fx.request('/records?tab=visits')).text();
    ok('the Visits tab waits too', /Waiting for usage events/.test(rec));
  }

  console.log('\n4. "Two people logging" equals the Monday digest\'s rule on the same entries');
  {
    const fx = await F.buildFixture({});
    await quiet(() => fx.tickUntilDone());
    const internal = new Set(String(fx.env.INTERNAL_UIDS).split(','));
    const from = Date.parse(new Date(S.NOW - 6 * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z');
    const byHid = new Map();
    for (const [p, f] of fx.world.docs) {
      const m = /^households\/([^/]+)\/events\/[^/]+$/.exec(p);
      if (!m) continue;
      const t = f.time instanceof Date ? f.time.getTime() : Number(f.time);
      if (t >= from && t <= S.NOW) { if (!byHid.has(m[1])) byHid.set(m[1], []); byHid.get(m[1]).push({ time: t, authorId: f.authorId, type: f.type }); }
    }
    let want = 0;
    for (const [p, f] of fx.world.docs) {
      const m = /^households\/([^/]+)$/.exec(p);
      if (!m || internal.has(f.ownerId) || f.deleteAfter) continue;
      if (core.sharedLoggingAt({ entries: byHid.get(m[1]) || [] }) > 0) want++;
    }
    const got = tile(await (await fx.request('/?range=7')).text(), 'Two people logging');
    ok('the overview tile (7 days, our own hidden) equals core.mjs sharedLoggingAt over the seeded entries (' + want + ')', got && Number(got.value) === want && want > 0, { got, want });
  }

  console.log('\n5. our own accounts: hidden by default, and a warning when they are not tagged (S28)');
  {
    const fx = await F.buildFixture({});
    await quiet(() => fx.tickUntilDone());
    const all = fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM dir_households WHERE deletion_pending IS NOT 1').get().n;
    const ours = fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM dir_households WHERE is_internal = 1').get().n;
    const def = tile(await (await fx.request('/')).text(), 'Households');
    const shown = tile(await (await fx.request('/?own=show')).text(), 'Households');
    ok('by default the Households tile leaves our own out (' + (all - ours) + ' of ' + all + ')', ours > 0 && def && Number(def.value) === all - ours, { def, all, ours });
    ok('and "?own=show" puts them back', shown && Number(shown.value) === all, shown);
    const warn = 'Your own accounts are not tagged, so every number here includes you.';
    ok('with INTERNAL_UIDS set, no warning', !(await (await fx.request('/')).text()).includes(warn));
    const fy = await F.buildFixture({ env: { INTERNAL_UIDS: '' } });
    await quiet(() => fy.tickUntilDone());
    ok('with INTERNAL_UIDS empty, the overview warns: "' + warn + '"', (await (await fy.request('/')).text()).includes(warn));
  }

  if (process.argv.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    const { selfTest } = require('./helpers/admin-selftest.js');
    selfTest(__filename, [
      { name: 'a CSV cell starting with = is not defused', file: 'workers/admin/src/index.mjs', find: "if (/^[=+\\-@\\t\\r]/.test(s)) s = \"'\" + s;", replace: '' },
      { name: 'the CSV is shown inline, not downloaded', file: 'workers/admin/src/index.mjs', find: "'content-disposition': 'attachment; filename=", replace: "'content-disposition': 'inline; filename=" },
      { name: 'a failing canary reads as working', file: 'workers/admin/src/data.mjs', find: 'if (j && j.ok === true) return', replace: 'if (j) return' },
      { name: 'a silent push cron reads as working', file: 'workers/admin/src/data.mjs', find: 'if (mins > 60) return', replace: 'if (mins > 6000) return' },
      { name: 'any digest ever sent reads as this week\'s', file: 'workers/admin/src/data.mjs', find: 'if (last && last >= mon) return', replace: 'if (last) return' },
      { name: 'a usage tile shows 0 instead of waiting', file: 'workers/admin/src/views.mjs', find: '<div class="tile-label">Active today</div><div class="tile-value">–</div>', replace: '<div class="tile-label">Active today</div><div class="tile-value">0</div>' },
      { name: 'one person logging counts as two', file: 'workers/admin/src/data.mjs', find: 'd.day >= from && d.authors >= 2', replace: 'd.day >= from && d.authors >= 1' },
      { name: 'our own accounts are shown by default', file: 'workers/admin/src/index.mjs', find: "const hideInternal = url.searchParams.get('own') !== 'show';", replace: "const hideInternal = url.searchParams.get('own') === 'hide';" },
      { name: 'no warning when our accounts are not tagged', file: 'workers/admin/src/views.mjs', find: 'if (!cfg.internal.size) out.push(', replace: 'if (false) out.push(' },
    ], ok);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-SCREENS: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-SCREENS: FAIL'); process.exit(1); });
