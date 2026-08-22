#!/usr/bin/env node
/* The birth poster had no way of reaching the parent it was built for.
 *
 * It needs only a name and a birthday, which saveBaby refuses to create a baby without. It draws
 * every detail she has not filled in as a dotted placeholder that never reaches the saved file. It
 * produces a printable painted keepsake stamped "made with Cubby". And the only way to it was
 * Album -> Memories -> a card near the bottom: three navigations deep, offered nowhere else in the
 * product.
 *
 * Meanwhile the ONE keepsake Cubby offers unprompted, the month card, cannot appear at all while
 * the baby is under a month old, because monthiversary() returns null while m < 1. So through the
 * exact four weeks in which a household decides whether Cubby is part of its life, the keepsake
 * layer had nothing to give, and the thing it could have given was buried.
 *
 * Two openings, both from things she has already typed:
 *   1. one row in openOnboardInvite, the second beat of the first session, under the first log;
 *   2. one pill in the home alert stack, in the slot the month card takes over the day it can.
 *
 * What this gate refuses to let regress: a bereaved parent being handed a keepsake to make, a
 * pregnancy having a baby's poster offered to it (openBirthPoster dereferences activeBaby() and
 * would throw), the nudge and the month card both sitting in the stack at once, and an offer that
 * comes back after she has answered it.
 *
 * And three things a first pass got wrong, each of which a reviewer reproduced in a browser:
 *   - block 6: the pill deferred to the get-started checklist on state.events, a fact about the
 *     FAMILY, while that checklist retires per PERSON for a joiner. The second caregiver, who is
 *     the wedge, got the keepsake offer stacked under her own unfinished five-row setup list.
 *   - block 2: the setup row and the home pill shared openPosterOffer, so one peek at an empty
 *     poster on the first evening silently spent the nudge meant to carry the next four weeks.
 *   - block 15: the poster printed saveBaby's 8:00 AM placeholder as if it were the hour the baby
 *     was born, beside seven fields honest enough to stay dotted, and this change is what puts that
 *     page in front of every new parent.
 *
 *   PORT=9384 node tools/serve.js &
 *   node tools/poster_second_beat_check.js http://localhost:9384
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* No default port. Three agents in this repo have graded a DIFFERENT checkout's server because a
   bare run fell back to 8080/8099/8123 and something was already listening there; one of them
   graded main and reported a clean pass. A URL you did not pass is not a URL you can trust. */
