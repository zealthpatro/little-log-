// Gate for what a parent is offered on home, and who gets to decide it.
//
// The Quick log row on home used to be hardcoded to the stage's default set, on purpose: a comment
// said the home tiles are "the main surface, not a shortcut". The effect was that the one screen a
// parent looks at forty times a day was the only one she could not tidy, and Pump sat there
// permanently for every parent who does not express. The customisation existed, but it governed the
// floating button alone and lived three taps deep in Settings under a row named after that button, so
// nobody knew the home row could change at all.
//
// Now one per-user list governs both, and the assertions are about that:
//   - out of the box, home does NOT offer pump (or voice, which is a microphone, not a tile)
//   - the picker still offers pump, and choosing it puts it back and keeps it
//   - removing something removes it from home AND the round button, so the two cannot disagree
//   - choosing nothing leaves a door, never a heading over a blank space
//   - the choice is per person in localStorage keyed by uid, never in state.settings, which is the
//     shared household blob: one caregiver tidying their own home must not retile anybody else's
//   - and there is a way in from home itself
//
//   node tools/serve.js &   &&   node tools/homelogs_gate.js [baseUrl]
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = (process.argv[2] || 'http://localhost:8080') + '/app/?e2e=1';
const DAY = 86400000;

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '  ' + d : ''))); };

const SEED = {
  babies: [{ id: 'b1', name: 'Aria', birth: Date.now() - 40 * DAY, sex: 'F', country: 'uk', routines: [] }],
  activeBabyId: 'b1', events: [],
  settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', theme: 'light', seen: { install: 1, home: 1 } },
  timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, illnesses: [], pregnancy: null, notes: []
};

// What is actually on the home row, by label, plus where the choice is stored.
const PROBE = `(function(){
  var sc=document.getElementById('scroll');
  var row=sc.querySelector('.actions');
  var labels=row?[].slice.call(row.querySelectorAll('.action')).map(function(b){
    var t=b.querySelector('.label');
    return (t?t.textContent:b.textContent).trim();
  }):[];
  return {
    labels: labels,
    chooseOnHome: !!sc.querySelector('.sec-act'),
    homeKeys: quickChosenHome(),
    fabKeys: quickChosen(),
    stored: localStorage.getItem('cubby-quick-'+quickUid()),
    inShared: JSON.stringify(state.settings).indexOf('pick') > -1
  };
})()`;

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
  const look = () => p.evaluate(probe => eval(probe), PROBE);
  const fresh = () => p.evaluate((probe) => {
    localStorage.removeItem('cubby-quick-' + quickUid());
    view = 'home'; render(); return eval(probe);
  }, PROBE);

  console.log('\n1. out of the box');
  const d = await fresh();
  ck(d.homeKeys.indexOf('pump') < 0, 'pump is not on home any more', JSON.stringify(d.homeKeys));
  ck(d.labels.indexOf('Pump') < 0, 'and no tile says Pump', JSON.stringify(d.labels));
  ck(d.homeKeys.indexOf('voice') < 0, 'voice is not a tile either (it is a microphone with its own door)');
  ck(d.homeKeys.indexOf('feed') >= 0 && d.homeKeys.indexOf('sleep') >= 0 && d.homeKeys.indexOf('diaper') >= 0,
    'the three a parent actually reaches for are still first', JSON.stringify(d.homeKeys));
  ck(d.chooseOnHome, 'and there is a way in from home itself');

  console.log('\n2. pump is offered, not removed');
  const offered = await p.evaluate(() => {
    closeSheet(); openQuickSettings();
    const sheet = document.getElementById('sheet');
    return {
      rows: [].slice.call(sheet.querySelectorAll('.bag-row')).map(r => r.id.replace('qs-', '')),
      mentionsPump: /pump/i.test(sheet.textContent),
      title: (sheet.querySelector('h2') || {}).textContent || null,
    };
  });
  ck(offered.rows.indexOf('pump') >= 0, 'the picker still offers pump', JSON.stringify(offered.rows));
  ck(offered.mentionsPump, 'and says out loud that you can turn it off if you are not expressing');
  ck(!/button/i.test(offered.title || ''), 'the sheet is no longer named after the round button', String(offered.title));

  const back = await p.evaluate((probe) => {
    toggleQuickAction('pump'); closeSheet(); render(); return eval(probe);
  }, PROBE);
  ck(back.homeKeys.indexOf('pump') >= 0, 'choosing it puts it on home', JSON.stringify(back.homeKeys));
  ck(back.labels.indexOf('Pump') >= 0, 'as a real tile', JSON.stringify(back.labels));
  ck(back.fabKeys.indexOf('pump') >= 0, 'and in the round button, from the same list');

  console.log('\n3. removing something removes it from both');
  const gone = await p.evaluate((probe) => {
    toggleQuickAction('pump'); toggleQuickAction('diaper'); closeSheet(); render(); return eval(probe);
  }, PROBE);
  ck(gone.homeKeys.indexOf('diaper') < 0 && gone.fabKeys.indexOf('diaper') < 0,
    'home and the round button agree', 'home=' + JSON.stringify(gone.homeKeys) + ' fab=' + JSON.stringify(gone.fabKeys));
  ck(gone.labels.indexOf('Diaper') < 0, 'and the tile is gone', JSON.stringify(gone.labels));

  console.log('\n4. choosing nothing');
  const none = await p.evaluate((probe) => {
    const st = quickStage(); const pr = quickPrefs(); pr.pick[st] = []; saveQuickPrefs(pr);
    closeSheet(); render(); return eval(probe);
  }, PROBE);
  ck(none.homeKeys.length === 0, 'the choice is honoured, not overruled by the defaults');
  ck(none.labels.length === 1 && /choose/i.test(none.labels[0]),
    'and home offers a door rather than a heading over nothing', JSON.stringify(none.labels));

  console.log('\n5. whose choice it is');
  const whose = await p.evaluate((probe) => {
    const st = quickStage(); const pr = quickPrefs(); pr.pick[st] = ['feed', 'sleep']; saveQuickPrefs(pr);
    render(); return eval(probe);
  }, PROBE);
  ck(!!whose.stored, 'stored per person, keyed by uid', String(whose.stored));
  ck(!whose.inShared, 'and NOT in the shared household blob, so it cannot retile anybody else');
  const other = await p.evaluate((probe) => {
    // A second caregiver on the same device: a different uid means a different list.
    localStorage.setItem('cubby-quick-uid', 'other-person');
    render(); return eval(probe);
  }, PROBE);
  ck(other.homeKeys.length !== 2, 'a different person gets their own list, not this one', JSON.stringify(other.homeKeys));

  console.log('\n6. clean console');
  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));

  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
