#!/usr/bin/env node
/* The handover note that expired while she was asleep.
 *
 * A note is the only way a second caregiver reaches the parent who has baby next, and the note that
 * matters is typed at the end of a shift: "slight cold today, extra cuddles, last fed 8pm". Cubby
 * decided what was still "new" by comparing against TODAY, so a note left at 11pm stopped counting
 * three hours later, at midnight, with nobody awake to have read it. The read-marker was stored as
 * {d, ids} and thrown away whole when the day turned, so the answer was not just "not new" but
 * "nothing to say": renderHome demoted the day surface back to the bottom of the page and the lane
 * printed "Nothing yet today". The morning parent woke to a screen that said her partner had left
 * her nothing, and the note sat one back-arrow away behind an arrow nobody would think to press.
 *
 * The window is 36 hours now, not a calendar day: a night plus a working day on either side of it.
 * The stored shape lost its day key, and anything a previous version already wrote to a phone is
 * migrated rather than orphaned, because dropping it would re-announce every note that parent read
 * last night at the moment they opened the app, which is the same bug wearing the other coat.
 * Today's lane carries last night's notes the way it already carries a pin, so the badge and the
 * cards below it are talking about the same thing.
 *
 * The clock here is pinned to 06:00, so "the 11pm note" is genuinely on the previous calendar day.
 * It is also MOVABLE mid-run (window.__clockShift), because half of what this gate is for is what
 * happens on a repaint that crosses midnight without a reload.
 *
 *   PORT=9473 node tools/serve.js &
 *   node tools/notes_unseen_check.js http://localhost:9473
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// No default. :8080 is whatever checkout somebody left running, and a gate that silently grades
// another tree is worse than one that does not run at all.
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/notes_unseen_check.js <base-url>   e.g. http://localhost:9473'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 06:00, the hour the morning parent picks the phone up. Last night's 11pm is a different calendar
// day from here, which is the whole point.
const CLOCK = (() => { const d = new Date(); d.setHours(6, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1, install: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

// The app's own day key, so a seeded note is filed exactly the way saveNote would have filed it.
const dayKeyOf = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
/* An explicit wall-clock instant N calendar days back, NOT `now - N*HOUR`. Subtracting 7 hours from
   a 06:00 anchor lands on the previous day 364 days a year and on the SAME day on the fall-back
   date, which would quietly turn "last night's note" into one of today's and take the byline
   assertion with it. Verified fall-back dates: America/New_York 2026-11-01, Europe/London
   2026-10-25, Australia/Sydney 2026-04-05. setDate/setHours honour the local offset; arithmetic
   on the epoch does not. */
const backAt = (days, h, m) => { const d = new Date(CLOCK); d.setDate(d.getDate() - days); d.setHours(h, m || 0, 0, 0); return d.getTime(); };
const mkNote = (id, at, over) => Object.assign({ id: id, text: id, createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: at, day: dayKeyOf(at) }, over || {});
// One note from the other parent, at the hour the handover actually happens: 11pm, last night.
const LAST_NIGHT = mkNote('n1', backAt(1, 23), { text: 'Slight cold today, extra cuddles. Last fed 8pm.' });

/* What home is claiming, read off the real DOM every time. Never document.body.textContent: this app
   is one file with its own source inline, so a text search of the body matches the script that draws
   the screen and every assertion passes whatever the screen says. */
