#!/usr/bin/env node
/* HOME-SCREEN SHORTCUTS: one static list, shown to everybody, at every stage.
 *
 * app/manifest.webmanifest now carries a `shortcuts` array, so a long-press on an installed Cubby
 * offers Feed, Sleep and Nappy without opening the app first. The iOS app icon's quick actions are
 * the same idea and will be the same list.
 *
 * Two things can go wrong with a static list and neither is visible by reading it.
 *
 * 1. DRIFT. The labels are copied from QUICK_ACTIONS in app/index.html. Rename a tile in the app
 *    and the long-press menu keeps saying the old word, on a surface nobody opens while working.
 *    Sections 1 and 2 pin every name and description to the table they were copied from.
 *
 * 2. THE WRONG STAGE. Half the households on this product are expecting, and a static list cannot
 *    know that. The pregnancy quick actions are all ownerOnly and two are week-gated (kicks 28,
 *    contractions 36), so a static list can honour neither and they must never appear in one.
 *    And an expecting mother WILL tap "Feed", because it is on her phone. Before this change the
 *    router matched nothing and did nothing: a cold launch, a wait past sign-in, then silence.
 *    Section 4 puts a pregnancy-only household on a ?go=feed link and requires a real screen.
 *
 * Runs the app in local mode (cubby-quick-uid=local), so store-firebase.js never loads. A PASS
 * attests to the ROUTER and the MANIFEST, not to the server or to firestore.rules.
 *
 *   node tools/serve.js &   &&   node tools/shortcuts_check.js http://localhost:8099
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = (process.argv[2] || 'http://localhost:8123').replace(/\/$/, '');
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 240) : '')); } };

const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');

/* The table the manifest was copied FROM. Parsed rather than restated, so this gate cannot drift
   in the same direction as the thing it is guarding. */
function quickActions() {
  const block = /const QUICK_ACTIONS=\[([\s\S]*?)\n\];/.exec(html);
  if (!block) return [];
  const rows = [];
  const re = /\{k:'([a-z]+)',\s*s:\[([^\]]*)\],\s*label:'([^']*)',\s*hint:(?:'([^']*)'|\([^)]*\)=>)/g;
  let m;
  while ((m = re.exec(block[1]))) {
    rows.push({
      k: m[1],
      stages: m[2].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean),
      label: m[3],
      hint: m[4] === undefined ? null : m[4],          // null = computed at runtime, not pinnable
      ownerOnly: /ownerOnly:true/.test(block[1].slice(m.index, m.index + 400)),
      minWeek: (/minWeek:(\d+)/.exec(block[1].slice(m.index, m.index + 400)) || [, null])[1],
    });
  }
  return rows;
}

/* The static half, as a function so the self-test can run it against a deliberately broken
   manifest and prove the assertions can go red. */
function checkStatic(manifest, rows, label) {
  console.log('\n' + label);
  const before = fail;
  const list = manifest.shortcuts;
  ok('the manifest declares shortcuts', Array.isArray(list) && list.length > 0, JSON.stringify(list));
  if (!Array.isArray(list)) return fail === before;
  const byKey = {};
  rows.forEach((r) => { byKey[r.k] = r; });

  list.forEach((s) => {
    const m = /^\/app\/\?go=([a-z]+)$/.exec(s.url || '');
    ok('"' + s.name + '" points at a /app/?go= route', !!m, s.url);
    if (!m) return;
    const row = byKey[m[1]];
    ok('"' + s.name + '" names a real quick action (' + m[1] + ')', !!row, Object.keys(byKey).join(' '));
    if (!row) return;
    ok('"' + s.name + '" still matches the app\'s own label', s.name === row.label, 'manifest ' + s.name + ' vs app ' + row.label);
    if (row.hint !== null) {
      ok('"' + s.name + '" still matches the app\'s own hint', s.description === row.hint,
        'manifest "' + s.description + '" vs app "' + row.hint + '"');
    }
    /* A static list is shown to every member of the circle, at every week. ownerOnly and minWeek
       are decisions the list cannot carry, so the actions that hold them may not be in it. */
    ok('"' + s.name + '" is not owner-only (a static list cannot check who is holding the phone)', !row.ownerOnly, row);
    ok('"' + s.name + '" is not week-gated (a static list cannot check the week)', !row.minWeek, row);
    ok('"' + s.name + '" is not a pregnancy-stage action', row.stages.indexOf('pregnancy') < 0, row.stages);
  });
  return fail === before;
}