const BASE = process.argv[2];
if (!BASE) {
  console.error('Pass the base URL of the server for THIS tree, e.g.\n  PORT=9317 node tools/serve.js &\n  node tools/poster_second_beat_check.js http://localhost:9317');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 13:00 on the 10th of the month. A fixed day-of-month matters here: the boundary under test is a
// calendar month, and running this on the 31st would otherwise walk into setMonth's overflow.
const CLOCK = (() => { const d = new Date(); d.setDate(10); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

// A newborn: six days old, well inside the window where the month card cannot exist yet.
const NEWBORN = { id: 'b1', name: 'Robin', birth: now - 6 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] };
const oneFeed = (babyId) => ({ id: 'f-' + babyId, type: 'feed', babyId, method: 'bottle', amount: 90, unit: 'ml', time: now - 2 * HOUR, authorId: 'local' });

const seed = (over) => Object.assign({
  babies: [Object.assign({}, NEWBORN)],
  activeBabyId: 'b1', events: [oneFeed('b1')], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

/* Every probe below reads the real rendered stack, never a variable. A pill is identified by the
   handler on its own button, which is the thing a thumb actually reaches. */
const PROBE = `(function(){
  var pills=[].slice.call(document.querySelectorAll('.alert-pill'));
  var find=function(fn){ return pills.filter(function(p){
    return [].slice.call(p.querySelectorAll('button')).some(function(b){ return (b.getAttribute('onclick')||'').indexOf(fn)>=0; });
  }); };
  var poster=find('openPosterOffer'), month=find('openMemoryCard');
  var p0=poster[0];
  return {
    pills: pills.length,
    poster: poster.length,
    month: month.length,
    title: p0?(p0.querySelector('.ap-t')||{}).textContent:null,
    sub: p0?(p0.querySelector('.ap-s')||{}).textContent:null,
    acts: p0?[].slice.call(p0.querySelectorAll('button')).map(function(b){return b.textContent.trim();}):[]
  };
})()`;

/* Every block below has to survive the poster offer being ABSENT, because that is precisely the
   tree this gate is supposed to go red against. A probe that throws on a missing element kills the
   run at block two and reports nothing, which looks identical to a gate nobody has ever watched
   fail. So the probes return a shape and the assertions do the judging. */
const PILL = (fn) => `(function(){
  var pills=[].slice.call(document.querySelectorAll('.alert-pill'));
  return pills.filter(function(x){ return [].slice.call(x.querySelectorAll('button')).some(function(b){ return (b.getAttribute('onclick')||'').indexOf('${fn}')>=0; }); })[0]||null;
})()`;

const SHEET = `(function(){
  var s=document.getElementById('sheet');
  var open=!!(s&&s.classList.contains('show'));
  var btns=open?[].slice.call(s.querySelectorAll('button')):[];
  var rows=btns.filter(function(b){ return /birth poster/i.test(b.textContent||''); });
  return {
    open: open,
    h2: open?((s.querySelector('h2')||{}).textContent||'').trim():'',
    posterRows: rows.length,
    posterLabel: rows.length?rows[0].textContent.trim():null,
    labels: btns.map(function(b){return b.textContent.trim();})
  };
})()`;

(async () => {
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

  /* The seen map is per signed-in person and lives in localStorage, and migrateSeenOnce only ever
     copies state.settings.seen across on the FIRST load of a device. Seeding it through the blob
     would therefore work once and then silently stop, so every load writes the map itself. */
  const load = async (s, opts) => {
    opts = opts || {};
    await page.evaluate((x, o) => {
      var uid = o.uid || 'local';
      localStorage.setItem('cubby-quick-uid', uid);
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      localStorage.setItem('cubby-seen-' + uid, JSON.stringify(o.seen || {}));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s, opts);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1400);
  };

  console.log('\n1. the first session ends by handing her something, not only by asking');
  {
    await load(seed());
    const r = await page.evaluate(`(function(){ openOnboardInvite(); return ${SHEET}; })()`);
    ok('the setup sheet is up', r.open === true && /get home/i.test(r.h2), r.h2);
    ok('it offers the birth poster, exactly once', r.posterRows === 1, r);
    ok('and names the baby rather than "your little one"', /robin/i.test(r.posterLabel || ''), r.posterLabel);
    /* Order is the point of the item: the log is the ask, the poster is what she gets back, and the
       invite stays below both. A row that exists but sits under six others is not a second beat. */
    const order = await page.evaluate(`(function(){
      var b=[].slice.call(document.querySelectorAll('#sheet button')).map(function(x){return x.textContent.trim();});
      return { poster:b.findIndex(function(t){return /birth poster/i.test(t);}),
               invite:b.findIndex(function(t){return /^invite someone$/i.test(t);}),
               another:b.findIndex(function(t){return /another little one/i.test(t);}) };
    })()`);
    ok('it sits above the invite', order.poster > -1 && order.invite > order.poster, order);
    // Both halves, because a row that is not there at all has index -1 and would sail past a bare
    // "is it above" comparison. An absent thing is not an early thing.
    ok('and above "add another little one"', order.poster > -1 && order.another > order.poster, order);
  }

  console.log('\n2. tapping that row opens the real poster, and does not spend the home nudge');
  {
    const r = await page.evaluate(`(function(){
      var rows=[].slice.call(document.querySelectorAll('#sheet button')).filter(function(b){return /birth poster/i.test(b.textContent||'');});
      if(!rows.length) return { missing:true, h2:'', gen:false, styles:0 };
      rows[0].click();
      var s=document.getElementById('sheet');
      return { missing:false, h2:((s.querySelector('h2')||{}).textContent||'').trim(),
               gen:[].slice.call(s.querySelectorAll('button')).some(function(b){return /generate poster/i.test(b.textContent||'');}),
               styles:s.querySelectorAll('.chip-row .chip').length };
    })()`);
    ok('a real tap lands on the poster sheet', /birth poster/i.test(r.h2), r);
    ok('with the generate button on it', r.gen === true, r);
    ok('and its style chips, so it is the built sheet and not a stub', r.styles >= 5, r);
    /* THE FIRST EVENING, end to end. Nothing logged yet, so the setup sheet is the only place the
       poster is offered and the home pill has not been earned. She looks at it, closes it, and logs
       her first nappy. The pill has to still be waiting for her.
       This row is a menu she opened, not a nudge that arrived, and the two must not share a
       retire-the-nudge handler: routed through openPosterOffer, one peek at an empty poster on the
       first evening silently burned the offer that was supposed to carry the next four weeks.
       Asserted on the stack she is handed back AND on the flag, because here the flag is the bug. */
    await load(seed({ events: [] }));
    const carried = await page.evaluate(`(function(){
      openOnboardInvite();
      var rows=[].slice.call(document.querySelectorAll('#sheet button')).filter(function(b){return /birth poster/i.test(b.textContent||'');});
      var opened=false;
      if(rows.length){ rows[0].click(); var s=document.getElementById('sheet');
        opened=/birth poster/i.test(((s.querySelector('h2')||{}).textContent||'')); }
      closeSheet();
      state.events.push({id:'f-first',type:'diaper',babyId:'b1',kind:'wet',time:Date.now()-600000,authorId:'local'});
      render();
      var uid=localStorage.getItem('cubby-quick-uid')||'local';
      var seen=JSON.parse(localStorage.getItem('cubby-seen-'+uid)||'{}');
      var out=${PROBE}; out.opened=opened; out.flag=!!seen['tip_poster_b1']; return out;
    })()`);
    ok('the peek from setup really did open the poster', carried.opened === true, carried);
    ok('it did not write the nudge flag behind her back', carried.flag === false, carried);
    ok('so once she has logged, the pill is still waiting for her', carried.poster === 1, carried);
  }

  console.log('\n3. a pregnancy is never offered a baby\'s poster');
  {
    await load(seed({ babies: [], activeBabyId: null, events: [],
      pregnancy: { stage: 'expecting', due: now + 90 * DAY, country: 'gb', mode: 'due' } }));
    const r = await page.evaluate(`(function(){ openOnboardInvite(); return ${SHEET}; })()`);
    // "Nothing happened" proves nothing on its own, so the sheet has to be demonstrably the right one.
    ok('the pregnancy finish sheet is up', r.open === true && r.labels.length > 0, r.labels);
    ok('it still offers the invite', r.labels.some((t) => /invite someone/i.test(t)), r.labels);
    ok('and offers no birth poster, which would dereference a baby that does not exist', r.posterRows === 0, r);
    ok('no error was thrown reaching it', errs.length === 0, errs.slice(0, 2));
  }

  console.log('\n4. home carries it through the weeks the month card cannot');
  {
    await load(seed());
    const r = await page.evaluate(PROBE);
    ok('the pill is in the alert stack, exactly once', r.poster === 1, r);
    ok('the month card is not, because a six-day-old has no month yet', r.month === 0, r);
    ok('it names the baby', /robin/i.test(r.title || ''), r.title);
    ok('it says what it is made of, so the offer is not a mystery', /birthday/i.test(r.sub || ''), r.sub);
    ok('it has two ways out', r.acts.length === 2, r.acts);
    ok('one of them is a decline', r.acts.some((t) => /not now/i.test(t)), r.acts);
  }

  console.log('\n5. nothing logged yet: the checklist owns the screen, not a keepsake offer');
  {
    await load(seed({ events: [] }));
    const r = await page.evaluate(PROBE);
    ok('no poster pill before the first log', r.poster === 0, r);
    // Proof the screen rendered at all, rather than a blank paint faking a pass.
    const home = await page.evaluate(`(function(){
      return { greeting: !!document.querySelector('.greeting'), actions: document.querySelectorAll('.actions .action').length };
    })()`);
    ok('and the home screen really did render', home.greeting === true && home.actions > 0, home);
    // The setup sheet is a menu she opened, so it keeps offering it whether or not she has logged.
    const sheet = await page.evaluate(`(function(){ openOnboardInvite(); return ${SHEET}; })()`);
    ok('the setup sheet still offers it, because that is a menu and not a nudge', sheet.posterRows === 1, sheet);
  }

  console.log('\n6. the second caregiver: the same deference, measured on the subject that is hers');
  {
    /* The co-parent or the nanny who joins in the newborn month, which is the wedge. The FAMILY has
       logs, because the owner has been logging since the birth, but this reader has none, and
       renderGetStarted retires PER PERSON for a joiner: her five-row setup checklist is still up.
       A household-wide test on state.events therefore stacked a print-a-keepsake offer underneath
       an unfinished checklist, on the screen of the one person in the family who has never logged.
       window.LL.role is set the way store-firebase.js:1763 sets it from the household members map. */
    const owned = [Object.assign({}, oneFeed('b1'), { id: 'o1', authorId: 'owner-uid' }),
                   Object.assign({}, oneFeed('b1'), { id: 'o2', authorId: 'owner-uid', time: now - 5 * HOUR })];
    await load(seed({ events: owned }), { uid: 'nanny-uid', seen: {} });
    const AS = (role) => `(function(){
      window.LL=window.LL||{}; window.LL.role='${role}'; window.LL.householdId='h1';
      window.LL.members={'owner-uid':'owner','nanny-uid':'caregiver'};
      render();
      var out=${PROBE}; out.gsRows=document.querySelectorAll('.gs-row').length; return out;
    })()`;
    const her = await page.evaluate(AS('caregiver'));
    ok('her get-started checklist is genuinely up', her.gsRows > 0, her);
    ok('and no keepsake offer is stacked underneath it', her.poster === 0, her);
    /* The control, so this is not an absence that would pass for free on a tree with no feature at
       all: the same household, the same two logs, read by the owner, still gets the pill. */
    const owner = await page.evaluate(AS('owner'));
    ok('the owner, same household and same logs, is still offered it', owner.poster === 1, owner);
    ok('because for her the checklist is finished', owner.gsRows === 0, owner);
    const after = await page.evaluate(`(function(){
      window.LL.role='caregiver';
      state.events.unshift({id:'n1',type:'diaper',babyId:'b1',kind:'wet',time:Date.now()-600000,authorId:'nanny-uid'});
      render();
      var out=${PROBE}; out.gsRows=document.querySelectorAll('.gs-row').length; return out;
    })()`);
    ok('once she has logged something herself the checklist stands down', after.gsRows === 0, after);
    ok('and then the keepsake is offered to her too', after.poster === 1, after);
  }

  console.log('\n7. the handoff: the month card takes the slot the day it can use it');
  {
    // One calendar month and two days old. monthiversary() is live; the poster nudge must be gone.
    const bd = new Date(now); bd.setMonth(bd.getMonth() - 1); bd.setDate(bd.getDate() - 2);
    await load(seed({ babies: [Object.assign({}, NEWBORN, { birth: bd.getTime() })] }));
    const r = await page.evaluate(PROBE);
    ok('the month card is up', r.month === 1, r);
    ok('the poster nudge has stood down', r.poster === 0, r);
    ok('exactly one keepsake pill is on the screen, never two', r.month + r.poster === 1, r);

    // And the day before the boundary, the other way round.
    const bd2 = new Date(now); bd2.setMonth(bd2.getMonth() - 1); bd2.setDate(bd2.getDate() + 1);
    await load(seed({ babies: [Object.assign({}, NEWBORN, { birth: bd2.getTime() })] }));
    const r2 = await page.evaluate(PROBE);
    ok('a day before the month mark it is still the poster', r2.poster === 1, r2);
    ok('and the month card is not up yet', r2.month === 0, r2);
    ok('again exactly one, never two', r2.month + r2.poster === 1, r2);
  }

  console.log('\n8. "not now" is an answer, and it survives a reload');
  {
    await load(seed());
    const before = await page.evaluate(PROBE);
    ok('the pill starts up', before.poster === 1, before);
    const after = await page.evaluate(`(function(){
      var p=${PILL('dismissPosterOffer')};
      if(p) p.querySelector('button.ap-quiet').click();
      var out=${PROBE}; out.clicked=!!p; return out;
    })()`);
    ok('there was a decline button to press', after.clicked === true, after);
    ok('declining takes it off the screen', after.clicked === true && after.poster === 0, after);
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);
    const back = await page.evaluate(PROBE);
    ok('and it does not come back on the next open', back.poster === 0, back);
    const still = await page.evaluate(`(function(){ return { pills: document.querySelectorAll('.alert-pill').length, greeting: !!document.querySelector('.greeting') }; })()`);
    ok('the reload really did paint home', still.greeting === true, still);
  }

  console.log('\n9. taking it from home also settles it for good');
  {
    await load(seed());
    const r = await page.evaluate(`(function(){
      var p=${PILL('openPosterOffer')};
      if(!p) return { h2:'', missing:true };
      [].slice.call(p.querySelectorAll('button')).filter(function(b){return /see it/i.test(b.textContent||'');})[0].click();
      var s=document.getElementById('sheet');
      return { missing:false, h2:((s.querySelector('h2')||{}).textContent||'').trim() };
    })()`);
    ok('See it opens the poster', /birth poster/i.test(r.h2), r);
    await page.evaluate('closeSheet()');
    await page.reload({ waitUntil: 'networkidle2' }); await sleep(1400);
    const back = await page.evaluate(PROBE);
    ok('and it is not offered again after a reload', back.poster === 0, back);
  }

  console.log('\n10. the answer belongs to that baby, not to the parent forever');
  {
    const twin = Object.assign({}, NEWBORN, { id: 'b2', name: 'Wren' });
    await load(seed({ babies: [Object.assign({}, NEWBORN), twin], events: [oneFeed('b1'), oneFeed('b2')] }));
    const r1 = await page.evaluate(`(function(){
      var p=${PILL('dismissPosterOffer')};
      if(p) p.querySelector('button.ap-quiet').click();
      var out=${PROBE}; out.clicked=!!p; return out;
    })()`);
    ok('the first twin was offered one to decline', r1.clicked === true, r1);
    ok('declining the first twin\'s poster clears it', r1.clicked === true && r1.poster === 0, r1);
    const r2 = await page.evaluate(`(function(){ state.activeBabyId='b2'; render(); return ${PROBE}; })()`);
    ok('the second twin is still offered their own', r2.poster === 1, r2);
    ok('and it is named for them', /wren/i.test(r2.title || ''), r2.title);
    const r3 = await page.evaluate(`(function(){ state.activeBabyId='b1'; render(); return ${PROBE}; })()`);
    ok('going back to the first, the answer she gave still holds', r3.poster === 0, r3);
  }

  console.log('\n11. one parent declining does not answer for the other');
  {
    await load(seed(), { uid: 'local', seen: { 'tip_poster_b1': 1 } });
    const mine = await page.evaluate(PROBE);
    ok('the parent who declined sees nothing', mine.poster === 0, mine);
    await load(seed(), { uid: 'papa', seen: {} });
    const theirs = await page.evaluate(PROBE);
    ok('the second person on this device is offered it', theirs.poster === 1, theirs);
  }

  console.log('\n12. loss-safe: nobody being held gently is handed a keepsake to make');
  {
    await load(seed({ lossHolding: { local: { at: now - 3 * DAY } } }));
    const r = await page.evaluate(PROBE);
    ok('no poster pill for a parent holding a loss', r.poster === 0, r);
    const home = await page.evaluate(`(function(){ return { quiet: /keeping things quiet/i.test((document.querySelector('.greeting-sub')||{}).textContent||''), greeting: !!document.querySelector('.greeting') }; })()`);
    ok('and the quiet state is genuinely the one on screen', home.quiet === true, home);
    const sheet = await page.evaluate(`(function(){ openOnboardInvite(); return ${SHEET}; })()`);
    ok('the setup sheet does not offer it either', sheet.posterRows === 0, sheet);
    ok('though the sheet itself rendered', sheet.open === true && sheet.labels.length > 0, sheet.labels);
  }

  console.log('\n13. a baby with no birthday has no poster to be offered');
  {
    await load(seed({ babies: [Object.assign({}, NEWBORN, { birth: null })] }));
    const r = await page.evaluate(PROBE);
    ok('no pill without a birthday', r.poster === 0, r);
    const sheet = await page.evaluate(`(function(){ openOnboardInvite(); return ${SHEET}; })()`);
    ok('and no row either', sheet.posterRows === 0, sheet);
    ok('the sheet still came up', sheet.open === true && sheet.labels.length > 0, sheet.labels);
    /* Asked of the guard itself, because the pill half of this block passes by accident otherwise:
       with birth null, new Date(null) is the epoch, the month mark lands in 1970 and posterOfferDue
       returns null on the arithmetic no matter what posterOfferable does. The row is the only half
       that was ever load-bearing. This is the half that names the actual rule. */
    const g = await page.evaluate(`(function(){ return { offerable: (typeof posterOfferable==='function')?!!posterOfferable():null }; })()`);
    ok('posterOfferable itself refuses, rather than the month arithmetic refusing by accident', g.offerable === false, g);
  }

  console.log('\n14. it lands where a thumb can use it');
  {
    await load(seed());
    const r = await page.evaluate(`(function(){
      var pills=[].slice.call(document.querySelectorAll('.alert-pill'));
      var p=pills.filter(function(x){ return [].slice.call(x.querySelectorAll('button')).some(function(b){return (b.getAttribute('onclick')||'').indexOf('openPosterOffer')>=0;}); })[0];
      if(!p) return null;
      var box=p.getBoundingClientRect();
      var btns=[].slice.call(p.querySelectorAll('button')).map(function(b){ var r=b.getBoundingClientRect(); return { w:Math.round(r.width), h:Math.round(r.height) }; });
      return { width:Math.round(box.width), overflow: box.right>390.5, btns:btns };
    })()`);
    ok('the pill is on the screen', r !== null, r);
    ok('it does not run off a 390px phone', r && r.overflow === false, r);
    ok('and both buttons clear the 44px tap target', r && r.btns.length === 2 && r.btns.every((b) => b.h >= 44), r);
  }

  console.log('\n15. the page it leads to never prints an hour nobody gave it');
  {
    /* This offer puts the poster in front of every new parent, twice, in the weeks that decide
       whether she stays, wrapped in a line that vouches for what is on it. saveBaby asks for a name
       and a birthday and no time at all, then writes new Date(bd+'T08:00'), and composePoster drew
       that placeholder in the same keepsake numerals as the date, beside seven fields honest enough
       to stay dotted. A mother who prints it at 40x60 and frames it finds out from somebody who was
       in the room.
       Measured on the canvas itself: fillText is wrapped, so these are the strings composePoster
       actually paints, not a variable that claims to describe them. */
    const CAPTURE = `(function(){
      var drawn=[]; var F=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(t){ drawn.push(String(t)); return F.apply(this,arguments); };
      try { openBirthPoster(); } finally { CanvasRenderingContext2D.prototype.fillText=F; }
      return { drawn:drawn, known:(typeof birthTimeKnown==='function')?birthTimeKnown(activeBaby()):null };
    })()`;
    const bd = new Date(now); bd.setDate(bd.getDate() - 6); bd.setHours(8, 0, 0, 0);   // exactly what saveBaby writes
    await load(seed({ babies: [Object.assign({}, NEWBORN, { birth: bd.getTime() })] }));
    const r = await page.evaluate(CAPTURE);
    ok('the poster really did paint, with her name on it', r.drawn.some((t) => /robin/i.test(t)), r.drawn.slice(0, 8));
    ok('and the birthday she did give', r.drawn.some((t) => t === String(bd.getDate())) && r.drawn.some((t) => t === String(bd.getFullYear())), r.drawn.slice(0, 12));
    ok('the untouched 8:00 placeholder does not count as a time she gave', r.known === false, r.known);
    ok('so no hour is printed on the paper at all', !r.drawn.some((t) => /\b0?8:00\b/.test(t)), r.drawn.filter((t) => /\d:\d/.test(t)));
    /* The other direction, so none of the above is an absence that passes for free on a tree with
       no such rule: an hour that IS hers still prints, in the numerals it always did. */
    const bd2 = new Date(bd); bd2.setHours(9, 37, 0, 0);
    await load(seed({ babies: [Object.assign({}, NEWBORN, { birth: bd2.getTime() })] }));
    const r2 = await page.evaluate(CAPTURE);
    ok('a real birth time is known', r2.known === true, r2.known);
    ok('and it is printed', r2.drawn.some((t) => /\b0?9:37\b/.test(t)), r2.drawn.filter((t) => /\d:\d/.test(t)));
    // And a parent who set 8:00 herself in Birth details is not second-guessed by the placeholder rule.
    const r3 = await page.evaluate(`(function(){ var b=activeBaby(); b.birth=${bd.getTime()}; b.birthTimeSet=true; return ${CAPTURE}; })()`);
    ok('an 8:00 she set herself is hers, and prints', r3.known === true && r3.drawn.some((t) => /\b0?8:00\b/.test(t)), r3.drawn.filter((t) => /\d:\d/.test(t)));
    await page.evaluate('closeSheet()');
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'POSTER-SECOND-BEAT: FAIL' : 'POSTER-SECOND-BEAT: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
