#!/usr/bin/env node
/* The "Get started" checklist counted the HOUSEHOLD's log, not the person reading it.
 *
 * So the second caregiver, the one the whole product is a wedge for, joined a family with three
 * months of history and landed on a home screen whose "Log your first entry" row was already ticked
 * by somebody else. Worse, the card retires at `haveBaby && haveLog`, and both were true the second
 * they arrived, so it never rendered at all: the one row that exists to make a second person log
 * something was invisible to the only person in the family who had never logged. Then renderHome
 * suppresses the tips ticker and the welcome coach mark while the card is up, so what they actually
 * got was a home screen full of somebody else's numbers and no instruction of any kind.
 *
 * Fixed with a joiner branch: two rows that are genuinely theirs, retiring on their OWN first entry.
 *
 * Three traps this gate holds, all of them found by review after the first version shipped here:
 *
 *  1. haveLog is a fact about the FAMILY and haveMyLog is a fact about the READER. The first version
 *     made the shared retire gate per-person, which handed the five-row setup checklist back, forever,
 *     to every owner whose partner does the logging, with the tips ticker and the coach mark switched
 *     off behind it. Block 6 is that reproduction.
 *  2. authorId is stamped by the SYNC layer at write time, not by saveDiaper. An offline nappy carries
 *     no author at all, so a strict `e.authorId===myUid()` check leaves a checklist permanently
 *     unfinished. An unstamped entry has to count as mine, which is the rule canEditEvent uses.
 *  3. The boot snapshot only fetches the last 120 days, and hydrateFullHistory is skipped whenever the
 *     3.5s failsafe boots first. Without a latch, a joiner who logs and then has a quiet four months
 *     boots back into "Get started" for the whole session. Block 4c is that reproduction.
 *  4. That latch has to be PROOF, not the lenient guess above, and it has to know which family it is
 *     about. The first version wrote a bare tip_gs_logged into a map keyed by person and never
 *     cleared, on the same unstamped-counts-as-mine rule, so one legacy nappy of the OWNER's switched
 *     the card off for the joiner permanently, in that family and in every family they joined next.
 *     Block 4d is that reproduction.
 *
 * The base URL is REQUIRED, and the served source is fingerprinted before anything is asserted. An
 * earlier version of this gate defaulted to a port another worktree was already serving and printed
 * PASS against code containing none of the change.
 *
 *   PORT=9366 node tools/serve.js &
 *   node tools/getstarted_author_check.js http://localhost:9366
 *   node tools/getstarted_author_check.js --self-test        (asserts the fingerprints are findable)
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const http = require('http');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

/* Every block is wrapped. The first version of this gate died on a raw TypeError the moment a row it
   expected was missing, which is exactly what happens on reverted code: exit 2, seven assertions
   never run, and the visible output understated the breakage by more than half. A block that throws
   is a failure with a name, and the run carries on. */
const block = async (name, fn) => {
  console.log('\n' + name);
  try { await fn(); } catch (e) { fail++; console.log('  FAIL block threw: ' + (e && e.message)); }
};

/* The change, fingerprinted in the SERVED source. Not a style check: every one of these is the
   load-bearing line of a defect above, so a tree without them cannot be graded. */
const MARKERS = [
  ["the joiner branch exists", "const joiner=(window.LL&&window.LL.role)==='caregiver';"],
  ["the retire gate is per-person for the joiner and per-household for the owner", "if(haveBaby && (joiner?haveMyLog:haveLog)) return '';"],
  ["the owner's card still reads the household log", "const haveLog=(state.events||[]).length>0;"],
  ["an unstamped entry counts as the reader's own", "some(e=>e && (!e.authorId || e.authorId===_me))"],
  ["the 120-day boot window is latched, per household", "const _lk='tip_gs_logged:'+_hid;"],
  ["and only a stamped entry of the reader's own may write that latch", "if((state.events||[]).some(e=>e && e.authorId===_me)) markSeen(_lk);"],
  ["nothing is filed before the household snapshot names the household", "if(joiner && _hid){"],
  ["the joiner's log row names its real destination", "'Log the next nappy'"],
  ["the hello row uses the house phrase", "'Leave a word for whoever has baby next'"],
];

