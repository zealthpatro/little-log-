/* AVATAR ASSIGNMENT GATE — twelve painted bears must actually reach twelve people.
 *
 * v244 shipped 18 painted portraits and then handed them out with a hash. The art was fine and
 * the assignment was not, in a way that only measurement can see:
 *
 *   hashStr is h = h*31 + c, so hashStr(A + B) = hashStr(A) * 31^|B| + hashStr(B). 31 is odd, so
 *   31^|B| is odd, so hashStr('pose:' + uid) & 1 === (hashStr('pose:') & 1) XOR (hashStr(uid) & 1).
 *   The pose "salt" was a CONSTANT BIT FLIP of the parity of the fur index, not decorrelation.
 *   Fur was h % 8 and pose was h & 1, so the two were welded together: only SIX of the twelve
 *   portraits could ever be produced, skewed 25 / 25 / 12.5 / 12.5 / 12.5 / 12.5. Four people in
 *   a circle showed a repeated face 76% of the time — worse than the eight flat SVG bears the
 *   painted set replaced (9.1%), on exactly the axis the work was meant to improve.
 *
 * Nothing in the codebase could have caught that: the slugs were valid, the files existed, the
 * screenshots looked right, and every uid resolved to a bear. It is only wrong in aggregate.
 * So this gate is a measurement, run against the REAL window.cubbyArtFor in the real page:
 *
 *   1. SPREAD          200k uids reach all 12 adult slugs, none over 15% (uniform is 8.33%)
 *   2. HOUSEHOLDS      the same, dealt into 40k random circles of 2 to 6
 *   3. NO COLLISIONS   every 4-person circle shows 4 different bears, 20k times over
 *   4. STABILITY       an assigned person keeps their bear as the circle grows to 6
 *   5. LEGACY          all 8 legacy furs still map to their documented tone (no churn)
 *   6. THE PICKER WINS an explicit pick beats the automatic choice, always
 *   7. CUBS            three babies in one household are three different cubs
 *   8. OWNER-SAFE      the claim writes our own memberInfo key and nobody else's
 *
 * And it GUARDS ITSELF (9): the v244 algorithm is reproduced here and run through checks 1 to 3.
 * If it ever passes them, this file has stopped measuring anything and the numbers above are a
 * decoration. That check failing to fail is itself a failure.
 *
 *   node tools/serve.js &   &&   node tools/avatar_test.js [baseUrl]
 */
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const APP = BASE + '/app/?e2e=1';

const N_SPREAD = 200000;   // the headline sample, per the fix's own claim
const N_HOUSE = 40000;     // random circles of 2 to 6
const N_FOUR = 20000;      // four-person circles, the "does my family look like my family" case
const N_STABLE = 20000;    // grow a circle from 1 to 6 and watch one person's bear

const fails = [];
const check = (ok, what, detail) => {
  console.log(`  ${ok ? '✓' : '✕'} ${what}${detail ? '  ' + detail : ''}`);
  if (!ok) fails.push(what + (detail ? ' — ' + detail : ''));
};

/* Everything below runs IN THE PAGE, against the shipped app/cubby-extras.js. Deliberately not a
   node port of the algorithm: a port would test the port. */
