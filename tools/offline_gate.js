// Gate for the connectivity states: the ones a lost signal actually strands a parent in, and the
// sentences Cubby says while it is happening.
//
// Cubby is offline-first for logging, so most failures are NOT errors: a write lands in the local
// Firestore cache and syncs itself later, and dressing that up as a problem is the alarm-about-nothing
// the charter forbids. Only three places genuinely leave somebody with nothing to look at, and those
// are what this covers:
//
//   1. The SDK did not load (app/firebase-init.js). window.LL never exists, the boot state machine
//      never starts, and nothing in the app can repaint over it. The guard now also tests auth and
//      firestore, because the four SDK files are four separate requests: a connection that drops
//      midway used to satisfy `firebase.initializeApp` and then throw OUTSIDE the try, leaving a dead
//      screen with no card at all.
//   2. Signed in, but her household could not be read (app/store-firebase.js). This used to fall
//      through to the marketing landing with "Continue with Google" over the top of a parent who IS
//      signed in, which reads as "you have been logged out and your data is gone". Both frightening
//      and untrue.
//   3. The guest games page (g/index.html), where a grandmother has no app and no service worker.
//      Every failure path there wiped the whole body, so one blip during the 20-second poll replaced
//      her rendered game and her confirmed guess with a bare line and nothing to tap.
//
// It also holds the honesty line. "Cubby will pick this up when you're back" is a guarantee backed by
// enablePersistence, and it is true of a queued write. It is false of a sign-in link, and the
// translator used to say it for both. The promise is opt-in now, so the default cannot lie.
//
//   node tools/serve.js &   &&   node tools/offline_gate.js [baseUrl]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const ROOT = path.join(__dirname, '..');
const DAY = 86400000;

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '  ' + d : ''))); };

