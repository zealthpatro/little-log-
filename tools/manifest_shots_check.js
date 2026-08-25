#!/usr/bin/env node
/* The three screenshots a parent sees at the moment she decides.
 *
 * WHAT WAS WRONG. app/manifest.webmanifest declared icons/screenshots/{track,vaccines,circle}.png,
 * and all three were drawn by tools/gen_pwa_screenshots.py: a warm gradient, a bear, and a faux log
 * card reading "Feed / left side, 12 min" typed in Arial. They are posters about Cubby, not Cubby.
 * They are what Chrome's install sheet and every PWA directory show while she is choosing, so the
 * two things Cubby is genuinely alone in doing were invisible at the only moment they could have
 * won her: a timeline that says which of two people logged each entry, a wellbeing note that is
 * never shared with anyone, and the quiet screen a parent lands on after a pregnancy ends with no
 * baby to come back to. Everything she did see was a claim rather than the product.
 *
 * WHAT THIS PROVES. Not that three files exist. It re-renders each screen from the app running at
 * the URL you pass, checks the promise in the manifest label is on screen IN THE FRAME, and then
 * compares the shipped PNG pixel for pixel against that live capture. A poster dropped back in, a
 * screen that quietly changed, a shot taken of the wrong tab: all three go red here.
 *
 *   PORT=9427 node tools/serve.js &
 *   node tools/manifest_shots_check.js http://localhost:9427
 *   node tools/manifest_shots_check.js --self-test     (the declaration alone, no browser)
 *
 * Regenerate the images with: node tools/gen_manifest_shots.js http://localhost:9427
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const SCENES = require(__dirname + '/manifest_shot_scenes.js');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..');
const SHOTS_DIR = path.join(ROOT, 'icons', 'screenshots');
const MANIFEST = path.join(ROOT, 'app', 'manifest.webmanifest');
const BASE = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

/* Every block is wrapped. A gate that dies on a raw TypeError the moment the thing it checks is
   missing reports exit 2 and half its assertions never run, which understates the breakage on
   exactly the reverted code it is supposed to describe. */
const block = async (name, fn) => {
  console.log('\n' + name);
  try { await fn(); } catch (e) { fail++; console.log('  FAIL block threw: ' + (e && e.message)); }
};

// The three drawn posters. Naming them is the point: if one ever comes back, this says so.
const POSTERS = ['track.png', 'vaccines.png', 'circle.png'];

/* Read straight out of the PNG header rather than shelling out to `sips`. sips is macOS only, and
   this whole section is the part that is supposed to run without a browser: on the Linux CI box the
   old version threw ENOENT, so even --self-test could not run there and the gate scored nothing at
   all. Bytes 12..15 are the IHDR tag, 16..19 width big-endian, 20..23 height. The signature is
   checked so a truncated or non-PNG file fails here, loudly, instead of reporting NaN. */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const px = (f) => {
  const b = fs.readFileSync(f);
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG_SIG) || b.toString('latin1', 12, 16) !== 'IHDR') {
    throw new Error(f + ' is not a PNG (no IHDR header)');
  }
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

/* ---------------------------------------------------------------------------------------------
   1. The declaration. Runs with or without a browser, so --self-test can check it on its own.
   --------------------------------------------------------------------------------------------- */