(async () => {
  console.log('\nhome-screen shortcuts: the static list, and what a wrong-stage tap does');
  const rows = quickActions();
  ok('QUICK_ACTIONS parsed out of app/index.html', rows.length >= 8, rows.length + ' rows');
  ok('and the pregnancy rows carry the gates this file relies on',
    rows.some((r) => r.k === 'kicks' && r.ownerOnly && r.minWeek === '28'), rows.filter((r) => r.stages.indexOf('pregnancy') >= 0));

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/manifest.webmanifest'), 'utf8'));
  checkStatic(manifest, rows, 'static, this checkout');

  /* Red-then-green, in the file, on every run. A manifest that points at a route the app does not
     have, renames a tile, and offers an owner-only week-gated pregnancy action must fail all of
     it. If this block ever passes, the assertions above are decorative. */
  console.log('\nthe static half can go red');
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.shortcuts = [
    { name: 'Feed', short_name: 'Feed', description: 'Breast, bottle, solids', url: '/app/?go=nosuchthing' },
    { name: 'Feeding', short_name: 'Feed', description: 'Breast, bottle, solids', url: '/app/?go=feed' },
    { name: 'Kicks', short_name: 'Kicks', description: 'Count the movements', url: '/app/?go=kicks' },
  ];
  const sunk = fail;
  const quiet = console.log; console.log = () => {};
  checkStatic(bad, rows, 'synthetic');
  console.log = quiet;
  const caught = fail - sunk;
  fail = sunk;                                        // the synthetic failures are the point, not a result
  ok('a drifted, wrong-route, pregnancy-carrying manifest is caught', caught >= 5, caught + ' assertions fired');

  /* ---------------------------------------------------------------- the behaviour half */
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });

  /* Which checkout answered? Anchor on the table the manifest's routes resolve through, so a red
     run is never misread as "the shortcuts are broken" when it is really "wrong port". */
  const marker = await page.evaluate(() => typeof runDeepLink === 'function'
    && /BABY_GO=\{feed:'openFeed'/.test(String(runDeepLink)));
  console.log(marker
    ? '\n  [checkout] ' + BASE + ' is serving a tree whose router has the BABY_GO table. Good.'
    : '\n  [checkout] WARNING: ' + BASE + ' has no BABY_GO table in runDeepLink.\n'
      + '             This port probably belongs to another checkout. Check the port first.');

  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
  const now = Date.now(), DAY = 86400000;
  const base = { babies: [], activeBabyId: null, events: [], illnesses: [],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, welcome: 1, log: 1 } },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, notes: [], pregnancy: null };
  const BABY = Object.assign({}, base, { babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }], activeBabyId: 'b1' });
  const PREG = Object.assign({}, base, { pregnancy: { id: 'p1', stage: 'expecting', dueDate: now + 70 * DAY, appts: [], bp: [], weights: [], periods: [] } });

  const arrive = async (state, qs) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      try { sessionStorage.removeItem('cubby-dl'); } catch (e) {}
    }, state);
    await page.goto(BASE + '/app/?e2e=1&' + qs, { waitUntil: 'networkidle2', timeout: 40000 });
    await sleep(2200);
  };
  const look = () => page.evaluate(() => {
    const s = document.getElementById('sheet'), sc = document.getElementById('scroll');
    return {
      sheetOpen: !!(s && s.classList.contains('show')),
      sheetH2: s && s.querySelector('h2') ? (s.querySelector('h2').textContent || '').replace(/\s+/g, ' ').trim() : null,
      screen: sc ? (sc.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160) : '',
    };
  });

  console.log('\n1. the shortcut works for the household it was written for');
  await arrive(BABY, 'go=feed');
  let v = await look();
  ok('a baby household tapping "Feed" gets the feed sheet', v.sheetOpen && /feed/i.test(v.sheetH2 || ''), v);

  console.log('\n2. and the pregnancy shortcuts the app mints itself are untouched');
  await arrive(PREG, 'go=kicks');
  v = await look();
  ok('an expecting mother on ?go=kicks still gets the kick counter', v.sheetOpen && /kick|movement/i.test((v.sheetH2 || '') + ' ' + v.screen), v);

  console.log('\n3. an unknown action is still swallowed, so the fallback is scoped');
  await arrive(BABY, 'go=notathing');
  v = await look();
  ok('?go=notathing opens nothing', !v.sheetOpen, v);

  /* THE WRONG STAGE. A static list cannot know who is holding the phone, so an expecting mother
     WILL tap "Feed". What happens is nothing: no PREG_GO key matches, hasBaby is false, the router
     falls out of the block.
     I wrote a fallback that sent her to go('home') instead, and then deleted it, because it changed
     nothing she could see. A pregnancy household's shell ignores `view` entirely — her journey is
     the screen at every value of it — so the before and after screens were character-for-character
     identical and only an internal variable moved. Two of the three assertions I had written around
     it also passed on a build with no fallback at all.
     So the real fix is not in the router, it is to not put the wrong shortcut on her phone: a
     dynamic, stage-aware list, which on iOS means native quick actions set from the app. Until that
     exists, what matters is that the wrong-stage tap is INERT rather than wrong, and that is what
     this section pins. It is falsifiable in the direction that would hurt: if ?go=feed ever opened
     a baby feed sheet at a pregnant woman, or dropped her on a blank screen, it fails. */
  console.log('\n4. a wrong-stage tap is inert, not wrong');
  await arrive(PREG, 'go=feed');
  v = await look();
  ok('an expecting mother tapping "Feed" is not shown a baby sheet', !v.sheetOpen, v);
  ok('and she is not left on a blank screen', v.screen.length > 20, v);
  ok('the screen she gets is her own journey', /week|due|trimester|expect/i.test(v.screen), v.screen);

  ok('no uncaught page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SHORTCUTS: FAIL' : 'SHORTCUTS: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
