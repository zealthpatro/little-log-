/* The client half of the funnel, in a real browser: do the counters fire at the right moments, does the
 * wizard still work with them in it, and does nothing leave the device except from production?
 *
 *   node tools/funnel_steps_check.js http://localhost:9743
 *
 * The strongest line here is section 4. Every payload the client produced is run through the SERVER's
 * own allowlist (workers/funnel/core.mjs stepKey). A client value the Worker would refuse is a count
 * silently lost in production with no error anywhere, so client and server drifting apart is caught
 * here, not in a month of empty numbers.
 */
const path = require('path');
const puppeteer = require(__dirname + '/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:9743';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 300) : '')); } };

(async () => {
  const core = await import('file://' + path.join(__dirname, '..', 'workers', 'funnel', 'core.mjs'));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  console.log('\nfunnel steps: fired at the real moments, anonymous, production only\n');

  /* A page with the test hook: cubbyStep records into window.__cubbyStepTest instead of fetching. */
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const stepRequests = []; page.on('request', (r) => { if (r.url().indexOf('/api/step') >= 0) stepRequests.push(r.url()); });
  await page.evaluateOnNewDocument(() => { window.__cubbyStepTest = []; });
  await page.goto(BASE + '/app/?e2e=onboard', { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(800);
  const steps = () => page.evaluate(() => window.__cubbyStepTest.slice());
  const last = async () => { const s = await steps(); return s[s.length - 1]; };

  console.log('1. the setup wizard');
  const hasPicker = await page.evaluate(() => document.querySelectorAll('.prof-card').length);
  ok('the first-run stage picker rendered', hasPicker === 3, hasPicker);
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.prof-card')).find((x) => /obStage\('baby'\)/.test(x.getAttribute('onclick') || '')); c.click(); });
  await sleep(500);
  let s = await last();
  ok('choosing a stage counts stage_chosen, for the stage chosen',
     s && s.event === 'onboarding.step_reached' && s.props.step === 'stage_chosen' && s.props.stage === 'baby', s);

  await page.evaluate(() => {
    document.querySelector('#bName').value = 'Robin';
    document.querySelector('#bDate').value = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
    saveBaby();
  });
  await sleep(800);
  const all1 = await steps();
  ok('saving the baby counts details_entered', all1.some((x) => x.props && x.props.step === 'details_entered' && x.props.stage === 'baby'), all1);
  const babies = await page.evaluate(() => (state.babies || []).length);
  ok('and the wizard still did its job: the baby exists', babies === 1, babies);

  /* collectIdentity sits between the details and the invite offer for a brand-new owner; completing it
     calls openOnboardInvite, so the offer is exercised directly here and the handoff stays the app's. */
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} openOnboardInvite(); });
  await sleep(500);
  s = await last();
  ok('the invite offer counts invite_offered', s && s.props && s.props.step === 'invite_offered' && s.props.stage === 'baby', s);
  const offerLinks = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map((b) => b.getAttribute('onclick') || '').filter((x) => /openFamily\('invite'/.test(x)));
  ok('the offer sheet opens the invite FORM with entry point onboarding', offerLinks.length > 0 && offerLinks.every((x) => /'onboarding'/.test(x)), offerLinks);
  const n1 = (await steps()).length;
  ok('opening the offer counted the offer only, not an invite form as well',
     (await steps()).filter((x) => x.event === 'invite.sheet_opened').length === 0, n1);

  console.log('\n2. the Pro sheet');
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} openPro(undefined, undefined, 'settings'); });
  await sleep(300);
  s = await last();
  ok('opening Pro from Settings counts pro.sheet_viewed with entry settings', s && s.event === 'pro.sheet_viewed' && s.props.entry_point === 'settings', s);
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} openPro('Growth charts'); });
  await sleep(300);
  s = await last();
  ok('a locked feature counts as feature_gate', s && s.props.entry_point === 'feature_gate', s);
  const beforeRe = (await steps()).length;
  await page.evaluate(() => openPro(undefined, undefined, 'rerender'));
  await sleep(300);
  ok('the sheet redrawing itself is NOT a second view', (await steps()).length === beforeRe, (await steps()).length - beforeRe);
  const bare = await page.evaluate(() => (document.documentElement.outerHTML.match(/openPro\(\)/g) || []).length);
  ok('no bare openPro() is left in the page to count re-renders as views', bare === 0, bare);

  console.log('\n3. the founder is not a customer');
  await page.evaluate(() => localStorage.setItem('cubby-internal', '1'));
  const beforeInt = (await steps()).length;
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} openPro(undefined, undefined, 'settings'); obStage('planning'); });
  await sleep(400);
  ok('a device marked internal sends nothing at all', (await steps()).length === beforeInt, (await steps()).length - beforeInt);
  await page.evaluate(() => localStorage.removeItem('cubby-internal'));

  console.log('\n4. every payload is one the SERVER accepts, and carries nothing else');
  const payloads = await steps();
  const refused = payloads.filter((p) => core.stepKey(p.event, p.props) === null);
  ok('every payload the client produced passes the Worker\'s own allowlist', refused.length === 0, refused);
  ok('each payload is exactly { event, props }', payloads.every((p) => Object.keys(p).sort().join(',') === 'event,props'), payloads[0]);
  const blob = JSON.stringify(payloads);
  ok('no payload carries the name typed into the wizard', blob.indexOf('Robin') < 0);
  ok('and none carries the signed-in uid', blob.indexOf('"local"') < 0 && !/uid|household|hid|email/.test(blob));
  /* Paired, so the lines above are about something: the run really produced a funnel. */
  ok('the run produced a real sequence of steps', payloads.length >= 5, payloads.length);
  ok('with the hook in place nothing went over the network', stepRequests.length === 0, stepRequests);
  ok('and the page threw nothing', errors.length === 0, errors);

  console.log('\n5. off the production host, nothing leaves the device');
  const plain = await browser.newPage();
  const leaks = []; plain.on('request', (r) => { if (r.url().indexOf('/api/step') >= 0) leaks.push(r.url()); });
  await plain.goto(BASE + '/app/?e2e=onboard', { waitUntil: 'networkidle2', timeout: 40000 });
  await sleep(600);
  await plain.evaluate(() => { obStage('baby'); try { closeSheet(); } catch (e) {} openPro(undefined, undefined, 'settings'); });
  await sleep(600);
  ok('on localhost, with no test hook, not one request reaches /api/step', leaks.length === 0, leaks);
  const guarded = await plain.evaluate(() => typeof cubbyStep === 'function' && /little-cubby\.com/.test(cubbyStep.toString()));
  ok('because cubbyStep is guarded to the production host', guarded);

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('FUNNEL-STEPS: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e); process.exit(1); });
