#!/usr/bin/env node
/* The nappy that made her look twice had nowhere to go.
 *
 * teach-data.js promised, under the Nappy sheet's own heading, "anything that made you look twice,
 * in your own words". The sheet was four buttons and a clock. eventDetail (app/index.html:4017) had
 * carried `if(e.type==='diaper'&&e.notes) return e.notes;` for as long as anyone can remember, dead
 * code, because nothing in the app could write that field. So a streak of blood, a mucus thread, the
 * first nappy after starting iron, the colour that changed overnight: the single most-asked-about
 * observation of the first year got typed into a general note if it got recorded at all, filed away
 * from the nappy it belonged to, and it never reached the one page written for a clinician.
 *
 * This gate holds the whole path: the field on the sheet, the words on the event, the words on the
 * timeline, the words in the edit sheet including when someone else wrote them, and the words on the
 * visit summary with their date and time. Plus the ways it could quietly lie: an empty note inventing
 * a field, a draft leaking into the next nappy, a note from another baby or from outside the window
 * appearing on a doctor's page, a multi-line note breaking the printed layout.
 *
 * Sections 18-21 exist because two reviewers reproduced real failures against a tree this file was
 * already printing 75/0 over: a note typed with Both selected was copied verbatim onto the other
 * twin's clinician page; a locked empty note box invited a second caregiver to write in it on every
 * nappy her partner logged; a note corrected down to a space painted a blank timeline line; and two
 * nappies of the same kind inside the 900ms slip window threw away the second one's words while the
 * toast still said "note saved".
 *
 *   PORT=<your own free port> node tools/serve.js &
 *   node tools/nappy_note_check.js http://localhost:<that port>
 */
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/* No default. On a box running ten agents in ten worktrees, any port this file could name is
   already held by somebody else's checkout, and a gate that silently grades another tree is worse
   than one that refuses to run. This has cost this project three separate false passes. */
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/nappy_note_check.js <base-url>   (serve YOUR tree on a free port and pass it)'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000, HOUR = 3600000;
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         got: ' + JSON.stringify(x) : '')); } };

