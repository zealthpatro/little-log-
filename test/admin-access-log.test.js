/* Cubby Ops: every look is logged before it is shown, in a chain nobody can edit unseen (S16 to S19).
 *
 *   node test/admin-access-log.test.js               the suite
 *   node test/admin-access-log.test.js --self-test   also break each rule in a temp copy and require RED
 *
 * The real handler over SAMPLE families; D1 is real SQLite, so the chain, the guarded insert and the
 * rollback are the database's own behaviour, not a fake's.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { selfTest, runMutant } = require('./helpers/admin-selftest');

const ROOT = process.env.ADMIN_ROOT || path.join(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); } };
const NAMES = ['Maya', 'Rosa', 'Usha', 'Priya', 'Leena', 'Omar', 'Dana', 'maya@example.com', 'rosa@example.com'];

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(m?js|sql)$/.test(e.name)) out.push(p);
  }
  return out;
}

(async () => {
  const F = await imp('workers/admin/dev/fixture.mjs');
  const L = await imp('workers/admin/src/log.mjs');
  console.log('\nadmin access log: logged first, chained, fixed vocabulary, append-only');

  console.log('\n1. every route that shows family data writes its row FIRST; a failed write shows nothing (S16)');
  const ROUTES = ['/', '/household/4', '/records', '/records?tab=households', '/records?tab=access', '/records.csv?tab=people',
    '/records.csv?tab=households', '/records.csv?tab=access', '/manual-access?household=4',
    /* Phase 2: the usage panels and tabs, with cubby-usage holding our own rows (household 1 is the founder's). */
    '/?own=show', '/household/1', '/records?tab=visits&own=show', '/records?tab=events&own=show', '/records?tab=signins&own=show',
    '/records?tab=devices&own=show', '/records.csv?tab=visits&own=show', '/records.csv?tab=events&own=show', '/records.csv?tab=signins&own=show',
    '/records.csv?tab=devices&own=show'];
  /* What a usage page or CSV would show: none of it may leave when the log row cannot be written. */
  const USAGE_SHOWN = ['iPhone app', 'v369', 'visit.started', 'Log a feed', 'Working · a save came in'];
  {
    const fx = await F.buildFixture({ usage: 'sample' });
    await fx.tickUntilDone();
    for (const p of ROUTES) {
      const before = fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log').get().n;
      const r = await fx.request(p);
      ok(p + ' answers 200 and leaves exactly one access-log row', r.status === 200 && fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log').get().n === before + 1, r.status);
    }
    await fx.request('/household/4');
    const hh = fx.admin.raw.prepare("SELECT * FROM access_log WHERE action = 'view_household' ORDER BY seq DESC LIMIT 1").get();
    const body = await (await fx.request('/household/4')).text();
    const row = fx.admin.raw.prepare("SELECT at FROM access_log WHERE action = 'view_household' ORDER BY seq DESC LIMIT 1").get();
    ok('the household banner shows the time of the row this very view wrote', body.includes('datetime="' + new Date(row.at).toISOString() + '"') && /You opened this household at/.test(body));
    ok('a household view names its household and no person', hh.target_hid === 'HHID_sample_maya' && hh.target_uid === null, hh);
  }
  {
    let failing = false;
    const fx = await F.buildFixture({ usage: 'sample', adminHooks: { before: (sql) => { if (failing && /INSERT INTO access_log /.test(sql)) throw new Error('D1_ERROR: staged log failure'); } } });
    await fx.tickUntilDone();
    const shownOk = (await (await fx.request('/records?tab=visits&own=show')).text()) + (await (await fx.request('/?own=show')).text()) + (await (await fx.request('/records.csv?tab=events&own=show')).text());
    ok('(companion) with the log working, those pages DO show what the matcher looks for', USAGE_SHOWN.every((x) => shownOk.includes(x)), USAGE_SHOWN.filter((x) => !shownOk.includes(x)));
    failing = true;
    for (const p of ROUTES) {
      const r = await fx.request(p);
      const body = await r.text();
      const seen = NAMES.concat(USAGE_SHOWN).filter((n) => body.includes(n));
      ok(p + ' with the log write failing: 503 and not one name or usage row', r.status === 503 && seen.length === 0, r.status + ' ' + seen);
    }
    const n0 = fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log').get().n;
    const h0 = fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log_hids').get().n;
    const post = await fx.request('/api/manual-access', { method: 'POST', headers: { origin: 'https://admin.little-cubby.com', 'content-type': 'application/json' }, body: JSON.stringify({ household: 4, reason: 'family_asked' }) });
    ok('a manual access whose row cannot be written says so (503)', post.status === 503);
    ok('and nothing was half-written: no row, no household list', fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log').get().n === n0 && fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log_hids').get().n === h0);
  }

  console.log('\n2. the chain verifies from row 1, and any edit or removal shows at that row (S17)');
  {
    const fx = await F.buildFixture({});
    await fx.tickUntilDone();
    for (const p of ROUTES) await fx.request(p);
    const db = fx.admin.raw;
    const good = await L.verifyChain(fx.admin);
    const n = db.prepare('SELECT COUNT(*) AS n FROM access_log').get().n;
    ok('the untouched chain verifies to its last row (' + n + ' rows)', good.ok && good.verifiedTo === n, good);
    const listRow = db.prepare('SELECT seq FROM access_log_hids GROUP BY seq ORDER BY seq LIMIT 1').get().seq;
    const tampers = [
      ['a row\'s detail edited', 'UPDATE access_log SET detail = \'{"tab":"households"}\' WHERE seq = 3', 3, 'edited'],
      ['a row\'s actor edited', "UPDATE access_log SET actor = 'Someone' WHERE seq = 2", 2, 'edited'],
      ['a row\'s household changed', "UPDATE access_log SET target_hid = 'HHID_sample_dana' WHERE action = 'view_household' AND seq = (SELECT MIN(seq) FROM access_log WHERE action = 'view_household')", null, 'edited'],
      ['a middle row deleted', 'DELETE FROM access_log WHERE seq = 4', 4, 'missing'],
      ['a household removed from a row\'s list', 'DELETE FROM access_log_hids WHERE rowid = (SELECT MIN(rowid) FROM access_log_hids WHERE seq = ' + listRow + ')', listRow, 'edited'],
      ['a household added to a row\'s list', "INSERT INTO access_log_hids (seq, hid) VALUES (" + listRow + ", 'HHID_sample_extra')", listRow, 'edited'],
      ['a row re-pointed at another parent', "UPDATE access_log SET prev_hash = '" + 'f'.repeat(64) + "' WHERE seq = 5", 5, 'link'],
      ['the newest row deleted', 'DELETE FROM access_log WHERE seq = (SELECT MAX(seq) FROM access_log)', null, 'missing'],
    ];
    for (const [label, sql, at, why] of tampers) {
      db.exec('SAVEPOINT t');
      db.exec(sql);
      const v = await L.verifyChain(fx.admin);
      const want = at === null ? true : v.brokenAt === at;
      ok(label + ': verification fails' + (at ? ' at row ' + at : '') + ' (' + why + ')', !v.ok && want && v.why === why, v);
      db.exec('ROLLBACK TO t'); db.exec('RELEASE t');
    }
    const after = await L.verifyChain(fx.admin);
    ok('the chain verifies again once each tamper is undone', after.ok, after);
    const page = await (await fx.request('/records?tab=access')).text();
    ok('the Access log tab says "Chain verified to entry N"', /Chain verified to entry \d+\./.test(page));
    /* The look that drew the tab is in the tab: its own entry heads the list, the chain line names that
       same entry, and the tab's count includes it. */
    const own = fx.admin.raw.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
    const firstSeq = (/<tbody><tr><td class="strong">(\d+)<\/td>/.exec(page) || [])[1];
    const chainTo = (/Chain verified to entry (\d+)\./.exec(page) || [])[1];
    const tabCount = (/Access log <span class="count">([\d,]+)<\/span>/.exec(page) || [])[1];
    ok('the Access log tab lists its own look first, and the chain line and the count agree with it',
      Number(firstSeq) === own && Number(chainTo) === own && Number(tabCount) === own, { own, firstSeq, chainTo, tabCount });

    /* Outside a savepoint (a page view writes its own row in its own transaction). */
    const fy = await F.buildFixture({});
    await fy.tickUntilDone();
    for (const p of ROUTES) await fy.request(p);
    fy.admin.raw.exec('DELETE FROM access_log WHERE seq = 4');
    const red = await (await fy.request('/records?tab=access')).text();
    ok('a deleted row shows on the Access log tab, in red, by number', /chain-bad/.test(red) && /The chain breaks at entry 4: that entry is missing\./.test(red));

    const writes = [];
    for (let i = 0; i < 4; i++) writes.push(L.appendLog(fx.admin, { at: fx.now(), actor: 'Alex', actor_id: '0123456789abcdef', action: 'view_overview', detail: { range: '7' } }, []));
    const res = await Promise.allSettled(writes);
    const seqs = res.filter((r) => r.status === 'fulfilled').map((r) => r.value.seq);
    ok('four appends at once all land, on four different rows', seqs.length === 4 && new Set(seqs).size === 4, res.map((r) => r.status + (r.reason ? r.reason.message : '')));
    const v2 = await L.verifyChain(fx.admin);
    ok('and the chain never forked', v2.ok, v2);
    /* V2-6: twenty at once (many tabs opened together). Each loser of a collision waits a random, growing
       moment before it tries again on the new head (2f checks the waits exactly), so the burst lands one by one
       instead of colliding again in step. Retrying in step, with no wait or the same wait for every loser,
       exactly five land: one a round for five rounds. All twenty landed in 289 of 300 bursts here, on a machine at
       a load average near 100; a machine starved of CPU fires the timers late and together, and the worst burst
       lost seven, so the line is ten, twice what retrying in step can reach. */
    const burst = [];
    const top0 = fx.admin.raw.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
    for (let i = 0; i < 20; i++) burst.push(L.appendLog(fx.admin, { at: fx.now(), actor: 'Alex', actor_id: '0123456789abcdef', action: 'view_overview', detail: { range: '30' } }, i % 3 ? [] : ['HHID_sample_maya']));
    const br = await Promise.allSettled(burst);
    const bseqs = br.filter((r) => r.status === 'fulfilled').map((r) => r.value.seq).sort((a, b) => a - b);
    const refusedWhy = [...new Set(br.filter((r) => r.status === 'rejected').map((r) => r.reason.message))];
    ok('twenty appends at once: at least 10 land (' + bseqs.length + ' of 20; retrying in step, 5 do), on numbers in a row', bseqs.length >= 10 && bseqs.every((x, i) => x === top0 + 1 + i),
      [bseqs.length, refusedWhy]);
    ok('and any refused were refused as contended, never as a broken log', refusedWhy.every((m) => m === 'log_contended'), refusedWhy);
    const v3 = await L.verifyChain(fx.admin);
    ok('and the chain still never forked', v3.ok, v3);
  }

  console.log('\n2f. looks at the same moment: a loser waits a random, growing moment before it tries again, and an overlapping look is never taken for a break (V2-6)');
  {
    const fx = await F.buildFixture({});
    await fx.tickUntilDone();
    for (const p of ROUTES.slice(0, 3)) await fx.request(p);
    const db = fx.admin.raw;
    const count = () => db.prepare('SELECT COUNT(*) AS n FROM access_log').get().n;
    const entry = () => ({ at: fx.now(), actor: 'Alex', actor_id: '0123456789abcdef', action: 'view_overview', detail: { range: '30' } });
    /* A D1 stand-in whose batch() collides on the primary key for its first `k` calls, as when another request
       wrote the same number first, stamping the moment of each try. */
    const colliding = (inner, k, stamps) => {
      const wrap = (q) => ({ _inner: q, bind: (...a) => wrap(q.bind(...a)), first: (...a) => q.first(...a), all: () => q.all(), run: () => q.run() });
      return { prepare: (sql) => wrap(inner.prepare(sql)), batch: (list) => {
        stamps.push(performance.now());
        if (k-- > 0) return Promise.reject(new Error('D1_ERROR: UNIQUE constraint failed: access_log.seq: SQLITE_CONSTRAINT'));
        return inner.batch(list.map((x) => x._inner));
      } };
    };
    /* The dice (Math.random) are fixed, and every timer appendLog asks for is recorded, so the waits are checked
       exactly, whatever the machine's load; the stamps show it really waited (a lower bound, which load cannot
       break). */
    const realRandom = Math.random;
    const timed = async (dice, k) => {
      const stamps = [], asked = [];
      let out = null, err = null;
      const realTimeout = globalThis.setTimeout;
      Math.random = () => dice;
      globalThis.setTimeout = (fn, ms, ...a) => { asked.push(Math.round(ms)); return realTimeout(fn, ms, ...a); };
      try { out = await L.appendLog(colliding(fx.admin, k, stamps), entry(), []); } catch (e) { err = e; } finally { Math.random = realRandom; globalThis.setTimeout = realTimeout; }
      return { out, err, tries: stamps.length, asked, gaps: stamps.slice(1).map((t, i) => Math.round(t - stamps[i])) };
    };
    const B = L.RETRY_BASE_MS;
    const want = (dice) => [0, 1, 2, 3].map((i) => Math.round(dice * B * 2 ** i));
    const high = await timed(0.999, 4);
    ok('four collisions in a row, then it lands on the fifth try', !high.err && high.out && high.tries === 5, [high.tries, high.err && high.err.message]);
    ok('and before each retry it waits a moment that can double each time (dice at their highest: asked for ' + high.asked.join(', ') + ' ms, waited ' + high.gaps.join(', ') + ')',
      JSON.stringify(high.asked) === JSON.stringify(want(0.999)) && high.gaps.every((g, i) => g >= Math.floor(0.9 * want(0.999)[i])), [high.asked, want(0.999), high.gaps]);
    const half = await timed(0.5, 4), low = await timed(0, 4);
    ok('the wait is drawn at random, the whole range open: half the dice, half the wait (' + half.asked.join(', ') + '); the lowest, none (' + low.asked.join(', ') + ')',
      !half.err && !low.err && JSON.stringify(half.asked) === JSON.stringify(want(0.5)) && JSON.stringify(low.asked) === JSON.stringify(want(0)), [half.asked, low.asked]);
    const n0 = count();
    const five = await timed(0.999, 5);
    ok('five collisions: refused as contended, nothing written, and no wait after the last try (' + five.asked.length + ' waits for ' + five.tries + ' tries)',
      five.err && five.err.message === 'log_contended' && five.tries === 5 && count() === n0 && five.asked.length === 4, [five.err && five.err.message, five.tries, five.asked]);

    /* Another request's entry lands while this one reads the tail. Read in two statements, the head record then
       stands one past the newest entry just read, which is exactly what a deleted entry looks like, and a look
       that merely overlapped another was refused as "Access log broken". `other()` commits one valid entry the
       way the dashboard writes it, just before the n-th database call this append makes. */
    const sha = (x) => require('crypto').createHash('sha256').update(x).digest('hex');
    const other = () => {
      const head = JSON.parse(db.prepare("SELECT value FROM admin_meta WHERE key = 'log_head'").get().value);
      const own = { seq: head.seq + 1, at: fx.now(), actor: 'Alex', actor_id: '0123456789abcdef', action: 'view_overview', target_hid: null, target_uid: null,
        detail: '{"range":"7"}', country: null, ray: null };
      const hash = sha(head.hash + '\n' + L.canonical(own) + '\n');
      db.prepare('INSERT INTO access_log (seq, at, actor, actor_id, action, target_hid, target_uid, detail, country, ray, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(own.seq, own.at, own.actor, own.actor_id, own.action, null, null, own.detail, null, null, head.hash, hash);
      db.prepare("UPDATE admin_meta SET value = ? WHERE key = 'log_head'").run(JSON.stringify({ seq: own.seq, hash }));
    };
    const overlapping = (inner, at) => {
      let calls = 0;
      const step = () => { if (++calls === at) other(); };
      const wrap = (q) => ({ _inner: q, bind: (...a) => wrap(q.bind(...a)), first: (...a) => { step(); return q.first(...a); }, all: () => { step(); return q.all(); }, run: () => { step(); return q.run(); } });
      return { prepare: (sql) => wrap(inner.prepare(sql)), batch: (list) => { step(); return inner.batch(list.map((x) => x._inner)); } };
    };
    for (const at of [2, 3, 4]) {
      const top = db.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
      let got = null, err = null;
      try { got = await L.appendLog(overlapping(fx.admin, at), entry(), []); } catch (e) { err = e; }
      const v = await L.verifyChain(fx.admin);
      ok('another look lands just before this one\'s database call ' + at + ': this one still lands, after it, and the chain verifies',
        !err && got && got.seq > top && v.ok, [err && (err.message + ' ' + (err.from || '') + '-' + (err.to || '')), got, top, v.ok]);
    }
    const page = await fx.request('/records?tab=access');
    ok('and the next look is an ordinary 200, nothing named missing', page.status === 200 && !/chain-bad/.test(await page.text()));
  }

  /* The founder's commands, taken from docs/ADMIN-DEPLOY.md itself (always this checkout's copy), so the
     page's "says how to carry on" cannot point at a command that does not work. */
  const deployDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ADMIN-DEPLOY.md'), 'utf8');
  const RESUME_SQL = [...deployDoc.matchAll(/--command "(INSERT[^"]*INTO admin_meta[^"]*log_resume[^"]*)"/g)].map((m) => m[1]);
  ok('docs/ADMIN-DEPLOY.md gives the one resume command, for every break', RESUME_SQL.length === 1, RESUME_SQL.length);

  console.log('\n2b. the newest entries deleted: the next look refuses, names them, and never chains over them');
  /* One DELETE is all anyone with D1 write needs (wrangler d1 execute, an API token, the main Worker once
     ADMIN_DB is bound). Before this fix the next write chained onto the shortened log and reused the numbers,
     and the Access log tab then said "Chain verified". Run outside any savepoint, as a real DELETE lands. */
  for (const k of [1, 3]) {
    const fx = await F.buildFixture({});
    await fx.tickUntilDone();
    for (const p of ROUTES) await fx.request(p);
    const db = fx.admin.raw;
    const top = db.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
    db.exec('DELETE FROM access_log_hids WHERE seq > ' + (top - k) + '; DELETE FROM access_log WHERE seq > ' + (top - k));
    const count = () => db.prepare('SELECT COUNT(*) AS n FROM access_log').get().n;
    const n0 = count();
    const named = k === 1 ? 'Entry ' + top + ' of the access log is missing.' : 'Entries ' + (top - k + 1) + ' to ' + top + ' of the access log are missing.';
    for (const p of ['/records?tab=access', '/', '/household/4', '/records.csv?tab=people']) {
      const r = await fx.request(p);
      const body = await r.text();
      ok('last ' + k + ' deleted, then ' + p + ': 503, names "' + named + '", and not one name', r.status === 503 && body.includes(named) && !NAMES.some((x) => body.includes(x)), r.status + ' ' + body.replace(/[\s\S]*<p class="lead">/, '').slice(0, 160));
    }
    const post = await fx.request('/api/manual-access', { method: 'POST', headers: { origin: 'https://admin.little-cubby.com', 'content-type': 'application/json' }, body: JSON.stringify({ household: 4, reason: 'family_asked' }) });
    const pj = await post.json().catch(() => ({}));
    ok('last ' + k + ' deleted: a manual access is refused too (503), and says which entries', post.status === 503 && String(pj.message || '').includes(named), [post.status, pj]);
    fx.setNow(fx.now() + 61000);
    const refused = await fx.request('/', { jwt: false });
    ok('last ' + k + ' deleted: a stranger is still refused (403)', refused.status === 403);
    ok('last ' + k + ' deleted: nothing was appended over the gap, not even a refusal', count() === n0, [count(), n0]);
    ok('last ' + k + ' deleted: no number was reused', !db.prepare('SELECT 1 FROM access_log WHERE seq > ?').get(top - k));

    /* The way on (docs/ADMIN-DEPLOY.md): the founder looks into it, then copies the head into a resume
       record. The chain then continues FROM THE HEAD, so the deleted numbers stay a gap for good. */
    db.exec(RESUME_SQL[0]);
    const tab = await fx.request('/records?tab=access');
    const tb = await tab.text();
    const own = db.prepare('SELECT seq, prev_hash FROM access_log ORDER BY seq DESC LIMIT 1').get();
    const resumeRow = db.prepare("SELECT value FROM admin_meta WHERE key = ?").get('log_resume:' + top);
    const headWas = { hash: resumeRow ? String(resumeRow.value).replace(/^\d+:/, '') : null };
    ok('last ' + k + ' deleted, then resumed: the next entry is ' + (top + 1) + ', chained to the old head', tab.status === 200 && own.seq === top + 1 && own.prev_hash === headWas.hash, [tab.status, own, headWas]);
    const gapLine = k === 1 ? 'except entry ' + top + ', which is missing' : 'except entries ' + (top - k + 1) + ' to ' + top + ', which are missing';
    ok('and the Access log tab names the gap in red, for good ("' + gapLine + '")', /chain-bad/.test(tb) && tb.includes(gapLine), (tb.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1]);
    const v = await L.verifyChain(fx.admin);
    ok('and the verifier reports the same gap', v.ok && v.gaps && v.gaps.length === 1 && v.gaps[0].from === top - k + 1 && v.gaps[0].to === top, v);
    /* A SECOND deletion after resuming is refused again: an old resume record never covers a new break. */
    db.exec('DELETE FROM access_log WHERE seq = (SELECT MAX(seq) FROM access_log)');
    const again = await fx.request('/');
    ok('a later deletion is refused again, whatever resume records exist', again.status === 503 && (await again.text()).includes('Entry ' + (top + 1) + ' of the access log is missing.'));
  }
  {
    /* The head itself deleted, or replaced, or a row written past it: each is refused and named. */
    const cases = [
      ['the head record deleted', "DELETE FROM admin_meta WHERE key = 'log_head'", 'The record of the newest access log entry is missing.', RESUME_SQL[0]],
      ['the newest entry rewritten', "UPDATE access_log SET hash = '" + 'e'.repeat(64) + "' WHERE seq = (SELECT MAX(seq) FROM access_log)", 'was changed after it was written.'],
      ['an entry written past the head', "INSERT INTO access_log (seq, at, actor, actor_id, action, detail, prev_hash, hash) SELECT MAX(seq) + 1, 1, 'X', '-', 'view_overview', '{}', '0', '0' FROM access_log", 'was not written by the dashboard.'],
    ];
    for (const [label, sql, says, resume] of cases) {
      const fx = await F.buildFixture({});
      await fx.tickUntilDone();
      for (const p of ROUTES.slice(0, 3)) await fx.request(p);
      fx.admin.raw.exec(sql);
      const r = await fx.request('/records?tab=access');
      const body = await r.text();
      ok(label + ': the next look is 503 and says so', r.status === 503 && body.includes(says) && !NAMES.some((x) => body.includes(x)), r.status + ' ' + body.replace(/[\s\S]*<p class="lead">/, '').slice(0, 160));
      if (resume) {
        fx.admin.raw.exec(resume);
        const after = await fx.request('/records?tab=access');
        ok(label + ': the documented way on lets the next look through, chained to the newest entry', after.status === 200 && (await L.verifyChain(fx.admin)).ok, after.status);
      }
    }
  }

  console.log('\n2e. the newest entry changed with its hash left alone: the next look re-hashes it and refuses (V2-4)');
  {
    const cases = [
      ['its household cleared', "UPDATE access_log SET target_hid = NULL WHERE seq = (SELECT MAX(seq) FROM access_log)"],
      ['its detail changed', "UPDATE access_log SET detail = '{\"tab\":\"people\"}' WHERE seq = (SELECT MAX(seq) FROM access_log)"],
      ['its actor changed', "UPDATE access_log SET actor = 'Someone' WHERE seq = (SELECT MAX(seq) FROM access_log)"],
      ['a household taken off its list', 'DELETE FROM access_log_hids WHERE rowid = (SELECT MIN(rowid) FROM access_log_hids WHERE seq = (SELECT MAX(seq) FROM access_log))'],
      ['a household added to its list', "INSERT INTO access_log_hids (seq, hid) SELECT MAX(seq), 'HHID_sample_extra' FROM access_log"],
    ];
    for (const [label, sql] of cases) {
      const fx = await F.buildFixture({});
      await fx.tickUntilDone();
      /* The newest entry is a household view (it has a household) or a list (it has a household list). */
      for (const p of /list/.test(label) ? ['/', '/household/4', '/records?tab=households'] : ['/', '/records?tab=households', '/household/4']) await fx.request(p);
      const db = fx.admin.raw;
      const top = db.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
      const n0 = db.prepare('SELECT COUNT(*) AS n FROM access_log').get().n;
      const snap = () => JSON.stringify(db.prepare('SELECT * FROM access_log WHERE seq = ?').get(top)) + JSON.stringify(db.prepare('SELECT hid FROM access_log_hids WHERE seq = ? ORDER BY hid').all(top));
      const before = snap(), hash0 = db.prepare('SELECT hash FROM access_log WHERE seq = ?').get(top).hash;
      db.exec(sql);
      ok('staged: the newest entry, ' + label + ', really changed, and its hash did not', snap() !== before && db.prepare('SELECT hash FROM access_log WHERE seq = ?').get(top).hash === hash0);
      const says = 'Entry ' + top + ' of the access log was changed after it was written.';
      let all = true, seen = '';
      for (const p of ['/records?tab=access', '/household/4', '/records.csv?tab=people']) {
        const r = await fx.request(p);
        const body = await r.text();
        if (!(r.status === 503 && body.includes(says) && !NAMES.some((x) => body.includes(x)))) { all = false; seen = p + ' ' + r.status + ' ' + body.replace(/[\s\S]*<p class="lead">/, '').slice(0, 140); }
      }
      ok('the newest entry, ' + label + ' (hash left alone): every look is 503, "' + says + '"', all, seen);
      ok('and nothing was appended after it', db.prepare('SELECT COUNT(*) AS n FROM access_log').get().n === n0);
      if (label === 'its household cleared') {
        db.exec(RESUME_SQL[0]);
        const t = await fx.request('/records?tab=access');
        const tb = await t.text();
        ok('after the documented resume the next look goes through, and the tab names entry ' + top + ' as changed, in red',
          t.status === 200 && /chain-bad/.test(tb) && tb.includes('The chain breaks at entry ' + top + ': that entry was changed after it was written.'), t.status + ' ' + ((tb.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1] || ''));
      }
    }
  }

  console.log('\n2d. the head record rewound, or lost with the newest entries: AUTOINCREMENT\'s high-water mark still names them (V2-1, V2-3)');
  {
    /* sqlite_sequence is SQLite's own record of the highest number an AUTOINCREMENT table ever handed out. A DELETE
       never lowers it (the same on Miniflare's D1: the plan's status notes), so a rewound head record cannot make the
       deleted numbers look as if they never existed. Run outside any savepoint, as a real DELETE lands. */
    const hwOf = (db) => (db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'access_log'").get() || {}).seq;
    const tabLine = async (fx) => { const r = await fx.request('/records?tab=access'); const b = await r.text(); return { status: r.status, body: b, line: (b.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1] || '' }; };
    for (const ticks of [0, 1]) {
      const fx = await F.buildFixture({});
      await fx.tickUntilDone();
      for (const p of ['/', '/household/4', '/records', '/', '/household/4', '/records', '/', '/household/4']) await fx.request(p);
      for (let i = 0; i < ticks; i++) { fx.setNow(fx.now() + 15 * 60000); await fx.tick(); }
      const db = fx.admin.raw;
      const top = db.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
      const keep = db.prepare('SELECT seq, hash FROM access_log WHERE seq = ?').get(top - 3);
      const hw0 = hwOf(db);
      db.exec('DELETE FROM access_log_hids WHERE seq > ' + keep.seq + '; DELETE FROM access_log WHERE seq > ' + keep.seq);
      ok('the high-water mark (sqlite_sequence) stays at ' + top + ' after the newest 3 are deleted', hw0 === top && hwOf(db) === top, [hw0, hwOf(db)]);
      db.prepare("UPDATE admin_meta SET value = ? WHERE key = 'log_head'").run(JSON.stringify({ seq: keep.seq, hash: keep.hash }));
      const named = 'Entries ' + (keep.seq + 1) + ' to ' + top + ' of the access log are missing.';
      for (const p of ['/records?tab=access', '/household/4', '/records.csv?tab=people']) {
        const r = await fx.request(p);
        const body = await r.text();
        ok('head rewound over the newest 3 (checkpoint ' + (ticks ? 'on them' : 'behind them') + '), then ' + p + ': 503, names "' + named + '", not one name',
          r.status === 503 && body.includes(named) && !NAMES.some((x) => body.includes(x)), r.status + ' ' + body.replace(/[\s\S]*<p class="lead">/, '').slice(0, 160));
      }
      ok('and nothing was written over them, no number reused', !db.prepare('SELECT 1 FROM access_log WHERE seq > ?').get(keep.seq));
      db.exec(RESUME_SQL[0]);
      const t = await tabLine(fx);
      const own = db.prepare('SELECT seq, prev_hash FROM access_log ORDER BY seq DESC LIMIT 1').get();
      ok('after the documented resume: the next entry is ' + (top + 1) + ' (never ' + (keep.seq + 1) + '), chained to the rewound head', t.status === 200 && own.seq === top + 1 && own.prev_hash === keep.hash, [t.status, own]);
      const gapLine = 'except entries ' + (keep.seq + 1) + ' to ' + top + ', which are missing';
      ok('and the Access log tab names entries ' + (keep.seq + 1) + ' to ' + top + ' missing, in red, for good', /chain-bad/.test(t.body) && t.line.includes(gapLine), t.line);
      const v = await L.verifyChain(fx.admin);
      ok('and the verifier reports that gap', v.ok && v.gaps.length === 1 && v.gaps[0].from === keep.seq + 1 && v.gaps[0].to === top, v);
      for (let i = 0; i < 3; i++) { await fx.request('/'); fx.setNow(fx.now() + 15 * 60000); await fx.tick(); }
      const t2 = await tabLine(fx);
      ok('and still does after the cron has swept the whole log', t2.status === 200 && t2.line.includes(gapLine) && /chain-bad/.test(t2.body), t2.line);
    }
    {
      /* sqlite_sequence lowered as well: the cron's checkpoint, when it stands on the deleted entries, still names
         them. (With the checkpoint behind them too, nothing inside the database can: docs/ADMIN-DEPLOY.md says so.) */
      const fx = await F.buildFixture({});
      await fx.tickUntilDone();
      for (const p of ['/', '/household/4', '/records', '/', '/household/4']) await fx.request(p);
      fx.setNow(fx.now() + 15 * 60000); await fx.tick();
      const db = fx.admin.raw;
      const top = db.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
      const keep = db.prepare('SELECT seq, hash FROM access_log WHERE seq = ?').get(top - 2);
      db.exec('DELETE FROM access_log_hids WHERE seq > ' + keep.seq + '; DELETE FROM access_log WHERE seq > ' + keep.seq);
      db.prepare("UPDATE admin_meta SET value = ? WHERE key = 'log_head'").run(JSON.stringify({ seq: keep.seq, hash: keep.hash }));
      db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'access_log'").run(keep.seq);
      const r = await fx.request('/');
      const body = await r.text();
      ok('head rewound and sqlite_sequence lowered, checkpoint on the deleted entries: still 503, naming ' + (keep.seq + 1) + ' to ' + top,
        r.status === 503 && body.includes('Entries ' + (keep.seq + 1) + ' to ' + top + ' of the access log are missing.'), r.status + ' ' + body.replace(/[\s\S]*<p class="lead">/, '').slice(0, 160));
    }
    for (const ticks of [0, 1]) {
      /* V2-3: the newest 3, their households and the head record deleted. The documented resume used to carry on
         from the newest surviving entry and hand its numbers out again, which erased the gap. */
      const fx = await F.buildFixture({});
      await fx.tickUntilDone();
      for (const p of ['/', '/household/4', '/records', '/', '/household/4', '/records', '/', '/household/4']) await fx.request(p);
      for (let i = 0; i < ticks; i++) { fx.setNow(fx.now() + 15 * 60000); await fx.tick(); }
      const db = fx.admin.raw;
      const top = db.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
      const keep = db.prepare('SELECT seq, hash FROM access_log WHERE seq = ?').get(top - 3);
      db.exec('DELETE FROM access_log_hids WHERE seq > ' + keep.seq + '; DELETE FROM access_log WHERE seq > ' + keep.seq + "; DELETE FROM admin_meta WHERE key = 'log_head'");
      const says = 'The record of the newest access log entry is missing, and so are entries ' + (keep.seq + 1) + ' to ' + top + '.';
      const r = await fx.request('/records?tab=access');
      const body = await r.text();
      ok('head record and the newest 3 deleted (checkpoint ' + (ticks ? 'on them' : 'behind them') + '): 503, "' + says + '"', r.status === 503 && body.includes(says), r.status + ' ' + body.replace(/[\s\S]*<p class="lead">/, '').slice(0, 200));
      db.exec(RESUME_SQL[0]);
      const t = await tabLine(fx);
      const own = db.prepare('SELECT seq, prev_hash FROM access_log ORDER BY seq DESC LIMIT 1').get();
      ok('one documented resume, and the next entry is ' + (top + 1) + ', chained to the newest surviving entry', t.status === 200 && own.seq === top + 1 && own.prev_hash === keep.hash, [t.status, own]);
      const gapLine = 'except entries ' + (keep.seq + 1) + ' to ' + top + ', which are missing';
      ok('and the resume record names the range: the tab shows it in red, for good', /chain-bad/.test(t.body) && t.line.includes(gapLine), t.line);
      for (let i = 0; i < 3; i++) { await fx.request('/'); fx.setNow(fx.now() + 15 * 60000); await fx.tick(); }
      const t2 = await tabLine(fx);
      ok('and after the cron has swept the whole log', t2.status === 200 && t2.line.includes(gapLine) && /chain-bad/.test(t2.body), t2.line);
      ok('and no number was handed out twice', db.prepare('SELECT COUNT(*) AS n FROM access_log WHERE seq > ? AND seq <= ?').get(keep.seq, top).n === 0);
    }
    {
      /* A resume names its range. Entries deleted just below it afterwards are a new break, never folded into
         the gap the founder already looked into. */
      const fx = await F.buildFixture({});
      await fx.tickUntilDone();
      for (const p of ['/', '/household/4', '/records', '/', '/household/4', '/records', '/', '/household/4']) await fx.request(p);
      const db = fx.admin.raw;
      const top = db.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
      db.exec('DELETE FROM access_log_hids WHERE seq > ' + (top - 2) + '; DELETE FROM access_log WHERE seq > ' + (top - 2));
      db.exec(RESUME_SQL[0]);
      db.exec('DELETE FROM access_log_hids WHERE seq IN (' + (top - 3) + ', ' + (top - 2) + '); DELETE FROM access_log WHERE seq IN (' + (top - 3) + ', ' + (top - 2) + ')');
      const r = await fx.request('/');
      const body = await r.text();
      ok('two more deleted just below a resumed gap: 503, naming only those two ("Entries ' + (top - 3) + ' to ' + (top - 2) + '")',
        r.status === 503 && body.includes('Entries ' + (top - 3) + ' to ' + (top - 2) + ' of the access log are missing.'), r.status + ' ' + body.replace(/[\s\S]*<p class="lead">/, '').slice(0, 200));
      db.exec(RESUME_SQL[0]);
      await fx.request('/');
      const v = await L.verifyChain(fx.admin);
      ok('resumed again, the founder has now looked at the whole run, and the verifier names it', v.ok && v.gaps.length >= 1 && v.gaps[0].from === top - 3 && v.gaps[v.gaps.length - 1].to === top, v);
      /* The same deletion AFTER the next entry was written: the appends go on (the tail is fine), and the sweep
         and the verifier name the two as a break, not as part of the resumed gap. */
      const gx = await F.buildFixture({});
      await gx.tickUntilDone();
      for (const p of ['/', '/household/4', '/records', '/', '/household/4', '/records', '/', '/household/4']) await gx.request(p);
      const gdb = gx.admin.raw;
      const gtop = gdb.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
      gdb.exec('DELETE FROM access_log_hids WHERE seq > ' + (gtop - 2) + '; DELETE FROM access_log WHERE seq > ' + (gtop - 2));
      gdb.exec(RESUME_SQL[0]);
      await gx.request('/');
      gdb.exec('DELETE FROM access_log_hids WHERE seq IN (' + (gtop - 3) + ', ' + (gtop - 2) + '); DELETE FROM access_log WHERE seq IN (' + (gtop - 3) + ', ' + (gtop - 2) + ')');
      const gv = await L.verifyChain(gx.admin);
      ok('deleted below a resumed gap after the next entry: the verifier breaks at ' + (gtop - 3) + ', it does not widen the gap', !gv.ok && gv.brokenAt === gtop - 3 && gv.why === 'missing' && gv.gapTo === gtop - 2, gv);
    }
  }

  console.log('\n2c. on the Free plan (10 ms of CPU a request) the chain is walked by the cron in chunks; the tab walks only what is newer');
  {
    /* Count the hashing itself: every entry verified is one SHA-256. Before this fix the tab hashed the whole
       log on every view (1,000 entries here, 10,000 in the miniflare measurement), which is what passes 10 ms. */
    const subtle = globalThis.crypto.subtle;
    const realDigest = subtle.digest.bind(subtle);
    let digests = 0;
    subtle.digest = (...a) => { digests++; return realDigest(...a); };
    const counted = async (fn) => { const d0 = digests; await fn(); return digests - d0; };
    try {
      const fx = await F.buildFixture({});
      await fx.tickUntilDone();
      const base = { at: fx.now(), actor: 'Alex', actor_id: '0123456789abcdef', action: 'view_overview', detail: { range: '7' } };
      for (let i = 0; i < 1000; i++) await L.appendLog(fx.admin, base, []);
      const db = fx.admin.raw;
      const check = () => { const r = db.prepare("SELECT value FROM admin_meta WHERE key = 'log_check'").get(); return r ? JSON.parse(r.value) : {}; };
      const top = () => db.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;

      const cold = await counted(() => fx.request('/records?tab=access'));
      ok('before any cron check, a tab view hashes a bounded number of entries, not the whole log (' + cold + ' of ' + top() + ')', cold <= 110, cold);
      const coldPage = await (await fx.request('/records?tab=access')).text();
      ok('and says how far it verified, and that newer entries follow', /Chain verified to entry \d+\. Entries after it are checked in the background\./.test(coldPage), (coldPage.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1]);

      const perTick = [];
      for (let i = 0; i < 30 && !(check().swept && check().tip && check().tip.seq === top()); i++) {
        fx.setNow(fx.now() + 15 * 60000);
        perTick.push(await counted(() => fx.tick()));
      }
      const st = check();
      ok('each cron tick hashes a bounded chunk (at most ' + Math.max(...perTick) + ' a tick, over ' + perTick.length + ' ticks)', perTick.length > 1 && Math.max(...perTick) <= 260, perTick);
      ok('and the cron keeps a verified-to checkpoint (seq, hash) at the newest entry', st.tip && st.tip.seq === top() && /^[0-9a-f]{64}$/.test(st.tip.hash), st.tip);
      ok('and has swept the whole chain from entry 1 again, in chunks', st.swept && st.swept.to >= st.tip.seq - 0 && !st.broken, st);

      /* The cron's chain check runs in every 15-minute tick beside the directory refresh, inside the same 10 ms.
         In Miniflare each D1 statement costs workerd about as much as hashing dozens of entries, so a tick makes
         ONE walk: forward from the checkpoint when there are new entries, otherwise one chunk of the sweep. */
      const countingDb = (inner) => {
        let n = 0;
        const wrap = (q) => ({ _inner: q, bind: (...a) => wrap(q.bind(...a)), first: (...a) => { n++; return q.first(...a); }, all: () => { n++; return q.all(); }, run: () => { n++; return q.run(); } });
        return { db: { prepare: (sql) => wrap(inner.prepare(sql)), batch: (list) => { n += list.length; return inner.batch(list.map((x) => x._inner)); } }, take: () => { const k = n; n = 0; return k; } };
      };
      const cdb = countingDb(fx.admin);
      const quiet = [];
      for (let i = 0; i < 3; i++) { cdb.take(); await L.checkChain(cdb.db, fx.now()); quiet.push(cdb.take()); }
      ok('a quiet tick (nothing new since the checkpoint) makes one walk, a sweep chunk, in at most 6 D1 statements (' + quiet.join(', ') + ')', Math.max(...quiet) <= 6, quiet);
      /* A tick after new looks walks forward from the checkpoint FIRST, then spends the rest of the same row
         budget on the sweep (V2-2: with one walk a tick, a dashboard in use starved the sweep for good). */
      const sweptBefore = JSON.stringify(check().sweep);
      await L.appendLog(fx.admin, base, []);
      cdb.take(); const d0 = digests; await L.checkChain(cdb.db, fx.now()); const fwd = cdb.take(); const fwdHashes = digests - d0;
      ok('a tick after new entries walks forward from the checkpoint, then sweeps on with the rest of its budget, in at most 10 statements (' + fwd + ')',
        fwd <= 10 && check().tip.seq === top() && JSON.stringify(check().sweep) !== sweptBefore, [fwd, sweptBefore, check()]);
      ok('and both walks share one budget: at most ' + L.CHAIN_ROWS_PER_TICK + ' entries and the two checkpoints re-hashed (' + fwdHashes + ')',
        fwdHashes <= L.CHAIN_ROWS_PER_TICK + 2, fwdHashes);

      /* The newest entries deleted with the head record left alone, while the checkpoint sits on them: every
         quiet tick is a sweep up to the checkpoint, and a sweep that runs out of entries before it must name
         them missing, never report the chain clean. (Every page already answers 503 for this, via the head.) */
      {
        const gx = await F.buildFixture({});
        await gx.tickUntilDone();
        for (let i = 0; i < 300; i++) await L.appendLog(gx.admin, base, []);
        const gdb = gx.admin.raw;
        const gcheck = () => { const r = gdb.prepare("SELECT value FROM admin_meta WHERE key = 'log_check'").get(); return r ? JSON.parse(r.value) : {}; };
        const gtop = gdb.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
        for (let i = 0; i < 20 && !(gcheck().swept && gcheck().tip && gcheck().tip.seq === gtop); i++) await L.checkChain(gx.admin, gx.now() + i);
        gdb.exec('DELETE FROM access_log WHERE seq > ' + (gtop - 3));
        let saw = null, cleanPastGap = false;
        for (let i = 0; i < 20 && !saw; i++) {
          await L.checkChain(gx.admin, gx.now() + 100 + i);
          const c = gcheck();
          if (c.broken) saw = c.broken;
          if (c.swept && c.swept.at === gx.now() + 100 + i && !c.broken) cleanPastGap = true;
        }
        ok('the newest 3 deleted under the checkpoint (head record untouched): the sweep names entries ' + (gtop - 2) + ' to ' + gtop + ' missing, never clean',
          saw && saw.brokenAt === gtop - 2 && saw.gapTo === gtop && saw.why === 'missing' && !cleanPastGap, [saw, cleanPastGap]);
      }

      /* V2-2: the dashboard in use, one look between every tick. A deletion or an edit under the checkpoint must
         still be named within one full sweep and one chunk of the next: ceil(N / (budget - looks)) + 1 ticks. */
      for (const [N, label, tamper, why, looks] of [
        [400, 'entry 3 deleted', 'DELETE FROM access_log WHERE seq = 3', 'missing', 1],
        [40, 'entry 3 edited', "UPDATE access_log SET detail = '{\"range\":\"90\"}' WHERE seq = 3", 'edited', 1],
        /* Heavy use: more new entries a tick than half the budget. A sweep that chased the moving tip would
           never finish; it runs to where the tip stood when it began. */
        [400, 'entry 3 deleted, 100 looks a tick', 'DELETE FROM access_log WHERE seq = 3', 'missing', 100],
      ]) {
        const bx = await F.buildFixture({});
        await bx.tickUntilDone();
        const bdb = bx.admin.raw;
        const btop = () => bdb.prepare('SELECT MAX(seq) AS n FROM access_log').get().n;
        const bcheck = () => { const r = bdb.prepare("SELECT value FROM admin_meta WHERE key = 'log_check'").get(); return r ? JSON.parse(r.value) : {}; };
        while (btop() < N) await L.appendLog(bx.admin, Object.assign({}, base, { at: bx.now() }), []);
        for (let i = 0; i < 20 && !(bcheck().swept && bcheck().tip && bcheck().tip.seq === btop()); i++) { bx.setNow(bx.now() + 15 * 60000); await bx.tick(); }
        bx.setNow(bx.now() + 15 * 60000); await bx.tick();       // a new sweep starts, and passes entry 3
        bdb.exec(tamper);
        const bound = Math.ceil(N / (L.CHAIN_ROWS_PER_TICK - looks - 1)) + 1;
        let named = 0, sweptAt = [];
        for (let i = 1; i <= 40 && !named; i++) {
          if (looks === 1) await bx.request('/');                 // the founder is using the dashboard
          else for (let k = 0; k < looks; k++) await L.appendLog(bx.admin, Object.assign({}, base, { at: bx.now() }), []);
          bx.setNow(bx.now() + 15 * 60000); await bx.tick();
          const c = bcheck();
          if (c.swept) sweptAt.push(c.swept.at);
          if (c.broken && c.broken.brokenAt === 3 && c.broken.why === why) named = i;
        }
        ok('dashboard in use (' + looks + (looks === 1 ? ' look' : ' looks') + ' before every tick), ' + N + ' entries, ' + label + ' under the checkpoint: named within ' + bound + ' ticks (' + (named || 'not in 40') + ')',
          named > 0 && named <= bound, [named, bound, bcheck()]);
        const line = await (await bx.request('/records?tab=access')).text();
        ok('and the Access log tab says so, in red, by number', /chain-bad/.test(line) && line.includes('The chain breaks at entry 3: '), (line.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1]);
      }
      {
        /* The tab line says when the whole log was last checked from entry 1, and that time keeps moving while
           the dashboard is in use. */
        const sx = await F.buildFixture({});
        await sx.tickUntilDone();
        const sdb = sx.admin.raw;
        const scheck = () => { const r = sdb.prepare("SELECT value FROM admin_meta WHERE key = 'log_check'").get(); return r ? JSON.parse(r.value) : {}; };
        const before = await (await sx.request('/records?tab=access')).text();
        const lineOf = (b) => (b.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1] || '';
        ok('before any full check, the tab line says none has finished yet', /No full check from entry 1 has finished yet\./.test(lineOf(before)), lineOf(before));
        for (let i = 0; i < 3; i++) { await sx.request('/'); sx.setNow(sx.now() + 15 * 60000); await sx.tick(); }
        const c = scheck();
        const iso = c.swept ? new Date(c.swept.at).toISOString() : '';
        const want = c.swept ? 'A full check from entry 1 last finished on ' + new Date(c.swept.at).getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(c.swept.at).getUTCMonth()]
          + ' at ' + iso.slice(11, 16) + ' UTC, at entry ' + c.swept.to + '.' : '(no sweep)';
        const after = lineOf(await (await sx.request('/records?tab=access')).text());
        ok('with the dashboard in use, each tick still finishes a full check, and the tab line says when ("' + want + '")',
          !!c.swept && c.swept.at === sx.now() && after.includes(want), [after, c]);
      }

      const warm = await counted(() => fx.request('/records?tab=access'));
      const warmPage = await (await fx.request('/records?tab=access')).text();
      ok('with the checkpoint current, a tab view hashes only what is newer (' + warm + ' hashes for ' + top() + ' entries)', warm <= 10, warm);
      ok('and still says "Chain verified to entry N" for its own newest entry', (warmPage.match(/Chain verified to entry (\d+)\./) || [])[1] === String(top()), (warmPage.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1]);

      /* The checkpoint's own entry edited: the tab re-hashes it, so this shows at once. */
      const tipSeq = check().tip.seq;
      const was = db.prepare('SELECT detail FROM access_log WHERE seq = ?').get(tipSeq).detail;
      db.prepare('UPDATE access_log SET detail = ? WHERE seq = ?').run('{"range":"90"}', tipSeq);
      const atTip = await (await fx.request('/records?tab=access')).text();
      ok('an edit to the checkpoint entry itself shows on the very next tab view', atTip.includes('The chain breaks at entry ' + tipSeq + ': that entry was changed after it was written.'), (atTip.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1]);
      db.prepare('UPDATE access_log SET detail = ? WHERE seq = ?').run(was, tipSeq);

      /* An edit to an OLD entry, behind the checkpoint: the tab cannot see it on its own, the cron's sweep does,
         and the tab then shows what the sweep found. */
      db.prepare('UPDATE access_log SET detail = ? WHERE seq = ?').run('{"range":"30"}', 5);
      let foundIn = 0;
      for (let i = 1; i <= 30; i++) {
        fx.setNow(fx.now() + 15 * 60000);
        await fx.tick();
        if (check().broken) { foundIn = i; break; }
      }
      ok('an edit to an old entry is found by the cron sweep (' + foundIn + ' ticks)', foundIn > 0 && check().broken.brokenAt === 5 && check().broken.why === 'edited', check().broken);
      const shown = await (await fx.request('/records?tab=access')).text();
      ok('and the tab shows it, in red, by number', /chain-bad/.test(shown) && shown.includes('The chain breaks at entry 5: that entry was changed after it was written.'), (shown.match(/class="chain[^"]*"[^>]*>([^<]*)/) || [])[1]);
    } finally { subtle.digest = realDigest; }
  }

  console.log('\n3. lists and exports record every household they showed (access_log_hids)');
  {
    const S = await imp('workers/admin/dev/sample.mjs');
    /* The founder's own two weeks, plus one visit he made as a caregiver in Maya's household (testing her
       invite), so a usage list can show two households. */
    const fx = await F.buildFixture({ usage: async (d1) => {
      await S.seedUsage(d1);
      await S.ingestVisit(d1, { uid: S.FOUNDER_UID, hid: 'HHID_sample_maya', role: 'caregiver', tz: 'Asia/Dubai', device: 'd_samiphone001', platform: 'ios_app', app_version: 'v369', ua: S.USAGE_UA.ios },
        S.NOW - 2 * 3600000, [[0, 'visit.started', { opened_from: 'link', start: 'cold' }], [6, 'feature.used', { feature: 'feed', action: 'logged' }], [30, 'visit.ended', { seconds: 30, reason: 'hidden' }]]);
    } });
    await fx.tickUntilDone();
    const hidsOf = (seq) => fx.admin.raw.prepare('SELECT hid FROM access_log_hids WHERE seq = ? ORDER BY hid').all(seq).map((r) => r.hid);
    const last = () => fx.admin.raw.prepare('SELECT * FROM access_log ORDER BY seq DESC LIMIT 1').get();
    const visible = fx.admin.raw.prepare('SELECT hid FROM dir_households WHERE is_internal = 0 ORDER BY hid').all().map((r) => r.hid);
    await fx.request('/records?tab=households');
    let row = last();
    ok('the Households tab records every household on its page', row.action === 'view_records' && JSON.stringify(hidsOf(row.seq)) === JSON.stringify(visible), [hidsOf(row.seq), visible]);
    await fx.request('/records?tab=people');
    row = last();
    const peopleHids = [...new Set(fx.admin.raw.prepare('SELECT p.hid FROM dir_people p JOIN dir_households h ON h.hid = p.hid WHERE p.is_internal = 0 AND h.is_internal = 0').all().map((r) => r.hid))].sort();
    ok('the People tab records the households of the people it showed', JSON.stringify(hidsOf(row.seq)) === JSON.stringify(peopleHids), [hidsOf(row.seq), peopleHids]);
    const csv = await (await fx.request('/records.csv?tab=households&own=show')).text();
    row = last();
    const all = fx.admin.raw.prepare('SELECT hid FROM dir_households ORDER BY hid').all().map((r) => r.hid);
    ok('a CSV export records every household in the file', row.action === 'export_csv' && JSON.stringify(hidsOf(row.seq)) === JSON.stringify(all), [hidsOf(row.seq), all]);
    ok('and how many rows it held', JSON.parse(row.detail).rows === all.length && csv.trim().split('\r\n').length === all.length + 1, row.detail);
    await fx.request('/records?tab=households&q=maya');
    row = last();
    ok('a search records THAT it searched, never what', JSON.parse(row.detail).searched === true && !/maya/i.test(row.detail), row.detail);
    await fx.request('/records?tab=households&stage=pregnant');
    ok('a filtered list records only what it showed', JSON.stringify(hidsOf(last().seq)) === JSON.stringify(['HHID_sample_leena']), hidsOf(last().seq));
    /* Phase 2: the usage tabs, exactly as the existing tabs. */
    const both = ['HHID_sample_founder', 'HHID_sample_maya'];
    await fx.request('/records?tab=visits&own=show');
    row = last();
    ok('the Visits tab: view_records with its tab, and both households its page showed', row.action === 'view_records' && JSON.parse(row.detail).tab === 'visits' && JSON.stringify(hidsOf(row.seq)) === JSON.stringify(both), [row.detail, hidsOf(row.seq)]);
    for (const tab of ['visits', 'events', 'signins', 'devices']) {
      const body = await (await fx.request('/records.csv?tab=' + tab + '&own=show')).text();
      row = last();
      const lines = body.trim().split('\r\n').length - 1;
      const want = tab === 'visits' || tab === 'events' ? both : ['HHID_sample_founder'];
      ok('the ' + tab + ' CSV: export_csv with its tab, its ' + lines + ' rows, and every household in the file', row.action === 'export_csv' && JSON.parse(row.detail).tab === tab
        && JSON.parse(row.detail).rows === lines && lines > 0 && JSON.stringify(hidsOf(row.seq)) === JSON.stringify(want), [row.detail, hidsOf(row.seq)]);
    }
    await fx.request('/records?tab=events&own=show&page=4');
    row = last();
    ok('a later page records the households on THAT page only (page 4 of events: the founder\'s)', JSON.parse(row.detail).page_no === 4 && JSON.stringify(hidsOf(row.seq)) === JSON.stringify(['HHID_sample_founder']), [row.detail, hidsOf(row.seq)]);
    await fx.request('/records?tab=signins');
    row = last();
    ok('our own accounts hidden: the tab shows nothing, and records no household', row.action === 'view_records' && JSON.parse(row.detail).own === 'hidden' && hidsOf(row.seq).length === 0, [row.detail, hidsOf(row.seq)]);
  }

  console.log('\n4. detail holds fixed keys and fixed values only; the actor is a first name and a hash (S18)');
  {
    const fx = await F.buildFixture({});
    await fx.tickUntilDone();
    const base = { at: fx.now(), actor: 'Alex', actor_id: '0123456789abcdef', action: 'manual_access' };
    const refused = async (detail) => { try { await L.appendLog(fx.admin, Object.assign({}, base, { detail }), []); return false; } catch (e) { return true; } };
    ok('a request number of "owner\'s email" is refused', await refused({ reason: 'family_asked', request: "owner's email" }));
    ok('a request number with an address in it is refused', await refused({ reason: 'family_asked', request: 'R-0001 maya@example.com' }));
    ok('a search term is refused', await refused({ q: 'maya' }));
    ok('a free-text reason is refused', await refused({ reason: 'she asked me on WhatsApp' }));
    ok('a key outside the list is refused', await refused({ note: 'x' }));
    ok('a nested object is refused', await refused({ tab: { $ne: 1 } }));
    ok('a well-formed one is accepted', !(await refused({ reason: 'legal_request', request: 'R-0042' })));
    const post = (b) => fx.request('/api/manual-access', { method: 'POST', headers: { origin: 'https://admin.little-cubby.com', 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const n0 = fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log').get().n;
    ok('the manual-access route refuses a free-text request number (400)', (await post({ household: 4, reason: 'family_asked', request: "owner's email" })).status === 400);
    ok('and a reason outside the list', (await post({ household: 4, reason: 'curious' })).status === 400);
    ok('and a person who is not in that household', (await post({ household: 4, reason: 'family_asked', person: 'UID_sample_dana' })).status === 400);
    ok('and none of those wrote a row', fx.admin.raw.prepare('SELECT COUNT(*) AS n FROM access_log').get().n === n0);
    const r = await post({ household: 4, reason: 'data_recovery', person: 'UID_sample_rosa', request: 'R-0007' });
    const j = await r.json();
    const row = fx.admin.raw.prepare('SELECT * FROM access_log WHERE seq = ?').get(j.seq);
    ok('a manual access about one person sets target_uid (it reaches only her download)', r.status === 200 && row.action === 'manual_access' && row.target_uid === 'UID_sample_rosa' && row.target_hid === 'HHID_sample_maya', row);
    ok('with the reason code and the request number, nothing else', row.detail === '{"reason":"data_recovery","request":"R-0007"}', row.detail);
    const rows = fx.admin.raw.prepare("SELECT actor, actor_id FROM access_log WHERE action != 'denied'").all();
    ok('every row names a first name and a 16-hex id', rows.length > 0 && rows.every((x) => x.actor === 'Alex' && /^[0-9a-f]{16}$/.test(x.actor_id)), rows.slice(0, 2));
    ok('and no row anywhere in the log holds an address', !/@/.test(JSON.stringify(fx.admin.raw.prepare('SELECT * FROM access_log').all())));
  }

  console.log('\n5. append-only, and read-only by code where the spec says so (static scan of workers/)');
  {
    const files = walk(path.join(ROOT, 'workers'), []);
    const hits = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => { if (/\b(UPDATE|DELETE\s+FROM|REPLACE\s+INTO|INSERT\s+OR\s+REPLACE\s+INTO|DROP\s+TABLE|ALTER\s+TABLE)\s+access_log(_hids)?\b/i.test(l)) hits.push(path.relative(ROOT, f) + ':' + (i + 1)); });
    }
    ok('no UPDATE, DELETE, REPLACE, DROP or ALTER of access_log or access_log_hids anywhere under workers/', hits.length === 0, hits);
    const admin = walk(path.join(ROOT, 'workers', 'admin'), []).filter((f) => !f.includes(path.sep + 'dev' + path.sep));
    const writes = [];
    const code = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of admin) {
      const src = code(f);
      const re = /(games|newsletter|GAMES_DB|NEWSLETTER_DB|USAGE_DB)\b[^;]{0,40}\.prepare\(\s*(['"`])([^'"`]*)\2/g;
      let m;
      while ((m = re.exec(src))) if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(m[3])) writes.push(path.relative(ROOT, f) + ': ' + m[3].slice(0, 60));
    }
    ok('nothing under workers/admin/ writes cubby-games, cubby-newsletter or cubby-usage', writes.length === 0, writes);
    /* Phase 2: the admin READS cubby-usage. USAGE_DB is named in one place, config.mjs, which hands the rest of
       the Worker only a read-only handle (usage.mjs readOnly); usage.mjs, where every usage read lives, holds
       no SQL that writes; and the handle itself refuses a write at run time. */
    const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
    const names = admin.filter((f) => /USAGE_DB/.test(code(f))).map(rel);
    const cfgSrc = code(path.join(ROOT, 'workers', 'admin', 'src', 'config.mjs'));
    ok('USAGE_DB is named only in config.mjs, and bound there through the read-only handle', JSON.stringify(names) === '["workers/admin/src/config.mjs"]'
      && /usage: env\.USAGE_DB && typeof env\.USAGE_DB\.prepare === 'function' \? readOnly\(env\.USAGE_DB\) : null/.test(cfgSrc) && (cfgSrc.match(/USAGE_DB/g) || []).length === 3, names);
    const SQL_WRITE = /\b(INSERT|UPDATE|DELETE|REPLACE\s+INTO|UPSERT|CREATE|DROP|ALTER)\b/i;
    const literals = (src) => src.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
    const usageWrites = literals(code(path.join(ROOT, 'workers', 'admin', 'src', 'usage.mjs'))).filter((x) => SQL_WRITE.test(x));
    ok('usage.mjs holds no SQL string that writes', usageWrites.length === 0, usageWrites);
    ok('(companion) the same matcher finds a staged one', literals("x.prepare('DELETE FROM usage_events WHERE uid = ?'); y = \"SELECT 1\";").filter((x) => SQL_WRITE.test(x)).length === 1);
    const Um = await imp('workers/admin/src/usage.mjs');
    const D1 = await imp('workers/admin/dev/d1-sqlite.mjs');
    const udb = D1.applySqlFile(D1.makeD1(), path.join(ROOT, 'schema', 'usage.sql'));
    const ro = Um.readOnly(udb);
    const STAGED = ['DELETE FROM usage_events', "INSERT INTO devices (device, uid, platform, os, browser, app_version, first_seen, last_seen) VALUES ('d', 'u', 'browser', 'o', 'b', 'v1', 1, 1)",
      "UPDATE devices SET uid = 'x'", 'REPLACE INTO usage_meta (key) VALUES (1)', 'CREATE TABLE x (a)', 'DROP TABLE devices', 'PRAGMA writable_schema = 1',
      'WITH x AS (SELECT 1) DELETE FROM usage_events', 'SELECT 1; DELETE FROM usage_events', ' select 1 ; update devices set uid = 1'];
    const let_through = [];
    for (const q of STAGED) { try { ro.prepare(q); let_through.push(q); } catch (e) { if (!/usage_read_only/.test(e.message)) let_through.push(q + ' (' + e.message + ')'); } }
    ok('the read-only handle refuses every write (' + STAGED.length + ' staged) and has no batch or exec', let_through.length === 0 && ro.batch === undefined && ro.exec === undefined && Object.isFrozen(ro), let_through);
    ok('(companion) and answers a SELECT', (await ro.prepare('SELECT COUNT(*) AS n FROM usage_events').bind().first()).n === 0);
    const C = await imp('workers/admin/src/config.mjs');
    const fxc = await F.buildFixture({ usage: 'sample' });
    const cfg = C.readConfig(fxc.env).cfg;
    let refused = false; try { cfg.usage.prepare('DELETE FROM usage_events'); } catch (e) { refused = /usage_read_only/.test(e.message); }
    ok('what readConfig hands the Worker for USAGE_DB is that handle', refused && cfg.usage !== fxc.env.USAGE_DB && typeof cfg.usage.batch === 'undefined');
    const before = fxc.usage.dump(), writesBefore = fxc.usage.log.length;
    await fxc.tickUntilDone();
    for (const p of ROUTES) await fxc.request(p);
    ok('and every route above, run against cubby-usage, leaves it byte for byte as it was, with no write statement run', fxc.usage.dump() === before && fxc.usage.log.length === writesBefore, fxc.usage.log.slice(writesBefore, writesBefore + 3));
    const reads = admin.map(code).join('\n');
    ok('the newsletter is read by email_hash only, never email or unsub_token', /SELECT stage, status FROM subscribers WHERE email_hash = \?/.test(reads) && !/unsub_token|SELECT[^'"`]*\bemail\b[^'"`]*FROM subscribers/.test(reads));
  }

  console.log('\n6. the chain head leaves the database every Monday (S19)');
  {
    const W = await imp('worker.js').catch(() => null);
    const digest = W && W.__funnel && W.__funnel.maybeSendFunnelDigest;
    ok('worker.js exposes the Monday digest to tests', typeof digest === 'function');
    if (typeof digest === 'function') {
      const fx = await F.buildFixture({});
      await fx.tickUntilDone();
      for (const p of ROUTES) await fx.request(p);
      const head = fx.admin.raw.prepare('SELECT seq, hash FROM access_log ORDER BY seq DESC LIMIT 1').get();
      const mon = Date.UTC(2026, 10, 16, 6, 0, 0);
      fx.games.raw.prepare('INSERT OR REPLACE INTO funnel_snapshots (day, ok, reason, reads, attempts, body, at) VALUES (?, 1, NULL, 1, 1, ?, ?)')
        .run('2026-11-16', JSON.stringify({ funnel: { trying: {}, pregnancy: {}, baby: {}, none: {} }, activity: { care_entries: { total: 0, by_author_role: {} } },
          transitions: { pregnancy_to_baby: 0, trying_to_pregnancy: 0 }, households: { internal_excluded: 0 }, reads: 1, retention_note: '' }), mon);
      const mail = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (u, init) => { if (String(u).includes('api.resend.com')) { mail.push(JSON.parse(init.body)); return new Response('{"id":"m"}'); } throw new Error('unexpected ' + u); };
      try { await digest({ GAMES_DB: fx.games, ADMIN_DB: fx.admin, ALERT_EMAIL: 'alerts@example.com', RESEND_API_KEY: 're_test' }, mon); }
      finally { globalThis.fetch = realFetch; }
      const html = mail[0] ? mail[0].html : '';
      ok('the digest carries the chain head hash', html.includes(head.hash), html.slice(-600));
      ok('and the entry it stands at', html.includes('entry ' + head.seq));
      ok('and the week\'s counts of views and exports', /views?:? \d+/i.test(html) && /export/i.test(html));
      const src = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
      const uses = src.split('\n').filter((l) => /ADMIN_DB/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
      ok('the main Worker touches ADMIN_DB in one named function, with SELECTs only', uses.length >= 1 && uses.every((l) => !/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE)\b/i.test(l)) && /async function adminChainSummary\(/.test(src), uses);
    }
  }

  if (process.argv.includes('--self-test') && !process.env.ADMIN_MUTANT) {
    /* The self-test of the self-test (F6). selfTest() itself runs here, on a copy whose worker.js cannot load
       (it gains a module the copy does not hold), which is exactly the failure this suite swallows: section 6
       catches a worker.js that will not load. With one harmless mutant. What selfTest() reports through ok()
       is collected, not counted: its control must fail, for that swallowed reason, and the mutant must be
       reported "not counted". Without the control, or without the rule that holds mutants back when it
       fails, the harmless mutant turns this copy red and counts as caught, and so would every mutant below. */
    console.log('\nself-test of the self-test: selfTest() on a copy that cannot load worker.js, with one harmless mutant');
    const breakWorker = (tmp) => fs.appendFileSync(path.join(tmp, 'worker.js'), "\nimport './workers/zz-not-in-the-copy/core.mjs';\n");
    const HARMLESS = { name: 'a new file nothing imports', file: 'workers/admin/src/zz-harmless.mjs', find: null, replace: '// Nothing imports this file.\n' };
    const said = [];
    const log0 = console.log;
    console.log = () => {};
    try { selfTest(__filename, [HARMLESS], (name, passed, detail) => said.push({ name, passed: !!passed, detail: String(detail === undefined ? '' : detail) }), { prepare: breakWorker }); }
    finally { console.log = log0; }
    const control = said.find((x) => /^control: /.test(x.name));
    ok('selfTest() reports its control as failed on that copy (' + (control ? control.detail.slice(0, 80) : 'no control line at all') + '), for the failure this suite swallows, which WRONG_REASON alone does not see',
      !!control && !control.passed && /worker\.js exposes the Monday digest/.test(control.detail) && !/^the copy cannot run the suite/.test(control.detail), said);
    const held = said.filter((x) => x.name.includes('"' + HARMLESS.name + '"'));
    ok('and reports the harmless mutant "not counted: the control run failed", never as caught', held.length === 1 && !held[0].passed && /^mutant "[^"]*" not counted: the control run failed$/.test(held[0].name), said);
    const clean = runMutant(__filename, HARMLESS);
    ok('(companion) on a copy that loads worker.js the same harmless mutant leaves this suite green (exit ' + clean.code + '), so counting it as caught would be a false catch',
      clean.applied && clean.code === 0, clean.out.split('\n').slice(-4).join(' | '));
    selfTest(__filename, [
      { name: 'a failed log write is swallowed and data is served', file: 'workers/admin/src/index.mjs',
        find: "    try { row = await logRow(cfg, req, t, 'view_household', { target_hid: h.hid, detail: { page: 'household' } }, []); }\n    catch (e) { console.error('admin_log_fail', code(e)); return logFailed(e); }",
        replace: "    try { row = await logRow(cfg, req, t, 'view_household', { target_hid: h.hid, detail: { page: 'household' } }, []); }\n    catch (e) { row = { at: t }; }" },
      { name: 'the hash leaves out the household list', file: 'workers/admin/src/log.mjs', find: "'\\n' + [...new Set(hids)].sort().join(',')", replace: "''" },
      { name: 'the hash leaves out the detail', file: 'workers/admin/src/log.mjs', find: 'target_uid: row.target_uid || null, detail: row.detail,', replace: 'target_uid: row.target_uid || null,' },
      { name: 'a list view does not record its households', file: 'workers/admin/src/index.mjs', find: "try { await logRow(cfg, req, t, 'view_records', { detail }, hids); }", replace: "try { await logRow(cfg, req, t, 'view_records', { detail }, []); }" },
      { name: 'detail accepts any key', file: 'workers/admin/src/log.mjs', find: "if (!Object.prototype.hasOwnProperty.call(DETAIL, k)) throw new Error('log_detail_key');", replace: 'if (!Object.prototype.hasOwnProperty.call(DETAIL, k)) continue;' },
      { name: 'the request number takes free text', file: 'workers/admin/src/log.mjs', find: "request: (v) => typeof v === 'string' && /^R-\\d{4}$/.test(v),", replace: "request: (v) => typeof v === 'string'," },
      { name: 'an UPDATE of the log appears in code', file: 'workers/admin/src/retention.mjs', find: null, replace: "export const x = (db) => db.prepare('UPDATE access_log SET actor = ? WHERE seq = ?');\n" },
      { name: 'the verifier does not see the newest row deleted', file: 'workers/admin/src/log.mjs', find: "return result({ ok: false, done: false, brokenAt: prevSeq + 1, gapTo: span ? span.uncoveredTo : h.seq, why: 'missing' });", replace: 'return result({ ok: true, done: true });' },
      /* N1: the newest entries deleted must stop the log, named, and never be chained over. */
      { name: 'a new row chains onto the newest row, not the head (the old re-chain)', file: 'workers/admin/src/log.mjs',
        find: "    if (!b) anchor = s.head || GENESIS_ANCHOR;\n    else if (resumedPast(s, b)) anchor = b.anchor;\n    else throw new LogBroken(b);",
        replace: '    anchor = s.last || GENESIS_ANCHOR;' },
      { name: 'a broken tail is chained to the head but not refused', file: 'workers/admin/src/log.mjs', find: '    else throw new LogBroken(b);', replace: '    else anchor = b.anchor || GENESIS_ANCHOR;' },
      { name: 'a resumed log reuses the deleted numbers', file: 'workers/admin/src/log.mjs', find: 'seq: highWater(s) + 1,', replace: 'seq: (s.last ? s.last.seq : 0) + 1,' },
      { name: 'any resume record covers any later break', file: 'workers/admin/src/log.mjs',
        find: '  const r = b.anchor && s.resumes.get(b.hi);\n  return !!r && r.hash === b.anchor.hash && !unresumed(s.resumes, s.last ? s.last.seq : 0, b.hi);', replace: '  return s.resumes.size > 0;' },
      { name: 'the verifier steps over a resumed gap without naming it', file: 'workers/admin/src/log.mjs',
        find: 'if (span && span.gaps) { gaps.push(...span.gaps); prevSeq = seq - 1;', replace: 'if (span && span.gaps) { prevSeq = seq - 1;' },
      /* V2-4: the newest entry re-hashed on every append. */
      { name: 'the newest entry is trusted without re-hashing it', file: 'workers/admin/src/log.mjs',
        find: 'if (L && L.seq === H.seq && (L.hash !== H.hash || !L.intact))', replace: 'if (L && L.seq === H.seq && L.hash !== H.hash)' },
      { name: 'the newest entry is re-hashed without its household list', file: 'workers/admin/src/log.mjs',
        find: 'rowHashInput(t.prev_hash, t, hids)', replace: 'rowHashInput(t.prev_hash, t, [])' },
      /* V2-6: a jittered, growing wait between log-write retries, and the tail read in one statement. */
      { name: 'no wait between log-write retries', file: 'workers/admin/src/log.mjs', find: 'await retryWait(attempt); continue;', replace: 'continue;' },
      { name: 'every loser waits the same moment (no jitter)', file: 'workers/admin/src/log.mjs', find: 'Math.random() * RETRY_BASE_MS', replace: 'RETRY_BASE_MS' },
      { name: 'the wait never grows', file: 'workers/admin/src/log.mjs', find: 'RETRY_BASE_MS * 2 ** attempt', replace: 'RETRY_BASE_MS' },
      { name: 'it waits after the last try too', file: 'workers/admin/src/log.mjs', find: '{ if (attempt < 4) await retryWait(attempt); continue; }', replace: '{ await retryWait(attempt); continue; }' },
      { name: 'the head record is read in a second statement, after the newest entry', file: 'workers/admin/src/log.mjs',
        find: "  let meta = [];\n  try { meta = JSON.parse((t && t.meta) || '[]').map((kv) => ({ key: String(kv[0]), value: kv[1] })); } catch (e) { meta = []; }",
        replace: "  const meta = ((await db.prepare(\"SELECT key, value FROM admin_meta WHERE key = 'log_head' OR key = 'log_check' OR key LIKE 'log_resume:%'\").all()).results) || [];" },
      /* V2-1, V2-3: the high-water mark, and a resume record that names its range. */
      { name: 'the high-water mark ignores sqlite_sequence (a rewound head hides the newest looks)', file: 'workers/admin/src/log.mjs',
        find: 's.tip ? s.tip.seq : 0, s.hw || 0);', replace: 's.tip ? s.tip.seq : 0);' },
      { name: 'the high-water mark ignores the cron checkpoint', file: 'workers/admin/src/log.mjs',
        find: 's.tip ? s.tip.seq : 0, s.hw || 0);', replace: 's.hw || 0);' },
      { name: 'the no-head break names only the newest entry (the old recovery that reused numbers)', file: 'workers/admin/src/log.mjs',
        find: "if (L || s.hasHead) return { why: 'no_head', from: span.from, to: span.to, anchor: L, hi };", replace: "if (L || s.hasHead) return { why: 'no_head', from: 0, to: 0, anchor: L, hi: L ? L.seq : 0 };" },
      { name: 'the resume command keys at the head record, not the high-water mark', file: 'workers/admin/migrations/0001_init.sql',
        find: "SELECT 'log_resume:' || top.n AS key,", replace: "SELECT 'log_resume:' || COALESCE((SELECT seq FROM h), (SELECT seq FROM l)) AS key," },
      { name: 'a resume record covers numbers it does not name', file: 'workers/admin/src/log.mjs',
        find: 'return !!r && r.hash === b.anchor.hash && !unresumed(s.resumes, s.last ? s.last.seq : 0, b.hi);', replace: 'return !!r && r.hash === b.anchor.hash;' },
      { name: 'the verifier folds entries deleted below a resumed gap into it', file: 'workers/admin/src/log.mjs',
        find: 'if (!r || r.from > cur) return { uncoveredTo: cur };', replace: 'if (!r || r.from > cur) return { gaps };' },
      { name: 'a broken log serves the page anyway', file: 'workers/admin/src/index.mjs', find: "    try { await logRow(cfg, req, t, 'view_overview', { detail: { range, own: hideInternal ? 'hidden' : 'shown' } }, []); }\n    catch (e) { console.error('admin_log_fail', code(e)); return logFailed(e); }",
        replace: "    try { await logRow(cfg, req, t, 'view_overview', { detail: { range, own: hideInternal ? 'hidden' : 'shown' } }, []); }\n    catch (e) { if (!(e && e.code === 'log_broken')) return logFailed(e); }" },
      /* N5: the chain is walked by the cron in chunks; the tab only from the checkpoint. */
      { name: 'the tab walks the whole log again', file: 'workers/admin/src/log.mjs', find: '{ from: st.tip || GENESIS_ANCHOR, limit: TAB_VERIFY_ROWS, resumes }', replace: '{ resumes }' },
      { name: 'the cron never stores a checkpoint', file: 'workers/admin/src/log.mjs', find: 'if (r1.ok) st.tip = { seq: r1.verifiedTo, hash: r1.verifiedHash };', replace: 'if (r1.ok) st.tip = st.tip;' },
      { name: 'the cron walks the whole chain in one tick', file: 'workers/admin/src/log.mjs', find: 'const chunk = rowsPerTick || CHAIN_ROWS_PER_TICK;', replace: 'const chunk = 1e9;' },
      { name: 'the checkpoint entry is trusted without re-hashing it', file: 'workers/admin/src/log.mjs',
        find: 'if (a.hash !== from.hash || await sha256hex(rowHashInput(a.prev_hash, a, ah.get(from.seq) || [])) !== from.hash) {', replace: 'if (a.hash !== from.hash) {' },
      { name: 'the cron never sweeps from entry 1 again', file: 'workers/admin/src/log.mjs', find: 'if (left > 0 && st.tip && st.tip.seq > 0) {', replace: 'if (false) {' },
      /* V2-2: one shared row budget a tick, forward first, the rest on the sweep. */
      { name: 'a tick with new looks skips the sweep (the dashboard in use starves it)', file: 'workers/admin/src/log.mjs',
        find: 'if (left > 0 && st.tip && st.tip.seq > 0) {', replace: 'if (!behind && left > 0 && st.tip && st.tip.seq > 0) {' },
      { name: 'the forward walk and the sweep each get a whole budget', file: 'workers/admin/src/log.mjs', find: 'limit: left, to: st.sweepTo', replace: 'limit: chunk, to: st.sweepTo' },
      { name: 'a sweep chases the moving tip instead of running to where it began', file: 'workers/admin/src/log.mjs', find: 'limit: left, to: st.sweepTo, resumes', replace: 'limit: left, to: st.tip.seq, resumes' },
      { name: 'the tab line never says when the whole log was last checked', file: 'workers/admin/src/views.mjs',
        find: 'return { bad: gaps.length > 0, line: line + sweptWords(ch.swept) };', replace: 'return { bad: gaps.length > 0, line };' },
      { name: 'a sweep that runs out of entries before the checkpoint reports clean', file: 'workers/admin/src/log.mjs', find: '      if (prevSeq < to) {', replace: '      if (false) {' },
      { name: 'a quiet tick walks forward instead of sweeping', file: 'workers/admin/src/log.mjs', find: 'const behind = !st.tip || !head || head.seq !== st.tip.seq || head.hash !== st.tip.hash;', replace: 'const behind = true;' },
      { name: 'the tab ignores what the sweep found', file: 'workers/admin/src/log.mjs', find: 'if (r.ok && st.broken) return', replace: 'if (false && st.broken) return' },
      { name: 'the Monday digest drops the chain head', file: 'worker.js', find: 'const html = funnelDigestHtml(rows) + await adminChainSummary(env, now.getTime());', replace: 'const html = funnelDigestHtml(rows);' },
      { name: 'the main Worker writes ADMIN_DB', file: 'worker.js', find: "    const head = await env.ADMIN_DB.prepare('SELECT seq, hash FROM access_log ORDER BY seq DESC LIMIT 1').first();",
        replace: "    await env.ADMIN_DB.prepare('DELETE FROM admin_meta WHERE key = ?').bind('x').run();\n    const head = await env.ADMIN_DB.prepare('SELECT seq, hash FROM access_log ORDER BY seq DESC LIMIT 1').first();" },
      { name: 'a usage CSV records no household', file: 'workers/admin/src/index.mjs', find: "return { cells: usageCells(tab, r, who), link: h ? '/household/' + h.display_no : null, hid: h ? h.hid : null };",
        replace: "return { cells: usageCells(tab, r, who), link: h ? '/household/' + h.display_no : null, hid: null };" },
      { name: 'a usage tab is served when its log row fails', file: 'workers/admin/src/index.mjs',
        find: "    detail.page_no = pageNo;\n    try { await logRow(cfg, req, t, 'view_records', { detail }, hids); }\n    catch (e) { console.error('admin_log_fail', code(e)); return logFailed(e); }",
        replace: "    detail.page_no = pageNo;\n    try { await logRow(cfg, req, t, 'view_records', { detail }, hids); }\n    catch (e) { if (!usage) { console.error('admin_log_fail', code(e)); return logFailed(e); } }" },
      { name: 'config hands over USAGE_DB itself, not the read-only handle', file: 'workers/admin/src/config.mjs', find: '? readOnly(env.USAGE_DB) : null', replace: '? env.USAGE_DB : null' },
      { name: 'the read-only handle lets a write through', file: 'workers/admin/src/usage.mjs', find: "if (typeof sql !== 'string' || !READ.test(sql) || WRITE.test(sql)) throw new Error('usage_read_only');", replace: "if (typeof sql !== 'string') throw new Error('usage_read_only');" },
      { name: 'usage.mjs writes cubby-usage', file: 'workers/admin/src/usage.mjs', find: '  const total = Number((await one(db, c.sql, c.binds)).n) || 0;',
        replace: "  await db.prepare('DELETE FROM usage_meta WHERE key = ?').bind('x').run();\n  const total = Number((await one(db, c.sql, c.binds)).n) || 0;" },
      { name: 'the admin writes cubby-games', file: 'workers/admin/src/data.mjs', find: "const rows = await allRows(cfg.games, \"SELECT key, value, updated_at FROM ops_state WHERE key IN ('push_last_run', 'push_daily')\");",
        replace: "await cfg.games.prepare('DELETE FROM ops_state WHERE key = ?').bind('x').run();\n    const rows = await allRows(cfg.games, \"SELECT key, value, updated_at FROM ops_state WHERE key IN ('push_last_run', 'push_daily')\");" },
    ], ok);
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('ADMIN-ACCESS-LOG: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL threw ' + (e && e.stack)); console.log('ADMIN-ACCESS-LOG: FAIL'); process.exit(1); });
