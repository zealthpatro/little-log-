// Gate for where the Notes lane sits on home, and when it is allowed to ask for attention.
//
// The card lives at the BOTTOM of home. It comes up for exactly one reason: another member has left
// something this member has not read yet, addressed to the whole circle or to them by name. It goes
// straight back down when they read it.
//
// Before this, the lane held the top of the screen every day, and on most days what it held was a
// heading, a prompt to write something and a quote of the day, sitting above the parent's own baby.
// Generic filler in a prominent slot teaches people to scroll past that slot, which is the worst
// possible outcome for the only place a second caregiver can reach them.
//
// The assertions are about position and restraint:
//   - nothing unread     -> bottom of home (moved, never removed; the quote of the day stays)
//   - unread from anyone else -> above Quick log, on the first screen, badged, and the CARD says which
//   - my own note        -> stays at the bottom. It is not news to me.
//   - read it            -> back to the bottom, badge and dot gone
//   - two unread, one read -> STAYS up, count drops to one
//   - private to somebody else -> never counted, never promotes (a third member cannot be nudged by
//     a handoff that is not theirs to read)
//   - a PIN left on an earlier day is not news. It is a standing note that has been on this screen
//     every day since; counting it unread promoted the card and printed "1 new" every single day until
//     somebody tapped a note they had already read. A pin left TODAY still counts.
//   - the read-marker is note IDS scoped to a day in localStorage keyed by uid. Never state.settings
//     (shared with the circle). Never a high-water timestamp (silently swallows a note that syncs in
//     stamped earlier than one already read). Day-scoped so it is self-pruning: a fixed-size list
//     evicted by read order spent its slots on dead ids and eventually threw away a live one.
//   - reading the LAST unread note takes the card's footprint out of the page above where she is
//     reading, so the scroll offset gives back exactly that footprint and she closes the sheet looking
//     at what she was looking at
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
  // install/home tips pre-seen: `canShowInstall()` flips when the browser fires beforeinstallprompt,
  // which is asynchronous, so leaving it live means the harness races a ~90px coach card appearing
  // and disappearing between measurements and invents a layout failure.
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { install: 1, home: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};
// The shape home reads back, in one place: id, who, and who it is for.
const THEIRS = { id: 'n1', text: 'Formula is in the top cupboard.', createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle' };

// Every check runs against the same two-element answer: where the card is, and what it is claiming.
const PROBE = `(function(){
  var sc=document.getElementById('scroll');
  var badge=sc.querySelector('.ds-badge');
  var ql=[].slice.call(sc.querySelectorAll('.sec-title')).filter(function(n){return /Quick log/.test(n.textContent);})[0];
  var ds=sc.querySelector('#daySurface');
  return {
    order: [].slice.call(sc.querySelectorAll('#daySurface, .today-strip')).map(function(n){return n.id||n.className;}),
    badge: badge?badge.textContent.trim():null,
    lane: !!sc.querySelector('.ds-notes.ds-new'),
    dots: sc.querySelectorAll('.note-card.nt-unread').length,
    cards: sc.querySelectorAll('.note-card').length,
    unseen: unseenNotes().length,
    top: ds?ds.getBoundingClientRect().top:null,
    qlTop: ql?ql.getBoundingClientRect().top:1e6,
    vh: window.innerHeight
  };
})()`;
const DOWN = ['today-strip', 'daySurface'], UP = ['daySurface', 'today-strip'];
const where = r => JSON.stringify(r.order);

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
  const set = async (notes) => p.evaluate((ns, probe) => {
    state.notes = (ns || []).map(n => Object.assign({ day: dayKey(now()), at: now() - 3600000 }, n));
    view = 'home'; render();
    return eval(probe);
  }, notes, PROBE);
  const look = () => p.evaluate(probe => eval(probe), PROBE);

  console.log('\n1. nothing unread');
  const empty = await set([]);
  ck(empty.order.indexOf('daySurface') > -1, 'the card is still on the page — moved, never removed');
  ck(where(empty) === JSON.stringify(DOWN), 'it sits below the today strip', where(empty));
  ck(!empty.badge && !empty.lane && !empty.dots, 'nothing asks for attention');

  console.log('\n2. a note to the whole circle, from somebody else');
  const theirs = await set([THEIRS]);
  ck(where(theirs) === JSON.stringify(UP), 'the card comes up', where(theirs));
  ck(theirs.top < theirs.qlTop, 'above Quick log');
  ck(theirs.top < theirs.vh, 'on the first screen', Math.round(theirs.top) + 'px of ' + theirs.vh);
  ck(theirs.badge === '1 new', 'the lane header carries the count', JSON.stringify(theirs.badge));
  ck(theirs.lane, 'the lane is marked unread');
  ck(theirs.dots === 1, 'and the CARD says which note is the new one', String(theirs.dots));

  console.log('\n3. a note addressed to me by name');
  const toMe = await p.evaluate((probe) => {
    state.notes = [{ id: 'n5', text: 'yours only', day: dayKey(now()), at: now(), createdBy: 'other', createdByName: 'Papa Bear', audience: myUid() }];
    render(); return eval(probe);
  }, PROBE);
  ck(where(toMe) === JSON.stringify(UP), 'comes up for me', where(toMe));
  ck(toMe.unseen === 1 && toMe.dots === 1, 'and is counted');

  console.log('\n4. a note I wrote myself');
  const mine = await p.evaluate((probe) => {
    state.notes = [{ id: 'n2', text: 'Bottles sterilised.', day: dayKey(now()), at: now() - 600000, createdBy: myUid(), createdByName: 'Me', audience: 'circle' }];
    render(); return eval(probe);
  }, PROBE);
  ck(where(mine) === JSON.stringify(DOWN), 'stays at the bottom — it is not news to me', where(mine));
  ck(!mine.badge && !mine.dots && mine.unseen === 0, 'and is never announced back to me');
  ck(mine.cards === 1, 'but it is still there to read');

  console.log('\n5. a note private to somebody else');
  const priv = await set([{ id: 'n4', text: 'not for me', createdBy: 'other', createdByName: 'Papa Bear', audience: 'someone-else' }]);
  ck(priv.unseen === 0 && !priv.dots, 'is not counted as new for me');
  ck(where(priv) === JSON.stringify(DOWN), 'and cannot bring the card up', where(priv));
  ck(priv.cards === 0, 'and is not rendered at all');

  console.log('\n6. reading it puts the card back down');
  const reseed = await set([THEIRS]);
  ck(where(reseed) === JSON.stringify(UP), 'up again with an unread note', where(reseed));
  const afterRead = await p.evaluate((probe) => {
    openNoteView('n1'); closeSheet(); render(); return eval(probe);
  }, PROBE);
  ck(where(afterRead) === JSON.stringify(DOWN), 'reading it moves it back down', where(afterRead));
  ck(!afterRead.badge && !afterRead.dots && afterRead.unseen === 0, 'badge and dot are gone');
  ck(afterRead.cards === 1, 'the note itself is still there');

  console.log('\n7. two unread, one read');
  const two = await set([THEIRS, { id: 'n6', text: 'Nappies are low.', createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: Date.now() }]);
  ck(two.unseen === 1 && two.badge === '1 new', 'n1 is already read, so only the new one counts', JSON.stringify(two.badge));
  const bothNew = await p.evaluate((probe) => {
    localStorage.removeItem('cubby-notes-seen:' + quickUid()); render(); return eval(probe);
  }, PROBE);
  ck(bothNew.unseen === 2 && bothNew.badge === '2 new' && bothNew.dots === 2, 'with the marker cleared both are new', JSON.stringify(bothNew.badge));
  const oneRead = await p.evaluate((probe) => {
    openNoteView('n6'); closeSheet(); render(); return eval(probe);
  }, PROBE);
  ck(where(oneRead) === JSON.stringify(UP), 'one tap does NOT drop the card while one is still unread', where(oneRead));
  ck(oneRead.unseen === 1 && oneRead.dots === 1, 'the count goes to one, and the dot moves to the right card');

  console.log('\n8. the read-marker itself');
  const marker = await p.evaluate(() => {
    const raw = localStorage.getItem('cubby-notes-seen:' + quickUid());
    let v = null; try { v = JSON.parse(raw); } catch (e) { }
    const holds = (v && Array.isArray(v.ids)) ? v.ids : [];
    return { raw, holds, ids: !!(v && Array.isArray(v.ids)), inShared: JSON.stringify(state.settings).indexOf('notes-seen') > -1 };
  });
  ck(marker.ids, 'holds note ids, not a timestamp', String(marker.raw));
  ck(marker.holds.indexOf('n6') > -1, 'and names the note that was opened', String(marker.raw));
  ck(!marker.inShared, 'and is NOT in the shared settings blob');

  console.log('\n9. a note that syncs in stamped EARLIER than one already read');
  // The whole reason the marker is a set of ids. A high-water timestamp treats this note as read
  // before anybody has seen it, and nobody is ever told it existed.
  const late = await p.evaluate((probe) => {
    state.notes.push({ id: 'n7', text: 'left this morning, arrived late', day: dayKey(now()), at: now() - 8 * 3600000, createdBy: 'other', createdByName: 'Nana Bear', audience: 'circle' });
    render(); return eval(probe);
  }, PROBE);
  ck(late.unseen === 2, 'is still unread', String(late.unseen));
  ck(where(late) === JSON.stringify(UP), 'and still brings the card up', where(late));

  console.log('\n10. a standing pin left on an EARLIER day');
  // The one this gate exists for. A pin is not news: it has been on this screen every day since it
  // was left. Counting it unread promoted the card and printed "1 new" every single day until the
  // parent happened to tap a note they had already read — the exact false nudge the change removes.
  const oldPin = await p.evaluate((probe) => {
    localStorage.removeItem('cubby-notes-seen:' + quickUid());
    state.notes = [{ id: 'p1', text: 'Formula is in the top cupboard.', day: dayKey(now() - 5 * 86400000), at: now() - 5 * 86400000, pinned: true, createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle' }];
    render(); return eval(probe);
  }, PROBE);
  ck(oldPin.unseen === 0 && !oldPin.badge && !oldPin.dots, 'is not news', 'unseen=' + oldPin.unseen + ' badge=' + JSON.stringify(oldPin.badge));
  ck(where(oldPin) === JSON.stringify(DOWN), 'and cannot hold the card at the top', where(oldPin));
  ck(oldPin.cards === 1, 'but it is still standing in the lane, which is what a pin is for');

  console.log('\n11. a pin left TODAY');
  const newPin = await p.evaluate((probe) => {
    state.notes = [{ id: 'p2', text: 'Bottles are sterilised, top shelf.', day: dayKey(now()), at: now(), pinned: true, createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle' }];
    render(); return eval(probe);
  }, PROBE);
  ck(newPin.unseen === 1 && newPin.badge === '1 new', 'still counts on the day it lands', JSON.stringify(newPin.badge));
  ck(where(newPin) === JSON.stringify(UP), 'and still brings the card up', where(newPin));

  console.log('\n12. the marker is scoped to the day');
  const scoped = await p.evaluate(() => {
    const k = 'cubby-notes-seen:' + quickUid();
    openNoteView('p2'); closeSheet();          // section 10 cleared the marker; write one to look at
    const raw = JSON.parse(localStorage.getItem(k) || 'null');
    // Hand it yesterday's day key: those ids can never be asked about again, so it must read as empty
    // rather than being carried forward and evicted by read order.
    localStorage.setItem(k, JSON.stringify({ d: dayKey(now() - 86400000), ids: ['p2'] }));
    const staleGivesNothing = notesSeen().length === 0;
    localStorage.setItem(k, JSON.stringify({ d: dayKey(now()), ids: ['p2'] }));
    return { shape: raw && typeof raw === 'object' && Array.isArray(raw.ids), day: raw && raw.d, staleGivesNothing, todayCounts: noteIsSeen('p2') };
  });
  ck(scoped.shape, 'is {d, ids}, not a bare list and not a timestamp');
  ck(scoped.staleGivesNothing, "yesterday's marker reads as nothing read, so it can never evict a live id");
  ck(scoped.todayCounts, "and today's marker is honoured");

  console.log('\n13. reading the last note does not move the page under the sheet');
  const scroll = await p.evaluate(async () => {
    localStorage.removeItem('cubby-notes-seen:' + quickUid());
    state.notes = [];
    for (let i = 1; i <= 6; i++) state.notes.push({ id: 'm' + i, text: 'Note number ' + i + ', long enough to give the card real height on a phone screen.', day: dayKey(now()), at: now() - i * 60000, createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle' });
    view = 'home'; render();
    for (let i = 1; i <= 5; i++) { openNoteView('m' + i); closeSheet(); }
    render();
    const sc = document.getElementById('scroll');
    const ds = sc.querySelector('#daySurface');
    const dsH = ds.getBoundingClientRect().height;
    const foot = ds.offsetHeight + (parseFloat(getComputedStyle(ds).marginBottom) || 0);
    sc.scrollTop = Math.min(sc.scrollHeight - sc.clientHeight, foot + 140);
    // Both readings have to be taken with the entry animation settled, or the BEFORE is a node
    // part-way through a translate and the test invents a discrepancy that no parent ever sees.
    await new Promise(r => setTimeout(r, 700));
    const q = () => { const n = [].slice.call(sc.querySelectorAll('.sec-title')).filter(x => /Quick log/.test(x.textContent))[0]; return n ? n.getBoundingClientRect().top : null; };
    const before = q(), stBefore = sc.scrollTop;
    openNoteView('m6'); closeSheet();
    // Long enough for the re-paint's entry animation to settle: what matters is where she ends up
    // looking, not where a node is mid-translate.
    await new Promise(r => setTimeout(r, 700));
    return {
      dsH, foot, before, after: q(), stBefore, stAfter: sc.scrollTop, unseen: unseenNotes().length,
      order: [].slice.call(sc.querySelectorAll('#daySurface, .today-strip')).map(n => n.id || n.className)
    };
  });
  ck(scroll.dsH > 400, 'the lane really is tall here (' + Math.round(scroll.dsH) + 'px)');
  ck(scroll.stBefore > scroll.foot, 'and she is scrolled past its footprint, so the clamp is not doing the work', 'scrollTop ' + scroll.stBefore + ' vs footprint ' + scroll.foot);
  ck(scroll.unseen === 0 && JSON.stringify(scroll.order) === JSON.stringify(DOWN), 'the card demoted', where(scroll));
  ck(scroll.stBefore - scroll.stAfter === scroll.foot, 'the scroll gave back exactly the card footprint', scroll.stBefore + ' -> ' + scroll.stAfter + ', footprint ' + scroll.foot);
  ck(Math.abs(scroll.after - scroll.before) <= 2, 'and Quick log stayed put', Math.round(scroll.before) + ' -> ' + Math.round(scroll.after));

  console.log('\n14. the quote of the day cannot look like a note');
  /* This has now regressed once, which is why it is a check and not a comment. The lane used to open
     with nothing but the quote, in the display face with a Caveat byline, so a parent read it as a note
     FROM Cubby and the lane never looked writable. Plain words were added above it and it was centred,
     and the centring was doing more work than anyone realised: when the lane became one left-aligned
     column the quote was still 17px display italic with a handwriting byline — larger than the heading
     and, without the centring, indistinguishable from something somebody had left her.
     A note carries two signals: the display face and the Caveat byline. The quote may have neither. */
  const qod = await p.evaluate(() => {
    state.notes = []; view = 'home'; render();
    const sc = document.getElementById('scroll');
    const q = sc.querySelector('.note-empty .qod'), h = sc.querySelector('.note-empty .qod-none');
    const by = sc.querySelector('.note-empty .qod-by');
    if (!q || !h || !by) return { missing: true };
    const px = (n) => parseFloat(getComputedStyle(n).fontSize);
    const fam = (n) => getComputedStyle(n).fontFamily.toLowerCase();
    const noteBy = sc.querySelector('.note-card .nt-by');
    return {
      quoteSize: px(q), headSize: px(h),
      quoteFam: fam(q), byFam: fam(by),
      // What a REAL note's byline uses, read from the app rather than hardcoded here.
      realNoteByFam: noteBy ? fam(noteBy) : 'caveat',
      separated: getComputedStyle(q).borderTopStyle !== 'none' || parseFloat(getComputedStyle(q).marginTop) >= 12,
    };
  });
  ck(!qod.missing, 'the empty lane renders its three parts');
  ck(qod.quoteSize < qod.headSize, 'the quote is smaller than the heading above it, not larger',
    qod.quoteSize + 'px vs ' + qod.headSize + 'px');
  ck(!/fraunces|caveat/.test(qod.quoteFam), 'and not in the display or handwriting face', qod.quoteFam);
  ck(!/caveat/.test(qod.byFam), 'its byline is not the handwriting a real note signs with', qod.byFam);
  ck(qod.separated, 'and it is separated from the words above it, so it reads as a footer');

  console.log('\n15. the unread marker takes up no space');
  // It shipped as a real border plus padding (3 + 11 - 2), which shoved the whole Notes lane 12px
  // right of "The day" and the photos below it — only in the unread state, which is the one a parent
  // is most likely looking at. Drawn as a pseudo-element now, so the lane cannot move.
  const align = await p.evaluate(async (N) => {
    const sc = document.getElementById('scroll');
    const left = s => { const n = sc.querySelector(s); return n ? Math.round(n.getBoundingClientRect().left * 10) / 10 : null; };
    const shot = () => ({ notes: left('.ds-notes .ds-lt'), recap: left('.ds-recap .ds-lt') });
    // The recap lane is the neighbour a parent sees the misalignment against, and it only renders when
    // the day has something logged, so give it one.
    state.events = [{ id: 'ev1', babyId: state.activeBabyId, type: 'feed', time: now() - 3600000, method: 'bottle', amount: 90 }];
    // read
    state.notes = [Object.assign({}, N, { day: dayKey(now()), at: now() - 3600000 })];
    localStorage.setItem('cubby-notes-seen:' + quickUid(), JSON.stringify({ d: dayKey(now()), ids: [N.id] }));
    render(); await new Promise(r => setTimeout(r, 60));
    const read = shot();
    // unread
    localStorage.removeItem('cubby-notes-seen:' + quickUid());
    render(); await new Promise(r => setTimeout(r, 60));
    const unread = shot();
    return { read, unread, marked: !!sc.querySelector('.ds-notes.ds-new') };
  }, THEIRS);
  ck(align.marked, 'the unread state really is marked in this check');
  ck(align.read.notes != null && align.read.recap != null, 'both lane headings are measurable',
    JSON.stringify(align.read));
  ck(align.read.notes === align.read.recap, 'read: Notes lines up with The day', JSON.stringify(align.read));
  ck(align.unread.notes === align.unread.recap, 'unread: it still lines up', JSON.stringify(align.unread));
  ck(align.unread.notes === align.read.notes, 'and the lane does not move when a note arrives unread',
    align.read.notes + ' -> ' + align.unread.notes);

  console.log('\n16. stepping back a day');
  const nav = await p.evaluate(async () => {
    state.notes = []; render();
    const sc = document.getElementById('scroll'); sc.scrollTo(0, 0);
    surfaceShift(-1);
    await new Promise(r => setTimeout(r, 150));
    const r = document.getElementById('daySurface').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
  });
  ck(nav.bottom > 0 && nav.top < nav.vh, 'the surface stays on screen — the arrows live inside it', Math.round(nav.top) + 'px of ' + nav.vh);

  console.log('\n17. clean console');
  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));

  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
