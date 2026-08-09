// Gate for where the Notes lane sits on home, and when it is allowed to ask for attention.
//
// A note is the one thing on this screen another person put there. That earns it the top of the
// page on the days it exists, and nothing on the days it does not: before this, a heading, a prompt
// to write something and a quote of the day sat above the parent's own baby, every single day.
// Generic filler in a prominent slot teaches people to scroll past that slot, which is the worst
// possible outcome for the only place a second caregiver can reach them.
//
// So the assertions are about position and restraint:
//   - no note today  -> the card is at the BOTTOM of home (moved, never removed)
//   - a note today   -> the card is above Quick log, on the first screen
//   - "new" counts only what SOMEBODY ELSE left and only today (your own note is not news to you)
//   - the read-marker is per member and lives in localStorage keyed by uid, never in state.settings,
//     which is the shared household blob — one caregiver reading must not clear it for the other
//   - stepping a day back keeps the surface on screen, because the arrows that did it live inside it
//
//   node tools/serve.js &   &&   node tools/noteshome_test.js [baseUrl]
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = (process.argv[2] || 'http://localhost:8080') + '/app/?e2e=1';
const DAY = 86400000;

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '  ' + d : ''))); };

const SEED = {
  babies: [{ id: 'b1', name: 'Aria', birth: Date.now() - 40 * DAY, sex: 'F', country: 'uk', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: {} },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};
const THEIRS = { id: 'n1', text: 'Formula is in the top cupboard.', createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle' };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 390, height: 850, deviceScaleFactor: 1 });
  await p.goto(APP, { waitUntil: 'networkidle2' });
  await p.evaluate(s => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', 'light');
  }, SEED);
  await p.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1800));

  console.log('\n1. a day with no notes');
  const empty = await p.evaluate(() => {
    view = 'home'; render();
    const sc = document.getElementById('scroll');
    return {
      order: [...sc.querySelectorAll('#daySurface, .today-strip')].map(n => n.id || n.className),
      badge: !!sc.querySelector('.ds-badge'), hl: !!sc.querySelector('.ds-notes.ds-new')
    };
  });
  ck(empty.order.indexOf('daySurface') > -1, 'the card is still on the page — moved, never removed');
  ck(JSON.stringify(empty.order) === JSON.stringify(['today-strip', 'daySurface']), 'it sits below the today strip', JSON.stringify(empty.order));
  ck(!empty.badge && !empty.hl, 'nothing asks for attention');

  console.log('\n2. a note somebody else left today');
  const theirs = await p.evaluate((N) => {
    state.notes = [Object.assign({}, N, { day: dayKey(now()), at: now() - 3600000 })]; render();
    const sc = document.getElementById('scroll');
    const badge = sc.querySelector('.ds-badge');
    const ql = [...sc.querySelectorAll('.sec-title')].find(n => /Quick log/.test(n.textContent));
    return {
      order: [...sc.querySelectorAll('#daySurface, .today-strip')].map(n => n.id || n.className),
      badge: badge ? badge.textContent.trim() : null, hl: !!sc.querySelector('.ds-notes.ds-new'),
      cards: sc.querySelectorAll('.note-card').length,
      top: sc.querySelector('#daySurface').getBoundingClientRect().top,
      qlTop: ql ? ql.getBoundingClientRect().top : 1e6, vh: window.innerHeight
    };
  }, THEIRS);
  ck(JSON.stringify(theirs.order) === JSON.stringify(['daySurface', 'today-strip']), 'the card is promoted', JSON.stringify(theirs.order));
  ck(theirs.top < theirs.qlTop, 'above Quick log');
  ck(theirs.top < theirs.vh, 'on the first screen', Math.round(theirs.top) + 'px of ' + theirs.vh);
  ck(theirs.badge === '1 new', 'the lane header carries the count', JSON.stringify(theirs.badge));
  ck(theirs.hl, 'the lane is marked unread');
  ck(theirs.cards === 1, 'the note itself renders');

  console.log('\n3. a note I left myself');
  const mine = await p.evaluate(() => {
    state.notes = [{ id: 'n2', text: 'Bottles sterilised.', day: dayKey(now()), at: now() - 600000, createdBy: myUid(), createdByName: 'Me', audience: 'circle' }];
    render();
    const sc = document.getElementById('scroll');
    return {
      order: [...sc.querySelectorAll('#daySurface, .today-strip')].map(n => n.id || n.className),
      badge: !!sc.querySelector('.ds-badge'), unseen: unseenNotes().length
    };
  });
  ck(JSON.stringify(mine.order) === JSON.stringify(['daySurface', 'today-strip']), 'still holds the card up top');
  ck(!mine.badge && mine.unseen === 0, 'but is never announced back to me as new');

  console.log('\n4. reading it');
  const read = await p.evaluate((N) => {
    state.notes = [Object.assign({}, N, { day: dayKey(now()), at: now() - 3600000 })]; render();
    const before = unseenNotes().length;
    openNoteView('n1'); closeSheet(); render();
    const sc = document.getElementById('scroll');
    return {
      before, after: unseenNotes().length,
      keyed: !!localStorage.getItem('cubby-notes-seen:' + quickUid()),
      inShared: JSON.stringify(state.settings).indexOf('notes-seen') > -1,
      badge: !!sc.querySelector('.ds-badge'),
      order: [...sc.querySelectorAll('#daySurface, .today-strip')].map(n => n.id || n.className)
    };
  }, THEIRS);
  ck(read.before === 1 && read.after === 0, 'opening the note clears the mark', read.before + ' -> ' + read.after);
  ck(read.keyed, 'the mark is per member, keyed by uid');
  ck(!read.inShared, 'and is NOT in the shared settings blob');
  ck(!read.badge, 'the badge is gone');
  ck(JSON.stringify(read.order) === JSON.stringify(['daySurface', 'today-strip']), 'a read note still keeps the card near the top');

  console.log('\n5. a later note from the same person');
  const again = await p.evaluate(() => {
    state.notes.push({ id: 'n3', text: 'Nappies are low.', day: dayKey(now()), at: now(), createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle' });
    render();
    return { unseen: unseenNotes().length };
  });
  ck(again.unseen === 1, 'comes back as new', String(again.unseen));

  console.log('\n6. a private note addressed to somebody else');
  const priv = await p.evaluate(() => {
    state.notes = [{ id: 'n4', text: 'not for me', day: dayKey(now()), at: now(), createdBy: 'other', createdByName: 'Papa Bear', audience: 'someone-else' }];
    render();
    const sc = document.getElementById('scroll');
    return { unseen: unseenNotes().length, order: [...sc.querySelectorAll('#daySurface, .today-strip')].map(n => n.id || n.className) };
  });
  ck(priv.unseen === 0, 'is not counted as new for me');
  ck(JSON.stringify(priv.order) === JSON.stringify(['today-strip', 'daySurface']), 'and does not promote the card', JSON.stringify(priv.order));

  console.log('\n7. stepping back a day');
  const nav = await p.evaluate(async () => {
    state.notes = []; render();
    const sc = document.getElementById('scroll'); sc.scrollTo(0, 0);
    surfaceShift(-1);
    await new Promise(r => setTimeout(r, 150));
    const r = document.getElementById('daySurface').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
  });
  ck(nav.bottom > 0 && nav.top < nav.vh, 'the surface stays on screen — the arrows live inside it', Math.round(nav.top) + 'px of ' + nav.vh);

  console.log('\n8. clean console');
  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));

  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
