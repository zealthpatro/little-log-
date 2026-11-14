#!/usr/bin/env node
/* Nothing another person writes may ever become markup or script in the app.
 *
 * A household is shared. A caregiver, a link joiner, or anyone who has taken over a weaker member's
 * account can write names, bear labels, note text, entry fields, document ids, photo bytes and baby
 * colours, and every one of those is drawn on someone else's phone. Until 2026-11-12 several of them
 * went into innerHTML raw: the relationship label on Settings > Guardians, a note's id in the Home
 * note card's onclick, an event's id and photo bytes on the timeline, a baby's colour in a style.
 * Each ran script in the owner's session the moment she opened the screen (AUDIT client-1, -2, -3).
 *
 * This gate seeds hostile values into every one of those fields and walks the screens a parent
 * actually opens: Home, the timeline, notes, Settings, Guardians, the family list, the photo album,
 * medicines, an entry's edit sheet, and the Moments "who" chips. On every screen it asserts:
 *   - the sentinel functions the payloads call were never run (window.__pwnHits stays empty),
 *   - no injected element (<x-pwn>) and no injected attribute exists,
 *   - every inline handler that carries a payload, when run in a sandbox where every name is a
 *     harmless stub, still calls nothing but stubs and still parses (a string that escaped its
 *     quotes either runs the sentinel or breaks the syntax, and both are a fail),
 *   - no style, src or href carries the payload,
 * and, so none of that passes for free on a blank screen, that the hostile text IS on the screen,
 * as text.
 *
 * Sections:
 *   0. jArg, run in node: a value with quotes, backslashes and line terminators comes back exactly.
 *      And a static scan: every ${} inside a quoted JS string in an inline handler goes through
 *      jArg or hArg, in every file under app/ that builds handlers from templates.
 *   1. The LOAD path: hostile state written to localStorage and booted (Store.load ->
 *      normalizeLoadedState, the same normaliser the cloud path runs on every blob snapshot).
 *   2. The SINKS: the same values put straight into state after boot, past every ingest check, so
 *      the escaping at each sink is graded on its own.
 *      2d. Every alert pill a member's words or ids can reach (the month card, a sibling's dose, a
 *      fever, an illness reading, a visit, an overdue vaccine, the four consent states, the child and
 *      poster pills) and
 *      the Settings and Data rows that print a member's words, each staged hostile and required to be
 *      on screen, with each button handing its handler exactly the id it was drawn with.
 *      2e. The one document listener that runs component buttons (UI_ACTIONS), in the real page.
 *      2f. Health > Illness: the "last temp" line, with a reading whose temp and unit a member wrote.
 *   3. The INGEST helpers store-firebase.js calls where Firestore snapshots land: ids, colours and
 *      photo bytes are neutralised and the entry itself is kept. Plus a static check that every
 *      listener actually calls them.
 *   4. tools/xss_leaf_check.js, run from here: no field list at all, every leaf hostile.
 *
 *   node tools/xss_sink_check.js http://localhost:9745
 *
 * Pass an explicit base URL; tools/gates.js passes its own.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const dl = require('./gate_downloads');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2];
if (!BASE) { console.error('usage: node tools/xss_sink_check.js <base-url>'); process.exit(2); }
const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 900) : '')); } };

/* Every tag is a separate sentinel, so a failure names the field that got through. */
const TAGS = ['rel', 'name', 'notetext', 'noteby', 'noteid', 'evid', 'evnote', 'evtime', 'babyname', 'babyid',
  'color', 'src', 'phid', 'caption', 'medid', 'medname', 'hh', 'photorow', 'audience', 'amount',
  'side', 'illid', 'illname', 'msid', 'mstitle', 'docid', 'docname', 'clinic', 'askid', 'asktext',
  'rtid', 'rttitle', 'cid', 'clabel', 'creq', 'dose', 'unit', 'evunit', 'medid2',
  'apptid', 'appttitle', 'place', 'ctname', 'ctrole', 'preid', 'pretext', 'symp', 'momid', 'momcap', 'bag',
  'plan', 'vq', 'guessname', 'guessnote', 'guestnick', 'guestrel', 'guestdate', 'guestnote', 'obs',
  // 2d: every alert pill and the Settings and Data rows
  'kidid', 'kidname', 'visitname', 'monthph', 'kidill', 'kidillname', 'illtemp', 'illunit', 'fevunit', 'kidmed',
  'kidmedname', 'kiddose', 'kidunit', 'othermed', 'cask', 'caskby', 'casklabel', 'cwait', 'cwaitlabel', 'cready',
  'cdecl', 'cdecllabel', 'newid', 'newname', 'disp', 'vxname'];
/* One payload per field, aimed at all three contexts at once:
     \');__pwn_t();//   closes a single-quoted JS string inside a handler. A bare quote would be
                        turned into \' by a half-escaper; the backslash in front cancels that.
     ">                 closes the attribute it sits in, then plants an element and an onerror.
   'PWN-' leads so the text can be found on screen when it is (correctly) shown as text. */
const P = (t) => 'PWN-' + t + "\\');__pwn_" + t + '();//"><x-pwn data-t="' + t + '"></x-pwn><img src="/x-pwn-404" onerror="__pwn_' + t + '()">';
const COLOR = 'red;background-image:url(/PWN-color);" onmouseover="__pwn_color()" data-pwn="1';
const SRC = 'x" onerror="__pwn_src()" data-pwn="1';
const DAY = 86400000;
// 1pm, so Home is in its daytime layout (the photo hero holds still at night).
const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
const OFFSET = CLOCK - Date.now();
const now = CLOCK;