const fetchText = (url) => new Promise((res, rej) => {
  http.get(url, (r) => {
    if (r.statusCode !== 200) { rej(new Error(url + ' -> HTTP ' + r.statusCode)); r.resume(); return; }
    let b = ''; r.setEncoding('utf8'); r.on('data', (c) => { b += c; }); r.on('end', () => res(b));
  }).on('error', rej);
});

if (process.argv[2] === '--self-test') {
  const fs = require('fs');
  const src = fs.readFileSync(__dirname + '/../app/index.html', 'utf8');
  console.log('\nself-test: every fingerprint is present in the working tree');
  MARKERS.forEach(([n, m]) => ok(n, src.indexOf(m) >= 0, m));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'GETSTARTED-AUTHOR SELF-TEST: FAIL' : 'GETSTARTED-AUTHOR SELF-TEST: PASS');
  process.exit(fail ? 1 : 0);
}
if (!BASE) {
  console.error('usage: node tools/getstarted_author_check.js http://localhost:<your port>\n' +
    '       the base URL is required on purpose: a default port grades whichever checkout happens\n' +
    '       to be serving on it, which is how this gate once printed PASS against unchanged code.');
  process.exit(2);
}

const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

// Three months of a family's history, all of it logged by the mother. This is what a partner or a
// nanny actually arrives to, and it is the shape that used to retire the card before they saw it.
// `endedDaysAgo` pushes the whole run into the past, which is how a block gets a clean read on the
// teaching layer: awayRecap fires on anything another member logged TODAY and suppresses the ticker.
const history = (author, n, endedDaysAgo) => {
  const evs = [];
  const tail = (endedDaysAgo || 0) * DAY;
  for (let i = 0; i < (n || 40); i++) {
    evs.push({ id: 'h' + i, type: i % 2 ? 'feed' : 'diaper', babyId: 'b1', kind: 'wet', method: 'bottle',
      amount: 120, unit: 'ml', time: now - tail - i * 6 * HOUR, authorId: author });
  }
  return evs;
};

