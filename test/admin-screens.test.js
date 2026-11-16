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
 *   5. our own accounts are hidden by default, and the overview warns when they are not tagged (S28);
 *   6. phase 2: with cubby-usage bound and holding our own rows, every usage panel shows the real number,
 *      worked out here from the rows themselves; unbound, empty or hidden, it still waits;
 *   7. the Visits, Usage events, Sign-ins and Devices tabs: their counts, 50 a page, every row in the CSV,
 *      and F5 (a visit that logged a dose shows the hour only, in the page and in the CSV);
 *   8. F5 wherever else a dose visit's time could show: a device's first and last seen (its batch arrival is
 *      the dose's minute), an event of the visit after the hour turns, a sign-in inside it, the household
 *      page; each beside a companion that keeps its minutes. (§6 holds the saving check's F5 lines.)
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

  console.log('\n6. phase 2: the usage panels show real numbers from our own rows, and wait when there are none (§6.1, §6.2, §17)');
  {
    const DAY = 86400000;
    /* Our own test accounts in this scenario: the founder (household of FOUNDER_UID) in Kiritimati, where at the
       pinned 10:42 UTC it is already 00:42 on 14 Nov, so "today" is HIS today, not UTC's; and Dana and Sam (one
       household) in New York, whose last visits were 8 to 12 days ago. */
    const INTERNAL = [S.FOUNDER_UID, 'UID_sample_dana', 'UID_sample_sam'].join(',');
    const me = { uid: S.FOUNDER_UID, hid: 'HHID_sample_founder', tz: 'Pacific/Kiritimati', device: 'd_founderkiri1', platform: 'ios_app', app_version: 'v369', ua: S.USAGE_UA.ios };
    const dana = { uid: 'UID_sample_dana', hid: 'HHID_sample_dana', tz: 'America/New_York', device: 'd_danaandroid1', platform: 'android_app', app_version: 'v368', ua: S.USAGE_UA.android };
    const sam = { uid: 'UID_sample_sam', hid: 'HHID_sample_dana', role: 'caregiver', tz: 'America/New_York', device: 'd_sambrowser99', platform: 'browser', app_version: 'v368', ua: S.USAGE_UA.mac };
    const visit = (secs, extra) => [[0, 'visit.started', { opened_from: 'icon', start: 'cold' }]].concat(extra || []).concat([[secs, 'visit.ended', { seconds: secs, reason: 'hidden' }]]);
    const opts = { internal: INTERNAL };
    const seed = async (d1) => {
      /* The founder: a visit started 60 seconds ago, a feed logged, received 40 seconds ago. */
      /* 9 days ago first (batches land in time order, as they do from a phone): a household with an old
         visit AND a recent one has not gone quiet. */
      await S.ingestVisit(d1, me, S.NOW - 9 * DAY, visit(50), opts);
      await S.ingestVisit(d1, me, S.NOW - 60000, visit(18, [[10, 'feature.used', { feature: 'feed', action: 'logged' }]]), opts);
      await S.ingestVisit(d1, dana, S.NOW - 10 * DAY, visit(300, [[20, 'feature.used', { feature: 'sleep', action: 'logged' }]]), opts);
      await S.ingestVisit(d1, dana, S.NOW - 12 * DAY, visit(200), opts);
      await S.ingestVisit(d1, sam, S.NOW - 8 * DAY, visit(100, [[20, 'feature.used', { feature: 'feed', action: 'logged' }]]), opts);
    };
    const fx = await F.buildFixture({ usage: seed, env: { INTERNAL_UIDS: INTERNAL } });
    await quiet(() => fx.tickUntilDone());
    const raw = fx.usage.raw;
    const h = await (await fx.request('/?own=show')).text();
    /* Worked out here, from the rows, not by the module under test. */
    const startedToday = raw.prepare("SELECT DISTINCT uid FROM usage_events WHERE name = 'visit.started' AND tz = 'Pacific/Kiritimati' AND local_day = '2026-11-14'").all().length;
    let t = tile(h, 'Active today');
    ok('Active today: the founder, whose own day is already 14 Nov (' + startedToday + '), "opened Cubby since midnight"', t && t.value === '1' && startedToday === 1 && t.sub === 'opened Cubby since midnight', t);
    t = tile(h, 'Active this week');
    ok('Active this week: 1 of the 2 households we measure, "50% of households measured"', t && t.value === '1' && t.sub === '50% of households measured', t);
    t = tile(h, 'Went quiet');
    ok('Went quiet: Dana and Sam\'s household, last visit 8 days ago: 1 (the founder\'s, with visits 9 days ago and today, is not), "no visit in 7 days"', t && t.value === '1' && t.sub === 'no visit in 7 days', t);
    let c = checkLine(h, 'Saving and sync');
    ok('saving and sync: "Working · last write 40 seconds ago"', c && c.state === 'ok' && c.line === 'Working · last write 40 seconds ago', c);
    const card = (body, title) => { const i = body.indexOf('>' + title + '</h2>'); return i >= 0 ? body.slice(i, body.indexOf('</section>', i)) : ''; };
    const rowOf = (body, label) => { const m = new RegExp('<tr><td class="strong">' + label + '</td><td>([^<]*)</td><td>([^<]*)</td><td>([^<]*)</td><td>([^<]*)</td></tr>').exec(body); return m ? m.slice(1) : null; };
    const uses = card(h, 'What people use');
    ok('What people use (7 days): Feeds, 1 household, 1 person, 1 use, "Same" as the 7 days before (Sam\'s feed, 8 days ago)', JSON.stringify(rowOf(uses, 'Feeds')) === '["1","1","1","Same"]', rowOf(uses, 'Feeds'));
    ok('and Sleep, used only 10 days ago, is not in this range', !rowOf(uses, 'Sleep'));
    const u30 = card(await (await fx.request('/?own=show&range=30')).text(), 'What people use');
    ok('over 30 days: Feeds by 2 people in 2 households, and Sleep by 1', JSON.stringify((rowOf(u30, 'Feeds') || []).slice(0, 3)) === '["2","2","2"]' && JSON.stringify((rowOf(u30, 'Sleep') || []).slice(0, 3)) === '["1","1","1"]', [rowOf(u30, 'Feeds'), rowOf(u30, 'Sleep')]);
    const tc = card(h, 'Time in Cubby');
    ok('Time in Cubby (7 days): typical visit 18s, 1.0 visits and 18s a day per active person', /Typical visit<\/span><span>18s</.test(tc) && /Visits a day, per active person<\/span><span>1\.0</.test(tc) && /Time a day, per active person<\/span><span>18s</.test(tc), tc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
    ok('and the busiest local hour is his 12am (00:41 in Kiritimati)', /Busiest hour: 12am, in each person/.test(tc));
    const wc = card(h, 'Where they use it');
    ok('Where they use it: 1 person on the iPhone app, nobody on Android this week', /iPhone app<\/span><span>1 person</.test(wc) && /Android app<\/span><span>0 people</.test(wc));
    ok('and the version line counts devices seen this range: "100% ... on the newest version (v369)"', /100% of the devices seen in this range are on the newest version \(v369\)\. None is on an older one\./.test(wc), wc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(-200));

    /* Saving and sync turns red two ways. */
    const failing = async (seedFn) => { const fy = await F.buildFixture({ usage: seedFn, env: { INTERNAL_UIDS: INTERNAL } }); await quiet(() => fy.tickUntilDone()); return checkLine(await (await fy.request('/?own=show')).text(), 'Saving and sync'); };
    const failSave = () => visit(30, [[5, 'feature.used', { feature: 'feed', action: 'logged' }], [20, 'save.failed', { error: 'unavailable', retries: 5, offline: 'yes' }]]);
    c = await failing(async (d1) => { for (const who of [me, dana, sam]) await S.ingestVisit(d1, who, S.NOW - 20 * 60000, failSave(), opts); });
    ok('saves failing for 3 people in the last hour: red, "Not working · saves failed for 3 people in the last hour"', c && c.state === 'bad' && c.line === 'Not working · saves failed for 3 people in the last hour', c);
    /* ingestVisit stamps the batch as received 2 seconds after its last step: visit(10) lands 12s after it
       starts, visit(30) 32s after. These start times put each landing on a whole minute. */
    c = await failing(async (d1) => {
      await S.ingestVisit(d1, me, S.NOW - 30 * 60000 - 12000, visit(10, [[5, 'feature.used', { feature: 'feed', action: 'logged' }]]), opts);
      await S.ingestVisit(d1, me, S.NOW - 10 * 60000 - 32000, visit(30, [[20, 'save.failed', { error: 'deadline', retries: 5, offline: 'no' }]]), opts);
    });
    ok('the newest save failed 10 minutes ago, after the last write: red, "Not working · the newest save failed, 10 minutes ago"', c && c.state === 'bad' && c.line === 'Not working · the newest save failed, 10 minutes ago', c);
    c = await failing(async (d1) => {
      await S.ingestVisit(d1, me, S.NOW - 30 * 60000 - 32000, visit(30, [[20, 'save.failed', { error: 'deadline', retries: 5, offline: 'no' }]]), opts);
      await S.ingestVisit(d1, me, S.NOW - 10 * 60000 - 12000, visit(10, [[5, 'feature.used', { feature: 'feed', action: 'logged' }]]), opts);
    });
    ok('(companion) a failed save followed by a good one reads as working again', c && c.state === 'ok' && c.line === 'Working · last write 10 minutes ago', c);
    /* F5: "last write N minutes ago" from a batch that carried a dose or a health entry IS that minute; such a
       time is left out of the line, never rounded. Same landing times as above. */
    c = await failing(async (d1) => {
      await S.ingestVisit(d1, me, S.NOW - 30 * 60000 - 12000, visit(10, [[5, 'feature.used', { feature: 'feed', action: 'logged' }]]), opts);
      await S.ingestVisit(d1, me, S.NOW - 4 * 60000 - 32000, visit(30, [[12, 'feature.used', { feature: 'medicine', action: 'logged' }]]), opts);
    });
    ok('F5: the newest write logged a dose 4 minutes ago: "Working · the newest save went through", with no time', c && c.state === 'ok' && c.line === 'Working · the newest save went through', c);
    c = await failing(async (d1) => {
      await S.ingestVisit(d1, me, S.NOW - 30 * 60000 - 32000, visit(30, [[12, 'feature.used', { feature: 'health_log', action: 'logged' }]]), opts);
      await S.ingestVisit(d1, me, S.NOW - 10 * 60000 - 12000, visit(10, [[5, 'feature.used', { feature: 'feed', action: 'logged' }]]), opts);
    });
    ok('(companion) a health entry 30 minutes ago, then a feed 10 minutes ago: the feed keeps its time, "Working · last write 10 minutes ago"', c && c.state === 'ok' && c.line === 'Working · last write 10 minutes ago', c);
    c = await failing(async (d1) => {
      await S.ingestVisit(d1, me, S.NOW - 30 * 60000 - 12000, visit(10, [[5, 'feature.used', { feature: 'feed', action: 'logged' }]]), opts);
      await S.ingestVisit(d1, me, S.NOW - 10 * 60000 - 32000, visit(30, [[8, 'feature.used', { feature: 'medicine', action: 'edited' }], [20, 'save.failed', { error: 'deadline', retries: 5, offline: 'no' }]]), opts);
    });
    ok('F5: the newest save failed 10 minutes ago in a visit that edited a dose: red, "Not working · the newest save failed", with no time', c && c.state === 'bad' && c.line === 'Not working · the newest save failed', c);
    /* Two people's batches land in the same millisecond, 3 minutes ago: Dana's feed first, the founder's dose
       second. Whichever row wins the newest-write tie, that moment is the dose's, so it is not shown. */
    const same = S.NOW - 3 * 60000;
    c = await failing(async (d1) => {
      await S.ingestVisit(d1, dana, S.NOW - 3 * 60000 - 20000, visit(10, [[5, 'feature.used', { feature: 'feed', action: 'logged' }]]), Object.assign({ receivedAt: same }, opts));
      await S.ingestVisit(d1, me, S.NOW - 3 * 60000 - 25000, visit(10, [[5, 'feature.used', { feature: 'medicine', action: 'logged' }]]), Object.assign({ receivedAt: same }, opts));
    });
    ok('F5: a feed and a dose from two people landing in the same millisecond: "Working · the newest save went through"', c && c.state === 'ok' && c.line === 'Working · the newest save went through', c);

    /* Waits: unbound, bound and empty, and hidden (our own accounts are the only ones measured in phase 2). */
    const waits = (body) => ['Active today', 'Active this week', 'Went quiet'].every((l) => { const x = tile(body, l); return x && x.value === '–' && x.sub === 'Waiting for usage events'; })
      && ['What people use', 'Time in Cubby', 'Where they use it'].every((x) => /<p class="waiting">Waiting for usage events<\/p>/.test(card(body, x)))
      && (checkLine(body, 'Saving and sync') || {}).line === 'Waiting for usage events';
    ok('the same page, our own accounts hidden (the default): every usage panel waits, and says how to see them', waits(await (await fx.request('/')).text())
      && /only our own accounts are measured, and they are hidden here\. Untick “Hide our own accounts” to see them\./.test(await (await fx.request('/')).text()));
    ok('(companion) the same matcher finds numbers on ?own=show, so it is not green for free', !waits(h));
    const empty = await F.buildFixture({ usage: 'empty' });
    await quiet(() => empty.tickUntilDone());
    ok('cubby-usage bound but empty: every usage panel still waits, never a zero', waits(await (await empty.request('/?own=show')).text()));
    const unbound = await F.buildFixture({});
    await quiet(() => unbound.tickUntilDone());
    ok('cubby-usage unbound: every usage panel waits', waits(await (await unbound.request('/?own=show')).text()));

    /* cubby-usage failing to answer is said, never dressed up as "waiting" or a zero. */
    let broken = false;
    const bx = await F.buildFixture({ usage: 'sample', usageHooks: { before: (sql) => { if (broken && /^\s*SELECT/i.test(sql)) throw new Error('D1_ERROR: staged read failure'); } } });
    await quiet(() => bx.tickUntilDone());
    broken = true;
    const UNREAD = 'Usage events could not be read just now.';
    const bo = await quiet(async () => { const r = await bx.request('/?own=show'); return { status: r.status, body: await r.text() }; });
    const bt = tile(bo.body, 'Active today');
    ok('cubby-usage failing: the overview still answers, and says "' + UNREAD + '" on the tiles and the saving check', bo.status === 200 && bt && bt.value === '–' && bt.sub === UNREAD
      && (checkLine(bo.body, 'Saving and sync') || {}).line === UNREAD && /<p class="waiting">Usage events could not be read just now\.<\/p>/.test(card(bo.body, 'What people use')), [bo.status, bt, checkLine(bo.body, 'Saving and sync')]);
    const bh = await quiet(async () => (await bx.request('/household/' + bx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_founder'").get().display_no)).text());
    ok('and so does the household page', new RegExp('Failed saves, 7 days</span><span class="sub">' + UNREAD.replace('.', '\\.') + '<').test(bh));
    const br = await quiet(async () => { const r = await bx.request('/records?tab=visits&own=show'); return { status: r.status, body: await r.text() }; });
    ok('and the Visits tab, which still logs the look (200, never a crash)', br.status === 200 && br.body.includes(UNREAD) && bx.admin.raw.prepare("SELECT detail FROM access_log ORDER BY seq DESC LIMIT 1").get().detail.includes('"tab":"visits"'), br.status);
    /* A usage CSV whose read failed is never a file of no rows (which reads exactly like "no events"), and,
       since nothing left, no export is logged. */
    const exports = () => bx.admin.raw.prepare("SELECT COUNT(*) AS n FROM access_log WHERE action = 'export_csv'").get().n;
    const ex0 = exports();
    for (const tab of ['visits', 'events', 'signins', 'devices']) {
      const bc = await quiet(async () => { const r = await bx.request('/records.csv?tab=' + tab + '&own=show'); return { status: r.status, cd: r.headers.get('content-disposition'), body: await r.text() }; });
      ok('the ' + tab + ' CSV with cubby-usage failing: 503, no file, "Usage events could not be read just now, so nothing was exported."', bc.status === 503 && !bc.cd
        && bc.body.includes('Usage events could not be read just now, so nothing was exported.') && !/When \(their time\)|Opens Cubby on/.test(bc.body), [bc.status, bc.cd, bc.body.slice(0, 120)]);
    }
    ok('and not one export is logged for them', exports() === ex0, [ex0, exports()]);
    broken = false;
    const ex1 = exports();
    const good = await quiet(async () => { const r = await bx.request('/records.csv?tab=events&own=show'); return { status: r.status, cd: r.headers.get('content-disposition'), body: await r.text() }; });
    ok('(companion) read again with cubby-usage answering: 200, a file with rows, and its export logged', good.status === 200 && /^attachment;/.test(good.cd || '') && parseCsv(good.body).length > 10 && exports() === ex1 + 1, [good.status, good.cd, ex1, exports()]);
    broken = false;

    /* The household page: failed saves and sign-in problems over 7 days, from the founder's sample. */
    const sx = await F.buildFixture({ usage: 'sample' });
    await quiet(() => sx.tickUntilDone());
    const no = sx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_founder'").get().display_no;
    const hp = await (await sx.request('/household/' + no)).text();
    const since = S.NOW - 7 * DAY;
    const saves = sx.usage.raw.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE hid = 'HHID_sample_founder' AND name = 'save.failed' AND at >= ?").get(since).n;
    const signins = sx.usage.raw.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE hid = 'HHID_sample_founder' AND name = 'signin.attempted' AND json_extract(props, '$.outcome') = 'failed' AND at >= ?").get(since).n;
    const kv = (body, label) => { const m = new RegExp('<div class="kv"><span>' + label + '</span><span[^>]*>([^<]*)</span></div>').exec(body); return m ? m[1] : null; };
    ok('the founder\'s household: "Failed saves, 7 days" is ' + saves + ', counted from his rows', saves === 2 && kv(hp, 'Failed saves, 7 days') === String(saves), kv(hp, 'Failed saves, 7 days'));
    ok('and "Sign-in problems, 7 days" is ' + signins, signins === 1 && kv(hp, 'Sign-in problems, 7 days') === String(signins), kv(hp, 'Sign-in problems, 7 days'));
    const maya = await (await sx.request('/household/' + sx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_maya'").get().display_no)).text();
    ok('a family\'s household (nobody in it is ours) still waits on both', kv(maya, 'Failed saves, 7 days') === 'Waiting for usage events' && kv(maya, 'Sign-in problems, 7 days') === 'Waiting for usage events');
    ok('the founder\'s "Who uses what" and "Visits, last 48 hours" show his own rows', /<table class="table-narrow grid">/.test(card(hp, 'Who uses what, last 30 days')) && /<ul class="visits"><li>/.test(card(hp, 'Visits, last 48 hours')));
  }

  console.log('\n7. Every record: Visits, Usage events, Sign-ins, Devices (§6.3): counts, paging, CSV, and F5');
  {
    const fx = await F.buildFixture({ usage: 'sample' });
    await quiet(() => fx.tickUntilDone());
    const raw = fx.usage.raw;
    const internal = "uid = '" + S.FOUNDER_UID + "'";
    const J = "COALESCE(json_extract(props, '$.screen'), '') NOT IN ('pregnancy_week', 'kicks', 'contractions', 'cycle') AND COALESCE(json_extract(props, '$.feature'), '') NOT IN ('pregnancy_week', 'kicks', 'contractions', 'cycle')";
    const want = {
      visits: raw.prepare('SELECT COUNT(DISTINCT visit) AS n FROM usage_events WHERE ' + internal).get().n,
      events: raw.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE ' + internal + ' AND ' + J).get().n,
      signins: raw.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE name = 'signin.attempted' AND " + internal).get().n,
      devices: raw.prepare('SELECT COUNT(*) AS n FROM devices WHERE ' + internal).get().n,
    };
    const tabCount = (body, label) => { const m = new RegExp('>' + label + ' <span class="count">([^<]*)</span>').exec(body); return m ? m[1] : null; };
    const page1 = await (await fx.request('/records?tab=visits&own=show')).text();
    for (const [tab, label] of [['visits', 'Visits'], ['events', 'Usage events'], ['signins', 'Sign-ins'], ['devices', 'Devices']]) {
      ok('the ' + label + ' tab counts every row of ours (' + want[tab] + ')', want[tab] > 0 && tabCount(page1, label) === String(want[tab]), tabCount(page1, label));
    }
    ok('the Usage events count leaves out pregnancy and trying tools (JOURNEY_KEYS are totals only)', want.events < raw.prepare('SELECT COUNT(*) AS n FROM usage_events WHERE ' + internal).get().n);
    const rowsOf = (body) => (body.match(/<tbody>([\s\S]*?)<\/tbody>/) || ['', ''])[1].split('</tr>').filter((x) => /<td/.test(x)).map((tr) => [...tr.matchAll(/<td[^>]*>(?:<a [^>]*>)?([^<]*)/g)].map((m) => m[1]));
    const pages = Math.ceil(want.events / 50);
    let seen = [];
    for (let i = 1; i <= pages; i++) {
      const b = await (await fx.request('/records?tab=events&own=show&page=' + i)).text();
      const r = rowsOf(b);
      ok('Usage events page ' + i + ' of ' + pages + ': ' + r.length + ' rows, and the pager says so', r.length === (i < pages ? 50 : want.events - 50 * (pages - 1)) && b.includes('Page ' + i + ' of ' + pages), r.length);
      seen = seen.concat(r.map((x) => x.join('|')));
    }
    const csv = parseCsv(await (await fx.request('/records.csv?tab=events&own=show')).text());
    ok('the CSV holds every event (' + (csv.length - 1) + '), with the visible columns as its header', csv.length - 1 === want.events && csv[0].join(',') === 'When (their time),Person,Event,Details kept,Opens Cubby on,Version,Visit', [csv.length - 1, csv[0]]);
    ok('and the pages, end to end, are the CSV\'s rows in the same order', JSON.stringify(seen) === JSON.stringify(csv.slice(1).map((x) => x.join('|').replace(/&/g, '&amp;'))), [seen[0], csv[1] && csv[1].join('|')]);
    /* F5: the visit that logged a dose shows the hour only, everywhere; other visits keep their minutes. */
    const doseVisit = raw.prepare("SELECT visit FROM usage_events WHERE name = 'feature.used' AND json_extract(props, '$.feature') = 'medicine'").get().visit;
    const doseRows = csv.slice(1).filter((x) => x[6] === doseVisit);
    ok('F5: every event of the visit that logged a dose shows the hour only in the CSV ("11 Nov, 9pm")', doseRows.length >= 3 && doseRows.every((x) => x[0] === '11 Nov, 9pm'), doseRows.map((x) => x[0]));
    const others = csv.slice(1).filter((x) => x[6] !== doseVisit);
    ok('(companion) and every other visit keeps its minutes (' + others.length + ' events)', others.length > 100 && others.every((x) => /, \d{1,2}:\d\d(am|pm)$/.test(x[0])), others.length);
    const vcsv = parseCsv(await (await fx.request('/records.csv?tab=visits&own=show')).text());
    const dv = vcsv.slice(1).filter((x) => x[6] === 'Log medicine');
    ok('and on the Visits tab its start reads "11 Nov, 9pm"', dv.length === 1 && dv[0][4] === '11 Nov, 9pm', dv);
    ok('the Visits CSV holds every visit (' + want.visits + ')', vcsv.length - 1 === want.visits);
    const si = parseCsv(await (await fx.request('/records.csv?tab=signins&own=show')).text());
    ok('Sign-ins: the wrong code shows as Email code · Verified · Failed · Wrong code', si.slice(1).some((x) => x[3] === 'Email code' && x[4] === 'Verified' && x[5] === 'Failed' && x[6] === 'Wrong code'), si.slice(1, 3));
    const dc = parseCsv(await (await fx.request('/records.csv?tab=devices&own=show')).text());
    ok('Devices: the Android phone shows Android 15, Chrome, v368, app build 1.3.2', dc.slice(1).some((x) => x[1] === 'Android app' && x[2] === 'Android 15' && x[3] === 'Chrome' && x[4] === 'v368' && x[5] === '1.3.2'), dc.slice(1));
    const hidden = await (await fx.request('/records?tab=visits')).text();
    ok('our own accounts hidden (the default): the tab waits, with a way to show them', /<p class="waiting">Waiting for usage events<\/p>/.test(hidden) && /href="\/records\?tab=visits&amp;own=show">Show our own accounts</.test(hidden) && tabCount(hidden, 'Visits') === '–');
  }

  console.log('\n8. F5 wherever a dose visit\'s time could show: Devices, an event past the hour, Sign-ins, the household page');
  {
    const DAY = 86400000;
    /* 12 Nov in Dubai (UTC+4), at local h:m:s. NOW is 13 Nov 10:42 UTC, 2:42pm in Dubai: "Yesterday". */
    const at = (h, m, s) => Date.UTC(2026, 10, 12, h - 4, m, s || 0);
    const dev = (device, platform, ua) => ({ uid: S.FOUNDER_UID, hid: 'HHID_sample_founder', tz: 'Asia/Dubai', device, platform, app_version: 'v369', ua });
    const phone = dev('d_f5dosephone1', 'ios_app', S.USAGE_UA.ios);
    const laptop = dev('d_f5plainlap01', 'browser', S.USAGE_UA.mac);
    const tablet = dev('d_f5oldtablet1', 'android_app', S.USAGE_UA.android);
    const signin = (attempt) => ['signin.attempted', { method: 'google', step: 'signed_in', outcome: 'succeeded', error: 'none', attempt, storage: 'app' }];
    const fx = await F.buildFixture({ usage: async (d1) => {
      /* An Android tablet first seen 100 days before its oldest visit still kept (10 Nov, 7:20am). */
      await S.ingestVisit(d1, tablet, Date.UTC(2026, 10, 10, 3, 20, 0), [[0, 'visit.started', { opened_from: 'icon', start: 'cold' }],
        [20, 'feature.used', { feature: 'nappy', action: 'logged' }], [30, 'visit.ended', { seconds: 30, reason: 'hidden' }]]);
      d1.raw.prepare("UPDATE devices SET first_seen = first_seen - ? WHERE device = 'd_f5oldtablet1'").run(100 * DAY);
      /* A laptop visit at 8:05am that logs a feed, with a sign-in: every time of it keeps its minutes. */
      await S.ingestVisit(d1, laptop, at(8, 5), [[0, 'visit.started', { opened_from: 'icon', start: 'cold' }], [10, ...signin(1)],
        [20, 'feature.used', { feature: 'feed', action: 'logged' }], [30, 'visit.ended', { seconds: 30, reason: 'hidden' }]]);
      /* The phone's only visit: starts 9:58:30pm, logs a dose at 9:59:10pm, signs in at 10:00:10pm, ends 10:01:30pm,
         and its batch reaches the server at 10:01:32pm. Every one of those times is the dose's minute or near it. */
      await S.ingestVisit(d1, phone, at(21, 58, 30), [[0, 'visit.started', { opened_from: 'notification', start: 'warm' }],
        [40, 'feature.used', { feature: 'medicine', action: 'logged' }], [100, ...signin(2)], [180, 'visit.ended', { seconds: 180, reason: 'hidden' }]]);
    } });
    await quiet(() => fx.tickUntilDone());
    const csvOf = async (tab) => parseCsv(await (await fx.request('/records.csv?tab=' + tab + '&own=show')).text()).slice(1);
    const rowsOf = (body) => (body.match(/<tbody>([\s\S]*?)<\/tbody>/) || ['', ''])[1].split('</tr>').filter((x) => /<td/.test(x)).map((tr) => [...tr.matchAll(/<td[^>]*>(?:<a [^>]*>)?([^<]*)/g)].map((m) => m[1]));
    const devs = await csvOf('devices');
    const devOf = (list, p) => list.find((x) => x[1] === p) || [];
    ok('F5 on Devices: the phone whose only visit logged a dose (batch in at 10:01pm): first and last seen "12 Nov, 9pm"', devOf(devs, 'iPhone app')[7] === '12 Nov, 9pm' && devOf(devs, 'iPhone app')[8] === '12 Nov, 9pm', devOf(devs, 'iPhone app'));
    const devPage = rowsOf(await (await fx.request('/records?tab=devices&own=show')).text());
    ok('and the same on the Devices page', devOf(devPage, 'iPhone app')[7] === '12 Nov, 9pm' && devOf(devPage, 'iPhone app')[8] === '12 Nov, 9pm', devOf(devPage, 'iPhone app'));
    ok('(companion) the laptop, whose visit logged a feed, keeps its minutes: "12 Nov, 8:05am"', devOf(devs, 'Browser tab')[7] === '12 Nov, 8:05am' && devOf(devs, 'Browser tab')[8] === '12 Nov, 8:05am', devOf(devs, 'Browser tab'));
    ok('a device first seen before its oldest kept visit shows that day alone, "2 Aug", and last seen "10 Nov, 7:20am"', devOf(devs, 'Android app')[7] === '2 Aug' && devOf(devs, 'Android app')[8] === '10 Nov, 7:20am', devOf(devs, 'Android app'));
    const ev = await csvOf('events');
    const doseEv = ev.filter((x) => x[4] === 'iPhone app');
    ok('F5 past the hour: all 4 events of the dose visit, its 10pm sign-in and 10:01pm end among them, read "12 Nov, 9pm"', doseEv.length === 4 && doseEv.every((x) => x[0] === '12 Nov, 9pm'), doseEv.map((x) => x[0] + ' ' + x[2]));
    const lapEv = ev.filter((x) => x[4] === 'Browser tab');
    ok('(companion) the laptop visit\'s 4 events keep their minutes: "12 Nov, 8:05am"', lapEv.length === 4 && lapEv.every((x) => x[0] === '12 Nov, 8:05am'), lapEv.map((x) => x[0]));
    const si = await csvOf('signins');
    const siPage = rowsOf(await (await fx.request('/records?tab=signins&own=show')).text());
    const siOf = (list, p) => list.find((x) => x[9] === p) || [];
    ok('F5 on Sign-ins: the sign-in inside the dose visit (10:00pm) reads "12 Nov, 9pm" in the CSV and on the page', si.length === 2 && siOf(si, 'iPhone app')[0] === '12 Nov, 9pm' && siOf(siPage, 'iPhone app')[0] === '12 Nov, 9pm', [si, siPage]);
    ok('(companion) the laptop\'s sign-in keeps its minutes: "12 Nov, 8:05am"', siOf(si, 'Browser tab')[0] === '12 Nov, 8:05am' && siOf(siPage, 'Browser tab')[0] === '12 Nov, 8:05am', [siOf(si, 'Browser tab'), siOf(siPage, 'Browser tab')]);
    const no = fx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_founder'").get().display_no;
    const items = ((await (await fx.request('/household/' + no)).text()).match(/<ul class="visits">([\s\S]*?)<\/ul>/) || ['', ''])[1]
      .split('</li>').map((x) => x.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    ok('F5 on the household page: "Yesterday, 9pm · Sam · iPhone app · logged a dose"', items.some((x) => x.startsWith('Yesterday, 9pm · Sam · iPhone app · logged a dose')), items);
    ok('(companion) and the laptop visit keeps its minutes: "Yesterday, 8:05am · Sam · Browser tab"', items.some((x) => x.startsWith('Yesterday, 8:05am · Sam · Browser tab')), items);
  }

  console.log('\n9. F5 by order, by window and by cut: a dose visit\'s minute moves nothing, and a visit is judged whole');
  {
    const DAY = 86400000, MIN = 60000;
    const csvRows = async (fx, tab) => parseCsv(await (await fx.request('/records.csv?tab=' + tab + '&own=show')).text()).slice(1);
    const founderNo = (fx) => fx.admin.raw.prepare("SELECT display_no FROM dir_households WHERE hid = 'HHID_sample_founder'").get().display_no;
    const visitsList = (body) => ((body.match(/<ul class="visits">([\s\S]*?)<\/ul>/) || ['', ''])[1]).split('</li>').map((x) => x.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    const dev = (device, platform, ua) => ({ uid: S.FOUNDER_UID, hid: 'HHID_sample_founder', tz: 'Asia/Dubai', device, platform, app_version: 'v369', ua });
    const signin = (attempt) => ['signin.attempted', { method: 'google', step: 'signed_in', outcome: 'succeeded', error: 'none', attempt, storage: 'app' }];

    /* 9a. ORDER. Yesterday in Dubai, inside the 9pm hour: the laptop at 9:36 (a feed and a sign-in) and 9:38 (a
       nappy), the phone at 9:37 (a feed), and two dose visits, the phone's (a dose and a sign-in) and the
       home-screen app's (a health entry, its only visit), at 9:35 in one world and 9:39 in the other. A row's
       place must not bracket a dose: every page, tab and CSV that lists rows reads the same in both worlds,
       byte for byte. Batches land in time order, one per visit at its end. */
    const at = (h, m) => Date.UTC(2026, 10, 12, h - 4, m, 0);
    const laptop = dev('d_f9laptop0001', 'browser', S.USAGE_UA.mac);
    const phone = dev('d_f9phone00001', 'ios_app', S.USAGE_UA.ios);
    const home = dev('d_f9homescr001', 'home_screen', S.USAGE_UA.ios);
    const world = (doseMin, feedMin) => async (d1) => {
      const plan = [
        [Object.assign({ visit: 'v_f9lap001' }, laptop), at(21, feedMin), [[0, 'visit.started', { opened_from: 'icon', start: 'warm' }], [5, ...signin(1)], [10, 'feature.used', { feature: 'feed', action: 'logged' }], [20, 'visit.ended', { seconds: 20, reason: 'hidden' }]]],
        [Object.assign({ visit: 'v_f9lap002' }, laptop), at(21, 38), [[0, 'visit.started', { opened_from: 'icon', start: 'warm' }], [10, 'feature.used', { feature: 'nappy', action: 'logged' }], [20, 'visit.ended', { seconds: 20, reason: 'hidden' }]]],
        [Object.assign({ visit: 'v_f9pho001' }, phone), at(21, 37), [[0, 'visit.started', { opened_from: 'icon', start: 'warm' }], [10, 'feature.used', { feature: 'feed', action: 'logged' }], [20, 'visit.ended', { seconds: 20, reason: 'hidden' }]]],
        [Object.assign({ visit: 'v_f9dose01' }, phone), at(21, doseMin), [[0, 'visit.started', { opened_from: 'notification', start: 'warm' }], [5, 'feature.used', { feature: 'medicine', action: 'logged' }], [10, ...signin(2)], [20, 'visit.ended', { seconds: 20, reason: 'hidden' }]]],
        [Object.assign({ visit: 'v_f9dose02' }, home), at(21, doseMin) + 1000, [[0, 'visit.started', { opened_from: 'icon', start: 'warm' }], [5, 'feature.used', { feature: 'health_log', action: 'logged' }], [20, 'visit.ended', { seconds: 20, reason: 'hidden' }]]],
      ].sort((a, b) => a[1] - b[1]);
      for (const [who, start, steps] of plan) await S.ingestVisit(d1, who, start, steps);
    };
    const render = async (seed) => {
      const fx = await F.buildFixture({ usage: seed });
      await quiet(() => fx.tickUntilDone());
      const out = {};
      for (const tab of ['visits', 'events', 'signins', 'devices']) {
        out['/records?tab=' + tab] = await (await fx.request('/records?tab=' + tab + '&own=show')).text();
        out['/records.csv?tab=' + tab] = await (await fx.request('/records.csv?tab=' + tab + '&own=show')).text();
      }
      out['/household'] = visitsList(await (await fx.request('/household/' + founderNo(fx))).text()).join('\n');
      return out;
    };
    const early = await render(world(35, 36)), late = await render(world(39, 36));
    const moved = Object.keys(early).filter((k) => early[k] !== late[k]);
    ok('ORDER: the dose visit at 9:35 or 9:39 (with 9:36, 9:37 and 9:38 around it): all 4 usage tabs, their CSVs and the household page read byte for byte the same', moved.length === 0,
      moved.map((k) => k + ': ' + (early[k].split('\n').find((l, i) => l !== late[k].split('\n')[i]) || '').replace(/<[^>]+>/g, ' ').slice(0, 140)));
    const whens = (w, t) => parseCsv(w['/records.csv?tab=' + t]).slice(1).map((x) => x[t === 'visits' ? 4 : 0]);
    ok('and in every list, in both worlds, the dose visit\'s "12 Nov, 9pm" rows come after every 9:3x row of that hour (Visits, Usage events, Sign-ins CSV)', [early, late].every((w) => ['visits', 'events', 'signins'].every((t) => {
      const ws = whens(w, t), firstHour = ws.indexOf('12 Nov, 9pm');
      return firstHour > 0 && ws.slice(firstHour).every((x) => x === '12 Nov, 9pm');
    })), [early, late].map((w) => ['visits', 'events', 'signins'].map((t) => whens(w, t).join(' / '))));
    const devRow = (w) => parseCsv(w['/records.csv?tab=devices']).slice(1).find((x) => x[1] === 'iPhone app') || [];
    ok('the phone\'s first and last seen are picked by what they show, in both worlds: first "12 Nov, 9pm" (the dose visit stands at the start of the hour), last "12 Nov, 9:37pm"',
      [early, late].every((w) => devRow(w)[7] === '12 Nov, 9pm' && devRow(w)[8] === '12 Nov, 9:37pm'), [devRow(early), devRow(late)]);
    const feedMoved = await render(world(35, 34));
    const seen = Object.keys(early).filter((k) => early[k] !== feedMoved[k]);
    ok('(companion) moving the laptop\'s feed visit from 9:36 to 9:34 DOES change every list that shows it, so the comparison above can see a minute', ['/records?tab=visits', '/records.csv?tab=visits', '/records.csv?tab=events', '/records.csv?tab=signins', '/household'].every((k) => seen.includes(k)), seen);

    /* 9b. WINDOW. The household page lists "Visits, last 48 hours". A visit reaches the server in batches (5 s
       after an event): here the start and the dose land 25 s in, the end 3m 10s in. The dose visit (iPhone)
       and a feed visit of the same shape (laptop) start at 2:40pm Dubai on 11 Nov. Read minute by minute
       across their 48-hour edge, the dose visit never shows a minute and leaves the list at the start of an
       hour; the feed visit always shows its true start, 2:40pm, never its end's 2:43pm. So does a feed visit
       from a tablet whose clock runs 4 minutes fast, whose batches therefore land before the minute it
       started: it is listed, with its true start, for exactly the 48 hours after it began. */
    const S0 = Date.UTC(2026, 10, 11, 10, 40, 0);
    const send = (d1, who, events, now) => (async () => {
      const C = await imp('workers/usage/core.mjs');
      return C.ingest({ v: 1, tz: who.tz, device: who.device, platform: who.platform, app_version: who.app_version, events }, {
        db: d1, uid: who.uid, ua: who.ua, now, notice: '', env: { USAGE_MODE: 'internal', INTERNAL_UIDS: S.FOUNDER_UID, USAGE_DAILY_CAP: '1000000' },
        membership: async () => ({ hid: who.hid, role: 'owner', notice: '' }) });
    })();
    let n9 = 0;
    const id9 = () => '9f1c0b8e-0000-4000-8000-' + (++n9).toString(16).padStart(12, '0');
    const split = async (d1, who, visit, feature, from, ahead) => {
      await send(d1, who, [{ id: id9(), t: from, visit, name: 'visit.started', props: { opened_from: 'notification', start: 'warm' } },
        { id: id9(), t: from + 20000, visit, name: 'feature.used', props: { feature, action: 'logged' } }], from + 25000 - (ahead || 0));
      await send(d1, who, [{ id: id9(), t: from + 190000, visit, name: 'visit.ended', props: { seconds: 190, reason: 'hidden' } }], from + 190500 - (ahead || 0));
    };
    const tablet = dev('d_f9tablet0001', 'android_app', S.USAGE_UA.android);
    const wx = await F.buildFixture({ usage: async (d1) => {
      await split(d1, phone, 'v_f9wdose1', 'medicine', S0); await split(d1, laptop, 'v_f9wfeed1', 'feed', S0); await split(d1, tablet, 'v_f9wfast1', 'feed', S0, 4 * MIN);
    } });
    await quiet(() => wx.tickUntilDone());
    const sweep = [];
    for (let t = S0 + 47 * 3600000; t <= S0 + 48 * 3600000 + 6 * MIN; t += MIN) sweep.push(t);
    const hourEdge = Date.UTC(2026, 10, 13, 10, 0, 0);   // 2pm Dubai on 13 Nov: 48 hours after the dose visit's hour began
    const seenAt = [];
    for (const t of sweep) {
      wx.setNow(t);
      const items = visitsList(await (await wx.request('/household/' + founderNo(wx))).text());
      seenAt.push({ t, phone: items.find((x) => / · iPhone app/.test(x)) || null, lap: items.find((x) => / · Browser tab/.test(x)) || null, fast: items.find((x) => / · Android app/.test(x)) || null });
    }
    wx.setNow(S.NOW);
    const minuteOnPhone = seenAt.filter((x) => x.phone && /, \d{1,2}:\d\d(am|pm) /.test(x.phone));
    ok('WINDOW: across the 48-hour edge (' + sweep.length + ' minutes), the dose visit is never shown with a minute', minuteOnPhone.length === 0, minuteOnPhone.slice(0, 3).map((x) => new Date(x.t).toISOString() + ' ' + x.phone));
    const phoneShown = seenAt.filter((x) => x.phone).map((x) => x.t);
    ok('and it leaves the list at the start of an hour (48 hours after its hour began), never at a moment its batches set', phoneShown.length > 0 && phoneShown.every((t) => t <= hourEdge) && seenAt.filter((x) => !x.phone).every((x) => x.t > hourEdge)
      && seenAt.filter((x) => x.phone).every((x) => /^11 Nov, 2pm · Sam · iPhone app · logged a dose · 3m 10s$/.test(x.phone)), seenAt.filter((_, i) => i % 4 === 0).map((x) => new Date(x.t).toISOString().slice(11, 16) + ' ' + x.phone));
    const lapWrong = seenAt.filter((x) => x.lap && !/^11 Nov, 2:40pm · Sam · Browser tab · logged a feed · 3m 10s$/.test(x.lap));
    ok('and the feed visit of the same shape is read whole: it shows its true start, "11 Nov, 2:40pm", whenever it is listed, never its end\'s 2:43pm, and is listed until 48 hours after it began (the matcher above finds a minute where one may show)',
      lapWrong.length === 0 && seenAt.filter((x) => x.lap).length > 0 && seenAt.every((x) => !!x.lap === (x.t <= S0 + 48 * 3600000)), lapWrong.slice(0, 3).map((x) => new Date(x.t).toISOString() + ' ' + x.lap));
    const fastWrong = seenAt.filter((x) => (x.t <= S0 + 48 * 3600000) !== (x.fast === '11 Nov, 2:40pm · Sam · Android app · logged a feed · 3m 10s'));
    ok('and so is the tablet whose clock runs 4 minutes fast (its batches land at 2:36:25pm and 2:39:10pm): listed whole, "11 Nov, 2:40pm", for exactly the 48 hours after it began',
      fastWrong.length === 0, fastWrong.slice(0, 3).map((x) => new Date(x.t).toISOString() + ' ' + x.fast));

    /* 9c. CUT. Whatever removes old rows (the 90-day retention, by arrival) takes a visit from its head. The
       visit's first batch (its start and its dose) is cut here directly, so this holds whatever the retention
       code does. What stays is the end, which knows the length and lands in a later hour: 2:59:30pm start,
       dose 2:59:50pm, end 3:02:40pm, 3m 10s. Before the cut it read "2pm · 3m 10s"; after, "3pm · 3m 10s" or
       "3:02pm" would give the start away (3:02:40 less 3m 10s). So a visit that kept its end and lost its
       start is shown nowhere. One that never sent an end, cut the same way, shows the hour only. */
    const C0 = Date.UTC(2026, 10, 11, 10, 59, 30);
    const cx = await F.buildFixture({ usage: async (d1) => {
      await split(d1, phone, 'v_f9cdose1', 'medicine', C0);
      await send(d1, laptop, [{ id: id9(), t: C0, visit: 'v_f9cnoend', name: 'visit.started', props: { opened_from: 'icon', start: 'warm' } },
        { id: id9(), t: C0 + 20000, visit: 'v_f9cnoend', name: 'feature.used', props: { feature: 'medicine', action: 'logged' } }], C0 + 25000);
      await send(d1, laptop, [{ id: id9(), t: C0 + 200000, visit: 'v_f9cnoend', name: 'feature.used', props: { feature: 'feed', action: 'logged' } }], C0 + 205000);
    } });
    await quiet(() => cx.tickUntilDone());
    const tabCount = (body, label) => { const m = new RegExp('>' + label + ' <span class="count">([^<]*)</span>').exec(body); return m ? m[1] : null; };
    const look = async () => ({ visits: await csvRows(cx, 'visits'), events: await csvRows(cx, 'events'), signins: await csvRows(cx, 'signins'), devices: await csvRows(cx, 'devices'),
      page: await (await cx.request('/records?tab=visits&own=show')).text() });
    const before = await look();
    ok('(companion) whole, the dose visit reads "11 Nov, 2pm · 3m 10s" on the Visits tab and its 3 events are listed, so the matchers below can find it',
      before.visits.some((x) => x[2] === 'iPhone app' && x[4] === '11 Nov, 2pm' && x[5] === '3m 10s') && before.events.filter((x) => x[6] === 'v_f9cdose1').length === 3, before.visits);
    const cut = cx.usage.raw.prepare('DELETE FROM usage_events WHERE at = ?').run(C0 + 25000).changes;
    const after = await look();
    ok('CUT: with its first batch gone (' + cut + ' rows: two starts and two doses), the visit that kept its end is on no tab and in no CSV: no visit row, no event, no length',
      cut === 4 && !after.visits.some((x) => x[2] === 'iPhone app') && !after.events.some((x) => x[6] === 'v_f9cdose1') && !JSON.stringify(after).includes('3m 10s') && !/3:0\dpm/.test(JSON.stringify(after.visits) + JSON.stringify(after.events)),
      [after.visits, after.events.filter((x) => x[4] === 'iPhone app')]);
    ok('and the counts leave it out too: the Visits tab counts the rows it lists (' + after.visits.length + '), Usage events likewise (' + after.events.length + ')',
      tabCount(after.page, 'Visits') === String(after.visits.length) && tabCount(after.page, 'Usage events') === String(after.events.length), [tabCount(after.page, 'Visits'), tabCount(after.page, 'Usage events')]);
    const noEnd = after.visits.find((x) => x[2] === 'Browser tab') || [];
    ok('a visit cut the same way that never sent an end shows the hour only: its 3:02pm feed reads "11 Nov, 3pm", on the Visits tab and in Usage events', noEnd[4] === '11 Nov, 3pm'
      && after.events.filter((x) => x[6] === 'v_f9cnoend').length === 1 && after.events.filter((x) => x[6] === 'v_f9cnoend').every((x) => x[0] === '11 Nov, 3pm'), [noEnd, after.events.filter((x) => x[6] === 'v_f9cnoend')]);
    ok('and the phone\'s Devices row says the day alone once its only visit is not shown: last seen "11 Nov"', (after.devices.find((x) => x[1] === 'iPhone app') || [])[8] === '11 Nov', after.devices);
  }

  if (process.argv.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    const { selfTest } = require('./helpers/admin-selftest.js');
    selfTest(__filename, [
      { name: 'a CSV cell starting with = is not defused', file: 'workers/admin/src/index.mjs', find: "if (/^[=+\\-@\\t\\r]/.test(s)) s = \"'\" + s;", replace: '' },
      { name: 'the CSV is shown inline, not downloaded', file: 'workers/admin/src/index.mjs', find: "'content-disposition': 'attachment; filename=", replace: "'content-disposition': 'inline; filename=" },
      { name: 'a failing canary reads as working', file: 'workers/admin/src/data.mjs', find: 'if (j && j.ok === true) return', replace: 'if (j) return' },
      { name: 'a silent push cron reads as working', file: 'workers/admin/src/data.mjs', find: 'if (mins > 60) return', replace: 'if (mins > 6000) return' },
      { name: 'any digest ever sent reads as this week\'s', file: 'workers/admin/src/data.mjs', find: 'if (last && last >= mon) return', replace: 'if (last) return' },
      { name: 'a usage tile shows 0 instead of waiting', file: 'workers/admin/src/views.mjs', find: '<div class="tile-label">${label}</div><div class="tile-value">–</div>', replace: '<div class="tile-label">${label}</div><div class="tile-value">0</div>' },
      { name: 'one person logging counts as two', file: 'workers/admin/src/data.mjs', find: 'd.day >= from && d.authors >= 2', replace: 'd.day >= from && d.authors >= 1' },
      { name: 'our own accounts are shown by default', file: 'workers/admin/src/index.mjs', find: "const hideInternal = url.searchParams.get('own') !== 'show';", replace: "const hideInternal = url.searchParams.get('own') === 'hide';" },
      { name: 'no warning when our accounts are not tagged', file: 'workers/admin/src/views.mjs', find: 'if (!cfg.internal.size) out.push(', replace: 'if (false) out.push(' },
      { name: '"today" is UTC\'s, not the person\'s own', file: 'workers/admin/src/usage.mjs', find: 'localParts(now, okTz(r.tz)).local_day === r.local_day', replace: 'utcDay(now) === r.local_day' },
      { name: 'a household with a visit this week also counts as quiet', file: 'workers/admin/src/usage.mjs', find: "' GROUP BY hid HAVING MAX(at) < ?)', [...U, now - 7 * DAY]", replace: "' AND at < ? GROUP BY hid)', [...U, now - 7 * DAY]" },
      { name: 'three people failing to save reads as working', file: 'workers/admin/src/views.mjs', find: 'if (s.failedPeople >= 3) return', replace: 'if (s.failedPeople >= 30) return' },
      { name: 'the newest save failing reads as working', file: 'workers/admin/src/views.mjs', find: 'if (s.lastFailedAt && (!s.lastSaveAt || s.lastFailedAt > s.lastSaveAt)) return', replace: 'if (false) return' },
      { name: 'an empty cubby-usage shows zeros', file: 'workers/admin/src/usage.mjs', find: "    if (!(await anyRows(cfg, scope))) return { state: 'empty' };\n", replace: '' },
      { name: '"Hide our own accounts" no longer hides our usage', file: 'workers/admin/src/usage.mjs', find: 'if (!cfg || !cfg.usage || hideInternal) return NOBODY;', replace: 'if (!cfg || !cfg.usage) return NOBODY;' },
      { name: 'failed saves counted over 1 day, not 7', file: 'workers/admin/src/usage.mjs', find: "'FROM usage_events WHERE hid = ? AND at >= ? AND ' + S, [h.hid, now - 7 * DAY, ...U]", replace: "'FROM usage_events WHERE hid = ? AND at >= ? AND ' + S, [h.hid, now - 1 * DAY, ...U]" },
      { name: 'the usage tabs count pregnancy and trying tools', file: 'workers/admin/src/usage.mjs', find: "const where = tab === 'events' ? scope.where('e.uid') + ' AND ' + NOT_HIDDEN('e.') :", replace: "const where = tab === 'events' ? scope.where('e.uid') + ' AND (1 OR ' + NOT_HIDDEN('e.') + ')' :" },
      { name: 'a page skips a row (paging off by one)', file: 'workers/admin/src/usage.mjs', find: '[USAGE_PAGE, (pageNo - 1) * USAGE_PAGE]', replace: '[USAGE_PAGE, (pageNo - 1) * USAGE_PAGE + 1]' },
      { name: 'F5 is ignored: a dose visit keeps its minutes', file: 'workers/admin/src/html.mjs', find: "(hourOnly ? '' : ':' + z.min)", replace: "(':' + z.min)" },
      /* F5 beyond the shared clock (each found green by the review of 16 Nov until these lines). */
      { name: 'a device shows the minute its newest batch arrived', file: 'workers/admin/src/usage.mjs', find: 'lastSeen: e.last || (lastAt ? dayOnly(lastAt) : null),', replace: 'lastSeen: lastAt ? { at: lastAt, tz, hourOnly: false, bucket: bucketOf(lastAt, tz) } : null,' },
      { name: 'a device\'s dose visit keeps its minutes', file: 'workers/admin/src/usage.mjs', find: 'const when = { at: head.at, tz: head.tz, hourOnly: v.ho === 1, bucket: head.bucket };', replace: 'const when = { at: head.at, tz: head.tz, hourOnly: false, bucket: head.bucket };' },
      { name: 'a device first seen long ago shows its oldest kept visit instead', file: 'workers/admin/src/usage.mjs', find: 'firstSeen: firstKept ? e.first :', replace: 'firstSeen: e.first ? e.first :' },
      { name: 'an event of a dose visit shows its own hour', file: 'workers/admin/src/usage.mjs', find: 'at: head ? head.at : Number(r.client_at), tz: head ? head.tz : okTz(r.tz),', replace: 'at: Number(r.client_at), tz: okTz(r.tz),' },
      { name: 'the Sign-ins tab ignores F5', file: 'workers/admin/src/usage.mjs', find: 'props: props || [], hourOnly };', replace: "props: props || [], hourOnly: tab === 'events' && hourOnly };" },
      { name: 'the household page ignores F5', file: 'workers/admin/src/views.mjs', find: 'localWhen(v.start, v.tz, v.hourOnly, now)', replace: 'localWhen(v.start, v.tz, false, now)' },
      { name: 'the last write is timed though its batch logged a dose', file: 'workers/admin/src/views.mjs', find: "line: s.lastSaveUntimed ? 'Working · the newest save went through' : 'Working · last write '", replace: "line: 'Working · last write '" },
      { name: 'the newest failure is timed though its visit edited a dose', file: 'workers/admin/src/views.mjs', find: "(s.lastFailedUntimed ? '' : ', ' + agoWords(s.lastFailedAt, now))", replace: "(', ' + agoWords(s.lastFailedAt, now))" },
      { name: 'the batch check never finds a health visit', file: 'workers/admin/src/usage.mjs', find: '  if (!Number.isFinite(at)) return false;\n', replace: '  return false;\n' },
      { name: 'the batch check looks only at the row that won a same-millisecond tie', file: 'workers/admin/src/usage.mjs', find: "'SELECT 1 AS y FROM usage_events e WHERE e.at = ? AND '", replace: "'SELECT 1 AS y FROM (SELECT * FROM usage_events WHERE at = ? LIMIT 1) e WHERE '" },
      { name: 'the batch check misses a dose that was edited, not logged', file: 'workers/admin/src/usage.mjs', find: "json_extract(props, '$.action') IN ('logged', 'edited') AND json_extract(props, '$.feature') IN ('medicine', 'health_log')", replace: "json_extract(props, '$.action') IN ('logged') AND json_extract(props, '$.feature') IN ('medicine', 'health_log')" },
      /* F5 by order, by window and by cut, and the CSV of a failed read (each found by the review of 16 Nov). */
      { name: 'the Visits tab sorts by the exact start', file: 'workers/admin/src/usage.mjs', find: "const VISIT_ORDER = ' ORDER BY substr(head, 17, 13) DESC, '", replace: "const VISIT_ORDER = ' ORDER BY substr(head, 1, 15) DESC, '" },
      { name: 'Usage events and Sign-ins sort by each row\'s own time', file: 'workers/admin/src/usage.mjs', find: "const EVENT_ORDER = ' ORDER BY ' + EVENT_BUCKET + ' DESC, '", replace: "const EVENT_ORDER = ' ORDER BY e.client_at DESC, ' + EVENT_BUCKET + ' DESC, '" },
      { name: 'the household page sorts by the exact start', file: 'workers/admin/src/usage.mjs', find: '.sort((a, b) => newestFirst({ ...a, at: a.start,', replace: '.sort((a, b) => b.start - a.start || newestFirst({ ...a, at: a.start,' },
      { name: 'Devices sort by the exact last seen', file: 'workers/admin/src/usage.mjs', find: 'devs.sort((a, b) => newestFirst(key(a), key(b)));', replace: 'devs.sort((a, b) => (b.lastSeen ? b.lastSeen.at : 0) - (a.lastSeen ? a.lastSeen.at : 0));' },
      { name: 'a device\'s newest visit is picked by its exact start', file: 'workers/admin/src/usage.mjs', find: 'ORDER BY substr(head, 17, 13) DESC, ho, ', replace: 'ORDER BY substr(head, 1, 15) DESC, ho, ' },
      { name: 'a device\'s first visit is picked by its exact start', file: 'workers/admin/src/usage.mjs', find: 'ORDER BY substr(head, 17, 13), ho DESC, ', replace: 'ORDER BY substr(head, 1, 15), ho DESC, ' },
      { name: 'an hour-only first visit is kept or dropped by its exact start', file: 'workers/admin/src/usage.mjs',
        find: 'const firstKept = e.first && firstAt && (e.first.hourOnly ? e.first.bucket <= bucketOf(firstAt, e.first.tz) : e.first.at <= firstAt);', replace: 'const firstKept = e.first && firstAt && e.first.at <= firstAt;' },
      { name: 'the household page groups only the rows inside its 48 hours', file: ['workers/admin/src/usage.mjs', 'workers/admin/src/usage.mjs'],
        find: ["' AND (uid, visit) IN (SELECT uid, visit FROM usage_events WHERE hid = ? AND at >= ? AND ' + S", 'now - 49 * HOUR, ...U]'],
        replace: ["' AND hid = ? AND at >= ? AND (' + S", 'now - 48 * HOUR, ...U]'] },
      { name: 'the household page finds its visits with no slack for a fast phone clock', file: 'workers/admin/src/usage.mjs', find: 'now - 49 * HOUR, ...U]', replace: 'now - 48 * HOUR, ...U]' },
      { name: 'the household page lists whatever its batches bring in', file: 'workers/admin/src/usage.mjs',
        find: 'const listedSince = (v, now) => (v.hourOnly ? hourStart(v.start, v.tz) : v.start) >= now - 48 * HOUR;', replace: 'const listedSince = (v, now) => true;' },
      { name: 'an hour-only visit leaves the household page 48 hours after its own minute', file: 'workers/admin/src/usage.mjs',
        find: 'const listedSince = (v, now) => (v.hourOnly ? hourStart(v.start, v.tz) : v.start) >= now - 48 * HOUR;', replace: 'const listedSince = (v, now) => v.start >= now - 48 * HOUR;' },
      { name: 'a visit cut from its head keeps its minutes', file: ['workers/admin/src/usage.mjs', 'workers/admin/src/usage.mjs'],
        find: ["const HOUR_ONLY = (v) => '(' + v + 'health = 1 OR ' + v + 'headed = 0)';", 'const hourOnlyOf = (r) => r.health === 1 || r.headed !== 1;'],
        replace: ["const HOUR_ONLY = (v) => '(' + v + 'health = 1)';", 'const hourOnlyOf = (r) => r.health === 1;'] },
      { name: 'a visit that kept its end but lost its start is listed', file: 'workers/admin/src/usage.mjs', find: "const SHOWN = (v) => 'NOT (' + v + 'headed = 0 AND ' + v + 'ended = 1)';", replace: "const SHOWN = (v) => '(1 OR ' + v + 'headed = 0)';" },
      { name: 'a usage CSV whose read failed is served as a file of no rows', file: 'workers/admin/src/index.mjs', find: "    if (csv && usage && usage.state === 'error') return notExported();\n", replace: '' },
      { name: 'a usage read failure reads as waiting', file: 'workers/admin/src/usage.mjs', find: "  } catch (e) {\n    return { state: 'error' };\n  }\n}\n\n/* Pregnancy", replace: "  } catch (e) {\n    return { state: 'empty' };\n  }\n}\n\n/* Pregnancy" },
    ], ok);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-SCREENS: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-SCREENS: FAIL'); process.exit(1); });