function hostileState() {
  return {
    babies: [
      { id: 'b1', name: 'Robin', birth: now - 90 * DAY, sex: 'F', color: COLOR, allergies: [],
        doctors: [{ id: P('docid'), role: 'Pediatrician', name: P('docname'), clinic: P('clinic'), phone: '0123', nextVisit: '' }],
        askQs: [{ id: P('askid'), text: P('asktext'), done: false }],
        routines: [{ id: P('rtid'), title: P('rttitle'), time: '08:00', assignee: 'uidEvil', evType: 'activity', done: {} }] },
      { id: P('babyid'), name: P('babyname'), birth: now - 90 * DAY, sex: 'M', color: COLOR, routines: [], doctors: [], allergies: [] },
    ],
    activeBabyId: 'b1',
    events: [
      { id: P('evid'), type: 'feed', babyId: 'b1', time: now - 3600000, side: 'L', dur: 600000, note: P('evnote'), authorId: 'uidEvil', photoId: 'ph1' },
      { id: 'e2', type: 'diaper', babyId: 'b1', time: now - 7200000, kind: 'wet', authorId: 'uidEvil', notes: P('evnote') },
      { id: 'e3', type: 'feed', method: 'bottle', babyId: 'b1', time: now - 5400000, amount: '5" data-pwn="amount', unit: P('evunit'), authorId: 'uidEvil' },
      { id: 'e4', type: 'medicine', babyId: 'b1', medId: P('medid2'), time: now - 9000000, dose: P('dose'), unit: P('unit'), authorId: 'uidEvil' },
    ],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', householdName: P('hh'), seen: { home: 1, log: 1, album: 1, health: 1, welcome: 1, install: 1 } },
    timers: { b1: { feed: { start: now - 600000, side: P('side') } } },
    milestones: [{ id: P('msid'), babyId: 'b1', key: 'custom', title: P('mstitle'), cat: 'Custom', achievedAt: now - 3 * DAY, note: P('mstitle'), photoId: 'ph1' }],
    illnesses: [{ id: P('illid'), babyId: 'b1', name: P('illname'), startedAt: now - DAY, endedAt: null, notes: P('illname'), by: 'uidEvil' }],
    consents: [{ id: P('cid'), type: 'delete', scope: 'photos', label: P('clabel'), requestedBy: 'uidEvil', requestedByName: P('creq'), at: now - 3600000, approvals: ['uidEvil'], status: 'pending' }],
    meds: [{ id: P('medid'), name: P('medname'), dose: P('dose'), unit: P('unit'), babyId: 'b1', subject: { kind: 'baby', id: 'b1' }, active: true, pattern: { type: 'daily', times: ['00:00'] }, createdAt: 0 },
      { id: P('medid2'), name: P('medname'), dose: '2.5', unit: 'ml', babyId: 'b1', subject: { kind: 'baby', id: 'b1' }, active: true, pattern: { type: 'everyX', hours: 4 }, createdAt: 0 }],
    photos: [
      { id: P('photorow'), babyId: 'b1', photoId: 'ph1', caption: P('caption'), createdAt: now - DAY },
      { id: 'pr2', babyId: 'b1', photoId: P('phid'), caption: 'second', createdAt: now - 2 * DAY },
    ],
    vaccines: {}, pregnancy: null,
    notes: [{ id: P('noteid'), text: P('notetext'), createdBy: 'uidEvil', createdByName: P('noteby'), audience: 'circle', at: now - 1800000, day: dayKeyOf(now - 1800000), pinned: false }],
    guardians: ['local', 'uidEvil'],
  };
}
// Her journey, as a partner she shared it with would receive it. A partner can write precon.
function hostilePregnancy() {
  return {
    id: 'p1', ownerUid: 'local', stage: 'expecting', country: 'uk', dueDate: now + 10 * 7 * DAY, lmp: now - 30 * 7 * DAY, cycleLen: 28, createdAt: now - 30 * 7 * DAY,
    appts: [{ id: P('apptid'), title: P('appttitle'), place: P('place'), at: now + 3 * DAY, week: 31, notes: P('appttitle') }],
    careTeam: [{ id: 'ct1', name: P('ctname'), role: P('ctrole'), phone: '0123' }],
    precon: [{ id: P('preid'), text: P('pretext'), done: true, by: 'uidEvil', addedBy: 'uidEvil' }],
    symptoms: [{ id: 's1', at: now - DAY, name: P('symp'), sev: 'mild', note: P('symp') }],
    moments: [{ id: P('momid'), week: 20, caption: P('momcap'), photoId: 'ph1', at: now - 10 * DAY }],
    bag: [{ id: 'bg1', text: P('bag'), done: false }], birthPlan: P('plan'), visitQs: [{ id: 'vq1', text: P('vq'), done: false }],
    guesses: [{ id: 'g1', uid: 'uidEvil', name: P('guessname'), guess: 'F', note: P('guessnote'), at: now - DAY }],
    weights: [], bp: [], kicks: [], contractions: [], conditions: {}, glucose: [], urine: [], supplements: [], supplementLog: [], nausea: [],
    gameCode: 'g123', hubCode: 'h123', hubGames: { duedate: 'dd1' },
  };
}
// What /api/game and /api/hub could hand back if the Worker's validation ever loosened (client-10).
const GUEST = {
  sex: [{ nickname: P('guestnick'), guess: 'F', note: P('guestnote') }],
  dd: [{ nickname: P('guestnick'), relation: P('guestrel'), guess: JSON.stringify({ date: P('guestdate'), lengthCm: P('guestdate') }) }],
};
function dayKeyOf(ts) { const d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const hostilePhotos = () => ({ ph1: SRC, [P('phid')]: PNG });
const MEMBERS = { local: 'owner', uidEvil: 'caregiver' };
const memberInfo = () => ({
  local: { name: 'Test Parent', relationship: 'Mama Bear', role: 'owner' },
  uidEvil: { name: P('name'), relationship: P('rel'), role: 'caregiver' },
});

/* ---------------------------------------------------------------- 0. node-side checks */
function staticChecks() {
  console.log('\n0. jArg, and every templated handler argument');
  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const grab = (name) => { const m = new RegExp('function ' + name + '\\(.*\\{.*\\}\\s*$', 'm').exec(html); return m ? m[0] : ''; };
  const src = [grab('escapeHtml'), grab('jArg'), grab('hArg')].filter(Boolean).join('\n');
  // eslint-disable-next-line no-new-func
  const fns = new Function(src + '\nreturn { jArg: jArg, hArg: typeof hArg==="function"?hArg:null };')();
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  // What the browser does: decode the attribute, then run it as JS. The argument must arrive intact.
  const roundTrip = (enc, s) => { try { let got; new Function('f', decode("f('" + enc(s) + "')"))((v) => { got = v; }); return got; } catch (e) { return 'THREW ' + e.message; } };
  const NASTY = ["O'Brien", 'a\\', "a\\');alert(1);//", 'line\nbreak', 'cr\rhere', 'ls ps ', '"><b>x</b>', 'back\\\\slash', "</script><script>x</script>", 'Nana & "Pops"'];
  NASTY.forEach((s) => ok('jArg carries ' + JSON.stringify(s) + ' through a handler unchanged', roundTrip(fns.jArg, s) === s, roundTrip(fns.jArg, s)));
  ok('hArg exists, for a ${} inside a handler string', !!fns.hArg);
  if (fns.hArg) {
    NASTY.forEach((s) => ok('hArg carries ' + JSON.stringify(s) + ' unchanged', roundTrip(fns.hArg, s) === s, roundTrip(fns.hArg, s)));
    // A template literal prints `undefined`, `null` and 0 as themselves. hArg must too, or rewriting
    // '${x}' to '${hArg(x)}' would change what a handler receives.
    [undefined, null, 0, 12, false].forEach((v) => ok('hArg(' + String(v) + ') is exactly `${' + String(v) + '}`', roundTrip(fns.hArg, v) === `${v}`, roundTrip(fns.hArg, v)));
  }
  const files = ['app/index.html', 'app/teach-ui.js', 'app/log-guide.js', 'app/vax-card.js', 'app/voice-log.js', 'app/cubby-extras.js'];
  let raw = [];
  files.forEach((f) => { raw = raw.concat(rawHandlerArgs(fs.readFileSync(path.join(ROOT, f), 'utf8')).map((r) => f + ':' + r)); });
  ok('no ${} inside a quoted handler argument skips jArg/hArg (' + raw.length + ' do)', raw.length === 0, raw.slice(0, 12).join('\n         '));
  // The scanner has to be able to see one, or the line above passes for free.
  const planted = rawHandlerArgs('x=`<b onclick="go(\'${e.id}\')">`; y=`<b onclick="go(\'${hArg(e.id)}\')">`;');
  ok('the scanner itself catches a planted raw one, and only that one', planted.length === 1, planted);
}
/* Every ${expr} in an on*="..." attribute of a template literal, sitting inside a '...' JS string,
   whose expression is not jArg(...) or hArg(...). Walks the attribute with the template's own
   nesting, so a quote inside a nested ${} does not end it. */
function rawHandlerArgs(src) {
  const out = [];
  const re = /\son[a-z]+="/g; let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, inStr = false, depth = 0;
    const line = src.slice(0, m.index).split('\n').length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '\n') break;
      if (c === '"') break;
      if (c === '\\') { i++; continue; }
      if (c === "'") { inStr = !inStr; continue; }
      if (c === '$' && src[i + 1] === '{') {
        // find the matching close brace, skipping nested template literals
        let d = 1, j = i + 2, q = null;
        for (; j < src.length && d; j++) {
          const ch = src[j];
          if (q) { if (ch === '\\') { j++; continue; } if (ch === q) q = null; continue; }
          if (ch === '`' || ch === '"' || ch === "'") { q = ch; continue; }
          if (ch === '{') d++; else if (ch === '}') d--;
        }
        const expr = src.slice(i + 2, j - 1).trim();
        if (inStr && !/^(jArg|hArg)\(/.test(expr)) out.push(line + ' ' + expr.slice(0, 80));
        i = j - 1; depth++;
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- page-side probes */
function pageSetup(tags) {
  window.__pwnHits = [];
  tags.forEach(function (t) { window['__pwn_' + t] = function () { window.__pwnHits.push(t); }; });
  /* Runs an inline handler where every free name is a harmless stub, except the sentinels. If a
     payload got out of its string, the sentinel is called; if it got half out, the code no longer
     parses. Either is an injection. A runtime error from the stubs is not. */
  window.__sandboxRun = function (code) {
    var hits = [];
    var stub = new Proxy(function () {}, {
      get: function (t, k) { if (k === Symbol.toPrimitive) return function () { return ''; }; if (k === 'then') return undefined; return stub; },
      apply: function () { return stub; }, construct: function () { return stub; }, set: function () { return true; }, has: function () { return true; },
    });
    var scope = new Proxy({}, {
      has: function () { return true; },
      get: function (t, k) {
        if (k === Symbol.unscopables) return undefined;
        if (typeof k === 'string' && k.indexOf('__pwn') === 0) return function () { hits.push(k); };
        return stub;
      },
      set: function () { return true; },
    });
    var fn;
    try { fn = new Function('__s', 'with(__s){' + code + '\n}'); } catch (e) { return { hits: hits, syntax: String(e && e.message || e) }; }
    try { fn.call(stub, scope); } catch (e) {}
    return { hits: hits };
  };
  window.__scan = function (root) {
    root = root || document;
    var out = [];
    (window.__pwnHits || []).forEach(function (t) { if (out.indexOf('sentinel ran: ' + t) < 0) out.push('sentinel ran: ' + t); });
    root.querySelectorAll('x-pwn').forEach(function (n) { out.push('injected <x-pwn data-t=' + n.getAttribute('data-t') + '>'); });
    root.querySelectorAll('*').forEach(function (el) {
      var tag = el.tagName.toLowerCase();
      for (var a = 0; a < el.attributes.length; a++) {
        var n = el.attributes[a].name, v = el.attributes[a].value;
        if (n.indexOf('pwn') >= 0) out.push('injected attribute ' + n + ' on <' + tag + '>');
        if (/^on/.test(n) && v.indexOf('__pwn') >= 0) {
          var r = window.__sandboxRun(v);
          if (r.hits.length) out.push(n + ' on <' + tag + '> runs ' + r.hits.join(',') + ' :: ' + v.slice(0, 140));
          if (r.syntax) out.push(n + ' on <' + tag + '> no longer parses (' + r.syntax + ') :: ' + v.slice(0, 140));
        }
        // Image bytes the app made itself are base64, which spells PWN by chance every so often.
        var vv = v.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+\/=]+/g, 'data:');
        if ((n === 'style' || n === 'src' || n === 'href' || n === 'srcset') && (/PWN|__pwn/.test(vv) || /^\s*javascript:/i.test(vv))) out.push(n + ' on <' + tag + '> carries the payload :: ' + v.slice(0, 140));
      }
    });
    return out.filter(function (x, i) { return out.indexOf(x) === i; });
  };
  window.__text = function (sel) { var el = sel ? document.querySelector(sel) : document.getElementById('scroll'); return el ? (el.innerText || '') : ''; };
}

(async () => {
  staticChecks();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: dl.downloadBehavior() });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  await page.evaluateOnNewDocument(pageSetup, TAGS);
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });

  const boot = async (s, photos) => {
    await page.evaluate((x, ph) => {
      localStorage.setItem('little-log-v1', JSON.stringify(x));
      localStorage.setItem('cubby-quick-uid', 'local');
      localStorage.setItem('cubby-theme:local', 'light');
    }, s);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    // Photo bytes arrive by their own listener in the real app; this is the shape it hands over.
    await page.evaluate((ph) => { PhotoStore.map = window.cubbyIngest ? window.cubbyIngest.photos(ph) : ph; }, photos);
  };
  // The circle: a caregiver whose name and bear label are the payload, and who is a guardian.
  const circle = () => page.evaluate((mem, info) => {
    window.LL = window.LL || {};
    window.LL.members = mem; window.LL.memberInfo = info; window.LL.role = 'owner';
    try { window.toast = function () {}; } catch (e) {}
  }, MEMBERS, memberInfo());

  /* Opens one screen, waits for anything an injected <img> would load and fire, then scans. */
  const visit = async (label, open, sel) => {
    const r = await page.evaluate((code, s) => {
      try { closeSheet(); } catch (e) {}
      window.__pwnHits = [];   // per screen, so a failure names the screen it happened on
      var err = null;
      try { (new Function(code))(); } catch (e) { err = String(e && e.message || e); }
      return { err: err };
    }, open, sel || null);
    await sleep(350);
    const res = await page.evaluate((s) => ({ found: window.__scan(document), text: (function () {
      var parts = [];
      // textContent, not innerText: a heading styled uppercase would hide the text it does show.
      document.querySelectorAll(s || '#scroll, #sheet, .sheet, #llModalOv, .ll-modal, #xssProbe').forEach(function (el) { parts.push(el.textContent || ''); });
      return parts.join('\n');
    })() }), sel || null);
    return Object.assign(res, r);
  };

  const SCREENS = [
    { label: 'Home', open: "view='home'; go('home'); render();", must: ['PWN-notetext', 'PWN-medname'] },
    { label: 'the timeline', open: "go('log'); render();", must: ['PWN-rel'] },
    { label: 'the photo album', open: "go('album'); render();", must: [] },
    { label: 'Health and medicines', open: "go('health'); render();", must: ['PWN-medname'] },
    { label: 'a note, opened', open: 'openNoteView(state.notes[0].id);', must: ['PWN-notetext'] },
    { label: 'an entry, opened', open: "openEdit(state.events.find(function(e){return e.type==='feed';}).id);", must: [] },
    { label: 'the feed sheet, with the "Log for" chips', open: 'openFeed();', must: ['PWN-babyname'] },
    { label: 'Settings', open: "go('home'); openSettings();", must: ['PWN-rel'] },
    { label: 'Settings > Guardians', open: 'openGuardians();', must: ['PWN-rel'] },
    { label: 'the family list', open: "var d=document.getElementById('xssProbe')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'xssProbe'})); d.innerHTML=window.cubbyFamilyPortrait();", must: [] },
    { label: 'the timeline, every entry opened', open: "go('log'); state.events.forEach(function(e){ try{ openEdit(e.id); }catch(x){} });", must: [] },
    { label: 'the medicine entry, opened', open: "openEdit(state.events.find(function(e){return e.type==='medicine';}).id);", must: [], val: { '#eDose': P('dose') } },
    // A feed's unit is ml or oz: on the load path the ingest puts a hostile one back to ml, so only
    // the sink phase (past the ingest) still has it to show, escaped.
    { label: 'the bottle entry, opened', open: "openEdit(state.events.find(function(e){return e.method==='bottle';}).id);", must: [], sinkMust: ['PWN-evunit'] },   // #eAmt is type=number: the browser empties a non-number, which is fine
    { label: 'the nappy entry, opened', open: "openEdit('e2');", must: [] },
    { label: 'a medicine, managed', open: 'openMedManage(state.meds[0].id);', must: [], val: { '#mName': P('medname') } },
    { label: 'the baby profile (care team, questions)', open: 'openBabyProfile();', must: [] },
    { label: 'the doctor sheet', open: 'openDoctor();', must: [] },
    { label: 'Settings > Data (decisions)', open: 'openDataSheet();', must: ['PWN-clabel'] },
    { label: 'a decision, opened', open: 'openConsentReview(state.consents[0].id);', must: ['PWN-clabel'] },
    { label: 'rituals', open: 'openRoutinesEdit();', must: ['PWN-rttitle'] },
    { label: 'the day recap', open: 'openDayRecap();', must: [] },
    { label: 'recently deleted', open: 'openTrash();', must: [] },
    { label: 'the milestones tab', open: "albumTab='milestones'; go('album'); render();", must: [] },
    { label: 'the visit summary', open: 'openVisitSummary();', must: [] },
    { label: 'a note, being written', open: 'openNoteCompose();', must: [] },
    { label: 'the Moments "who" chips', open: "var d=document.getElementById('xssProbe')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'xssProbe'})); d.innerHTML=glWhoChips('');", must: ['PWN-rel'] },
  ];
  const walk = async (phase) => {
    for (const s of SCREENS) {
      const r = await visit(s.label, s.open);
      ok(phase + ': ' + s.label + ' opens', !r.err, r.err);
      ok(phase + ': ' + s.label + ': nothing injected, nothing ran', r.found.length === 0, r.found.slice(0, 8).join('\n         '));
      s.must.concat(phase === 'sink' ? (s.sinkMust || []) : []).forEach((t) => ok(phase + ': ' + s.label + ' shows the hostile ' + t.slice(4) + ' as text', r.text.indexOf(t) >= 0, r.text.slice(0, 200)));
      // An input carries the value as written, byte for byte: escaped on the way in, not mangled.
      for (const [sel, want] of Object.entries(s.val || {})) {
        const got = await page.evaluate((q) => { const el = document.querySelector(q); return el ? el.value : null; }, sel);
        ok(phase + ': ' + s.label + ': ' + sel + ' holds exactly what was written', got === want, got);
      }
    }
    await page.evaluate(() => { var d = document.getElementById('xssProbe'); if (d) d.remove(); try { closeSheet(); } catch (e) {} });
  };

  console.log('\n1. the load path: hostile data booted from storage');
  await boot(hostileState(), hostilePhotos());
  await circle();
  await walk('load');

  console.log('\n2. the sinks: hostile data put straight into state, past every ingest check');
  await page.evaluate((s, ph) => {
    window.__pwnHits = [];
    Object.keys(s).forEach(function (k) { state[k] = s[k]; });
    PhotoStore.map = ph;
  }, hostileState(), hostilePhotos());
  await circle();
  await walk('sink');

  /* Every open*() sheet the app has, called with no argument, on the same hostile state. Not
     every one renders without its argument, and that is fine: the scan runs either way. The ones
     left out navigate away, print, start a payment, or need a value that cannot be guessed. */
  const html = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const SKIP = /^open(Sheet|DateModal|PickerOverlay|Pro|ProPortal|Printable|Article|ReadCarousel|ReadingRoom|Install|Import|DoctorReport|PregDoctorReport|TtcDoctorReport|DeleteAccount)$/;
  const OPENERS = [...new Set([...html.matchAll(/^(?:async )?function (open[A-Za-z]*)\(/gm)].map((m) => m[1]))].filter((n) => !SKIP.test(n));
  console.log('\n2b. every one of the app\'s ' + OPENERS.length + ' sheets, on the same hostile state');
  const sweep = async (phase) => {
    const bad = [];
    for (const fn of OPENERS) {
      await page.evaluate((f) => { try { closeSheet(); } catch (e) {} window.__pwnHits = []; try { window[f](); } catch (e) {} }, fn);
      await sleep(120);
      const found = await page.evaluate(() => window.__scan(document));
      if (found.length) bad.push(fn + ': ' + found.slice(0, 3).join(' | '));
    }
    ok(phase + ': every sheet opens with nothing injected and nothing run', bad.length === 0, bad.slice(0, 10).join('\n         '));
  };
  await page.evaluate((g) => {
    // No network in the sweep: a sheet that fetches gets the hostile guest guesses, nothing else does.
    window.__realFetch = window.__realFetch || window.fetch;
    window.fetch = function (u) {
      const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      if (/\/api\/hub\//.test(String(u))) return json({ games: [{ type: 'sex', guesses: g.sex }, { type: 'duedate', guesses: g.dd }] });
      if (/\/api\/game\//.test(String(u))) return json({ guesses: g.sex, tally: { F: 1, M: 0 } });
      return Promise.reject(new Error('offline in the gate'));
    };
    window.open = function () { return null; };
  }, GUEST);
  await sweep('sink');

  console.log('\n2c. a pregnancy journey, with every field hers or her partner\'s to write');
  await page.evaluate((pg) => { state.pregnancy = pg; viewingPreg = true; ensurePregFields(state.pregnancy); window.__pwnHits = []; }, hostilePregnancy());
  const PREG_TABS = { week: [], care: ['PWN-appttitle'], moments: [] };
  for (const v of Object.keys(PREG_TABS)) {
    const r = await visit('pregnancy ' + v, "viewingPreg=true; pregGo('" + v + "');");
    ok('pregnancy: the ' + v + ' tab opens', !r.err, r.err);
    ok('pregnancy: the ' + v + ' tab: nothing injected, nothing ran', r.found.length === 0, r.found.slice(0, 8).join('\n         '));
    PREG_TABS[v].forEach((t) => ok('pregnancy: the ' + v + ' tab shows the hostile ' + t.slice(4) + ' as text', r.text.indexOf(t) >= 0, r.text.slice(0, 200)));
  }
  const guest = await visit('the guessing game', 'openGuessGame();');
  await sleep(600);   // the guest guesses arrive by fetch, after the sheet is up
  const late = await page.evaluate(() => ({ found: window.__scan(document), text: document.body.textContent }));
  ok('pregnancy: the guessing game, with guest guesses from the public link: nothing injected, nothing ran', guest.found.length === 0 && late.found.length === 0, guest.found.concat(late.found).slice(0, 8).join('\n         '));
  ok('pregnancy: and a guest\'s nickname is on screen, as text', late.text.indexOf('PWN-guestnick') >= 0);
  ok('pregnancy: and a guest\'s due-date guess (date, length) is on screen, as text', late.text.indexOf('PWN-guestdate') >= 0 && late.text.indexOf('PWN-guestrel') >= 0);
  await sweep('pregnancy');
  await page.evaluate(() => { state.pregnancy = null; viewingPreg = false; try { closeSheet(); } catch (e) {} });

  /* 2d. Every alert pill, and the Settings and Data rows, each carrying what a member wrote.
     Sections 1 and 2 only ever drew three of the pills (a dose due, an illness with no temperature,
     a consent waiting on this guardian) and no Settings row with a member's words in it, and nothing
     asserted even those were on screen, so a pill nobody staged, or one that stopped being drawn,
     passed for free. The month card's photo id, the fever and illness readings, the doctor on the
     visit pill, a sibling's name on a dose, the three other consent states and the read-only export
     row were never drawn hostile at all. They are all drawn here, past the ingest (the second lock
     on its own), and for each one: it is on screen, the hostile words are on it as text, byte for
     byte, nothing was injected and nothing ran, and tapping each button hands its handler exactly
     the id it was drawn with. Handlers are stubbed by their global names, so this grades the markup
     and the dispatch whichever way a button is wired (data-act, or an inline handler).
     The pregnancy-weeks pill prints only Cubby's own words; there is nothing to stage. The overdue
     vaccine's name reads like Cubby's (it comes from the schedule), but the plan lives in the shared
     blob, so any member can write it: it is staged hostile with the rest. */
  console.log('\n2d. every alert pill, and the Settings and Data rows, each carrying what a member wrote');
  const V = {
    kidId: P('kidid'), kidName: P('kidname'), visitName: P('visitname'), monthPh: P('monthph'),
    illId: P('kidill'), illName: P('kidillname'), illTemp: P('illtemp'), illUnit: P('illunit'), fevUnit: P('fevunit'),
    kidMed: P('kidmed'), kidMedName: P('kidmedname'), kidDose: P('kiddose'), kidUnit: P('kidunit'),
    otherMed: P('othermed'), otherBaby: P('babyid'), otherName: P('babyname'),
    cAsk: P('cask'), cAskBy: P('caskby'), cAskLabel: P('casklabel'), cWait: P('cwait'), cWaitLabel: P('cwaitlabel'),
    cReady: P('cready'), cDecl: P('cdecl'), cDeclLabel: P('cdecllabel'), rel: P('rel'),
    newId: P('newid'), newName: P('newname'), vxName: P('vxname'),
  };
  // go and render too: the vaccine pill's Open is go('health') then render(), and a real render would
  // repaint the pills mid-walk and strand every button after it.
  const STUBS = ['logDose', 'snoozeMedAlert', 'dismissMedAlert', 'openTemp', 'openFeverSafetyNet', 'openVisitSummary',
    'openMemoryCard', 'dismissTip', 'openPosterOffer', 'dismissPosterOffer', 'ackChild', 'openConsentReview',
    'downloadExport', 'ackDecline', 'openBabyProfile', 'openGuardians', 'requestExport', 'go', 'render'];
  const stage = (kind) => page.evaluate((kind, v, clock, day) => {
    try { closeSheet(); } catch (e) {}
    window.__pwnHits = [];
    const iso = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    state.babies = state.babies.filter((b) => b.id !== v.kidId && b.id !== v.newId);
    state.events = state.events.filter((e) => e.babyId !== v.kidId && e.babyId !== v.newId);
    let mv = null;
    if (kind === 'older') {
      // Nineteen months old (the child stage starts at 18) and on her month day, a day or few past the mark.
      const kid = { id: v.kidId, name: v.kidName, sex: 'F', color: '#F4A6B8', allergies: [], routines: [],
        doctors: [{ id: 'dv1', role: 'GP', name: v.visitName, clinic: '', phone: '', nextVisit: iso(clock) }] };
      state.babies.push(kid); state.activeBabyId = kid.id;
      for (let k = 1; k < 12 && !mv; k++) { const d = new Date(clock - k * day); d.setMonth(d.getMonth() - 19); kid.birth = d.getTime(); mv = monthiversary(); }
      state.photos = (state.photos || []).filter((p) => p.babyId !== kid.id).concat([{ id: 'pm1', babyId: kid.id, photoId: v.monthPh, slot: mv, caption: '', createdAt: clock - day }]);
      state.illnesses = (state.illnesses || []).filter((i) => i.babyId !== kid.id).concat([{ id: v.illId, babyId: kid.id, name: v.illName, startedAt: clock - day, endedAt: null, by: 'uidEvil' }]);
      // A fever with a unit a member wrote, and a later reading on the illness that is all member-written.
      state.events.push({ id: 'kt1', type: 'temperature', babyId: kid.id, time: clock - 2 * 3600000, temp: 39.2, unit: v.fevUnit, authorId: 'uidEvil' });
      state.events.push({ id: 'kt2', type: 'temperature', babyId: kid.id, time: clock - 3600000, temp: v.illTemp, unit: v.illUnit, illnessId: v.illId, authorId: 'uidEvil' });
      state.meds = (state.meds || []).filter((m) => m.id !== v.kidMed && m.id !== v.otherMed).concat([
        { id: v.kidMed, name: v.kidMedName, dose: v.kidDose, unit: v.kidUnit, babyId: kid.id, subject: { kind: 'baby', id: kid.id }, active: true, pattern: { type: 'daily', times: ['00:00'] }, createdAt: 0 },
        // A sibling's dose names the sibling, and the sibling's name is a member's to write.
        { id: v.otherMed, name: 'Iron', dose: '1', unit: 'ml', babyId: v.otherBaby, subject: { kind: 'baby', id: v.otherBaby }, active: true, pattern: { type: 'daily', times: ['00:00'] }, createdAt: 0 }]);
      // Her vaccine plan, from the shared blob: one dose a parent confirmed missed, its name a member's.
      state.vaccines = state.vaccines || {};
      state.vaccines[kid.id] = [{ id: 'vx1', name: v.vxName, group: '2 months', dueMonths: 2, given: false, givenAt: null, note: '', missed: true }];
      state.guardians = ['local', 'uidEvil'];
      state.consents = [
        { id: v.cAsk, type: 'delete', scope: 'photos', label: v.cAskLabel, requestedBy: 'uidEvil', requestedByName: v.cAskBy, at: clock - 3600000, approvals: ['uidEvil'], status: 'pending' },
        { id: v.cWait, type: 'delete', scope: 'photos', label: v.cWaitLabel, requestedBy: 'local', requestedByName: 'Test Parent', at: clock - 3500000, approvals: ['local'], status: 'pending' },
        { id: v.cReady, type: 'export', scope: 'all', label: 'Export everything', requestedBy: 'local', requestedByName: 'Test Parent', at: clock - 3400000, approvals: ['local', 'uidEvil'], status: 'ready' },
        { id: v.cDecl, type: 'delete', scope: 'photos', label: v.cDeclLabel, requestedBy: 'local', requestedByName: 'Test Parent', at: clock - 3300000, approvals: ['local'], status: 'declined', seenDecline: false }];
    } else {
      // A newborn, ten days old, with one log and the setup card done with: the poster offer.
      const nb = { id: v.newId, name: v.newName, birth: clock - 10 * day, sex: 'M', color: '#5E6AA8', allergies: [], routines: [], doctors: [] };
      state.babies.push(nb); state.activeBabyId = nb.id;
      state.events.push({ id: 'nf1', type: 'feed', babyId: nb.id, time: clock - 3600000, side: 'L', dur: 600000, authorId: 'local' });
      markSeen('tip_getstarted');
    }
    view = 'home'; go('home'); render();
    return { mv: mv };
  }, kind, V, CLOCK, DAY);

  /* Reads every pill on screen, then taps each named button with the handlers stubbed and records
     what each one received. One pill is found by the words a parent sees on it. */
  const tapPills = (want) => page.evaluate((want, stubs) => {
    const got = {};
    const pills = [...document.querySelectorAll('#scroll .alert-pill')];
    const saved = {}; let calls = [];
    stubs.forEach((n) => { saved[n] = window[n]; window[n] = function () { calls.push([n, [].slice.call(arguments)]); }; });
    try {
      Object.keys(want).forEach((key) => {
        const w = want[key];
        const pill = pills.find((p) => w.find.every((s) => p.textContent.indexOf(s) >= 0));
        if (!pill) { got[key] = { missing: true }; return; }
        const r = { text: pill.textContent, taps: {} };
        w.taps.forEach((label) => {
          const b = [...pill.querySelectorAll('button')].find((x) => x.textContent.trim() === label);
          calls = [];
          if (b) b.click();
          r.taps[label] = b ? calls : 'no button';
        });
        const due = pill.querySelector('[data-due]');
        r.due = due ? Number(due.getAttribute('data-due')) : null;
        got[key] = r;
      });
    } finally { stubs.forEach((n) => { window[n] = saved[n]; }); }
    return got;
  }, want, STUBS);

  const checkPills = async (label, want, expect) => {
    await sleep(350);
    const found = await page.evaluate(() => window.__scan(document));
    ok('pills, ' + label + ': nothing injected, nothing ran', found.length === 0, found.slice(0, 8).join('\n         '));
    const got = await tapPills(want);
    for (const key of Object.keys(want)) {
      const g = got[key];
      ok('pills, ' + label + ': the ' + key + ' pill is drawn', g && !g.missing, g);
      if (!g || g.missing) continue;
      want[key].shows.forEach((s) => ok('pills, ' + label + ': the ' + key + ' pill shows the hostile ' + s.slice(4, s.indexOf('\\')) + ' as text, exactly', g.text.indexOf(s) >= 0, g.text.slice(0, 300)));
      for (const [btn, calls] of Object.entries(expect(key, g))) {
        ok('pills, ' + label + ': ' + key + ' "' + btn + '" hands its handler exactly ' + JSON.stringify(calls).slice(0, 90), JSON.stringify(g.taps[btn]) === JSON.stringify(calls), g.taps[btn]);
      }
    }
    const after = await page.evaluate(() => window.__scan(document));
    ok('pills, ' + label + ': still nothing ran after every tap', after.length === 0, after.slice(0, 8).join('\n         '));
  };

  const older = await stage('older');
  ok('pills: the older child is on her month day (staging)', older.mv != null, older);
  const OLDER = {
    month: { find: [V.kidName, ' month'], shows: [V.kidName], taps: ['See it'] },
    child: { find: [V.kidName, 'growing up'], shows: [V.kidName], taps: ['Lovely'] },
    'dose (hers)': { find: [V.kidMedName], shows: [V.kidMedName, V.kidDose, V.kidUnit], taps: ['Log', 'In 15 min', 'Not now'] },
    'dose (a sibling\'s)': { find: [V.otherName, 'Iron'], shows: [V.otherName], taps: ['Log', 'In 15 min', 'Not now'] },
    illness: { find: [V.illName], shows: [V.illName, V.illTemp, V.illUnit], taps: ['Temp'] },
    vaccine: { find: ['Vaccine overdue'], shows: [V.vxName], taps: ['Open'] },
    fever: { find: ['Fever logged'], shows: [V.fevUnit], taps: ['When to call', 'Summary'] },
    visit: { find: ['Appointment soon'], shows: [V.visitName], taps: ['Summary'] },
    'consent (needs your OK)': { find: [V.cAskBy], shows: [V.cAskBy, V.cAskLabel], taps: ['Review'] },
    'consent (waiting)': { find: ['Waiting for', V.cWaitLabel], shows: [V.rel, V.cWaitLabel], taps: ['View'] },
    'consent (ready)': { find: ['Export agreed'], shows: [], taps: ['Download'] },
    'consent (declined)': { find: ['Not this time'], shows: [V.cDeclLabel], taps: ['OK'] },
  };
  await checkPills('an older child on her month day', OLDER, (key, g) => ({
    month: { 'See it': [['openMemoryCard', [older.mv, V.monthPh]], ['dismissTip', ['bday' + older.mv]]] },
    child: { Lovely: [['ackChild', []]] },
    'dose (hers)': { Log: [['logDose', [V.kidMed]]], 'In 15 min': [['snoozeMedAlert', [V.kidMed, g.due]]], 'Not now': [['dismissMedAlert', [V.kidMed, g.due]]] },
    'dose (a sibling\'s)': { Log: [['logDose', [V.otherMed]]], 'In 15 min': [['snoozeMedAlert', [V.otherMed, g.due]]], 'Not now': [['dismissMedAlert', [V.otherMed, g.due]]] },
    illness: { Temp: [['openTemp', []]] },
    vaccine: { Open: [['go', ['health']], ['render', []]] },
    fever: { 'When to call': [['openFeverSafetyNet', []]], Summary: [['openVisitSummary', []]] },
    visit: { Summary: [['openVisitSummary', []]] },
    'consent (needs your OK)': { Review: [['openConsentReview', [V.cAsk]]] },
    'consent (waiting)': { View: [['openConsentReview', [V.cWait]]] },
    'consent (ready)': { Download: [['downloadExport', [V.cReady]]] },
    'consent (declined)': { OK: [['ackDecline', [V.cDecl]]] },
  })[key]);

  /* The Settings and Data rows, on the same household: the profile row names the active child, the
     Guardians row names the guardians, and a caregiver's read-only export row names them too. */
  const rows = (open, guardians) => page.evaluate((open, guardians, stubs) => {
    try { closeSheet(); } catch (e) {}
    window.__pwnHits = [];
    if (guardians) state.guardians = guardians;
    (new Function(open))();
    const saved = {}; let calls = [];
    stubs.forEach((n) => { saved[n] = window[n]; window[n] = function () { calls.push([n, [].slice.call(arguments)]); }; });
    const out = [];
    try {
      document.querySelectorAll('.set-item').forEach((r) => {
        const t = (r.querySelector('.a') || r).textContent, s = (r.querySelector('.b') || r).textContent;
        if (!/PWN/.test(t + s)) return;
        calls = []; r.click();
        out.push({ title: t, sub: s, wired: !!(r.getAttribute('data-act') || r.getAttribute('onclick')), calls: calls });
      });
    } finally { stubs.forEach((n) => { window[n] = saved[n]; }); }
    return { rows: out, found: window.__scan(document) };
  }, open, guardians || null, STUBS);
  const set = await rows('openSettings();');
  ok('rows, Settings: nothing injected, nothing ran', set.found.length === 0, set.found.slice(0, 8).join('\n         '));
  const prof = set.rows.find((r) => r.title.indexOf(V.kidName + '\'s profile') >= 0);
  ok('rows, Settings: the profile row shows the child\'s hostile name as text, exactly', !!prof, set.rows);
  ok('rows, Settings: and a tap on it opens her profile, nothing else', prof && JSON.stringify(prof.calls) === JSON.stringify([['openBabyProfile', []]]), prof);
  const dat = await rows('openDataSheet();', ['local', 'uidEvil']);
  ok('rows, Data (a guardian): nothing injected, nothing ran', dat.found.length === 0, dat.found.slice(0, 8).join('\n         '));
  const gRow = dat.rows.find((r) => r.title.indexOf('Guardians') >= 0);
  ok('rows, Data (a guardian): the Guardians row shows a guardian\'s hostile name as text, exactly', !!gRow && gRow.sub.indexOf(V.rel) >= 0, dat.rows);
  ok('rows, Data (a guardian): and a tap on it opens Guardians, nothing else', gRow && JSON.stringify(gRow.calls) === JSON.stringify([['openGuardians', []]]), gRow);
  const cg = await rows('openDataSheet();', ['uidEvil']);
  ok('rows, Data (a caregiver): nothing injected, nothing ran', cg.found.length === 0, cg.found.slice(0, 8).join('\n         '));
  const xRow = cg.rows.find((r) => r.title.indexOf('Export data') >= 0);
  ok('rows, Data (a caregiver): the read-only export row names the guardian, hostile, as text', !!xRow && xRow.sub.indexOf(V.rel) >= 0, cg.rows);
  ok('rows, Data (a caregiver): and it is still read-only: no action, and a tap does nothing', xRow && !xRow.wired && xRow.calls.length === 0, xRow);
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} state.guardians = ['local', 'uidEvil']; });

  /* 2f. Health > Illness, the card a parent opens while an illness runs, on the same household. Its
     "last temp" line prints the newest reading on the illness, and that reading's temp and unit are a
     member's to write. The card's chart turns each reading into a number first, so the newest reading
     is staged twice, each time with one hostile field the chart still reads: a hostile unit on a real
     temperature, then a hostile temperature in °F. The list of readings under the line escapes the
     same two fields, so the line itself is matched whole, as text and byte for byte. */
  console.log('\n2f. Health > Illness, with a reading a member wrote');
  const illCase = async (label, temp, unit, want) => {
    await page.evaluate((t, u) => { const e = state.events.find((x) => x.id === 'kt2'); e.temp = t; e.unit = u; }, temp, unit);
    const r = await visit('Health > Illness, ' + label, "go('health'); healthTab='illness'; render();", '#scroll');
    ok('illness card, ' + label + ': opens', !r.err, r.err);
    ok('illness card, ' + label + ': it is the running illness, by her hostile name', r.text.indexOf(V.illName) >= 0, r.text.slice(0, 300));
    ok('illness card, ' + label + ': nothing injected, nothing ran', r.found.length === 0, r.found.slice(0, 8).join('\n         '));
    ok('illness card, ' + label + ': the "last temp" line shows it as text, exactly', r.text.indexOf(want) >= 0, r.text.slice(0, 400));
  };
  await illCase('a reading whose unit a member wrote', 39.4, V.illUnit, 'last temp 39.4°' + V.illUnit);
  await illCase('a reading whose temperature a member wrote', V.illTemp, 'F', 'last temp ' + V.illTemp + '°F');
  await page.evaluate(() => { healthTab = null; view = 'home'; go('home'); render(); });

  await stage('newborn');
  await checkPills('a newborn\'s first weeks', {
    poster: { find: ['A keepsake from the day', V.newName], shows: [V.newName], taps: ['See it', 'Not now'] },
  }, () => ({ 'See it': [['openPosterOffer', []]], 'Not now': [['dismissPosterOffer', []]] }));

  /* 2e. The one listener that runs every component's buttons, in the real page. tools/alert_pill_check.js
     holds it in a vm; this holds the copy the app actually registered, with whatever else the page has
     added to the document since. A name UI_ACTIONS does not own does nothing, even one every object
     inherits; arguments are JSON or nothing; and nothing is evaluated on the way. */
  console.log('\n2e. the component action listener, in the real page');
  const disp = await page.evaluate(() => {
    const r = { registry: typeof UI_ACTIONS === 'object' && UI_ACTIONS !== null };
    if (!r.registry) return r;
    window.__pwnHits = [];
    const names = Object.keys(UI_ACTIONS), saved = {}, calls = [];
    names.forEach((n) => { saved[n] = UI_ACTIONS[n]; UI_ACTIONS[n] = function () { calls.push([n, [].slice.call(arguments)]); }; });
    // An inherited name that would run if the listener ever looked past UI_ACTIONS' own entries.
    Object.defineProperty(Object.prototype, '__pwn_disp', { value: function () { window.__pwnHits.push('disp-inherited'); }, configurable: true, writable: true });
    const spied = []; const realEval = window.eval, realFn = window.Function, realST = window.setTimeout, realSI = window.setInterval;
    window.eval = function (s) { spied.push('eval'); return realEval(s); };
    window.Function = function () { spied.push('Function'); return realFn.apply(this, arguments); };
    window.setTimeout = function (f) { if (typeof f === 'string') spied.push('setTimeout(string)'); return realST.apply(window, arguments); };
    window.setInterval = function (f) { if (typeof f === 'string') spied.push('setInterval(string)'); return realSI.apply(window, arguments); };
    const errs = [];
    const tap = (act, args) => {
      const b = document.createElement('button');
      b.setAttribute('data-act', act);
      if (args !== undefined) b.setAttribute('data-args', args);
      const inner = document.createElement('span'); b.appendChild(inner);
      document.body.appendChild(b);
      const before = calls.length;
      try { inner.click(); } catch (e) { errs.push(act + ': ' + e.message); }
      b.remove();
      return calls.slice(before);
    };
    try {
      r.inherited = ['__pwn_disp', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__', 'isPrototypeOf']
        .map((n) => [n, tap(n, '[]').length]).filter((x) => x[1]);
      r.unknown = tap('noSuchAction', '[]').length + tap('', '[]').length + tap('logDose ', '[]').length;
      const known = names[0];
      r.badJson = tap(known, '"]);__pwn_disp();//').length + tap(known, '[1,').length;
      r.notArray = tap(known, '{"0":"x","length":1}').length + tap(known, '"x"').length + tap(known, 'null').length + tap(known, '7').length;
      const lit = '__pwn_disp()";alert(1);//<x-pwn>';
      r.literal = tap(known, JSON.stringify([lit, 3, null, true]));
      r.literalOk = r.literal.length === 1 && JSON.stringify(r.literal[0][1]) === JSON.stringify([lit, 3, null, true]);
      r.noArgs = tap(known);
      r.known = known;
    } finally {
      names.forEach((n) => { UI_ACTIONS[n] = saved[n]; });
      delete Object.prototype.__pwn_disp;
      window.eval = realEval; window.Function = realFn; window.setTimeout = realST; window.setInterval = realSI;
    }
    r.spied = spied; r.errs = errs; r.hits = window.__pwnHits.slice();
    // Every data-act on screen names an own entry, and every data-args parses to an array.
    r.badOnScreen = [...document.querySelectorAll('[data-act]')].filter((el) => {
      if (!Object.prototype.hasOwnProperty.call(UI_ACTIONS, el.getAttribute('data-act'))) return true;
      if (!el.hasAttribute('data-args')) return false;
      try { return !Array.isArray(JSON.parse(el.getAttribute('data-args'))); } catch (e) { return true; }
    }).map((el) => el.outerHTML.slice(0, 120));
    return r;
  });
  ok('the page has one action registry, UI_ACTIONS', disp.registry, disp);
  if (disp.registry) {
    ok('an inherited name (__proto__, constructor, toString, one planted on Object.prototype...) does nothing', !disp.inherited.length && disp.hits.indexOf('disp-inherited') < 0, disp);
    ok('an unknown name does nothing', disp.unknown === 0, disp.unknown);
    ok('data-args that is not JSON does nothing, and its text never runs', disp.badJson === 0 && !disp.hits.length, disp);
    ok('data-args that is JSON but not an array does nothing', disp.notArray === 0, disp.notArray);
    ok('a known name gets its arguments as plain values, exactly, a script-shaped string included', disp.literalOk, disp.literal);
    ok('a known name with no data-args gets no arguments', disp.noArgs.length === 1 && disp.noArgs[0][1].length === 0, disp.noArgs);
    ok('nothing is evaluated on the way (no eval, Function, or string timer)', !disp.spied.length, disp.spied);
    ok('and nothing threw', !disp.errs.length, disp.errs);
    ok('every data-act on screen names an own UI_ACTIONS entry, with array arguments', !disp.badOnScreen.length, disp.badOnScreen);
  }

  console.log('\n3. the ingest helpers store-firebase.js calls where snapshots land');
  const ing = await page.evaluate((p, color, srcBad, png) => {
    var I = window.cubbyIngest;
    if (!I) return { missing: true };
    var r = {};
    r.id = I.id(p);
    r.idGood = I.id('lq3x9a1kmh2b4c');
    r.idAuto = I.id('Xk2Pq9ZzA0bC1dE2fG3h');
    r.idStable = I.id(p) === I.id(p);
    r.color = I.color(color); r.hex = I.color('#F4A6B8'); r.varTok = I.color('var(--feed)');
    r.srcBad = I.photo(srcBad); r.srcPng = I.photo(png) === png; r.srcPath = I.photo('/app/avatars/cub-oat.webp');
    r.srcSvg = I.photo('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
    r.srcFar = I.photo('https://evil.example/x.png');
    var ev = I.event({ type: 'feed', note: p, time: 5, babyId: p, photoId: p }, p);
    r.ev = { id: ev.id, keptNote: ev.note === p, babyId: ev.babyId, photoId: ev.photoId, sameAsId: ev.babyId === I.id(p) };
    var nt = I.note({ text: p, audience: 'circle' }, p);
    r.nt = { id: nt.id, keptText: nt.text === p };
    var blob = { babies: [{ id: p, name: p, color: color }], photos: [{ id: p, photoId: p, babyId: p, caption: p }], meds: [{ id: p, babyId: p, name: p }] };
    I.blob(blob);
    // Round 2: numbers stay numbers, enums stay on their list, free text stays exactly as typed.
    var nb = { babies: [{ id: 'b1', place: "1);x();//", allergies: [p], growthSource: p, sex: p, birth: '1700000000000', gestWeeks: p }],
      settings: { unit: p, wUnit: 'lb', hUnit: p, hcUnit: p, tempUnit: 'F' }, journey: { rel: { b1: [{ id: 'r1', at: "1);x();//", label: p }] } } };
    I.blob(nb);
    var np = I.blob({ stage: 'expecting', glucoseUnit: p, appts: [{ id: 'a1', sfh: '30', efw: p, week: ' 31 ' }], kicks: [{ id: 'k', count: p }], glucose: [{ id: 'g', val: '5.4', unit: p }] });
    var ne = I.event({ type: 'growth', time: '1700000000000', weight: p, wUnit: p, hUnit: 'in', note: p }, 'e1');
    r.norm = { place: nb.babies[0].place, allergy: nb.babies[0].allergies[0] === p, gs: nb.babies[0].growthSource, sex: nb.babies[0].sex, birth: nb.babies[0].birth, gw: nb.babies[0].gestWeeks,
      set: nb.settings, relAt: nb.journey.rel.b1[0].at, relLabel: nb.journey.rel.b1[0].label === p,
      gu: np.glucoseUnit, sfh: np.appts[0].sfh, efw: np.appts[0].efw, week: np.appts[0].week, count: np.kicks[0].count, val: np.glucose[0].val, gunit: np.glucose[0].unit,
      evTime: ne.time, evW: ne.weight, evWU: ne.wUnit, evHU: ne.hUnit, evNote: ne.note === p };
    r.blob = { babyId: blob.babies[0].id, babyName: blob.babies[0].name === p, color: blob.babies[0].color, photoId: blob.photos[0].photoId, caption: blob.photos[0].caption === p, medId: blob.meds[0].id, medBaby: blob.meds[0].babyId, linked: blob.meds[0].babyId === blob.babies[0].id };
    return r;
  }, P('x'), COLOR, SRC, PNG);
  ok('window.cubbyIngest exists', !ing.missing);
  if (!ing.missing) {
    const SAFE = /^[A-Za-z0-9_.:-]{1,128}$/;
    ok('a hostile id comes back safe', SAFE.test(ing.id), ing.id);
    ok('and the same every time, so references stay linked', ing.idStable);
    ok('a real uid() id is untouched', ing.idGood === 'lq3x9a1kmh2b4c', ing.idGood);
    ok('a real Firestore auto id is untouched', ing.idAuto === 'Xk2Pq9ZzA0bC1dE2fG3h', ing.idAuto);
    ok('a hostile colour is dropped', !/PWN|"|url/.test(ing.color || ''), ing.color);
    ok('a #hex colour is kept', ing.hex === '#F4A6B8', ing.hex);
    ok('a theme token colour is kept', ing.varTok === 'var(--feed)', ing.varTok);
    ok('photo bytes that are not an image data URL are dropped', ing.srcBad === '', ing.srcBad);
    ok('a png data URL is kept', ing.srcPng);
    ok('a same-origin path is kept', ing.srcPath === '/app/avatars/cub-oat.webp', ing.srcPath);
    ok('an svg data URL (which can carry script) is dropped', ing.srcSvg === '', ing.srcSvg);
    ok('a far-away URL is dropped', ing.srcFar === '', ing.srcFar);
    ok('an event keeps its note and gets a safe id', SAFE.test(ing.ev.id) && ing.ev.keptNote, ing.ev);
    ok('its babyId and photoId are made safe the same way', ing.ev.sameAsId && SAFE.test(ing.ev.photoId), ing.ev);
    ok('a note keeps its text and gets a safe id', SAFE.test(ing.nt.id) && ing.nt.keptText, ing.nt);
    ok('the blob: baby keeps its name, its id and colour are made safe', SAFE.test(ing.blob.babyId) && ing.blob.babyName && !/PWN|"/.test(ing.blob.color || ''), ing.blob);
    ok('the blob: a photo keeps its caption, its photoId is made safe', SAFE.test(ing.blob.photoId) && ing.blob.caption, ing.blob);
    ok('the blob: a medicine still points at its baby', ing.blob.linked && SAFE.test(ing.blob.medId), ing.blob);
    const n = ing.norm;
    ok('free text stays exactly as typed: a birth place, an allergy, a relationship label, an entry note', n.place === "1);x();//" && n.allergy && n.relLabel && n.evNote, n);
    ok('a number written as a string becomes that number (birth, a visit SFH, a week with spaces, a glucose reading, an entry time)', n.birth === 1700000000000 && n.sfh === 30 && n.week === 31 && n.val === 5.4 && n.evTime === 1700000000000, n);
    ok('anything else in a number field is dropped (gestWeeks, rel.at, EFW, a kick count, a weight)', [n.gw, n.relAt, n.efw, n.count, n.evW].every((v) => v === undefined), n);
    ok('a unit off the list falls back to its default, a real one is kept', n.set.unit === 'ml' && n.set.wUnit === 'lb' && n.set.hUnit === 'cm' && !('hcUnit' in n.set) && n.set.tempUnit === 'F' && n.evWU === 'kg' && n.evHU === 'in', n);
    ok('growthSource, sex and the glucose units off their lists are dropped or reset', n.gs === undefined && n.sex === undefined && n.gu === undefined && n.gunit === undefined, n);
  }
  const sf = fs.readFileSync(path.join(ROOT, 'app/store-firebase.js'), 'utf8');
  ok('store-firebase: no listener sets an id straight from a doc', !/\.id\s*=\s*(ch\.)?doc\.id\b/.test(sf), (sf.match(/.*\.id\s*=\s*(ch\.)?doc\.id\b.*/g) || []).join('\n         '));
  ok('store-firebase: photo bytes never land in PhotoStore.map unchecked', !/PhotoStore\.map\[[^\]]+\]\s*=\s*(ch\.)?doc\.data\(\)\.data/.test(sf), (sf.match(/.*PhotoStore\.map\[[^\]]+\]\s*=\s*(ch\.)?doc\.data\(\)\.data.*/g) || []).join('\n         '));
  // ing() is store-firebase's handle on window.cubbyIngest (a pass-through only if index.html is older).
  const count = (re) => (sf.match(re) || []).length;
  ok('store-firebase: both events listeners (live and the history read) run the ingest check', count(/ing\(\)\.event\(/g) >= 2, count(/ing\(\)\.event\(/g));
  ok('store-firebase: the notes listener runs the ingest check', count(/ing\(\)\.note\(/g) >= 1);
  ok('store-firebase: both photo byte listeners run the ingest check', count(/ing\(\)\.photo\(/g) >= 2, count(/ing\(\)\.photo\(/g));
  ok('store-firebase: the household blob and the shared journey run the ingest check', /function applyAppBlob\(app\) \{\s*if \(!app\) return;\s*ing\(\)\.blob\(app\)/.test(sf) && /ing\(\)\.blob\(d\.data/.test(sf));
  ok('store-firebase: ing() really is window.cubbyIngest', /function ing\(\) \{ return window\.cubbyIngest \|\| PASS; \}/.test(sf));
  // Her readings reach her partner through applyMatDoc, not the journey doc, so it needs its own call.
  const matFold = (sf.match(/function applyMatDoc\(cat, d\) \{[^]*?\n  \}/) || [''])[0];
  ok('store-firebase: her health readings (applyMatDoc) run the ingest check before they reach state', /var I = ing\(\), data = \('mat' in I \? I : PASS\)\.mat\(d\.data/.test(matFold) && !/Object\.keys\(d\.data/.test(matFold), matFold.slice(-400));
  const idx = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
  const load = (idx.match(/async load\(\)\{[^]*?\n  \},/) || [''])[0];
  ok('index.html: Store.load hands back what was cached through the ingest check', /cubbyIngest\.loaded\(d\)/.test(load), load.slice(0, 400));

  const own = errs.filter((e) => !/firebase|network|Failed to fetch|ERR_|messaging|installations/i.test(e));
  ok('no page errors along the way', own.length === 0, own.slice(0, 5));

  await browser.close();

  /* The fields above are the ones someone thought of, and round 1 passed them with six holes left in
     fields nobody listed. So this gate also runs its companion, which lists none: every string and
     number leaf of a realistic household, hostile one class at a time, through the real ingest,
     on every screen and sheet (tools/xss_leaf_check.js). */
  console.log('\n4. the companion: every leaf, hostile, through the real ingest');
  const leaf = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'xss_leaf_check.js'), BASE], { encoding: 'utf8', timeout: 1200000, maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write((leaf.stdout || '').replace(/^/gm, '  | '));
  if (leaf.stderr) process.stdout.write(leaf.stderr.replace(/^/gm, '  ! '));
  ok('tools/xss_leaf_check.js passes', leaf.status === 0 && /XSS-LEAF: PASS/.test(leaf.stdout || ''), 'exit ' + leaf.status);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('XSS-SINK: ' + (fail ? 'FAIL' : 'PASS'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log('XSS-SINK: FAIL'); process.exit(1); });