(async () => {
  console.log('grading ' + BASE + '  (make sure this is YOUR tree: tools/serve.js prints the path it serves)');

  const src = await fetchText(BASE + '/app/index.html');
  console.log('\n0. the tree being graded actually contains the change');
  ok('the served app is the real file, not a 404 page', src.length > 200000, src.length);
  MARKERS.forEach(([n, m]) => ok(n, src.indexOf(m) >= 0, m));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  /* Every seen map is wiped between blocks, because the card's first line is hasSeen('tip_getstarted')
     and a dismissal left over from an earlier block would make every assertion below it pass by
     rendering nothing at all. The retirement latch lives in the same map, so it goes too. */
  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => {
        if (k.indexOf('cubby-theme') === 0 || k.indexOf('cubby-seen-') === 0 || k.indexOf('cubby-last-open') === 0) localStorage.removeItem(k);
      });
      localStorage.setItem('cubby-quick-uid', 'local');
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
  };

  /* Assigned ONTO the existing LL rather than replacing it, because Store is wired through that same
     object and a fresh literal would cut persist() off from it mid-test. Same shape the household
     snapshot writes: members is uid -> role STRING. */
  const asMember = (uid, role, members, memberInfo, hid) => page.evaluate((u, r, m, mi, h) => {
    window.LL = window.LL || {};
    window.LL.auth = { currentUser: { uid: u } };
    window.LL.role = r;
    window.LL.members = m;
    window.LL.memberInfo = mi;
    window.LL.householdId = h;   // set on the same snapshot as role, in store-firebase
  }, uid, role, members, memberInfo || {}, hid || 'hh1');

  // Everything this person's ledger has filed about having logged, and which family it is filed under.
  const latches = (uid) => page.evaluate((u) => {
    try { return Object.keys(JSON.parse(localStorage.getItem('cubby-seen-' + u) || '{}')).filter((k) => k.indexOf('tip_gs_logged') === 0).sort(); }
    catch (e) { return ['unreadable']; }
  }, uid);

  // Reads the card as a real element tree. Never body.textContent: this page's body contains the
  // inline script's own source, so every string in the app is "found" there and a check on it passes
  // no matter what rendered.
  const card = () => page.evaluate(() => {
    const html = renderGetStarted();
    const d = document.createElement('div'); d.innerHTML = html;
    return {
      empty: html === '',
      title: (d.querySelector('.gs-title') || {}).textContent || '',
      rows: Array.from(d.querySelectorAll('.gs-row')).map((r) => ({
        t: ((r.querySelector('.gs-t') || {}).textContent || '').trim(),
        s: ((r.querySelector('.gs-s') || {}).textContent || '').trim(),
        done: r.classList.contains('done'),
        onclick: r.getAttribute('onclick') || '',
      })),
    };
  });
  const labelsOf = async () => (await card()).rows.map((x) => x.t);

  // The card as it actually paints, out of the live document after a real render().
  const painted = () => page.evaluate(() => {
    render();
    const c = document.querySelector('.gs-card');
    if (!c) return null;
    return Array.from(c.querySelectorAll('.gs-row')).map((r) => ({
      t: ((r.querySelector('.gs-t') || {}).textContent || '').trim(), done: r.classList.contains('done'),
    }));
  });

  // What renderHome switches OFF while the card is up. This is the real cost of a checklist that
  // cannot end, and it is why block 6 is not a style objection.
  const homeState = () => page.evaluate(() => {
    render();
    return {
      cardOnHome: !!document.querySelector('.gs-card'),
      tips: !!document.getElementById('tipStatic'),
      coach: !!document.querySelector('.coach'),
    };
  });

  const MAMA = { uidMama: 'owner', uidNana: 'caregiver' };
  const INFO = { uidMama: { name: 'Maya Rao', relationship: 'Mama Bear' }, uidNana: { name: 'Nadia', relationship: 'Nana Bear' } };

  await block('1. a joiner arriving into three months of somebody else\'s history is still asked to log', async () => {
    await load(seed({ events: history('uidMama', 40) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO);
    const r = await card();
    const n = await page.evaluate(() => (state.events || []).length);
    ok('the family really does have a full log already', n === 40, n);
    ok('and the card still appears, which the household count never allowed', r.empty === false, r);
    const logRow = r.rows.find((x) => /log the next nappy/i.test(x.t));
    ok('the logging row is there', !!logRow, r.rows);
    ok('it is NOT ticked by the mother\'s forty entries', !!logRow && logRow.done === false, logRow);
    ok('and it is tappable, on the two-tap path that always writes an entry', /openDiaper/.test((logRow || {}).onclick), logRow);
  });

  await block('2. the joiner is not handed the owner\'s jobs, ticked, as if they were done', async () => {
    const r = await card();
    const L = r.rows.map((x) => x.t);
    /* Each negative carries `L.length` with it. Without that they are all vacuously true on reverted
       code, where the card never renders and `rows` is []: four green ticks for nothing. */
    ok('exactly two rows, both of them theirs', L.length === 2, L);
    ok('no "Add your baby", which a caregiver cannot do', L.length > 0 && !L.some((t) => /add your baby/i.test(t)), L);
    ok('no "Invite a co-parent", which is the owner\'s circle', L.length > 0 && !L.some((t) => /invite/i.test(t)), L);
    ok('no "Add a photo"', L.length > 0 && !L.some((t) => /photo/i.test(t)), L);
    const hello = r.rows[1] || {};
    ok('the second row is the hello', /say hello/i.test(hello.t || ''), hello);
    ok('and it opens the note composer', /openNoteCompose/.test(hello.onclick || ''), hello);
    ok('nothing on the card is pre-ticked for them', L.length > 0 && r.rows.every((x) => x.done === false), r.rows);
  });

  await block('3. it names the person whose family this is, and stays honest when it cannot', async () => {
    const r = await card();
    const sub = ((r.rows[0] || {}).s) || '';
    ok('it says who will see it', /Maya sees it straight away/.test(sub), sub);
    ok('and that their name goes on it', /with your name on it/.test(sub), sub);

    // Same household, memberInfo not down yet. This is a real first-boot window, not a hypothetical.
    await asMember('uidNana', 'caregiver', MAMA, {});
    const s2 = (((await card()).rows[0]) || {}).s || '';
    ok('with no member info it falls back to a pronoun', /They see it straight away/.test(s2), s2);
    ok('and never prints an empty name or an undefined', s2.length > 0 && !/undefined|^\s*sees|\bnull\b/.test(s2), s2);
    await asMember('uidNana', 'caregiver', MAMA, INFO);
  });

  await block('3b. the words on the joiner\'s card are the house voice, and they keep their promise', async () => {
    const r = await card();
    const L = r.rows.map((x) => x.t), S = r.rows.map((x) => x.s);
    /* The label used to say "Log the next thing you do" while the tap opened the nappy sheet and
       nothing else. That promise-vs-destination gap is a bug this file already carries a comment
       about, three lines below the row. The label has to name where the tap lands. */
    ok('the log row names its real destination', L[0] === 'Log the next nappy', L);
    ok('and the row really does open the nappy sheet, not a timer', /openDiaper/.test((r.rows[0] || {}).onclick || ''), r.rows[0]);
    /* One phrase for one act. The empty notes lane says "Leave a word for whoever has baby next";
       a second phrasing one screen away reads as two different features. */
    ok('the hello row reuses the notes lane\'s own phrase', S[1] === 'Leave a word for whoever has baby next', S);
    const all = L.concat(S).concat([r.title]).join(' ');
    ok('no em-dash anywhere on the card', all.indexOf('—') < 0 && all.indexOf('–') < 0, all);
    ok('sentence case, not Title Case', !L.some((t) => /\s[A-Z][a-z]/.test(t)), L);
    ok('nothing medical, nothing that can be failed', !/should|must|need to|behind|overdue|normal|healthy/i.test(all), all);

    // 390px, light. The report claimed no clipping and nothing gated it.
    const over = await page.evaluate(() => {
      render();
      const c = document.querySelector('.gs-card'); if (!c) return null;
      const rows = Array.from(c.querySelectorAll('.gs-row'));
      return { card: c.scrollWidth - c.clientWidth, row: Math.max.apply(null, rows.map((x) => x.scrollWidth - x.clientWidth)) };
    });
    ok('the card does not overflow its column at 390px', over && over.card <= 1 && over.row <= 1, over);
  });

  await block('4. it retires on the joiner\'s OWN first entry, and stays retired', async () => {
    const before = await painted();
    ok('the card is genuinely on the home screen, not just in the return value', !!before && before.length === 2, before);

    /* Asserted through renderGetStarted, not through a filter re-implemented in the test. The first
       version of this block counted `!e.authorId || e.authorId==='uidNana'` in the page and asserted
       on the count, which is the fix restated as its own proof and never called the function. */
    const r = await page.evaluate(() => {
      saveDiaper('wet');
      return { total: (state.events || []).length, unstamped: (state.events || []).filter((e) => !e.authorId).length, card: renderGetStarted() };
    });
    ok('their nappy is written', r.total === 41, r.total);
    ok('and the sync layer has not stamped it, which is why an author check has to be lenient', r.unstamped === 1, r.unstamped);
    ok('renderGetStarted retires on it anyway', r.card === '', r.card.slice(0, 160));
    ok('and the card is gone from the home screen', (await painted()) === null, await painted());
  });

  await block('4b. and it is still gone when they come back tomorrow', async () => {
    /* Re-seeded rather than reloaded in place, because under ?e2e=1 Store.save does not write
       little-log-v1 back, so a plain reload would replay the SEED and only ever measure the
       harness. This is the state a returning caregiver actually boots into: the family's history
       plus the one entry of theirs, stamped by the sync layer on the way up. */
    await load(seed({ events: history('uidMama', 40).concat([{ id: 'mine', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - HOUR, authorId: 'uidNana' }]) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO);
    ok('their own stamped entry keeps it retired', (await painted()) === null, await painted());

    // The same boot before the stamp lands: offline, or the snapshot echo not back yet.
    await load(seed({ events: history('uidMama', 40).concat([{ id: 'mine', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - HOUR }]) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO);
    ok('and an unstamped one does too, so an offline boot does not re-onboard them', (await painted()) === null, await painted());

    // Control: take their entry away again and the card must come straight back, which proves the
    // two assertions above are reading the entry and not a leftover dismissal.
    await load(seed({ events: history('uidMama', 40) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO);
    ok('with only the mother\'s entries it is up again', ((await painted()) || []).length === 2, await painted());
  });

  await block('4c. a quiet four months does not re-onboard a joiner who has already logged', async () => {
    /* store-firebase boots on `where("time",">=", Date.now()-120*86400000)`, and hydrateFullHistory
       only runs from the `if(!booted)` branch: when the 3.5s failsafe boots first, full history is
       never fetched for that session. So a joiner whose own last entry is older than the window sees
       a truncated log all session, and a per-person retire test with no memory reads that as "this
       person has never logged". */
    await load(seed({ events: history('uidMama', 40).concat([{ id: 'old', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - 200 * DAY, authorId: 'uidNana' }]) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO);
    ok('with their whole history on screen the card is retired', (await painted()) === null, await painted());

    await page.evaluate(() => { state.events = (state.events || []).filter((e) => e.authorId !== 'uidNana'); });
    ok('and the truncated 120-day boot does not put "Get started" back in front of them', (await painted()) === null, await painted());

    // Control: clear the latch and the same truncated state DOES bring the card back, which proves
    // the assertion above is reading the latch rather than a leftover dismissal.
    await page.evaluate(() => {
      const m = JSON.parse(localStorage.getItem(seenKey()) || '{}');
      Object.keys(m).forEach((k) => { if (k.indexOf('tip_gs_logged') === 0) delete m[k]; });
      localStorage.setItem(seenKey(), JSON.stringify(m));
    });
    ok('control: without the latch the truncated boot really would re-onboard them', ((await painted()) || []).length === 2, await painted());
  });

  await block('4d. the latch is proof this person logged HERE, not a guess that follows them around', async () => {
    /* The reproduction, in three parts.
       authorId is stamped by the sync layer at write time, so every household older than that line
       is full of entries the OWNER wrote with no author on them at all. The live read counts an
       unstamped entry as the reader's own on purpose, because an offline nappy has no stamp either
       and a strict check would leave the row unfinished. That lenience is fine for a guess we make
       again on the next paint. Written down it is not: the first version of this latch put a bare
       tip_gs_logged into a map that is keyed by person and never cleared, so ONE legacy nappy of
       the mother's, misread once, switched this card off for the joiner permanently, in this family
       and in every family they ever join afterwards. */
    await load(seed({ events: history('uidMama', 39).concat([{ id: 'legacy', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - 8 * DAY }]) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO, 'hh1');
    await painted();   // the paint that used to file the misread
    ok('one unstamped entry of the mother\'s writes nothing down about the joiner', (await latches('uidNana')).length === 0, await latches('uidNana'));

    // The rest of the household finishes syncing. Every entry now carries the mother's uid and not
    // one carries Nadia's, so the honest answer is that she still has not logged. Mutated in place
    // rather than re-seeded, because load() wipes the ledger and would clear the very latch under test.
    await page.evaluate(() => { (state.events || []).forEach((e) => { e.authorId = 'uidMama'; }); });
    ok('and once the family is fully stamped the card is back, still asking her', ((await painted()) || []).length === 2, await painted());

    // Now she really logs, and the latch is written: named for this family, in her own ledger.
    await load(seed({ events: history('uidMama', 40).concat([{ id: 'mine', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - HOUR, authorId: 'uidNana' }]) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO, 'hh1');
    ok('a stamped entry of her own retires it', (await painted()) === null, await painted());
    ok('and that fact is filed under the household it is about', JSON.stringify(await latches('uidNana')) === '["tip_gs_logged:hh1"]', await latches('uidNana'));
    ok('and under her own uid, never the owner\'s', (await latches('uidMama')).length === 0, await latches('uidMama'));

    /* Same phone, same account, a second family. A nanny takes another job, or a partner leaves and
       later joins someone else's Cubby. She has logged nothing here and has to be asked, which is
       the entire reason the joiner card exists. No load(): wiping the ledger would hide the bug. */
    await page.evaluate((evs) => { state.events = evs; }, history('uidBea', 40));
    await asMember('uidNana', 'caregiver', { uidBea: 'owner', uidNana: 'caregiver' },
      { uidBea: { name: 'Bea Ellis', relationship: 'Mama Bear' } }, 'hh2');
    const nu = await painted();
    ok('a different family asks her to log, it does not inherit the first one\'s answer', (nu || []).length === 2, nu);
    ok('and it names the second family, not the first', /Bea sees it straight away/.test((((await card()).rows[0]) || {}).s || ''), ((await card()).rows[0] || {}).s);
    ok('joining a second family files nothing new on its own', JSON.stringify(await latches('uidNana')) === '["tip_gs_logged:hh1"]', await latches('uidNana'));

    // Back to the first family, on the truncated 120-day boot that the latch exists for. Scoping it
    // per household must not cost the joiner the thing it was protecting.
    await page.evaluate((evs) => { state.events = evs; }, history('uidMama', 40));
    await asMember('uidNana', 'caregiver', MAMA, INFO, 'hh1');
    ok('and the family she has logged in still does not re-onboard her', (await painted()) === null, await painted());
  });

  await block('5. the owner, who the card was built for, is untouched', async () => {
    await load(seed());
    await asMember('uidMama', 'owner', { uidMama: 'owner' }, INFO);
    const r = await card();
    ok('a brand new owner still gets the full setup list', r.rows.length === 5, r.rows.map((x) => x.t));
    ok('starting with the baby', /add your baby/i.test((r.rows[0] || {}).t || ''), r.rows[0]);
    ok('and it still asks for a first entry in the old words', r.rows.some((x) => /log your first entry/i.test(x.t)), r.rows.map((x) => x.t));

    // Pre-existing plumbing, kept as a plain regression guard: the invite row reads the circle.
    await load(seed());
    await asMember('uidMama', 'owner', MAMA, INFO);
    const r2 = await card();
    ok('the invite row is ticked when the circle is genuinely shared', r2.rows.some((x) => /invite/i.test(x.t) && x.done), r2.rows);

    await load(seed({ events: history('uidMama', 3) }));
    await asMember('uidMama', 'owner', { uidMama: 'owner' }, INFO);
    ok('an owner who has logged is done, exactly as before', (await card()).empty === true, await card());
  });

  await block('6. the owner whose partner does all the logging keeps her quiet home screen', async () => {
    /* The reproduction. A family a year in: baby, photo, partner in the circle, sixty entries over
       the last fortnight, every one of them logged by him. She reads the app daily and has never
       tapped a log tile herself.
       Making the retire gate per-person for everybody gave her a five-row setup checklist with three
       ticks and "nearly done" on it, permanently, on the home screen of a fully set-up family — and
       renderHome switches the tips ticker, the coach mark, the teaching cue and the nudge off while
       that card is up. Nothing clears it but tapping x or logging. haveLog is a fact about the
       family; only the joiner branch may ask about the reader. */
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 300 * DAY, sex: 'F', avatarPhotoId: 'p1', routines: [], doctors: [], allergies: [] }],
      photos: [{ id: 'ph1', babyId: 'b1', photoId: 'p1', at: now - 30 * DAY }],
      events: history('uidDad', 60),
      settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: {} },
    }));
    await asMember('uidMama', 'owner', { uidMama: 'owner', uidDad: 'caregiver' }, INFO);
    const r = await card();
    ok('renderGetStarted stays silent for her', r.empty === true, r.rows.map((x) => x.t + (x.done ? ' /done' : '')));
    ok('no setup checklist on the home screen of a family a year in', (await painted()) === null, await painted());

    /* Same household, the partner's run ended three days ago, so awayRecap is quiet and the teaching
       layer can be read directly. This is the cost the card was carrying: not a row too many, the
       whole contextual teaching layer switched off for as long as the checklist is up. */
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 300 * DAY, sex: 'F', avatarPhotoId: 'p1', routines: [], doctors: [], allergies: [] }],
      photos: [{ id: 'ph1', babyId: 'b1', photoId: 'p1', at: now - 30 * DAY }],
      events: history('uidDad', 60, 3),
      settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: {} },
    }));
    await asMember('uidMama', 'owner', { uidMama: 'owner', uidDad: 'caregiver' }, INFO);
    const h = await homeState();
    ok('still no card', h.cardOnHome === false, h);
    ok('and the tips ticker is back on, which the card would have muted', h.tips === true, h);

    // Control: the same fixture with the household log emptied really does raise the card, so the
    // two assertions above are reading the retire gate and not a dismissal or a loss holding.
    await page.evaluate(() => { state.events = []; });
    const h2 = await homeState();
    ok('control: with nothing logged at all she does get the card', h2.cardOnHome === true, h2);
    ok('and the ticker is muted underneath it, which is the cost being avoided', h2.tips === false, h2);
  });

  await block('7. a signed-out parent is not left with a checklist she can never finish', async () => {
    /* The events a local-only session writes carry NO authorId, because the stamp is added by the
       sync layer. Under a strict equality check this parent logs every day for a year and the setup
       card sits on her home screen forever, muting the tips ticker and the coach mark with it. */
    await load(seed({ events: [{ id: 'e1', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - HOUR }] }));
    const r = await page.evaluate(() => ({ card: renderGetStarted(), stamped: (state.events || []).some((e) => e.authorId) }));
    ok('her entry really is unstamped', r.stamped === false, r);
    ok('and it still retires her card', r.card === '', r.card.slice(0, 160));

    // The same thing for a JOINER, which is the branch that actually reads per-author now.
    await load(seed({ events: [{ id: 'e1', type: 'diaper', babyId: 'b1', kind: 'wet', time: now - HOUR }] }));
    await asMember('uidNana', 'caregiver', MAMA, INFO);
    ok('and a joiner\'s unstamped entry retires hers too', (await card()).empty === true, await card());

    // And from scratch, through the real button path, twice.
    await load(seed());
    ok('with nothing logged the card is up', ((await painted()) || []).length === 5, await painted());
    await page.evaluate(() => { saveDiaper('wet'); });
    ok('one real nappy takes it down', (await painted()) === null, await painted());
    const second = await page.evaluate(() => { saveDiaper('dirty'); return (state.events || []).length; });
    ok('a second save does not resurrect it', second === 2 && (await painted()) === null, second);
  });

  await block('8. dismissing it is this person\'s decision, not the household\'s', async () => {
    await load(seed({ events: history('uidMama', 40) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO);
    ok('the joiner has the card', ((await painted()) || []).length === 2, await painted());
    await page.evaluate(() => { dismissTip('getstarted'); });
    ok('and can put it away', (await painted()) === null, await painted());
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('cubby-seen-') === 0).sort());
    ok('the dismissal is filed under their own uid', keys.indexOf('cubby-seen-uidNana') >= 0, keys);
    ok('and nothing was written under the owner\'s', keys.indexOf('cubby-seen-uidMama') < 0, keys);
  });

  await block('9. and it holds up in the dark, at 390px', async () => {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await load(seed({ events: history('uidMama', 40) }));
    await asMember('uidNana', 'caregiver', MAMA, INFO);
    const d = await page.evaluate(() => {
      render();
      const c = document.querySelector('.gs-card'); if (!c) return null;
      const rows = Array.from(c.querySelectorAll('.gs-row'));
      const cs = getComputedStyle(rows[0].querySelector('.gs-t'));
      return { rows: rows.length, over: Math.max.apply(null, rows.map((x) => x.scrollWidth - x.clientWidth)),
        cardOver: c.scrollWidth - c.clientWidth, colour: cs.color, dark: getComputedStyle(document.body).backgroundColor };
    });
    ok('the joiner card paints in dark mode', !!d && d.rows === 2, d);
    ok('with nothing clipped or overflowing', !!d && d.over <= 1 && d.cardOver <= 1, d);
    ok('and the label is not painted invisible', !!d && d.colour !== d.dark, d);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  });

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'GETSTARTED-AUTHOR: FAIL' : 'GETSTARTED-AUTHOR: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