const PROBE = `(function(){
  var sc=document.getElementById('scroll');
  var badge=sc.querySelector('.ds-badge'), head=sc.querySelector('.ds-day');
  return {
    order: [].slice.call(sc.querySelectorAll('#daySurface, .today-strip')).map(function(n){return n.id||n.className;}),
    badge: badge?badge.textContent.trim():null,
    head: head?head.textContent.trim():null,
    cards: sc.querySelectorAll('.note-card').length,
    dots: sc.querySelectorAll('.note-card.nt-unread').length,
    texts: [].slice.call(sc.querySelectorAll('.note-card .nt-text')).map(function(n){return n.textContent.trim();}),
    bylines: [].slice.call(sc.querySelectorAll('.note-card .nt-by')).map(function(n){return n.textContent.trim();}),
    empty: !!sc.querySelector('.note-empty'),
    unseen: unseenNotes().length,
    unseenIds: unseenNotes().map(function(n){return n.id;})
  };
})()`;
const DOWN = ['today-strip', 'daySurface'], UP = ['daySurface', 'today-strip'];
const where = (r) => JSON.stringify(r.order);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  // The shift is read on every call rather than closed over, so a test can move the clock forward
  // mid-session without a reload. Reset to OFFSET on every document, so no test leaks into the next.
  await page.evaluateOnNewDocument((shift) => {
    window.__clockShift = shift;
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + window.__clockShift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + window.__clockShift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  // A full boot, because the marker is read from localStorage on the first paint and half of what is
  // under test here is whether it survives one. `marker` is what a previous version left behind.
  const load = async (s, marker) => {
    await page.evaluate((x, m) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('cubby-theme:local', 'light');
      if (m === undefined) localStorage.removeItem('cubby-notes-seen:local');
      else localStorage.setItem('cubby-notes-seen:local', JSON.stringify(m));
    }, s, marker);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
  };
  const paint = (notes) => page.evaluate((ns, p) => {
    state.notes = ns; view = 'home'; go('home'); render(); return eval(p);
  }, notes, PROBE);

  console.log('\n1. the 11pm handover, opened at six the next morning');
  {
    await load(seed({ notes: [LAST_NIGHT] }));
    const r = await paint([LAST_NIGHT]);
    ok('it is still new seven hours later', r.unseen === 1, r);
    ok('so the day surface comes up above the today strip', where(r) === JSON.stringify(UP), where(r));
    ok('and the lane header says one is new', r.badge === '1 new', r.badge);
    // The half a badge alone cannot do. Before this the header counted a note the lane below it did
    // not render, which is worse than silence: it says something is waiting and hides it.
    ok('the note itself is IN the lane, not one back-arrow away', r.cards === 1, r);
    ok('marked as the unread one', r.dots === 1, r);
    ok('and the lane never says "Nothing yet today" over it', r.empty === false, r);
    ok('the byline says which night it was left', /Yesterday/.test(r.bylines[0] || ''), r.bylines);
  }

  console.log('\n2. reading it is what puts it down, and it stays down over a reboot');
  {
    const r = await page.evaluate((p) => { openNoteView('n1'); closeSheet(); render(); return eval(p); }, PROBE);
    ok('the surface demotes the moment she opens it', where(r) === JSON.stringify(DOWN), where(r));
    ok('nothing is asking for attention', r.unseen === 0 && !r.badge && !r.dots, r);
    ok('but the note is still there to read again', r.cards === 1, r);
    // The day key used to make this true by accident on the second day and false in between. A read
    // marker that does not survive a reload re-announces last night's note every time she reopens.
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    const r2 = await paint([LAST_NIGHT]);
    ok('and it is still read after a full reload', r2.unseen === 0 && !r2.badge, r2);
    ok('with the surface still at the bottom', where(r2) === JSON.stringify(DOWN), where(r2));
  }

  console.log('\n3. the edge of the window');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      const mk = (id, hoursAgo) => ({ id: id, text: 'edge ' + id, createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: now() - hoursAgo * 3600000, day: dayKey(now() - hoursAgo * 3600000) });
      const at = (h) => { state.notes = [mk('e', h)]; render(); return unseenNotes().length; };
      return { h1: at(1), h35: at(35), h35_9: at(35.9), h36_1: at(36.1), h48: at(48), h72: at(72) };
    });
    ok('an hour old is new', r.h1 === 1, r);
    ok('35 hours old is still new', r.h35 === 1, r);
    ok('and 35 hours 54 minutes is the last minute of it', r.h35_9 === 1, r);
    ok('36 hours and change is not', r.h36_1 === 0, r);
    ok('two days is not', r.h48 === 0, r);
    ok('three days is not', r.h72 === 0, r);
  }

  console.log('\n4. nothing left at all');
  {
    await load(seed());
    const r = await paint([]);
    ok('no notes means nothing is new', r.unseen === 0, r);
    ok('the surface sits at the bottom where it belongs', where(r) === JSON.stringify(DOWN), where(r));
    ok('and the lane says so in plain words', r.empty === true && r.cards === 0, r);
  }

  console.log('\n5. notes that are not hers to be nudged by');
  {
    const mine = await paint([{ id: 'm1', text: 'Bottles sterilised.', createdBy: 'local', createdByName: 'Me', audience: 'circle', at: backAt(1, 23), day: dayKeyOf(backAt(1, 23)) }]);
    ok('my own note from last night is not news to me', mine.unseen === 0 && !mine.badge, mine);
    ok('and cannot bring the surface up', where(mine) === JSON.stringify(DOWN), where(mine));
    ok('though it is still in the lane to read', mine.cards === 1, mine);

    const other = await paint([{ id: 'p1', text: 'not for me', createdBy: 'other', createdByName: 'Papa Bear', audience: 'someone-else', at: backAt(1, 23), day: dayKeyOf(backAt(1, 23)) }]);
    ok('a note private to a third member is never counted', other.unseen === 0, other);
    ok('never rendered', other.cards === 0, other);
    ok('and cannot bring the surface up', where(other) === JSON.stringify(DOWN), where(other));
  }

  console.log('\n6. a note that syncs in stamped earlier than one already read');
  {
    // Why the marker is ids and not a high-water timestamp, tested against the new window: the late
    // arrival is 30 hours old, inside the window, and must not be swallowed by the fresher read.
    await load(seed());
    const r = await page.evaluate((p) => {
      const fresh = { id: 'f1', text: 'this morning', createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: now() - 3600000, day: dayKey(now()) };
      state.notes = [fresh]; view = 'home'; go('home'); render();
      openNoteView('f1'); closeSheet();
      state.notes = [fresh, { id: 'l1', text: 'left the night before, arrived late', createdBy: 'nana', createdByName: 'Nana Bear', audience: 'circle', at: now() - 30 * 3600000, day: dayKey(now() - 30 * 3600000) }];
      render(); return eval(p);
    }, PROBE);
    ok('the older note is still unread', r.unseen === 1, r);
    ok('it brings the surface back up', where(r) === JSON.stringify(UP), where(r));
    ok('and it is the one carrying the dot', r.dots === 1, r);
  }

  console.log('\n7. what is actually on the phone');
  {
    await load(seed({ notes: [LAST_NIGHT] }));
    const r = await page.evaluate((ln) => {
      state.notes = [ln]; view = 'home'; go('home'); render();
      openNoteView('n1'); closeSheet();
      const raw = JSON.parse(localStorage.getItem('cubby-notes-seen:local') || 'null');
      return { raw: raw, isObj: !!raw && typeof raw === 'object' && !Array.isArray(raw), ids: !!raw && Array.isArray(raw.ids), hasDay: !!raw && 'd' in raw, names: (raw && raw.ids) || [], inShared: JSON.stringify(state.settings).indexOf('notes-seen') > -1 };
    }, LAST_NIGHT);
    ok('it is a list of note ids', r.isObj && r.ids, r.raw);
    ok('and it names the note that was opened', r.names.indexOf('n1') > -1, r.raw);
    ok('there is NO day key any more, so midnight cannot empty it', r.hasDay === false, r.raw);
    ok('and it is not in the shared household blob, where it would follow the whole circle', !r.inShared, r);
  }

  console.log('\n8. what a previous version left behind is read, not thrown away');
  {
    // The upgrade is the dangerous moment. She read four notes last night under the old code, which
    // filed them under yesterday's day key; if the new code cannot read that, every one of them comes
    // back as "new" the second she opens the app in the morning.
    const stale = { d: '1999-0-1', ids: ['n1'] };
    await load(seed({ notes: [LAST_NIGHT] }), stale);
    const r = await paint([LAST_NIGHT]);
    ok('an old {d, ids} written under yesterday still counts as read', r.unseen === 0, r);
    ok('so nothing is re-announced on upgrade', !r.badge && where(r) === JSON.stringify(DOWN), where(r));

    await load(seed({ notes: [LAST_NIGHT] }), ['n1']);
    const r2 = await paint([LAST_NIGHT]);
    ok('the bare array an older version wrote is migrated too', r2.unseen === 0, r2);

    /* Those three assert an ABSENCE, and on code that has no window at all nothing from last night
       is ever unseen, so they would pass against a tree where none of this exists. Migration is the
       part that is dangerous on upgrade, so it gets a presence test too: a SECOND note beside it
       that the old marker does not name. One migrated id has to leave exactly one of them new, and
       it has to be the right one. */
    const UNNAMED = mkNote('n2', backAt(1, 22), { createdByName: 'Nana Bear', text: 'Formula tin is in the top cupboard now' });
    await load(seed({ notes: [LAST_NIGHT, UNNAMED] }), { d: '1999-0-1', ids: ['n1'] });
    const r5 = await paint([LAST_NIGHT, UNNAMED]);
    ok('one migrated id leaves exactly one of last night\'s two notes new', r5.unseen === 1, r5);
    ok('and it is the one the old marker never named', JSON.stringify(r5.unseenIds) === '["n2"]', r5.unseenIds);
    ok('the badge counts one, not both and not none', r5.badge === '1 new' && r5.dots === 1, r5);
    ok('and both are in the lane, because a read note does not disappear', r5.cards === 2, r5);

    await load(seed({ notes: [LAST_NIGHT, UNNAMED] }), ['n1']);
    const r6 = await paint([LAST_NIGHT, UNNAMED]);
    ok('the bare array migrates to the same answer', r6.unseen === 1 && JSON.stringify(r6.unseenIds) === '["n2"]', r6.unseenIds);

    // A bare timestamp carries no ids at all, so there is nothing to migrate. It reads as
    // nothing-read, which costs one re-announcement and never a wrong answer.
    await load(seed({ notes: [LAST_NIGHT] }), now - 2 * HOUR);
    const r3 = await paint([LAST_NIGHT]);
    ok('a bare timestamp reads as nothing-read rather than as everything-read', r3.unseen === 1, r3);

    await load(seed({ notes: [LAST_NIGHT] }), { ids: 'not-a-list' });
    const r4 = await paint([LAST_NIGHT]);
    ok('and a corrupt marker never throws, it just means nothing has been read', r4.unseen === 1, r4);
  }

  console.log('\n9. the list still prunes itself without a day key to do it');
  {
    /* The day key used to empty this list at midnight for free. Without it the 200 cap is the only
       backstop, and a cap evicts by READ ORDER, which is how this shipped broken once: every slot
       spent on ids whose notes are long gone, the eviction reaching a live one, and the card coming
       back up saying "1 new" about a note read weeks ago. */
    await load(seed());
    const r = await page.evaluate(() => {
      const ids = () => (JSON.parse(localStorage.getItem('cubby-notes-seen:local') || '{}').ids || []).slice();
      const mk = (id, ms) => ({ id: id, text: id, createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: now() - ms, day: dayKey(now() - ms) });
      // Five notes she scrolled back and opened weeks ago, and three from inside the window.
      const old = [0, 1, 2, 3, 4].map((i) => mk('o' + i, (10 + i) * 86400000));
      const live = [1, 5, 30].map((h) => mk('w' + h, h * 3600000));
      state.notes = old.concat(live); view = 'home'; go('home'); render();
      old.forEach((n) => markNoteSeen(n.id));
      const afterOld = ids();
      live.forEach((n) => markNoteSeen(n.id));
      const afterLive = ids();
      // An id whose note this device has never seen: it may just not have synced, so it is kept.
      markNoteSeen('unknown-to-this-device');
      return { afterOld: afterOld, afterLive: afterLive, withUnknown: ids() };
    });
    ok('opening five long-dead notes leaves at most one id behind', r.afterOld.length <= 1, r.afterOld);
    ok('and none of them survive the next write', r.afterLive.filter((x) => x.charAt(0) === 'o').length === 0, r.afterLive);
    ok('so they can never be the slots that evict a live id', r.afterLive.length === 3, r.afterLive);
    ok('every id still inside the window is kept', ['w1', 'w5', 'w30'].every((x) => r.afterLive.indexOf(x) > -1), r.afterLive);
    ok('an id this device cannot place is kept, because it may simply not have synced', r.withUnknown.indexOf('unknown-to-this-device') > -1, r.withUnknown);

    const cap = await page.evaluate(() => {
      localStorage.removeItem('cubby-notes-seen:local');
      state.notes = []; render();
      for (let i = 0; i < 260; i++) markNoteSeen('bulk' + i);
      const ids = JSON.parse(localStorage.getItem('cubby-notes-seen:local') || '{}').ids || [];
      return { n: ids.length, last: ids[ids.length - 1] };
    });
    ok('the 200 cap still holds as the runaway backstop', cap.n === 200, cap);
    ok('and it keeps the newest, not the oldest', cap.last === 'bulk259', cap);
  }

  console.log('\n10. a pin is news for a night, then it goes quiet');
  {
    await load(seed());
    const fresh = await paint([{ id: 'pin1', text: 'Bottles are sterilised, top shelf.', pinned: true, createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: backAt(1, 23), day: dayKeyOf(backAt(1, 23)) }]);
    ok('a pin left last night is genuinely new this morning', fresh.unseen === 1 && fresh.badge === '1 new', fresh);
    ok('and brings the surface up once', where(fresh) === JSON.stringify(UP), where(fresh));
    // It is both a pin and a carried unread note, and the lane draws each of those lists. Once.
    ok('and it appears exactly once, not once per list that claims it', fresh.cards === 1, fresh);

    const old = await paint([{ id: 'pin2', text: 'Formula is in the top cupboard.', pinned: true, createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: now - 5 * DAY, day: dayKeyOf(now - 5 * DAY) }]);
    ok('a pin left five days ago is not news', old.unseen === 0 && !old.badge, old);
    ok('it cannot hold the surface at the top every morning', where(old) === JSON.stringify(DOWN), where(old));
    ok('but it still stands in the lane, which is what a pin is for', old.cards === 1, old);
  }

  console.log('\n11. a note deliberately filed onto an earlier day does not shout');
  {
    // saveNote stamps `at` with the day being browsed when she backdates, so a note typed today onto
    // last Tuesday is outside the window by construction. Filing tidily is not a handover.
    await load(seed());
    const r = await paint([{ id: 'b1n', text: 'first proper giggle', createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: now - 4 * DAY, day: dayKeyOf(now - 4 * DAY) }]);
    ok('it is not counted as new', r.unseen === 0, r);
    ok('and it does not appear on today', r.cards === 0 && r.empty === true, r);
  }

  console.log('\n12. the repaint that crosses midnight with nobody switching tabs');
  {
    /* The half this change missed first time round. unseenNotes() counts by the clock, but the badge
       and the unread ring were gated on surfaceIsToday(), which reads a day stamped once when the
       script parsed and refreshed only by go('home') or a hidden→visible switch. Neither of those
       fires for a parent who is already on home when midnight passes and then logs the night feed.
       One repaint later the surface was still lifted to the top of home BECAUSE of an unread note,
       while the surface itself said nothing was new and took the ring back off the card: her "1 new"
       vanished without her having read a thing. No reload and no visibilitychange anywhere in here,
       on purpose. That is the whole scenario. */
    const EVENING = mkNote('ev', backAt(0, 23), { text: 'Slight cold today, extra cuddles. Last fed 8pm.' });
    await load(seed({ notes: [EVENING] }));
    await page.evaluate((s) => { window.__clockShift = s; }, backAt(0, 23, 50) - Date.now());
    const before = await paint([EVENING]);
    ok('at ten to midnight it is new', before.unseen === 1 && before.badge === '1 new', before);
    ok('the ring is on the card and the surface is up', before.dots === 1 && where(before) === JSON.stringify(UP), where(before));
    ok('under a heading that says Today', before.head === 'Today', before.head);

    const after = await page.evaluate((s, p) => { window.__clockShift = s; render(); return eval(p); }, backAt(-1, 0, 15) - Date.now(), PROBE);
    ok('twenty-five minutes later nobody has read it, so it is still new', after.unseen === 1, after);
    ok('the badge still says so', after.badge === '1 new', after.badge);
    ok('the card still carries the ring', after.dots === 1, after);
    ok('the note is still in the lane', after.cards === 1, after.texts);
    ok('and the lane never says "Nothing yet today" over it', after.empty === false, after);
    ok('the heading rolls to the new day on its own, with no tab switch', after.head === 'Today', after.head);
    ok('the byline says which night it was left', /· Yesterday$/.test(after.bylines[0] || ''), after.bylines);
    ok('and the surface and the badge still agree with each other', where(after) === JSON.stringify(UP), where(after));
  }

  console.log('\n13. the order the lane is read in, and what a byline may say');
  {
    /* Drawn as pins, then last night, then today, the lane ran 5 days, 7 hours, 32 hours, 1 hour top
       to bottom: the freshest note LAST, under two older ones, on the screen a parent scans at 3am
       for the most recent thing anyone said about her baby. The two undated cards were the oldest
       and the newest, so a date could not be read as "older" either. One list, newest first. */
    await load(seed());
    const PIN = mkNote('c-pin', backAt(5, 9), { pinned: true, text: 'Emergency number is on the fridge' });
    const NIGHT = mkNote('c-night', backAt(1, 23), { text: 'Slight cold today, extra cuddles' });
    const DEEP = mkNote('c-deep', backAt(2, 22), { createdByName: 'Nana Bear', text: 'Formula tin is in the top cupboard now' });
    const TODAY = mkNote('c-today', backAt(0, 5), { text: 'Nappy rash cream is on the changing table' });
    const r = await paint([PIN, NIGHT, DEEP, TODAY]);
    ok('all four are on the screen', r.cards === 4, r.texts);
    ok('the pin holds the top, which is what a pin is for', /fridge/.test(r.texts[0] || ''), r.texts);
    ok('then the newest note, not the oldest', /changing table/.test(r.texts[1] || ''), r.texts);
    ok('then last night', /extra cuddles/.test(r.texts[2] || ''), r.texts);
    ok('then the night before that', /top cupboard/.test(r.texts[3] || ''), r.texts);
    ok('and the badge counts the three inside the window, not the standing pin', r.badge === '3 new', r.badge);
    /* "Grandmother · Wednesday, Aug 19" under a heading that says Today asks a parent at half past
       midnight to work out what day it currently is before she can work out how old the note is. */
    ok('a note from last night says Yesterday', /· Yesterday$/.test(r.bylines[2] || ''), r.bylines);
    ok('one from the night before says so in words, never a date', /· Two nights ago$/.test(r.bylines[3] || ''), r.bylines);
    ok('today\'s note carries no day, because the heading above it already does', !/·/.test(r.bylines[1] || ''), r.bylines);
    ok('and neither does a standing pin from before the window', !/·/.test(r.bylines[0] || ''), r.bylines);
    ok('no byline anywhere in the lane holds a calendar date', !r.bylines.some((b) => /\d/.test(b)), r.bylines);

    /* Newest-first has one thing above it. A note pinned TODAY is filed in the day's own list, not
       in pinnedNotes(), so sorting the merged lane by time alone drops it under anything typed
       after it — on the one day "Pin to today (your note stays up top)" is being read as a promise.
       guide_test found this the first time; it belongs here too, next to the sort that can break it. */
    const PINNED_TODAY = mkNote('t-pin', backAt(0, 4), { pinned: true, createdBy: 'local', createdByName: 'Me', text: 'Health visitor at eleven' });
    const CHATTER = mkNote('t-chat', backAt(0, 5), { text: 'Slept through until five' });
    const p = await paint([PINNED_TODAY, CHATTER]);
    ok('a note pinned today stays above the day\'s chatter, newer though the chatter is', /Health visitor/.test(p.texts[0] || ''), p.texts);
    ok('and the chatter is still under it, not gone', /Slept through/.test(p.texts[1] || ''), p.texts);
  }

  console.log('\n14. the mother Cubby has already gone quiet for');
  {
    /* myLossHolding() is the parent who lost one twin, or lost a pregnancy while an older child is
       still here. She never sees the holding screen: she gets "Cubby is keeping things quiet for
       you" and the ordinary home underneath it. Midnight used to take last night's note down on its
       own, and a 36-hour window means nothing does for a day and a half, so an unread note would sit
       lifted to the top of the one screen that has promised to stay quiet, with a counter on it. The
       note is not hidden. The surface is still in its usual place further down home. It is just not
       pushed at her. */
    await load(seed({ notes: [LAST_NIGHT], lossHolding: { local: { at: backAt(3, 12) } } }));
    const r = await paint([LAST_NIGHT]);
    const quiet = await page.evaluate(() => {
      const g = document.querySelector('#scroll .greeting-sub');
      return { quiet: !!g && /keeping things quiet/.test(g.textContent), holding: typeof myLossHolding === 'function' && !!myLossHolding() };
    });
    ok('the seed really does put her on the quiet path', quiet.holding && quiet.quiet, quiet);
    ok('the note is genuinely unread', r.unseen === 1, r);
    ok('but nothing is pushed to the top of her home', where(r) === JSON.stringify(DOWN), where(r));
    ok('and it is still there for her, further down, whenever she wants it', r.cards === 1, r.texts);

    // The same morning without the loss holding, so the assertion above is about that path and not
    // about something else having quietly stopped working.
    await load(seed({ notes: [LAST_NIGHT] }));
    const r2 = await paint([LAST_NIGHT]);
    ok('an ordinary morning still lifts it', where(r2) === JSON.stringify(UP), where(r2));
  }

  console.log('\n15. the byline is read off ONE clock, the reader\'s');
  {
    /* n.day is stamped by addNote on the AUTHOR's device (store-firebase.js). The byline was deciding
       "is this today's note" from that key and the wording from n.at against the reader's clock, so
       the two disagreed exactly when a circle is worth having: spread across timezones, or on the one
       night a year the day is 25 hours long. Nothing matched, everything fell through, and a note
       fifteen minutes old was signed "Two nights ago" on a screen headed Today. */

    // Dubai, four in the morning. Nana is in New York, where it is still yesterday evening, so her
    // phone filed the note under HER day. It is fifteen minutes old.
    await load(seed());
    await page.evaluate((s) => { window.__clockShift = s; }, backAt(0, 4) - Date.now());
    const NANA = mkNote('tz1', backAt(0, 3, 45), { createdByName: 'Nana Bear', text: 'Her temperature was 37.9 at ten, she settled after a feed' });
    NANA.day = dayKeyOf(backAt(1, 12));
    const tz = await page.evaluate((ns, p) => {
      state.notes = ns; view = 'home'; go('home'); render();
      const n = state.notes[0];
      return Object.assign(eval(p), { sameOnMyClock: dayKey(n.at) === dayKey(now()), authorFiledElsewhere: n.day !== dayKey(now()) });
    }, [NANA], PROBE);
    ok('the fixture really is two clocks disagreeing', tz.sameOnMyClock && tz.authorFiledElsewhere, tz);
    ok('the note is on her screen and counted new', tz.unseen === 1 && tz.cards === 1 && tz.badge === '1 new', tz);
    ok('under a heading that says Today', tz.head === 'Today', tz.head);
    ok('a note fifteen minutes old is never dated to nights ago', !/nights ago/.test(tz.bylines[0] || ''), tz.bylines);
    ok('and it carries no day at all, because the heading above it already does', tz.bylines[0] === 'Nana Bear', tz.bylines);

    // The same circle the other way round: the reader is the one who is behind, so the author's key
    // is TOMORROW from here. Same fifteen minutes, same answer.
    const AHEAD = mkNote('tz2', backAt(0, 19, 45), { createdByName: 'Nana Bear', text: 'She has been down since seven, no bother at all' });
    AHEAD.day = dayKeyOf(backAt(-1, 12));
    const tz2 = await page.evaluate((ns, p, s) => { window.__clockShift = s; state.notes = ns; view = 'home'; go('home'); render(); return eval(p); }, [AHEAD], PROBE, backAt(0, 20) - Date.now());
    ok('a note from a circle member whose day is ahead is still on the screen', tz2.unseen === 1 && tz2.cards === 1, tz2);
    ok('and it is not dated to nights ago either', tz2.bylines[0] === 'Nana Bear', tz2.bylines);

    /* The night the clocks go back, which needs no second timezone at all: America/New_York,
       2026-11-01 at 23:30. The day is 25 hours long, so now() minus 86,400,000 is STILL today and
       the Yesterday branch could never match. Last night's 11pm handover, 25 and a half hours old,
       read "Two nights ago" for the whole country at once. Stepping back a calendar day instead of
       a fixed number of milliseconds is what makes this one land. */
    const DST_NOW = Date.parse('2026-11-02T04:30:00Z');    // 23:30 Sun Nov 1, EST, after the change
    const DST_NIGHT = Date.parse('2026-11-01T03:00:00Z');  // 23:00 Sat Oct 31, EDT, 25.5 hours back
    await page.emulateTimezone('America/New_York');
    await load(seed());
    const dst = await page.evaluate((p, atMs, s) => {
      window.__clockShift = s;
      const n = { id: 'dst', text: 'Slight cold today, extra cuddles. Last fed 8pm.', createdBy: 'other', createdByName: 'Papa Bear', audience: 'circle', at: atMs, day: dayKey(atMs) };
      state.notes = [n]; view = 'home'; go('home'); render();
      return Object.assign(eval(p), { longDay: dayKey(now() - 86400000) === dayKey(now()), ageH: (now() - atMs) / 3600000 });
    }, PROBE, DST_NIGHT, DST_NOW - Date.now());
    ok('the fixture really is the 25-hour day, so a day back in milliseconds lands on today', dst.longDay, dst);
    ok('and last night\'s note is genuinely a night old, not two', Math.round(dst.ageH) === 26 || Math.round(dst.ageH) === 25, dst.ageH);
    ok('it is still new the next evening', dst.unseen === 1 && dst.cards === 1, dst);
    ok('carried onto today', dst.head === 'Today', dst.head);
    ok('and the byline says Yesterday, which is the night it was actually left', /· Yesterday$/.test(dst.bylines[0] || ''), dst.bylines);
    await page.emulateTimezone(null);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'NOTES-UNSEEN: FAIL' : 'NOTES-UNSEEN: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