const PROBE = function (cfg) {
  const A = window.cubbyArtFor;
  if (typeof A !== 'function') return { fatal: 'window.cubbyArtFor missing' };

  /* ---- seeds: the three shapes a seed actually takes in this app ------------------------------
     a Firebase uid (28 chars of base62), an email (the local-mode / invite path), and a long
     opaque id. A hash flaw can hide in one shape and show in another, which is why the original
     measurement checked all three. Deterministic PRNG so a failure is reproducible. */
  let s = 0x2F6E2B1;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const B62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const chars = n => { let o = ''; for (let i = 0; i < n; i++) o += B62[(rnd() * 62) | 0]; return o; };
  function seed(i) {
    const shape = i % 3;
    if (shape === 0) return chars(28);                       // firebase uid
    if (shape === 1) return chars(6 + (rnd() * 8 | 0)) + '@' + chars(5) + '.com';
    return chars(64);
  }

  /* ---- the v244 algorithm, reproduced (check 9) -----------------------------------------------
     Uses the app's own still-exported cubbyVariantFor for the fur, so this is the real legacy
     path and not a paraphrase of it. */
  function legacyHash(str) { let h = 0; str = String(str || ''); for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
  const FUR_TONE = {
    '#D7B27E': 'oat', '#E0A96D': 'oat', '#C4863F': 'honey', '#B8843A': 'honey',
    '#9C6B3D': 'cinnamon', '#6E4E36': 'cocoa', '#46403A': 'cocoa', '#8C8C8C': 'ash'
  };
  function legacyArtFor(kind, sd) {
    const tone = FUR_TONE[String(window.cubbyVariantFor(sd).fur).toUpperCase()] || 'cream';
    if (kind === 'baby') return 'cub-' + tone;
    return 'av-' + tone + '-' + ((legacyHash('pose:' + sd) & 1) ? 'b' : 'a');
  }

  const TONES = ['cream', 'oat', 'honey', 'cinnamon', 'cocoa', 'ash'];
  const ADULT = [];
  TONES.forEach(t => { ADULT.push('av-' + t + '-a'); ADULT.push('av-' + t + '-b'); });
  const CUBS = TONES.map(t => 'cub-' + t);

  const setCircle = info => { window.LL.members = {}; window.LL.memberInfo = info; for (const k in info) window.LL.members[k] = 'caregiver'; };
  const tally = () => ({ n: 0, by: {} });
  const add = (t, slug) => { t.n++; t.by[slug] = (t.by[slug] || 0) + 1; };
  function report(t, pool) {
    const reached = pool.filter(p => t.by[p]).length;
    let top = '', topN = 0;
    pool.forEach(p => { if ((t.by[p] || 0) > topN) { topN = t.by[p] || 0; top = p; } });
    return { n: t.n, reached, of: pool.length, maxShare: t.n ? topN / t.n : 0, topSlug: top, by: t.by };
  }

  /* ---- 1. spread: one uid, one household, 200k times ---------------------------------------- */
  function spread(fn, n) {
    const t = tally();
    for (let i = 0; i < n; i++) {
      const uid = seed(i);
      setCircle({ [uid]: {} });
      add(t, fn('member', uid, null));
    }
    return report(t, ADULT);
  }

  /* ---- 2 + 3. random circles: spread when dealt, and how often two people match -------------- */
  function households(fn, n, fixedSize) {
    const t = tally();
    const clash = {};                              // circle size -> [circles, circles with a repeat]
    for (let i = 0; i < n; i++) {
      const k = fixedSize || (2 + (rnd() * 5 | 0));  // 2..6
      const uids = []; for (let j = 0; j < k; j++) uids.push(seed(i * 7 + j));
      const info = {}; uids.forEach(u => { info[u] = {}; });
      setCircle(info);
      const got = uids.map(u => fn('member', u, null));
      got.forEach(g => add(t, g));
      clash[k] = clash[k] || [0, 0];
      clash[k][0]++;
      if (new Set(got).size !== k) clash[k][1]++;
    }
    const rate = {};
    Object.keys(clash).forEach(k => { rate[k] = clash[k][1] / clash[k][0]; });
    return Object.assign(report(t, ADULT), { collision: rate });
  }

  /* ---- 4. stability: grow the circle around one person --------------------------------------- */
  function stability(fn, n) {
    let moved = 0, lateClash = 0, checked = 0;
    for (let i = 0; i < n; i++) {
      const me = seed(i * 11);
      setCircle({ [me]: {} });
      const mine = fn('member', me, null);
      // The app writes the assignment down the moment it is made (cubbyClaimAvatar), so model
      // exactly that: from here on `me` is a member with a stored avatar.
      const info = { [me]: { avatar: { art: mine, fur: '#C4863F', acc: 'none', auto: true } } };
      for (let k = 1; k < 6; k++) {
        const other = seed(i * 11 + k);
        info[other] = {};
        setCircle(info);
        const now = fn('member', me, info[me].avatar);
        checked++;
        if (now !== mine) moved++;
        const theirs = fn('member', other, null);
        if (theirs === mine) lateClash++;
        info[other] = { avatar: { art: theirs, fur: '#C4863F', acc: 'none', auto: true } };
      }
    }
    return { checked, moved, lateClash };
  }

  /* ---- 5. legacy furs: the migration table must not move ------------------------------------- */
  function legacy(fn) {
    const rows = [];
    // A crowded circle on purpose: a stored fur must win over anything the household would prefer.
    const crowd = {};
    ADULT.forEach((sl, i) => { crowd['crowd' + i] = { avatar: { art: sl } }; });
    Object.keys(FUR_TONE).forEach(fur => {
      const uid = 'legacy-' + fur;
      const info = Object.assign({}, crowd); info[uid] = { avatar: { fur: fur, acc: 'crown' } };
      setCircle(info);
      const got = fn('member', uid, info[uid].avatar);
      rows.push({ fur, want: FUR_TONE[fur], got, ok: got.indexOf('av-' + FUR_TONE[fur] + '-') === 0 });
      // and the cub sculpt of the same stored fur
      const bgot = fn('baby', uid, info[uid].avatar);
      rows.push({ fur: fur + ' (cub)', want: FUR_TONE[fur], got: bgot, ok: bgot === 'cub-' + FUR_TONE[fur] });
    });
    return rows;
  }

  /* ---- 6. an explicit pick always wins -------------------------------------------------------- */
  function picker(fn) {
    const bad = [];
    ADULT.forEach(slug => {
      // everyone else already wears this exact bear, so "least used" would never choose it
      const info = {};
      for (let i = 0; i < 5; i++) info['other' + i] = { avatar: { art: slug } };
      const me = 'picker-uid-' + slug;
      info[me] = { avatar: { art: slug, fur: '#C4863F', acc: 'none' } };
      setCircle(info);
      if (fn('member', me, info[me].avatar) !== slug) bad.push(slug);
    });
    return bad;
  }

  /* ---- 7. cubs: siblings and twins ------------------------------------------------------------ */
  function cubs(fn) {
    const out = { distinct3: 0, trials: 0, moved: 0 };
    for (let i = 0; i < 5000; i++) {
      const ids = ['b' + seed(i), 'b' + seed(i + 1e6), 'b' + seed(i + 2e6)];
      state.babies = ids.map(id => ({ id, name: id }));
      const got = ids.map(id => fn('baby', id, null));
      out.trials++;
      if (new Set(got).size === 3) out.distinct3++;
      // a fourth baby arrives: the first three must not move
      state.babies = ids.map((id, n) => ({ id, name: id, avatar: { art: got[n] } }))
        .concat([{ id: 'b-new-' + i, name: 'new' }]);
      const again = ids.map(id => fn('baby', id, { art: got[ids.indexOf(id)] }));
      if (again.join() !== got.join()) out.moved++;
    }
    state.babies = [];
    return out;
  }

  const out = {
    real: {
      spread: spread(A, cfg.nSpread),
      house: households(A, cfg.nHouse),
      four: households(A, cfg.nFour, 4),
      stable: stability(A, cfg.nStable),
      legacy: legacy(A),
      picker: picker(A),
      cubs: cubs(A)
    },
    legacyAlgo: {
      spread: spread(legacyArtFor, cfg.nSpread),
      house: households(legacyArtFor, cfg.nHouse),
      four: households(legacyArtFor, cfg.nFour, 4)
    }
  };

  /* ---- 8. the claim writes our key and nobody else's ------------------------------------------
     Guarded rather than assumed: a build with no claim at all is a finding to report, not a
     crash that throws away the eight measurements above. */
  if (typeof window.cubbyClaimAvatar !== 'function') {
    out.claim = { missing: true, wrote: 0, keys: [], slug: null, expected: null, repeated: 0, overwrotePick: 0, strangerWrote: 0 };
    return out;
  }
  const writes = [];
  const fakeDb = { collection: () => ({ doc: () => ({ update: u => { writes.push(u); return Promise.resolve(); } }) }) };
  const me = 'uid-me-000000000000000000000';
  const you = 'uid-you-00000000000000000000';
  const savedLL = { db: window.LL.db, auth: window.LL.auth, hh: window.LL.householdId };
  window.LL.db = fakeDb;
  window.LL.auth = { currentUser: { uid: me } };
  window.LL.householdId = 'hh-test';
  state.babies = [];
  // (a) a member with no bear yet, in a two-person circle. `expected` is read off the SAME roster
  // the claim will see, or this compares two different households and always fails.
  setCircle({ [me]: {}, [you]: {} });
  const expected = A('member', me, null);
  window.cubbyClaimAvatar();
  const first = writes.slice();
  window.cubbyClaimAvatar();                        // idempotent: a second pass writes nothing
  const afterRepeat = writes.length;
  // (b) a DIFFERENT member who already picked a bear (a fresh uid, so the in-flight guard is not
  // what is being measured here — the stored avatar has to be what stops the write).
  writes.length = 0;
  const mePicked = 'uid-picked-0000000000000000';
  window.LL.auth = { currentUser: { uid: mePicked } };
  setCircle({ [mePicked]: { avatar: { art: 'av-cocoa-b', fur: '#6E4E36', acc: 'none' } }, [you]: {} });
  window.cubbyClaimAvatar();
  const overwrotePick = writes.length;
  // (c) and a member the roster does not know yet: claiming before the household lands would book
  // a bear against a circle of one.
  writes.length = 0;
  window.LL.auth = { currentUser: { uid: 'uid-not-in-roster-00000000' } };
  setCircle({ [me]: {}, [you]: {} });
  window.cubbyClaimAvatar();
  out.claim = {
    wrote: first.length,
    keys: first.map(u => Object.keys(u)[0]),
    slug: first.length ? first[0]['memberInfo.' + me + '.avatar'] : null,
    expected: expected,
    repeated: afterRepeat - first.length,
    overwrotePick: overwrotePick,
    strangerWrote: writes.length
  };
  window.LL.db = savedLL.db; window.LL.auth = savedLL.auth; window.LL.householdId = savedLL.hh;
  return out;
};

const pct = x => (x * 100).toFixed(2) + '%';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));

  const r = await page.evaluate(PROBE, { nSpread: N_SPREAD, nHouse: N_HOUSE, nFour: N_FOUR, nStable: N_STABLE });
  await browser.close();

  if (r.fatal) { console.error('runner error:', r.fatal); process.exit(2); }
  const R = r.real, L = r.legacyAlgo;

  console.log(`\n1. SPREAD — ${R.spread.n.toLocaleString()} uids, each alone in their own circle`);
  check(R.spread.reached === 12, `all 12 adult portraits are reachable`, `${R.spread.reached}/12`);
  check(R.spread.maxShare <= 0.15, `no portrait takes more than 15%`, `busiest ${R.spread.topSlug} ${pct(R.spread.maxShare)} (uniform 8.33%)`);
  console.log('     ' + Object.keys(R.spread.by).sort()
    .map(k => k.replace('av-', '') + ' ' + pct(R.spread.by[k] / R.spread.n)).join('   '));

  console.log(`\n2. HOUSEHOLDS — ${N_HOUSE.toLocaleString()} circles of 2 to 6`);
  check(R.house.reached === 12, `all 12 reached when dealt into circles`, `${R.house.reached}/12`);
  check(R.house.maxShare <= 0.15, `still no portrait over 15%`, `busiest ${R.house.topSlug} ${pct(R.house.maxShare)}`);
  Object.keys(R.house.collision).sort().forEach(k =>
    console.log(`     circle of ${k}: two people match ${pct(R.house.collision[k])} of the time`));

  console.log(`\n3. NO COLLISIONS — ${N_FOUR.toLocaleString()} four-person circles`);
  check(R.four.collision[4] === 0, `every four-person circle shows four different bears`, `repeat rate ${pct(R.four.collision[4])}`);

  console.log(`\n4. STABILITY — ${N_STABLE.toLocaleString()} circles grown from 1 to 6`);
  check(R.stable.moved === 0, `an assigned person never changes bear as the circle grows`, `${R.stable.moved} of ${R.stable.checked} moved`);
  check(R.stable.lateClash === 0, `and a newcomer never lands on a bear already taken`, `${R.stable.lateClash} clashes`);

  console.log(`\n5. LEGACY FURS — the migration table must not move`);
  const badLegacy = R.legacy.filter(x => !x.ok);
  R.legacy.filter((_, i) => i % 2 === 0).forEach(x => console.log(`     ${x.fur} -> ${x.got}`));
  check(badLegacy.length === 0, `all 8 legacy furs (adult + cub) keep their tone`,
    badLegacy.map(x => `${x.fur}->${x.got} want ${x.want}`).join(', '));

  console.log(`\n6. THE PICKER WINS`);
  check(R.picker.length === 0, `an explicit pick survives a circle already full of that bear`, R.picker.join(', '));

  console.log(`\n7. CUBS`);
  check(R.cubs.distinct3 === R.cubs.trials, `three babies in one household are three different cubs`, `${R.cubs.distinct3}/${R.cubs.trials}`);
  check(R.cubs.moved === 0, `and a new baby does not move an older sibling's cub`, `${R.cubs.moved} moved`);

  console.log(`\n8. OWNER-SAFE CLAIM`);
  const c = r.claim;
  check(!c.missing, `the assignment is written down at all (window.cubbyClaimAvatar)`, c.missing ? 'missing: a bear would be recomputed every time the circle changes' : '');
  check(c.wrote === 1, `claiming writes exactly one field`, `${c.wrote}`);
  check(c.keys.every(k => k.indexOf('memberInfo.uid-me-') === 0), `and only our own memberInfo key`, c.keys.join(', '));
  check(!!(c.slug && c.slug.art === c.expected), `the written slug is the one the app renders`, `${c.slug && c.slug.art} vs ${c.expected}`);
  check(c.repeated === 0, `a second pass writes nothing (idempotent)`, `${c.repeated}`);
  check(c.overwrotePick === 0, `it never writes over an existing pick`, `${c.overwrotePick}`);
  check(c.strangerWrote === 0, `and it waits for the roster before claiming anything`, `${c.strangerWrote}`);

  console.log(`\n9. THE GATE HAS TEETH — the v244 hash algorithm, same three checks`);
  console.log(`     reached ${L.spread.reached}/12 slugs, busiest ${L.spread.topSlug} at ${pct(L.spread.maxShare)}`);
  Object.keys(L.house.collision).sort().forEach(k =>
    console.log(`     circle of ${k}: two people match ${pct(L.house.collision[k])} of the time`));
  const legacyFails = (L.spread.reached < 12) || (L.spread.maxShare > 0.15) || (L.four.collision[4] > 0);
  check(legacyFails, `v244's assignment fails checks 1 to 3 (so this gate measures something)`,
    legacyFails ? `${L.spread.reached}/12 reached, four-person repeat ${pct(L.four.collision[4])}` : 'it PASSED, which means this file is not testing anything');

  console.log('\nuncaught page errors:', errs.length); errs.slice(0, 6).forEach(e => console.log('  ✕', e));
  if (errs.length) fails.push(errs.length + ' uncaught page errors');
  console.log(fails.length ? `\nAVATAR: FAIL ❌  (${fails.length})\n  - ` + fails.join('\n  - ') : '\nAVATAR: PASS ✅');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('runner error:', e.message); process.exit(2); });