// 14:00, so nothing in here straddles midnight and every "yesterday" is genuinely yesterday.
const CLOCK = (() => { const d = new Date(); d.setHours(14, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

const seed = (over) => Object.assign({
  babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
  activeBabyId: 'b1', events: [], illnesses: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
}, over || {});

const nappy = (id, kind, ago, notes, over) => Object.assign({
  id: id, type: 'diaper', babyId: 'b1', kind: kind, time: now - ago, authorId: 'local',
}, notes ? { notes: notes } : {}, over || {});

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
  /* A gate has to report, not die. Without these guards the very first evaluate on a tree that has
     no note field throws on a null element and every section below it is skipped, which looks like
     a short run rather than a broken feature. Each helper returns false instead, so the assertion
     that cares fails and the rest of the file still runs. */
  await page.evaluateOnNewDocument(() => {
    window.__n = {
      type: (v, fire) => { const i = document.getElementById('dNote'); if (!i) return false; i.value = v; if (fire !== false) i.dispatchEvent(new Event('input', { bubbles: true })); return true; },
      typed: () => { const i = document.getElementById('dNote'); return i ? i.value : null; },
      edit: (v) => { const i = document.getElementById('eNote'); if (!i) return false; i.value = v; return true; },
      tap: (kind) => { const o = [].slice.call(document.querySelectorAll('#sheet .opt')).filter((x) => new RegExp('^' + kind, 'i').test(x.textContent.trim()))[0]; if (!o) return false; o.click(); return true; },
      // The target chips are first-class controls on this sheet, so the gate presses them the way a
      // parent does rather than assigning logTargets behind the sheet's back.
      chip: (label) => { const c = [].slice.call(document.querySelectorAll('#sheet .tgt')).filter((x) => new RegExp(label, 'i').test(x.textContent))[0]; if (!c) return false; c.click(); return true; },
      // What the note slot looks like right now: the box if there is one, and whatever line of
      // explanation sits under the Note label either way.
      slot: () => {
        const sheet = document.getElementById('sheet');
        const lab = [].slice.call(sheet.querySelectorAll('.field label')).filter((l) => /^Note/.test(l.textContent.trim()))[0];
        const fld = lab ? lab.closest('.field') : null;
        const inp = document.getElementById('dNote');
        const hint = fld ? fld.querySelector('.csub') : null;
        return { field: !!fld, input: !!inp, hint: hint ? hint.textContent.trim() : null,
          hintPx: hint ? parseFloat(getComputedStyle(hint).fontSize) : null,
          inputPx: inp ? parseFloat(getComputedStyle(inp).fontSize) : null,
          bodyPx: parseFloat(getComputedStyle(document.body).fontSize) };
      },
    };
  });
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));

  const load = async (s) => {
    await page.evaluate((x) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      Object.keys(localStorage).forEach((k) => { if (k.indexOf('cubby-theme') === 0) localStorage.removeItem(k); });
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1300);
  };

  console.log('\n1. the sheet has somewhere to put it');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper();
      const inp = document.getElementById('dNote');
      const sheet = document.getElementById('sheet');
      const grid = sheet.querySelector('.opt-grid');
      const strip = sheet.querySelector('.time-strip');
      const pos = (el) => el ? [].indexOf.call(sheet.querySelectorAll('*'), el) : -1;
      const fld = inp ? inp.closest('.field') : null;
      return {
        has: !!inp, tag: inp ? inp.tagName : null, placeholder: inp ? inp.getAttribute('placeholder') : null,
        label: fld ? (fld.querySelector('label') || {}).textContent : null,
        hint: fld ? (fld.querySelector('.csub') || {}).textContent : null,
        afterGrid: pos(inp) > pos(grid), beforeStrip: pos(inp) < pos(strip),
        kinds: [].slice.call(sheet.querySelectorAll('.opt')).map((o) => o.textContent.trim()),
        slot: __n.slot(),
      };
    });
    ok('there is a note field on the nappy sheet', r.has === true, r);
    ok('it is a single line, not a textarea', r.tag === 'INPUT', r);
    ok('it sits under the four kinds', r.afterGrid === true, r);
    // pos() returns -1 for an element that is not there, and -1 is below everything, so this used
    // to pass on a tree with no note field at all. Paired with has, it cannot.
    ok('and above the time strip', r.has === true && r.beforeStrip === true, r);
    ok('all four kinds are still offered', r.kinds.length === 4 && /Wet/.test(r.kinds[0]) && /Dry/.test(r.kinds[3]), r);
    ok('it is marked optional', /optional/i.test(r.label || ''), r);
    // A field whose save button is four tiles above it has to say so, or a typed note dies with
    // the sheet and the parent never learns it did.
    ok('it says where the words go', /tap above/i.test(r.hint || ''), r);
    ok('the placeholder is the promise teach-data already made', /look twice/i.test(r.placeholder || ''), r);
    /* .csub is styled only as .stat-card .csub, so in a sheet it inherits body type: 16px, full ink,
       borderless, directly under the box. Measured rather than read off the markup, because the bug
       is entirely in the computed value. It has to read as a hint, not as a second note field. */
    ok('the hint is quieter than the words she types', r.slot.hintPx !== null && r.slot.inputPx !== null && r.slot.hintPx < r.slot.inputPx, r.slot);
    ok('and quieter than body text, not the same size as it', r.slot.hintPx !== null && r.slot.hintPx <= r.slot.bodyPx - 2, r.slot);
  }

  console.log('\n2. what she types is what is stored');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper();
      const typed = __n.type('  a thread of mucus, dark green  ');
      __n.tap('Dirty');
      const evs = state.events.filter((e) => e.type === 'diaper');
      const t = document.getElementById('toast');
      return { typed: typed, n: evs.length, kind: evs[0] && evs[0].kind, notes: evs[0] && evs[0].notes,
        toast: (t.textContent || '').replace(/\s+/g, ' ').trim(),
        open: document.getElementById('sheet').classList.contains('show') };
    });
    ok('there is somewhere to type it', r.typed === true, r);
    ok('exactly one nappy is written', r.n === 1, r);
    ok('with the kind she tapped', r.kind === 'dirty', r);
    ok('and her words, trimmed but not reworded', r.notes === 'a thread of mucus, dark green', r);
    ok('the toast tells her the note landed', /note saved/i.test(r.toast), r);
    ok('and the sheet closes behind her', r.open === false, r);
  }

  console.log('\n3. the last keystroke is not lost to the tap');
  {
    // iOS autocorrect and dictation can land text without firing the oninput this sheet listens
    // to. saveDiaper reads the live input for exactly this, so a note typed and immediately
    // tapped away is still hers.
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper();
      __n.type('a streak of blood', false);   // value set, no input event, on purpose
      __n.tap('Wet');
      const e = state.events.filter((x) => x.type === 'diaper')[0];
      return { notes: e && e.notes, kind: e && e.kind };
    });
    ok('a note the draft never heard about is still saved', r.notes === 'a streak of blood', r);
    ok('on the right kind', r.kind === 'wet', r);
  }

  console.log('\n4. an empty note invents nothing');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper();
      __n.tap('Wet');
      openDiaper();
      __n.type('     ');
      __n.tap('Both');
      const evs = state.events.filter((e) => e.type === 'diaper');
      return { n: evs.length, keys: evs.map((e) => Object.prototype.hasOwnProperty.call(e, 'notes')),
        details: evs.map((e) => eventDetail(e)) };
    });
    ok('both plain nappies are written', r.n === 2, r);
    // Two counts, not an .every(): an empty array would pass "none of them has a notes key".
    ok('neither carries a notes field at all', r.keys.length === 2 && r.keys.filter(Boolean).length === 0, r);
    ok('and the timeline detail line stays empty for them', r.details.length === 2 && r.details.join('') === '', r);
  }

  console.log('\n5. the note does not follow her to the next nappy');
  {
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper();
      const typed = __n.type('very pale');
      __n.tap('Dirty');
      openDiaper();
      const shown = __n.typed();
      __n.tap('Wet');
      const evs = state.events.filter((e) => e.type === 'diaper').sort((x, y) => x.time - y.time);
      return { typed: typed, shown: shown, n: evs.length, notes: evs.map((e) => e.notes || null) };
    });
    ok('the note was typed in the first place', r.typed === true, r);
    ok('the reopened sheet starts blank', r.shown === '', r);
    ok('two nappies, one note between them', r.n === 2 && r.notes.filter(Boolean).length === 1, r);
    // Both halves, or "one of them has no note" is true of a tree where neither has one.
    ok('and the plain one stayed plain', r.notes.filter(Boolean).length === 1 && r.notes.indexOf(null) !== -1, r);
  }

  console.log('\n6. picking the other baby does not eat what she typed');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 90 * DAY, routines: [], doctors: [], allergies: [] }],
    }));
    const r = await page.evaluate(() => {
      openDiaper();
      const typed = __n.type('blood on the wipe');
      const chip = [].slice.call(document.querySelectorAll('#sheet .tgt')).filter((c) => /Wren/.test(c.textContent))[0];
      const had = !!chip;
      if (chip) chip.click();
      const after = __n.typed();
      __n.tap('Dirty');
      const evs = state.events.filter((e) => e.type === 'diaper');
      return { typed: typed, had: had, after: after, n: evs.length, on: evs.map((e) => e.babyId), notes: evs.map((e) => e.notes) };
    });
    ok('the note was typed in the first place', r.typed === true, r);
    ok('there is a per-baby chip to press', r.had === true, r);
    ok('the typed note survives the re-render', r.after === 'blood on the wipe', r);
    ok('one nappy, on the baby she picked', r.n === 1 && r.on[0] === 'b2', r);
    ok('and it kept the note', r.notes[0] === 'blood on the wipe', r);
  }

  console.log('\n7. it reads back on the timeline, and after a reload');
  {
    /* Typed through the sheet, not seeded into localStorage. Seeding only exercises eventDetail's
       branch at :4017, which HEAD already carried as dead code, so a seeded version of this section
       printed green on a tree where nothing could write the field. */
    await load(seed());
    const wrote = await page.evaluate(() => {
      openDiaper();
      const typed = __n.type('a thread of blood');
      __n.tap('Dirty');
      return { typed: typed, n: state.events.filter((e) => e.type === 'diaper').length };
    });
    ok('the note went in through the sheet, not the store', wrote.typed === true && wrote.n === 1, wrote);
    const r = await page.evaluate(() => {
      go('log'); if (typeof setLogTab === 'function') setLogTab('log');
      const rows = [].slice.call(document.querySelectorAll('#scroll .tl-item'))
        .filter((x) => /Nappy/.test((x.querySelector('.t1') || {}).textContent || ''));
      return { rows: rows.length, t1: rows[0] ? rows[0].querySelector('.t1').textContent.trim() : null,
        t2: rows[0] && rows[0].querySelector('.t2') ? rows[0].querySelector('.t2').textContent.trim() : null };
    });
    ok('the nappy is on the timeline', r.rows === 1, r);
    ok('titled by its kind', /dirty/i.test(r.t1 || ''), r);
    ok('with the note as its detail line', r.t2 === 'a thread of blood', r);

    /* Survives a reload: read the persisted store rather than the paint. Seeded rather than typed,
       because in this harness the signed-out firestore cache writes its own copy of the store back
       over localStorage a beat after persist() lands, so a UI-written event loses that race. The
       typed half above already proves the write path; this half proves the round trip. */
    await load(seed({ events: [nappy('d1', 'dirty', 2 * HOUR, 'a thread of blood')] }));
    const after = await page.evaluate(() => {
      go('log'); if (typeof setLogTab === 'function') setLogTab('log');
      const stored = JSON.parse(localStorage.getItem('little-log-v1')).events.filter((e) => e.type === 'diaper');
      const row = [].slice.call(document.querySelectorAll('#scroll .tl-item'))
        .filter((x) => /Nappy/.test((x.querySelector('.t1') || {}).textContent || ''))[0];
      return { stored: stored.length && stored[0].notes, t2: row && row.querySelector('.t2') ? row.querySelector('.t2').textContent.trim() : null };
    });
    ok('it is still in the store after a reload', after.stored === 'a thread of blood', after);
    ok('and still on the timeline', after.t2 === 'a thread of blood', after);
  }

  console.log('\n8. she can correct it, and the correction is recorded');
  {
    await load(seed({ events: [nappy('d1', 'wet', 3 * HOUR, 'looked a bit pink')] }));
    const r = await page.evaluate(() => {
      openEdit('d1');
      const before = (document.getElementById('eNote') || {}).value;
      __n.edit('pink, gone by the next change');
      saveEdit('d1');
      const e = state.events.find((x) => x.id === 'd1');
      const h = (e.history || []).filter((x) => x.field === 'note');
      return { before: before, after: e.notes, kind: e.kind, hist: h.length,
        from: h[0] && h[0].from, to: h[0] && h[0].to, editedBy: e.editedBy };
    });
    ok('the edit sheet opens on what she wrote', r.before === 'looked a bit pink', r);
    ok('the new words are stored', r.after === 'pink, gone by the next change', r);
    ok('the kind is untouched by editing the note', r.kind === 'wet', r);
    ok('one history entry records the change', r.hist === 1, r);
    ok('from the old words to the new', r.from === 'looked a bit pink' && r.to === 'pink, gone by the next change', r);
    ok('and the entry is stamped as edited', r.editedBy === 'local', r);
  }

  console.log('\n9. clearing it is a correction like any other');
  {
    await load(seed({ events: [nappy('d1', 'dirty', 3 * HOUR, 'wrong nappy, this was Wren')] }));
    const r = await page.evaluate(() => {
      openEdit('d1');
      const had = __n.edit('');
      saveEdit('d1');
      const e = state.events.find((x) => x.id === 'd1');
      return { had: had, notes: e.notes, detail: eventDetail(e), hist: (e.history || []).filter((x) => x.field === 'note').length };
    });
    ok('the edit sheet offers the note field', r.had === true, r);
    ok('the note is emptied rather than quietly kept', r.notes === '', r);
    ok('the timeline stops showing it', r.detail === '', r);
    ok('and the clearing is in the history', r.hist === 1, r);
  }

  console.log('\n10. what her partner wrote, she can read but not rewrite');
  {
    await load(seed({ events: [nappy('d1', 'dirty', 4 * HOUR, 'very dark, almost black', { authorId: 'uidPapa' })] }));
    const r = await page.evaluate(() => {
      window.LL = { auth: { currentUser: { uid: 'local' } }, role: 'caregiver',
        members: { local: 'caregiver', uidPapa: 'caregiver' },
        memberInfo: { local: { name: 'Maya' }, uidPapa: { name: 'Sam', relationship: 'Papa Bear' } } };
      openEdit('d1');
      const box = document.getElementById('eNote');
      const sheet = document.getElementById('sheet');
      return { has: !!box, value: box ? box.value : null, disabled: box ? box.disabled : null,
        canSave: !!sheet.querySelector('.btn-primary'),
        detail: eventDetail(state.events.find((x) => x.id === 'd1')) };
    });
    // Read-only over hidden: it is the part of his nappy she most needs to see.
    ok('his note is on screen', r.has === true && r.value === 'very dark, almost black', r);
    ok('but the field is locked', r.disabled === true, r);
    // Paired with has, or "no Save button" is true of a sheet with no note field in it either.
    ok('and there is no Save button to press', r.has === true && r.canSave === false, r);
    ok('the timeline still shows his words to her', r.detail === 'very dark, almost black', r);
  }

  console.log('\n11. the words reach the page written for a clinician');
  {
    await load(seed({ events: [
      nappy('d1', 'dirty', 2 * DAY, 'dark green, a thread of mucus'),
      nappy('d2', 'wet', 1 * DAY, 'a streak of blood on the wipe'),
      nappy('d3', 'wet', 3 * HOUR),
    ] }));
    const r = await page.evaluate(() => {
      const t = visitSummary(7);
      return { text: t, lines: t.split('\n'), header: t.split('\n').filter((l) => /^Nappy notes:/.test(l))[0],
        bullets: t.split('\n').filter((l) => /^ {2}• /.test(l) && /nappy|wet|dirty|both|dry/i.test(l)) };
    });
    ok('there is a Nappy notes line', !!r.header, r.header);
    ok('it counts only the nappies that carry one', /^Nappy notes: 2$/.test(r.header || ''), r.header);
    ok('two notes are printed', r.bullets.length === 2, r.bullets);
    ok('oldest first, so the series reads in order', /dark green/.test(r.bullets[0] || '') && /streak of blood/.test(r.bullets[1] || ''), r.bullets);
    ok('each carries its kind', /, dirty: /.test(r.bullets[0] || '') && /, wet: /.test(r.bullets[1] || ''), r.bullets);
    ok('each carries a clock time', r.bullets.length === 2 && r.bullets.filter((l) => /\d{1,2}:\d{2}/.test(l)).length === 2, r.bullets);
    ok('the words are hers, unedited', /dark green, a thread of mucus$/.test(r.bullets[0] || ''), r.bullets);
    // The count line above it must not change: notes are extra, not a replacement.
    ok('the nappy count line is still there', /^Nappies: 3 total/m.test(r.text), r.lines.filter((l) => /^Nappies/.test(l)));
    // Paired with the count, or "there is no verdict here" is true of an empty section.
    ok('and Cubby adds no reading of its own', r.bullets.length === 2 && !/(normal|abnormal|concerning|worrying|see a doctor)/i.test(r.header + r.bullets.join('')), r.bullets);
  }

  console.log('\n12. a quiet fortnight says nothing at all');
  {
    await load(seed({ events: [nappy('d1', 'wet', 2 * HOUR), nappy('d2', 'dirty', 6 * HOUR)] }));
    const r = await page.evaluate(() => {
      const t = visitSummary(7);
      return { t: t, has: /Nappy notes/.test(t), count: /^Nappies: 2 total/m.test(t) };
    });
    ok('no notes, no Nappy notes line', r.has === false, r.t.slice(0, 300));
    ok('the count line is unaffected', r.count === true, r.t.slice(0, 300));
  }

  console.log('\n13. an empty log does not print an empty section');
  {
    await load(seed());
    const r = await page.evaluate(() => visitSummary(7));
    ok('nothing logged, nothing claimed about nappies', !/Nappy notes/.test(r), r.slice(0, 260));
  }

  console.log('\n14. a bad fortnight cannot push the rest of the page off');
  {
    const evs = [];
    for (let i = 0; i < 8; i++) evs.push(nappy('n' + i, i % 2 ? 'wet' : 'dirty', (i + 1) * 6 * HOUR, 'note number ' + i));
    await load(seed({ events: evs }));
    const r = await page.evaluate(() => {
      const t = visitSummary(7);
      return { header: t.split('\n').filter((l) => /^Nappy notes:/.test(l))[0],
        bullets: t.split('\n').filter((l) => /^ {2}• .*note number/.test(l)) };
    });
    ok('the header still counts every one of them', /^Nappy notes: 8/.test(r.header || ''), r.header);
    ok('and says which ones are shown', /6 most recent below/.test(r.header || ''), r.header);
    ok('exactly six are printed', r.bullets.length === 6, r.bullets);
    // n0 is the most recent (6 hours ago), n7 the oldest. Kept: n0..n5, printed oldest first.
    ok('they are the six most recent', r.bullets.length === 6 && /number 5$/.test(r.bullets[0]) && /number 0$/.test(r.bullets[5]), r.bullets);
    ok('the two oldest are left off, not silently renumbered', r.bullets.length === 6 && !/number 6|number 7/.test(r.bullets.join('')), r.bullets);
  }

  console.log('\n15. one note, one line, whatever she typed into the edit box');
  {
    await load(seed({ events: [nappy('d1', 'dirty', 3 * HOUR, 'dark green\nand a thread of mucus\n\nsecond change too')] }));
    const r = await page.evaluate(() => {
      const t = visitSummary(7);
      return { bullets: t.split('\n').filter((l) => /^ {2}• /.test(l)),
        stray: t.split('\n').filter((l) => /mucus|second change/.test(l) && !/^ {2}• /.test(l)) };
    });
    ok('a multi-line note prints as one bullet', r.bullets.length === 1, r.bullets);
    ok('with all of it on that line', /dark green and a thread of mucus second change too$/.test(r.bullets[0] || ''), r.bullets);
    ok('and nothing spilling into the page around it', r.bullets.length === 1 && r.stray.length === 0, r.stray);
  }

  console.log('\n16. only this baby, only this window');
  {
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 90 * DAY, routines: [], doctors: [], allergies: [] }],
      events: [
        nappy('d1', 'wet', 3 * HOUR, 'robin note, inside the window'),
        nappy('d2', 'dirty', 20 * DAY, 'robin note, three weeks ago'),
        nappy('d3', 'dirty', 3 * HOUR, 'wren note, other baby', { babyId: 'b2' }),
      ],
    }));
    const r = await page.evaluate(() => {
      const seven = visitSummary(7);
      state.activeBabyId = 'b2';
      const wren = visitSummary(7);
      state.activeBabyId = 'b1';
      const month = visitSummary(30);
      return { seven: seven, wren: wren, month: month,
        sevenH: seven.split('\n').filter((l) => /^Nappy notes:/.test(l))[0],
        monthH: month.split('\n').filter((l) => /^Nappy notes:/.test(l))[0] };
    });
    // Each absence is paired with the presence it is meant to be distinguished from, so none of
    // them can pass on a page that prints no notes at all.
    ok("a three-week-old note is not on this week's page", /inside the window/.test(r.seven) && !/three weeks ago/.test(r.seven), r.sevenH);
    ok('the count matches what is printed', /^Nappy notes: 1$/.test(r.sevenH || ''), r.sevenH);
    ok("the other baby's note is nowhere on it", /inside the window/.test(r.seven) && !/wren note/.test(r.seven), r.sevenH);
    ok("and Robin's note is nowhere on Wren's page", !/robin note/.test(r.wren) && /wren note, other baby/.test(r.wren), r.wren.slice(0, 300));
    ok('a wider window does reach the older note', /three weeks ago/.test(r.month) && /^Nappy notes: 2$/.test(r.monthH || ''), r.monthH);
  }

  console.log('\n17. the printed report is built from the same words');
  {
    await load(seed({ events: [nappy('d1', 'dirty', 10 * DAY, 'dark green, first one since the iron')] }));
    const r = await page.evaluate(() => {
      // openDoctorReport prints visitSummary(14) verbatim, so this is the string the clinician holds.
      const t = visitSummary(14);
      return { has: /dark green, first one since the iron/.test(t), header: t.split('\n').filter((l) => /^Nappy notes:/.test(l))[0] };
    });
    ok('a ten-day-old note is on the fortnight the report prints', r.has === true, r);
    ok('under its own heading', /^Nappy notes: 1$/.test(r.header || ''), r);
  }

  console.log('\n18. a note about one twin cannot land on the other');
  {
    /* commitEvent copies the whole payload to every id in targetsResolved(), so the moment saveDiaper
       put notes in that payload, "streak of blood, Robin's" typed with Both selected was written
       verbatim onto Wren's record and printed under Nappy notes on Wren's clinician page and on the
       14-day doctor PDF. Three taps, every one of them a first-class control on this sheet. Wet and
       the time are true of both twins; the words are a claim about one nappy. Nothing else in this
       file ever presses Both, which is how 75/0 sat on top of it. */
    await load(seed({
      babies: [{ id: 'b1', name: 'Robin', birth: now - 90 * DAY, routines: [], doctors: [], allergies: [] },
        { id: 'b2', name: 'Wren', birth: now - 90 * DAY, routines: [], doctors: [], allergies: [] }],
    }));
    const r = await page.evaluate(() => {
      openDiaper();
      const typed = __n.type("streak of blood, Robin's");
      const one = __n.slot();
      const pressedBoth = __n.chip('Both');
      const both = __n.slot();
      __n.chip('Robin');
      const restored = __n.typed();
      __n.chip('Both');
      __n.tap('Wet');
      const evs = state.events.filter((e) => e.type === 'diaper');
      const t = document.getElementById('toast');
      const mine = visitSummary(7);
      state.activeBabyId = 'b2';
      const wren = visitSummary(7);
      state.activeBabyId = 'b1';
      return { typed: typed, one: one, pressedBoth: pressedBoth, both: both, restored: restored,
        n: evs.length, on: evs.map((e) => e.babyId).sort(), withNote: evs.filter((e) => e.notes).length,
        mine: mine, wren: wren, toast: (t.textContent || '').replace(/\s+/g, ' ').trim() };
    });
    ok('one baby picked, and there is a box to type in', r.typed === true && r.one.input === true, r.one);
    ok('the Both chip is there, the way the parent sees it', r.pressedBoth === true, r);
    ok('picking Both takes the box away', r.typed === true && r.both.input === false, r.both);
    ok('and says why, without blaming her', /one baby at a time/i.test(r.both.hint || ''), r.both);
    ok('her words come back when she picks a name again', r.restored === "streak of blood, Robin's", r);
    ok('both twins still get the nappy', r.n === 2 && r.on.join(',') === 'b1,b2', r);
    ok('and neither record carries the words', r.typed === true && r.n === 2 && r.withNote === 0, r);
    ok("nothing about blood on Wren's clinician page", r.typed === true && !/streak of blood/.test(r.wren) && !/Nappy notes/.test(r.wren), r.wren.slice(0, 300));
    ok("nor on Robin's, since the words were never taken", r.typed === true && !/Nappy notes/.test(r.mine), r.mine.slice(0, 300));
    ok('and the toast does not claim a note was saved', r.typed === true && /Nappy logged/.test(r.toast) && !/note saved/i.test(r.toast), r.toast);
  }

  console.log('\n19. an empty box she cannot type in is not a record');
  {
    /* The read-only note was rendered on every nappy, note or no note, placeholder and all. To a
       second caregiver reading a nappy her partner logged, a box headed Note holding "anything that
       made you look twice" in grey reads at a glance like something he wrote, and she cannot type
       into it to find out otherwise. Most of the nappies she opens are his. */
    await load(seed({ events: [
      nappy('d1', 'dirty', 4 * HOUR, 'very dark, almost black', { authorId: 'uidPapa' }),
      nappy('d2', 'wet', 5 * HOUR, null, { authorId: 'uidPapa' }),
      nappy('d3', 'wet', 6 * HOUR, null, { authorId: 'local' }),
    ] }));
    const r = await page.evaluate(() => {
      window.LL = { auth: { currentUser: { uid: 'local' } }, role: 'caregiver',
        members: { local: 'caregiver', uidPapa: 'caregiver' },
        memberInfo: { local: { name: 'Maya' }, uidPapa: { name: 'Sam', relationship: 'Papa Bear' } } };
      const look = () => {
        const box = document.getElementById('eNote');
        const sheet = document.getElementById('sheet');
        return { has: !!box, value: box ? box.value : null, ph: box ? box.getAttribute('placeholder') : null,
          noteLabel: [].slice.call(sheet.querySelectorAll('.field label')).filter((l) => /^Note$/.test(l.textContent.trim())).length,
          text: (sheet.textContent || '').replace(/\s+/g, ' ') };
      };
      openEdit('d1'); const withNote = look(); closeSheet();
      openEdit('d2'); const without = look(); closeSheet();
      // Not over-fixed: on the nappy she logged herself, still no note, she gets an empty box to
      // write the first one in. The rule is "can you type in it", not "is there a note".
      openEdit('d3'); const own = look(); closeSheet();
      return { withNote: withNote, without: without, own: own };
    });
    ok('his words are on screen when he wrote some', r.withNote.has === true && r.withNote.value === 'very dark, almost black', r.withNote);
    ok('a nappy he logged without one shows no box at all', r.withNote.has === true && r.without.has === false, r.without);
    ok('and no Note heading over the empty space', r.without.noteLabel === 0, r.without);
    // The placeholder is the whole failure: grey words under a heading saying Note, in a box she
    // cannot type in, read at a glance as something her partner wrote.
    ok('she is not invited into a box she cannot use', r.withNote.has === true && r.without.ph === null && !/look twice/.test(r.without.text), r.without);
    ok('and his own words carry no invitation over them', r.withNote.ph === null, r.withNote);
    ok('but her own nappy still offers her an empty one', r.own.has === true && r.own.value === '' && /look twice/.test(r.own.ph || ''), r.own);
  }

  console.log('\n20. a note corrected down to nothing leaves no blank line behind');
  {
    /* saveEdit stored #eNote untrimmed, so a note rubbed out to a space stayed a space. eventDetail
       is truthy on it, so the timeline painted a second line under the nappy with nothing in it,
       which she cannot see to clear and the doctor page silently drops. */
    await load(seed({ events: [nappy('d1', 'wet', 3 * HOUR, 'looked a bit pink')] }));
    const r = await page.evaluate(() => {
      openEdit('d1');
      const had = __n.edit('   ');
      saveEdit('d1');
      const e = state.events.find((x) => x.id === 'd1');
      go('log'); if (typeof setLogTab === 'function') setLogTab('log');
      const row = [].slice.call(document.querySelectorAll('#scroll .tl-item'))
        .filter((x) => /Nappy/.test((x.querySelector('.t1') || {}).textContent || ''))[0];
      const t2 = row ? row.querySelector('.t2') : null;
      return { had: had, notes: e.notes, detail: eventDetail(e), row: !!row,
        t2: t2 ? JSON.stringify(t2.textContent) : null,
        hist: (e.history || []).filter((x) => x.field === 'note').length };
    });
    ok('there was a box to rub it out in', r.had === true, r);
    ok('spaces are stored as nothing, not as spaces', r.had === true && r.notes === '', r);
    ok('the clearing is recorded like any other correction', r.had === true && r.hist === 1, r);
    ok('the nappy is still on the timeline', r.row === true, r);
    ok('with no empty line painted under it', r.had === true && r.detail === '' && r.t2 === null, r);
  }

  console.log('\n21. two nappies in the same second keep both sets of words');
  {
    /* The 900ms double-tap guard signs type, method, kind, amount, activity, medId and targets. It
       did not sign notes, so the second wet nappy of a pair was dropped as a slip and her words went
       with it, while the toast still read "Nappy logged · wet · note saved". */
    await load(seed());
    const r = await page.evaluate(() => {
      openDiaper(); const a = __n.type('a streak of blood'); __n.tap('Wet');
      openDiaper(); const b = __n.type('gone by the next change'); __n.tap('Wet');
      const evs = state.events.filter((e) => e.type === 'diaper');
      return { a: a, b: b, n: evs.length, notes: evs.map((e) => e.notes || null) };
    });
    ok('there was a field to type into both times', r.a === true && r.b === true, r);
    ok('both nappies are written', r.a === true && r.n === 2, r);
    ok('the first set of words is kept', r.a === true && r.notes.indexOf('a streak of blood') !== -1, r);
    ok('and so is the second', r.b === true && r.notes.indexOf('gone by the next change') !== -1, r);
    // And the guard still guards: identical shape twice in the same second is still one fumbled tap.
    const g = await page.evaluate(() => {
      state.events = []; persist();
      openDiaper(); const a = __n.type('same words'); __n.tap('Wet');
      openDiaper(); const b = __n.type('same words'); __n.tap('Wet');
      return { a: a, b: b, n: state.events.filter((e) => e.type === 'diaper').length };
    });
    ok('but the same words twice in the same second is still one slip', g.a === true && g.b === true && g.n === 1, g);
  }

  ok('no page errors throughout', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'NAPPY-NOTE: FAIL' : 'NAPPY-NOTE: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
