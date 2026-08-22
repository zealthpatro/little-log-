/* Entering a screen animates. A background sync repainting that screen does not.
 *
 *   node tools/serve.js &   &&   node tools/rerender_gate.js [baseUrl]
 *
 * WHY THIS EXISTS. A parent filmed her Care tab and called it jittery. She was right, and the cause was
 * invisible to every gate we had: `.fade-in` carries `animation:rise .45s`, sixteen render functions
 * return a fresh `<div class="fade-in">` wrapper, and paintShell's patch path replaces #scroll's
 * children — so each repaint produced a NEW wrapper and the browser restarted the animation. With
 * rerender() wired to fifteen Firestore listener call sites, any activity anywhere in the household made
 * the whole visible tab rise and fade again.
 *
 * It is not only ugly. The page moves under a thumb that is aiming at a checkbox, which is one way a
 * parent ticks the wrong appointment, and it makes the app feel unreliable at the exact moment it is
 * showing someone their antenatal schedule.
 *
 * perf_check counts DOM nodes and markup size; uitest checks contrast and dead taps. Neither can see an
 * animation replay, which is why this is its own gate.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const DAY = 86400000;

const SEED = {
  babies: [{ id: 'b1', name: 'Aria', birth: Date.now() - 21 * DAY, sex: 'F', country: 'uk', routines: [] }],
  activeBabyId: 'b1',
  events: [{ id: 'e1', type: 'feed', time: Date.now() - 2 * 3600000, babyId: 'b1', method: 'bottle', amount: 90 }],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { install: 1, home: 1, leftnote: 1, gs: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '\n         ' + d : ''))); };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], protocolTimeout: 300000 });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.setViewport({ width: 390, height: 1400, deviceScaleFactor: 1 });
  await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2' });
  await p.evaluate((s) => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', 'light');
  }, SEED);
  await p.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 2200));

  console.log('\nentering a screen still animates');
  const onEnter = await p.evaluate(async () => {
    go('home'); await new Promise((r) => setTimeout(r, 400));
    go('log');  await new Promise((r) => setTimeout(r, 500));
    const w = document.querySelector('#scroll .fade-in');
    return w ? { has: true, anim: getComputedStyle(w).animationName, noRise: w.classList.contains('no-rise') } : { has: false };
  });
  ck(onEnter.has, 'the tab wrapper is there on a view change', JSON.stringify(onEnter));
  ck(onEnter.has && onEnter.anim === 'rise' && !onEnter.noRise,
    'and it plays the rise animation, because you actually arrived', JSON.stringify(onEnter));

  console.log('\na repaint of the SAME view does not animate again');
  const onRepaint = await p.evaluate(async () => {
    const sc = document.getElementById('scroll');
    const before = sc.firstElementChild;
    /* Force the replaceChildren path the way a Firestore snapshot does: same shell signature, changed
       content. Calling render() with unchanged data hits paintShell's html===_shellHtml early-out and
       never touches the DOM, which would make this assertion pass for the wrong reason. */
    /* A real ELEMENT as the marker, not a comment: paintShell's patch path moves parsed element nodes
       across, so a comment never survives and the check would report "nothing landed" while the repaint
       had in fact happened. It doubles as a guaranteed-fresh .fade-in for the assertion below.
       Built through the DOM rather than a regex, too: an earlier draft matched `<div id="scroll"` and
       silently did nothing, because innerHTML serialises class before id — so `changed` equalled the
       original, paintShell took its no-op early-out, and the assertion below passed while testing
       nothing at all. That is exactly the failure the repaintLanded check exists to catch. */
    const tmp = document.createElement('div');
    tmp.innerHTML = document.getElementById('app').innerHTML;
    const tScroll = tmp.querySelector('#scroll');
    const probeEl = document.createElement('div');
    probeEl.className = 'fade-in'; probeEl.id = 'rrProbe'; probeEl.textContent = 'probe';
    tScroll.insertBefore(probeEl, tScroll.firstChild);
    paintShell(_shellSig, tmp.innerHTML);
    await new Promise((r) => setTimeout(r, 150));
    const scAfter = document.getElementById('scroll');
    const all = [].slice.call(scAfter.querySelectorAll('.fade-in'));
    const probe = scAfter.querySelector('#rrProbe');
    return {
      scrollSurvived: scAfter === sc,
      repaintLanded: !!probe,
      probeAnim: probe ? getComputedStyle(probe).animationName : null,
      wrappers: all.length,
      animating: all.filter(function (n) { return getComputedStyle(n).animationName !== 'none'; }).length
    };
  });
  ck(onRepaint.scrollSurvived, '#scroll itself survives the repaint (iOS keeps its inertial scroll)', JSON.stringify(onRepaint));
  ck(onRepaint.repaintLanded, 'the repaint actually touched the DOM, so this is not passing by doing nothing', JSON.stringify(onRepaint));
  /* The invariant is "nothing animates", NOT "the element was swapped". An earlier draft asserted the
     swap and failed on the Log tab, where patchTimeline updates the wrapper IN PLACE — which is better
     than replacing it, and still correct. Assert the thing you actually care about. */
  ck(onRepaint.wrappers > 0 && onRepaint.animating === 0,
    'and no wrapper replays the entry animation', JSON.stringify(onRepaint));

  console.log('\nthe gate can fail');
  const caught = await p.evaluate(async () => {
    const st = document.createElement('style');
    st.id = 'rrSelfTest';
    st.textContent = '.fade-in.no-rise{animation:rise .45s !important;}';   // put the bug back
    document.head.appendChild(st);
    const changed = document.getElementById('app').innerHTML.replace(/(<div id="scroll"[^>]*>)/, '$1<!--y-->');
    paintShell(_shellSig, changed);
    await new Promise((r) => setTimeout(r, 150));
    const after = document.querySelector('#scroll .fade-in');
    const anim = after ? getComputedStyle(after).animationName : null;
    const n = document.getElementById('rrSelfTest'); if (n) n.remove();
    return anim;
  });
  ck(caught === 'rise', 'it notices when the entry animation is allowed to replay', 'saw ' + caught);

  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));
  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
