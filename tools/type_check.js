/* The type contract, enforced. Canon: DESIGN.md A3.1.
 *
 * Cubby has three faces and they are a signal about WHO IS SPEAKING, which a parent reads before she
 * reads a word. Two rules:
 *
 *   1. THE HANDWRITING FACE MEANS A PERSON WROTE THIS. Caveat is for content a member authored and the
 *      byline that says who. Cubby's own words never wear it.
 *   2. IN A BLOCK WHERE CUBBY IS SPEAKING, ITS HEADING IS THE LARGEST THING IN IT. Supporting text
 *      never out-ranks the heading it sits under.
 *
 * WHY THIS IS A GATE AND NOT A NOTE IN A DOC. The Notes empty state opened with a quote of the day in
 * the display face at 17px with a Caveat byline, under a 14px body-face heading: larger than its own
 * heading and signed in handwriting, so it read as a note somebody had left. That was fixed once by
 * CENTRING the quote — which held the two apart without anyone recording that centring was the thing
 * doing the holding. When the lane later became one left-aligned column, for a good reason, the bug
 * came back unchanged. A rule that lives only in a layout choice is not a rule.
 *
 * SIZES ARE COMPARED IN CAP HEIGHT, NOT px. Measured on this machine: at 100px the cap heights are
 * body 70.5, display 70.0, hand 67.6. So `font-size` alone is not a comparison across faces, and the
 * bug sat in exactly that blind spot. The factors are measured at runtime, so swapping a font cannot
 * silently invalidate the gate.
 *
 *   node tools/serve.js &   &&   node tools/type_check.js [baseUrl]
 *   node tools/type_check.js --self-test     # proves the gate can fail (see the bottom of this file)
 */
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const SELF_TEST = args.indexOf('--self-test') >= 0;
const BASE = (args.filter(a => !a.startsWith('--'))[0] || 'http://localhost:8080');
const DAY = 86400000;

/* RULE 1's allowlist. One entry, and it should stay close to one: every addition is a decision that
   Cubby is putting a human's handwriting on something. Each needs a reason, because a list of
   selectors with no reasons becomes a list nobody dares delete from. */
const HAND_OK = {
  '.note-card .nt-by': 'the name of the member who actually wrote this note. This is the anchor the rule is built on.',
};

/* RULE 2's blocks: places Cubby speaks in more than one voice level, with the element that is the
   heading. A block not listed here is not checked, so adding a new message block means adding it
   here — which is the point. */
const BLOCKS = [
  ['.note-empty', '.qod-none', 'the empty Notes lane. Where this bug lived, twice.'],
  ['.empty-state', 'p', 'the illustrated cold screens (Log, Stats, Album).'],
  ['.conn-card', 'p', 'the connectivity card, which has to explain itself at 3am.'],
  ['.coach', '.cm-t', 'the one-time coach marks.'],
  ['.alert-pill', '.ap-t', 'the loudest thing Cubby ever shows a parent.'],
  ['.ww-line', '.ww-t', 'the wake-window line.'],
  ['.hero-invite', '.ht', 'the add-a-photo invitation.'],
  ['.set-item', '.a', 'every settings row.'],
];

/* Screens to walk. Seeded so the message blocks actually render: an empty lane needs no notes, an
   alert pill needs a dose due, the cold screens need an empty tab. */
const STEPS = [
  ['home', "go('home')"],
  ['home: empty notes lane', "go('home'); state.notes=[]; render()"],
  ['home: a note from somebody else', "go('home'); state.notes=[{id:'t1',text:'Formula is in the top cupboard.',day:dayKey(now()),at:now()-3600000,createdBy:'other',createdByName:'Papa Bear',audience:'circle'}]; render()"],
  ['log (empty)', "state.events=[]; go('log'); render()"],
  ['album (empty)', "go('album')"],
  ['health', "go('health')"],
  ['settings', "closeSheet(); openSettings()"],
  ['the connectivity card', "closeSheet(); go('home'); var c=document.createElement('div'); c.innerHTML=window.cubbyConnCard({title:'We can\\u2019t reach your Cubby',body:'You look offline. Anything already saved on this phone is still here, safe.'}); document.getElementById('scroll').appendChild(c)"],
  ['home: dose due', "closeSheet(); go('home'); state.meds=[{id:'m1',babyId:state.activeBabyId,name:'Calpol',dose:'2.5',unit:'ml',pattern:{type:'everyX',hours:6},remind:true,active:true}]; state.events=[{id:'e9',babyId:state.activeBabyId,type:'medicine',medId:'m1',medName:'Calpol',time:Date.now()-7*3600000}].concat(state.events); render()"],
];