const SEED = {
  babies: [{ id: 'b1', name: 'Aria', birth: Date.now() - 40 * DAY, sex: 'F', country: 'uk', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { install: 1, home: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

  console.log('\n1. the artwork is there when the network is not');
  const sw = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8');
  ck(/'\/app\/spot-art\/offline_balloon\.webp'/.test(sw),
    'the balloon is in the service worker precache list');
  ck(fs.existsSync(path.join(ROOT, 'app/spot-art/offline_balloon.webp')), 'and the file exists');
  const bytes = fs.readFileSync(path.join(ROOT, 'app/spot-art/offline_balloon.webp'));
  // A WebP with alpha carries an ALPH chunk. Without one the balloon keeps the white ground it was
  // painted on for the poster's multiply compositing, and --spot-paper is transparent in Night, so it
  // would render as a glaring white disc on a dark screen.
  ck(bytes.includes(Buffer.from('ALPH')), 'and it is cut out (has an alpha channel), not on white paper');
  ck(bytes.length < 60000, 'and it is small enough to precache without thought (' + Math.round(bytes.length / 1024) + 'KB)');
  const spotArt = fs.readdirSync(path.join(ROOT, 'app/spot-art')).filter(f => f.endsWith('.webp'));
  const precached = spotArt.filter(f => sw.indexOf('/app/spot-art/' + f) > -1);
  ck(precached.length === 1, 'and it is the ONLY illustration precached — the other ' + (spotArt.length - 1)
    + ' belong to screens reached with a connection', JSON.stringify(precached));

  console.log('\n2. the SDK failed to load');
  // Drive the real guard with a partial SDK: firebase-app landed, firebase-firestore did not.
  const p1 = await b.newPage();
  await p1.setViewport({ width: 390, height: 850 });
  await p1.goto(BASE + '/app/', { waitUntil: 'networkidle2' });
  const partial = await p1.evaluate(async (base) => {
    // Rebuild the pre-boot situation: a partial `firebase` global, then run firebase-init.js again.
    document.body.innerHTML = '<div id="llAuthOv"></div>';
    window.firebase = { initializeApp: function () { } };   // no .auth, no .firestore
    delete window.cubbyConnCard;
    const src = await (await fetch(base + '/app/firebase-init.js')).text();
    try { new Function(src)(); } catch (e) { return { threw: e.message }; }
    const ov = document.getElementById('llAuthOv');
    const btn = ov.querySelector('.es-cta');
    return {
      threw: null,
      painted: !!ov.querySelector('.conn-card'),
      art: (ov.querySelector('.es-balloon') || {}).getAttribute ? ov.querySelector('.es-balloon').getAttribute('src') : null,
      title: (ov.querySelector('.conn-card p') || {}).textContent || null,
      role: (ov.querySelector('.conn-card') || {}).getAttribute ? ov.querySelector('.conn-card').getAttribute('role') : null,
      btnLabel: btn ? btn.textContent.trim() : null,
      btnHeight: btn ? btn.getBoundingClientRect().height : null,
      inlineHex: /#[0-9A-Fa-f]{6}/.test(ov.innerHTML),
    };
  }, BASE);
  ck(!partial.threw, 'a partial SDK does not throw', partial.threw || '');
  ck(partial.painted, 'it paints the connectivity card');
  ck(partial.art === '/app/spot-art/offline_balloon.webp', 'with the balloon', String(partial.art));
  ck(partial.role === 'status', 'announced to a screen reader (role=status)', String(partial.role));
  ck(!partial.inlineHex, 'and with no hardcoded colours, so Night is readable');
  ck(partial.btnLabel === 'Try again', 'there is a way out', String(partial.btnLabel));
  ck(partial.btnHeight >= 44, 'and it meets the 44px touch target', String(partial.btnHeight));
  await p1.close();

  console.log('\n3. the words');
  const p2 = await b.newPage();
  await p2.setViewport({ width: 390, height: 850 });
  await p2.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2' });
  await p2.evaluate(s => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', 'light');
  }, SEED);
  await p2.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1800));
  const words = await p2.evaluate(() => {
    const off = { code: 'unavailable' };
    const t = window.cubbyErrText;
    const card = window.cubbyConnCard({ title: 'We can’t reach your Cubby', body: 'You look offline. Anything already saved on this phone is still here, safe. Try again once you have a connection.' });
    const el = document.createElement('div'); el.innerHTML = card;
    return {
      queued: t(off, 'fallback', true),
      notQueued: t(off, 'fallback'),
      isConn: !!(window.cubbyIsConnErr && window.cubbyIsConnErr(off)),
      cardText: el.textContent.replace(/\s+/g, ' ').trim(),
    };
  });
  ck(/pick this up when you/.test(words.queued), 'a queued write keeps the promise', words.queued);
  ck(!/pick this up when you/.test(words.notQueued), 'a server round trip does NOT get the promise', words.notQueued);
  ck(/needs a connection/.test(words.notQueued), 'it says what is actually true instead', words.notQueued);
  ck(words.isConn, 'the connectivity test is shared, not duplicated');
  const allCopy = [words.queued, words.notQueued, words.cardText].join(' ');
  // DESIGN.md A7 and the charter: no em-dash, no shouting, no alarm, no blame, no jargon.
  ck(allCopy.indexOf('—') === -1, 'no em-dash');
  ck(!/!/.test(allCopy), 'no exclamation mark');
  ck(!/\b(error|failed|failure|network error|retry)\b/i.test(allCopy), 'no jargon and no blame words', allCopy);
  ck(/safe|still here|saved/i.test(words.cardText),
    'and the card answers the question she actually has, which is whether her entries are safe', words.cardText);
  await p2.close();

  console.log('\n4. the guest games page, with the API blocked');
  const p3 = await b.newPage();
  await p3.setViewport({ width: 390, height: 850 });
  await p3.setRequestInterception(true);
  p3.on('request', r => (/\/api\//.test(r.url()) ? r.abort() : r.continue()));
  await p3.goto(BASE + '/g/index.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1200));
  const guest = await p3.evaluate(() => {
    const body = document.getElementById('body');
    const btn = document.getElementById('goffRetry');
    return {
      card: !!body.querySelector('.goff'),
      art: (body.querySelector('.goff img') || {}).getAttribute ? body.querySelector('.goff img').getAttribute('src') : null,
      text: body.textContent.replace(/\s+/g, ' ').trim(),
      retry: !!btn,
      retryH: btn ? btn.getBoundingClientRect().height : null,
    };
  });
  ck(guest.card, 'a failed first load gets the illustrated state');
  ck(guest.art === '/app/spot-art/offline_balloon.webp', 'with the same balloon', String(guest.art));
  ck(guest.retry, 'and a real Try again button, which this page never had');
  ck(guest.retryH >= 44, 'at 44px', String(guest.retryH));
  ck(!/error|failed/i.test(guest.text), 'no blame words here either', guest.text);

  // The important one: a blip during the 20s poll must not wipe what she is looking at.
  const kept = await p3.evaluate(async () => {
    window.guestGame.renderHub({
      title: 'Our baby', closed: false,
      games: [{ id: 'g1', type: 'sex', prompt: 'Boy or girl?', tally: { F: 2, M: 1 }, guesses: [] }]
    });
    const before = document.getElementById('body').textContent.replace(/\s+/g, ' ').trim();
    const hadContent = window.guestGame.gotContent();
    window.guestGame.loadHub();                       // the API is still blocked
    await new Promise(r => setTimeout(r, 700));
    const body = document.getElementById('body');
    return {
      hadContent, before,
      after: body.textContent.replace(/\s+/g, ' ').trim(),
      wiped: !!body.querySelector('.goff'),
      // The class the game renders under depends on how far this guest has got (nickname form, cards,
      // or the reveal), so the test is that HER content survived, not which shape it took. The quiet
      // line is inserted INTO the re-rendered game, so it has to come out before comparing.
      keptEverything: (function () {
        const f = body.querySelector('.mine');
        const t = body.textContent.replace(/\s+/g, ' ').trim();
        return (f ? t.replace(f.textContent.replace(/\s+/g, ' ').trim(), '') : t).trim() === before;
      })(),
      told: !!body.querySelector('.mine'),
    };
  });
  ck(kept.hadContent, 'with a game on screen, gotContent() says so');
  ck(!kept.wiped, 'a failed refresh does NOT replace it with the offline card');
  ck(kept.keptEverything, 'every word she was looking at is still there', kept.after.slice(0, 100));
  ck(kept.told, 'and she is told quietly, in a line that clears itself');
  await p3.close();

  console.log('\n5. the guest games page, when the server answers badly');
  /* Not the same thing as a dead connection, and it used to be treated worse: every one of these
     paths called msg(), which rewrites the whole body. A 500 during the 20-second poll, or a hub
     poll that 404s and falls through to the legacy endpoint, wiped a rendered game. */
  const serve = async (status, body) => {
    const pg = await b.newPage();
    await pg.setViewport({ width: 390, height: 850 });
    await pg.setRequestInterception(true);
    pg.on('request', r => (/\/api\//.test(r.url())
      ? r.respond({ status, contentType: 'application/json', body: body || '{}' })
      : r.continue()));
    await pg.goto(BASE + '/g/index.html', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 900));
    return pg;
  };
  const HUB = JSON.stringify({
    title: 'Our baby', closed: false,
    games: [{ id: 'g1', type: 'sex', prompt: 'Boy or girl?', tally: { F: 2, M: 1 }, guesses: [] }]
  });
  const afterPoll = async (status, label) => {
    const pg = await serve(status);
    const out = await pg.evaluate(async (hub) => {
      window.guestGame.renderHub(JSON.parse(hub));
      const body = document.getElementById('body');
      const before = body.textContent.replace(/\s+/g, ' ').trim();
      window.guestGame.loadHub();                    // the API now answers with the failure status
      await new Promise(r => setTimeout(r, 700));
      const f = body.querySelector('.mine');
      const t = body.textContent.replace(/\s+/g, ' ').trim();
      return {
        before,
        kept: (f ? t.replace(f.textContent.replace(/\s+/g, ' ').trim(), '') : t).trim() === before,
        wiped: /Game not found|Could not reach|Almost ready/.test(t),
        told: !!f,
      };
    }, HUB);
    await pg.close();
    ck(out.kept && !out.wiped, label, out.wiped ? 'replaced with a message' : 'kept');
    ck(out.told, '  and says so quietly instead');
  };
  await afterPoll(500, 'a 500 during the poll keeps her game');
  // The important one: a 404 on the hub endpoint used to fall through to the legacy game, which 404s
  // too, ending in "Game not found" over the top of a hub that was fine a second ago.
  await afterPoll(404, 'a 404 during the poll does not probe the legacy game and declare it missing');

  const refused = await (async () => {
    const pg = await serve(500);
    const out = await pg.evaluate(async () => {
      window.guestGame.renderLegacy({ title: 'Our baby', tally: { F: 1, M: 0 } });
      const body = document.getElementById('body');
      const nick = document.getElementById('nick'); if (nick) nick.value = 'Nana';
      const had = !!body.querySelector('.picks');
      window.guestGame.submitLegacy('F');
      await new Promise(r => setTimeout(r, 700));
      return { had, stillHasBoard: !!body.querySelector('.picks'), told: !!body.querySelector('.mine') };
    });
    await pg.close();
    return out;
  })();
  ck(refused.had, 'a legacy board renders in this check');
  ck(refused.stillHasBoard, 'a refused guess leaves the board up rather than replacing it');
  ck(refused.told, '  and tells her the guess did not save');

  // And the genuine dead end is unchanged: nothing rendered, the game really is gone.
  const gone = await (async () => {
    const pg = await serve(404);
    const out = await pg.evaluate(async () => {
      await new Promise(r => setTimeout(r, 400));
      return document.getElementById('body').textContent.replace(/\s+/g, ' ').trim();
    });
    await pg.close();
    return out;
  })();
  ck(/Game not found/.test(gone), 'with nothing on screen, a missing game still says so plainly', gone.slice(0, 70));

  console.log('\n6. nothing that queues was promoted to an error');
  const store = fs.readFileSync(path.join(ROOT, 'app/store-firebase.js'), 'utf8');
  ck(/Cubby will sync when you’re back/.test(store),
    'the gentle push-failure toast is untouched: a queued write stays a toast, never a full state');
  ck(!/cubbyConnCard/.test(store.split('function pushNow')[1] || ''),
    'and the write path does not reach for the connectivity card');
  /* Every failure to SEND a sign-in email must read as a plain failure, never as "queued, we will
     sync later" — there is no queue behind it and telling a locked-out parent to wait is the cruellest
     possible wrong answer. Matched on the shape rather than one exact sentence: this used to pin the
     literal 'Could not send the link just now', which went stale the moment that copy was reworded and
     then reported 'not found', i.e. it stopped checking anything while still looking like a check. */
  const sendCatches = [...store.matchAll(/errText\(err, 'Could not send [^']*'[^)]*\)/g)].map((m) => m[0]);
  ck(sendCatches.length > 0, 'the sign-in send failure path is still findable', sendCatches.length);
  ck(sendCatches.every((c) => !/,\s*true\s*\)/.test(c)),
    'sending a sign-in email does not claim a queue', sendCatches.join(' | ') || 'not found');

  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