function checkDeclaration() {
  const raw = fs.readFileSync(MANIFEST, 'utf8');
  let m = null, parsed = true;
  try { m = JSON.parse(raw); } catch (e) { parsed = false; }
  ok('the manifest is valid JSON', parsed);
  if (!parsed) return [];

  const shots = m.screenshots || [];
  // Counted, not just .every()d. An empty array satisfies every predicate below it and would have
  // let a manifest declaring no screenshots at all walk through this whole section green.
  ok('it declares exactly 3 screenshots', shots.length === 3, shots.length);
  ok('all 3 are form_factor narrow', shots.length === 3 && shots.every((s) => s.form_factor === 'narrow'),
    shots.map((s) => s.form_factor));

  const srcs = shots.map((s) => s.src || '');
  const stillPosters = srcs.filter((s) => POSTERS.some((p) => s.endsWith(p)));
  ok('none of them is one of the drawn marketing posters', stillPosters.length === 0, stillPosters);

  const files = srcs.map((s) => path.join(ROOT, s.replace(/^\//, '')));
  const missing = files.filter((f) => !fs.existsSync(f));
  ok('every declared file exists on disk', files.length === 3 && missing.length === 0, missing);
  if (missing.length) return [];

  const dims = files.map(px);
  const wrongSize = shots.filter((s, i) => s.sizes !== dims[i].w + 'x' + dims[i].h)
    .map((s, i) => s.sizes + ' declared');
  ok('the declared sizes match the actual pixels', wrongSize.length === 0,
    shots.map((s, i) => s.sizes + ' vs ' + dims[i].w + 'x' + dims[i].h));

  /* Chrome's richer install UI drops screenshots outside these bounds, silently, and falls back to
     the plain install bar. Then the whole exercise buys nothing. */
  const inRange = dims.filter((d) => d.w >= 320 && d.w <= 3840 && d.h >= 320 && d.h <= 3840);
  ok('every side is inside Chrome install-sheet range (320..3840)', dims.length === 3 && inRange.length === 3, dims);
  const ratios = dims.map((d) => Math.max(d.w, d.h) / Math.min(d.w, d.h));
  ok('the long side is under 2.3x the short side', ratios.length === 3 && ratios.every((r) => r <= 2.3),
    ratios.map((r) => r.toFixed(3)));
  ok('all three share one aspect ratio', ratios.length === 3 && Math.max(...ratios) - Math.min(...ratios) < 0.001,
    ratios.map((r) => r.toFixed(3)));

  const labels = shots.map((s) => s.label || '');
  ok('every screenshot carries a label', labels.length === 3 && labels.every((l) => l.length > 0), labels);
  // House voice: no em-dashes anywhere a parent reads.
  const dashed = labels.filter((l) => /[—–]/.test(l));
  ok('no em-dashes in the labels', dashed.length === 0, dashed);
  const shouty = labels.filter((l) => l.length > 100);
  ok('no label runs past 100 characters', shouty.length === 0, shouty);

  /* The Anxiety Test, written down so a machine can hold it.
     These three strings live in Chrome's install sheet. The reader is overwhelmingly a woman who is
     pregnant right now, who did not ask a question, and who cannot look away from a shop window she
     is standing in. A label may promise what Cubby DOES. It may not tell her how her own story ends.
     The first cut of shot 3 read "Not every journey ends happily", which names a reader's worst fear
     at her, unprompted, at the one moment she is least able to put it down. */
  const PROPHECY = [/ends?\s+happily/i, /end\s+(?:well|badly)/i, /go(?:es)?\s+wrong/i,
    /lose\s+(?:your|the|a)\s+(?:baby|pregnancy)/i, /(?:might|may)\s+not\s+make\s+it/i,
    /worst\s+happens/i, /not\s+every\s+(?:journey|pregnancy|story)/i];
  const foretold = labels.filter((l) => PROPHECY.some((r) => r.test(l)));
  ok('no label tells a parent how her own story ends', foretold.length === 0, foretold);

  /* The labels and the scenes have to agree about what each picture is of, or the gate below is
     grading a promise nobody made. */
  const sceneLabels = SCENES.SHOTS.map((s) => s.label);
  ok('the manifest labels are the ones the scenes describe',
    labels.length === 3 && sceneLabels.length === 3 && labels.every((l, i) => l === sceneLabels[i]),
    { manifest: labels, scenes: sceneLabels });
  const sceneFiles = SCENES.SHOTS.map((s) => '/icons/screenshots/' + s.file + '.png');
  ok('and it points at the files the scenes write',
    srcs.length === 3 && srcs.every((s, i) => s === sceneFiles[i]), { manifest: srcs, scenes: sceneFiles });

  return files;
}

if (process.argv[2] === '--self-test') {
  console.log('\nself-test: the manifest declaration on its own, no browser');
  checkDeclaration();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'MANIFEST-SHOTS SELF-TEST: FAIL' : 'MANIFEST-SHOTS SELF-TEST: PASS');
  process.exit(fail ? 1 : 0);
}
if (!BASE) {
  console.error('usage: node tools/manifest_shots_check.js http://localhost:<your port>\n' +
    '       the base URL is required on purpose: a default port grades whichever checkout happens\n' +
    '       to be serving on it, and this project has already shipped a gate that graded the wrong tree.');
  process.exit(2);
}

/* Mean absolute greyscale difference between two PNGs, 0 (identical) to 255, measured in the page
   because the browser is the only PNG decoder here. Downscaled first: comparing 1170x2532 raw would
   fail on a one-pixel antialiasing wobble and tell nobody anything. */
async function meanDiff(page, aDataUrl, bDataUrl) {
  return page.evaluate(async (a, b) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const W = 96, H = 208;
    const grey = async (src) => {
      const img = await load(src);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data, g = new Float64Array(W * H);
      for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      return g;
    };
    const [ga, gb] = [await grey(a), await grey(b)];
    let s = 0; for (let i = 0; i < ga.length; i++) s += Math.abs(ga[i] - gb[i]);
    return s / ga.length;
  }, aDataUrl, bDataUrl);
}

(async () => {
  console.log('\n1. what the manifest declares');
  const files = checkDeclaration();

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument(SCENES.pinClock, SCENES.OFFSET);
  await page.setViewport(SCENES.VIEWPORT);

  for (const s of SCENES.SHOTS) {
    await block('2. ' + s.file + ' really is "' + s.why + '"', async () => {
      await SCENES.stage(page, BASE, s, sleep);
      const seen = (await SCENES.onScreenText(page)).toLowerCase();
      const missing = s.must.filter((x) => seen.indexOf(x.toLowerCase()) < 0);
      // Counted against the list length, because [].every() is true and a scene that lost its must
      // list would otherwise pass this line by having nothing to check.
      ok('the label\'s promise is in the frame (' + s.must.length + ' phrases)',
        s.must.length >= 2 && missing.length === 0, missing);
      const notList = s.mustNot || [];
      const banned = notList.filter((x) => seen.indexOf(x.toLowerCase()) >= 0);
      // Length-gated like the must line above it. Shot 2 shipped with mustNot: [], so this assertion
      // was .every() over nothing: a free pass on the one screenshot whose entire claim is an absence.
      ok('nothing that must not be in the frame is (' + notList.length + ' named)',
        notList.length >= 1 && banned.length === 0, banned);

      const shipped = files.find((f) => f.endsWith(s.file + '.png'));
      ok('the manifest ships a file for this scene', !!shipped, s.file);
      if (!shipped) return;
      const live = await page.screenshot({ encoding: 'base64' });
      const d = await meanDiff(page,
        'data:image/png;base64,' + live,
        'data:image/png;base64,' + fs.readFileSync(shipped).toString('base64'));
      /* 6/255 is roughly "the same screen, re-rendered". The drawn posters this replaces sit around
         40 against any of these, and a shot of the wrong tab is further still. Printed either way so
         a drift that is creeping toward the line is visible before it crosses it. */
      ok('the shipped PNG is this screen (mean grey diff ' + d.toFixed(2) + ', limit 6)', d < 6, d);
    });
  }

  await block('3. no data: the two-names claim cannot be captured from an empty account', async () => {
    /* The seeded day first, counted, because "zero rows on an empty account" proves nothing on its
       own: a build where authorTag returned '' for everyone would also score zero and this block
       would sail through green while shot 1 shipped a timeline with no names on it at all. */
    await SCENES.stage(page, BASE, SCENES.SHOTS[0], sleep);
    const full = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.tl-by')].map((n) => n.innerText.trim());
      return { rows: rows.length, names: [...new Set(rows)].length };
    });
    // Counted against the seed rather than a literal, so extending the day does not quietly relax it.
    const seeded = SCENES.SHOTS[0].seed.events;
    ok('every seeded entry carries a "logged by" line (' + seeded.length + ' of them)',
      seeded.length >= 20 && full.rows === seeded.length, { seeded: seeded.length, rows: full.rows });
    ok('and they are two different people, not one', full.names === 2, full);

    const empty = Object.assign({}, SCENES.SHOTS[0].seed, { events: [] });
    await SCENES.stage(page, BASE, Object.assign({}, SCENES.SHOTS[0], { seed: empty }), sleep);
    const n = await page.evaluate(() => document.querySelectorAll('.tl-by').length);
    ok('with no entries there is no "logged by" line anywhere', n === 0, n);
    const seen = (await SCENES.onScreenText(page)).toLowerCase();
    ok('and neither name is on the screen', seen.indexOf('mama bear') < 0 && seen.indexOf('papa bear') < 0);
  });

  await block('4. someone else\'s data: the private note refuses to open for a non-owner', async () => {
    await SCENES.stage(page, BASE, SCENES.SHOTS[1], sleep);
    /* #sheet.show, not .sheet. The sheet element is permanent markup that is translated a full
       height below the fold and slid back up by the class, so counting .sheet counts one open sheet
       forever and this assertion read 1 against a screen that was showing nothing. */
    const before = await page.evaluate(() => document.querySelectorAll('#sheet.show').length);
    ok('the owner can open it', before === 1, before);
    await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
    await sleep(600);   // the sheet slides out over .36s; reading before it lands measures the animation
    const after = await page.evaluate(() => {
      // matIsOwner is what pregIsOwner asks. This is the partner in the same circle, not a stranger.
      window.LL.matIsOwner = () => false;
      let threw = null;
      try { openMoodNote(); } catch (e) { threw = String((e && e.message) || e); }
      return { sheets: document.querySelectorAll('#sheet.show').length, threw: threw };
    });
    ok('a caregiver in the same circle gets no sheet at all', after.sheets === 0, after);
    /* Zero sheets is an absence, and a refusal and a crash both produce it. Only one of them is the
       product working, and the pairing this line used to lean on was measured on a different
       staging entirely. So: it must not have thrown, and flipping the ONE thing that changed must
       open it again on this same page. That makes ownership the only available explanation. */
    ok('and it refused rather than crashed on the way', after.threw === null, after.threw);
    const back = await page.evaluate(() => {
      window.LL.matIsOwner = () => true;
      try { openMoodNote(); } catch (e) {}
      return document.querySelectorAll('#sheet.show').length;
    });
    ok('and ownership is the only reason it refused', back === 1, back);
    await page.evaluate(() => { window.LL.matIsOwner = () => false; try { closeSheet(); } catch (e) {} });
    await sleep(600);
    const seen = (await SCENES.onScreenText(page)).toLowerCase();
    ok('and none of her notes is on the screen',
      seen.indexOf('did not sleep much') < 0 && seen.indexOf('waiting on the scan date') < 0);
  });

  await block('5. a second save: the promise is not a first-run line', async () => {
    await SCENES.stage(page, BASE, SCENES.SHOTS[1], sleep);
    const kept = await page.evaluate(() => {
      const box = document.querySelector('#moodNote');
      if (box) box.value = 'A second one, later the same week.';
      saveMoodNote();
      return (state.pregnancy.moodLog || []).length;
    });
    ok('the note saved (4 now, 3 seeded)', kept === 4, kept);
    await page.evaluate(() => { openMoodNote(); });
    await sleep(500);
    const seen = await SCENES.onScreenText(page);
    ok('the never-shared sentence is still on the sheet the second time',
      seen.toLowerCase().indexOf('never shared with anyone in your circle, ever') >= 0);
    ok('and the new note is in "Just for you"', seen.indexOf('A second one, later the same week.') >= 0);
  });

  await block('6. a stage boundary: the quiet screen belongs to the parent with no baby', async () => {
    /* renderLossHolding takes over only while state.babies is empty. A surviving twin must NOT be
       shown the bereavement screen instead of her own baby's day, and the same rule the other way
       round is why the quiet line exists on Home. Getting this wrong would ship a screenshot of a
       state a parent can be trapped in. */
    const withBaby = Object.assign({}, SCENES.SHOTS[2].seed, {
      babies: [{ id: 'b1', name: 'Bo', birth: SCENES.CLOCK - 40 * SCENES.DAY, sex: 'F', routines: [], allergies: [] }],
      activeBabyId: 'b1',
    });
    await SCENES.stage(page, BASE, Object.assign({}, SCENES.SHOTS[2], { seed: withBaby, go: async () => {} }), sleep);
    const seen = await SCENES.onScreenText(page);
    ok('with a baby in the house the holding screen does not take over',
      seen.indexOf('Take all the time you need') < 0, seen.slice(0, 120));
    ok('she gets her baby\'s own screen', /\bBo\b/.test(seen), seen.slice(0, 120));
    /* Not silence, either. Quiet mode has to be visible and exitable or the only signal she has is
       the absence of things. */
    ok('and Cubby still says it is keeping things quiet', /keeping things quiet/i.test(seen), seen.slice(0, 200));
  });

  await block('7. a reload: the quiet screen is still there in the morning', async () => {
    await SCENES.stage(page, BASE, SCENES.SHOTS[2], sleep);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1600);
    const seen = await SCENES.onScreenText(page);
    ok('it survives a reload', seen.indexOf('Take all the time you need') >= 0, seen.slice(0, 160));
    ok('and the upbeat chooser has still not replaced it', seen.indexOf('Where are you on the journey') < 0);
  });

  await block('8. the harness is signed in, the way every reader of this screen is', async () => {
    /* The one class of defect this gate is structurally blind to: the generator and this gate share
       manifest_shot_scenes.js, so anything the harness gets wrong about the SHAPE of a production
       session is baked identically into both sides and the pixel compare scores it 0.00.
       It happened. The scene stubbed the signed-in user by assigning LL.auth.currentUser, which is a
       getter-only accessor, so the assignment vanished in sloppy mode and authorTag()'s " (you)"
       branch never ran. The shipped PNG was a timeline in which nobody is you, which is a state no
       production reader can reach: firebase-init.js always sets LL.auth and memberInfo is only ever
       populated for a signed-in member. Against the harness re-render it measured 0.07 of a limit of
       6, so the picture compare had nothing to say. Only this block does. */
    await SCENES.stage(page, BASE, SCENES.SHOTS[0], sleep);
    const who = await page.evaluate(() => ({
      uid: (window.LL && window.LL.auth && window.LL.auth.currentUser && window.LL.auth.currentUser.uid) || null,
      mine: (typeof myUid === 'function') ? myUid() : null,
      rows: [...document.querySelectorAll('.tl-by')].map((n) => n.innerText.trim()),
    }));
    ok('there is a signed-in user, not a null one', who.uid !== null, who.uid);
    ok('and it is the uid the seed files Maya\'s entries under', who.uid === 'local' && who.mine === 'local',
      { currentUser: who.uid, myUid: who.mine });
    const seeded = SCENES.SHOTS[0].seed.events;
    const hers = seeded.filter((e) => e.authorId === 'local').length;
    const his = seeded.filter((e) => e.authorId === 'uidPapa').length;
    const you = who.rows.filter((r) => /\(you\)/.test(r)).length;
    ok('so every one of Maya\'s own rows says "(you)" (' + hers + ')', you === hers, { expected: hers, got: you });
    ok('and none of Sam\'s does (' + his + ')', who.rows.length - you === his,
      { expected: his, got: who.rows.length - you });
  });

  await block('9. the seeded day is a day a real baby had', async () => {
    /* This is the one screen where the DATA is the marketing. An earlier cut of the seed reached
       about twelve hours back, so the timeline drew "Yesterday · 1 feed · 3h 12m sleep · 0 nappies"
       under a baby captioned two months old: a truncated half day rendered as a whole one. No copy
       states a verdict, but the numbers imply one, and to any parent who knows newborn norms that
       line is a baby who needs a hospital. In an install sheet a first-time parent has nothing to
       compare it against. Today is exempt, because at 09:41 today is genuinely half over. */
    await SCENES.stage(page, BASE, SCENES.SHOTS[0], sleep);
    const days = await page.evaluate(() => [...document.querySelectorAll('.day-group')].map((g) => {
      const head = g.querySelector('.day-head');
      const sum = g.querySelector('.day-sum');
      return {
        day: ((head && head.firstChild && head.firstChild.nodeValue) || '').trim(),
        sum: ((sum && sum.textContent) || '').trim(),
      };
    }));
    ok('the timeline covers more than the half day that has happened so far', days.length >= 2,
      days.map((d) => d.day));
    const read = (s) => {
      const hm = s.match(/(?:(\d+)h\s*)?(?:(\d+)m)?\s*sleep/) || [];
      return {
        feeds: +((s.match(/(\d+)\s*feeds?/) || [])[1] || 0),
        nappies: +((s.match(/(\d+)\s*(?:nappies|nappy)/) || [])[1] || 0),
        sleepH: (+(hm[1] || 0)) + (+(hm[2] || 0)) / 60,
      };
    };
    const fullDays = days.slice(1).map((d) => Object.assign({ day: d.day, sum: d.sum }, read(d.sum)));
    ok('there is at least one whole day under today to judge', fullDays.length >= 1, days.map((d) => d.day));
    /* Deliberately loose floors. They are not clinical advice and they are not shown to anyone; they
       only have to be low enough that no ordinary day trips them and high enough that a half day
       drawn as a whole one cannot get past. */
    const starved = fullDays.filter((d) => d.feeds < 6);
    ok('no whole day in the shot shows fewer than 6 feeds', starved.length === 0, starved);
    const dry = fullDays.filter((d) => d.nappies < 5);
    ok('and none shows fewer than 5 nappies', dry.length === 0, dry);
    const awake = fullDays.filter((d) => d.sleepH < 10);
    ok('and none shows under 10 hours of sleep', awake.length === 0,
      awake.map((d) => d.day + ': ' + d.sum));
  });

  /* "No page errors" is an absence, and an absence is worth nothing unless the listener that would
     have caught one is known to be alive. Throw one on purpose, confirm it landed, then set it aside
     and judge the rest. */
  await page.evaluate(() => { setTimeout(() => { throw new Error('cubby-gate-liveness-probe'); }, 0); });
  await sleep(400);
  const probe = errs.filter((e) => e.indexOf('cubby-gate-liveness-probe') >= 0).length;
  ok('the page-error listener is awake (it caught a deliberate throw)', probe === 1, probe);
  const real = errs.filter((e) => e.indexOf('cubby-gate-liveness-probe') < 0);
  ok('no page errors throughout', real.length === 0, real.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'MANIFEST-SHOTS: FAIL' : 'MANIFEST-SHOTS: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