const SEED = {
  babies: [{ id: 'b1', name: 'Aria', birth: Date.now() - 40 * DAY, sex: 'F', country: 'uk', routines: [] }],
  activeBabyId: 'b1',
  events: [{ id: 'e1', type: 'feed', time: Date.now() - 2 * 3600000, babyId: 'b1', method: 'bottle', amount: 90 }],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { install: 1, home: 1, leftnote: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

let fails = 0, passes = 0;
const bad = [];
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '\n         ' + d : ''))); };

/* Runs inside the page. Returns every violation it can see in the CURRENT paint, with enough detail to
   act on: the selector, the face, and the cap-height comparison that decided it. */
const AUDIT = `(async function(handOk, blocks, injectBug){
  await (document.fonts ? document.fonts.ready : Promise.resolve());
  var canvas=document.createElement('canvas'), cx=canvas.getContext('2d');
  var CAP={};
  function capOf(family){
    if(CAP[family]!=null) return CAP[family];
    cx.font='700 100px '+family;
    var m=cx.measureText('H');
    CAP[family]=(m.actualBoundingBoxAscent||70)/100;
    return CAP[family];
  }
  function faceOf(el){
    var f=getComputedStyle(el).fontFamily.toLowerCase();
    if(f.indexOf('caveat')>=0) return 'hand';
    if(f.indexOf('fraunces')>=0) return 'display';
    return 'body';
  }
  // Visual size: px scaled by the face's own cap height, so 17px display and 14px body are comparable.
  function visual(el){
    var s=getComputedStyle(el);
    var fam=s.fontFamily.split(',')[0].replace(/["']/g,'');
    return parseFloat(s.fontSize)*capOf(fam);
  }
  function path(el){
    var out=[];
    for(var n=el; n && n.nodeType===1 && out.length<4; n=n.parentElement){
      var s=n.tagName.toLowerCase();
      if(n.classList.length) s+='.'+[].slice.call(n.classList).join('.');
      out.unshift(s);
      if(n.id) { out[0]='#'+n.id; break; }
    }
    return out.join(' > ');
  }
  /* Its own text, and it has to contain a LETTER. Both rules are about words: who is speaking, and
     which words out-rank which. An icon slot is not supporting text, and the first run of this proved
     the point by flagging three of them — the party emoji in an alert pill and two glyphs in settings
     rows, all deliberately larger than the heading beside them because they are pictures. Flagging
     correct things is the fastest way to make a gate ignored, so the test is for letters rather than a
     list of icon class names, which would need updating every time somebody adds one. */
  function hasOwnText(el){
    var own='';
    for(var i=0;i<el.childNodes.length;i++){
      var n=el.childNodes[i];
      if(n.nodeType===3) own+=n.textContent;
    }
    if(!own.trim()) return false;
    // Double-escaped: this whole audit is a template literal, so a single \\p reaches the page as p and
    // the regex became /p{L}/u \u2014 "incomplete quantifier". Caught on the first run.
    try { return /\\p{L}/u.test(own); } catch(e) { return /[A-Za-z\\u00C0-\\u024F]/.test(own); }
  }
  var root=document.body;
  if(injectBug){
    // --self-test: put the original bug back, in a detached-but-rendered block, and require the audit
    // to catch BOTH halves of it. A gate that has never failed is a guess.
    var d=document.createElement('div');
    d.className='note-empty';
    d.innerHTML='<div class="qod-none">Nothing yet today.</div>'
      + '<div class="qod" style="font-family:Fraunces,serif;font-size:17px">Your love is the safest place they will ever know.</div>'
      + '<div class="qod-by" style="font-family:Caveat,cursive;font-size:16px">Cubby</div>';
    d.setAttribute('data-selftest','1');
    document.getElementById('scroll').appendChild(d);
  }

  var violations=[];

  // ---- RULE 1: the handwriting face is reserved.
  var all=root.querySelectorAll('*');
  for(var i=0;i<all.length;i++){
    var el=all[i];
    if(!hasOwnText(el)) continue;
    if(faceOf(el)!=='hand') continue;
    var ok=false;
    for(var k=0;k<handOk.length;k++){ try{ if(el.matches(handOk[k])) { ok=true; break; } }catch(e){} }
    if(!ok) violations.push({rule:1, sel:path(el), text:el.textContent.trim().slice(0,42),
      detail:'set in the handwriting face, which means a person wrote this'});
  }

  // ---- RULE 2: in a Cubby block, the heading is the largest thing.
  for(var bi=0; bi<blocks.length; bi++){
    var blockSel=blocks[bi][0], headSel=blocks[bi][1];
    var found=root.querySelectorAll(blockSel);
    for(var j=0;j<found.length;j++){
      var block=found[j];
      var head=block.querySelector(headSel);
      if(!head) continue;
      var hv=visual(head);
      var kids=block.querySelectorAll('*');
      for(var m2=0;m2<kids.length;m2++){
        var kid=kids[m2];
        if(kid===head || head.contains(kid) || kid.contains(head)) continue;
        if(!hasOwnText(kid)) continue;
        var kv=visual(kid);
        if(kv > hv + 0.5){
          violations.push({rule:2, sel:path(kid), text:kid.textContent.trim().slice(0,42),
            detail:'renders at '+kv.toFixed(1)+' cap-px inside '+blockSel+', whose heading ('+headSel+') is only '+hv.toFixed(1)});
        }
      }
    }
  }
  return violations;
})(HANDOK, BLOCKS, INJECT)`;

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 390, height: 1400, deviceScaleFactor: 1 });
  await p.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2' });
  await p.evaluate(s => {
    localStorage.setItem('little-log-v1', JSON.stringify(s));
    localStorage.setItem('cubby-quick-uid', 'local');
    localStorage.setItem('cubby-theme:local', 'light');
  }, SEED);
  await p.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  const code = AUDIT
    .replace('HANDOK', JSON.stringify(Object.keys(HAND_OK)))
    .replace('BLOCKS', JSON.stringify(BLOCKS.map(x => [x[0], x[1]])));

  console.log('\nthe contract');
  console.log('  handwriting is allowed on ' + Object.keys(HAND_OK).length + ' selector(s):');
  for (const [sel, why] of Object.entries(HAND_OK)) console.log('    ' + sel + '  — ' + why);
  console.log('  ' + BLOCKS.length + ' blocks are checked for heading rank');

  // Both themes: a face or a size can be overridden per theme, and that is precisely the kind of thing
  // nobody looks at twice.
  for (const theme of ['light', 'night']) {
    console.log('\nwalking ' + STEPS.length + ' screens in ' + theme);
    await p.evaluate(t => { document.documentElement.setAttribute('data-theme', t); }, theme);
    for (const [label, step] of STEPS) {
      try { await p.evaluate(s => { eval(s); }, step); } catch (e) { console.log('  (skipped ' + label + ': ' + e.message.split('\n')[0] + ')'); continue; }
      await new Promise(r => setTimeout(r, 450));
      const v = await p.evaluate(c => eval(c), code.replace('INJECT', 'false'));
      for (const x of v) bad.push(Object.assign({ theme, screen: label }, x));
    }
  }

  // De-duplicate: the same rule breaking on six screens is one thing to fix, not six.
  const uniq = new Map();
  for (const v of bad) {
    const key = v.rule + '|' + v.sel + '|' + v.detail;
    if (!uniq.has(key)) uniq.set(key, { ...v, screens: new Set() });
    uniq.get(key).screens.add(v.theme + ':' + v.screen);
  }

  console.log('\nrule 1 — the handwriting face is reserved');
  const r1 = [...uniq.values()].filter(v => v.rule === 1);
  ck(r1.length === 0, 'nothing outside the allowlist is wearing a person\'s handwriting',
    r1.map(v => v.sel + '  "' + v.text + '"\n         seen on: ' + [...v.screens].join(', ')).join('\n         '));

  console.log('\nrule 2 — a heading out-ranks what it supports');
  const r2 = [...uniq.values()].filter(v => v.rule === 2);
  ck(r2.length === 0, 'no supporting text is larger than its own heading',
    r2.map(v => v.sel + '  "' + v.text + '"\n         ' + v.detail + '\n         seen on: ' + [...v.screens].join(', ')).join('\n         '));

  console.log('\nthe gate can fail');
  /* Put the original bug back and require BOTH halves to be caught. Without this the two checks above
     passing means nothing: they would also pass if the audit silently found no elements at all. */
  await p.evaluate(s => { eval(s); }, "closeSheet(); go('home'); state.notes=[]; render()");
  await new Promise(r => setTimeout(r, 400));
  const caught = await p.evaluate(c => eval(c), code.replace('INJECT', 'true'));
  const st = caught.filter(v => /data-selftest|note-empty/.test(v.sel) || /qod/.test(v.sel));
  ck(st.some(v => v.rule === 1), 'it catches the Caveat byline when the bug is put back',
    JSON.stringify(caught.map(v => v.rule + ':' + v.sel)));
  ck(st.some(v => v.rule === 2), 'and the oversized quote', JSON.stringify(caught.filter(v => v.rule === 2).map(v => v.detail)));
  await p.evaluate(() => { const n = document.querySelector('[data-selftest]'); if (n) n.remove(); });

  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));

  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
