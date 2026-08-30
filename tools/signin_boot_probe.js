/* Does a brand-new parent who signs in with a CODE actually land in her Cubby?
 *
 *   node tools/signin_boot_probe.js [baseUrl] [runs]     default https://little-cubby.com, 3 runs
 *
 * WHY THIS EXISTS. On 2026-08-31 a new parent could complete the email-code sign-in, hold a valid
 * session, and be left on the marketing landing with the sign-in overlay still up. A reload fixed it.
 * Signed in, and still looking at the page that will not let you in — the exact shape of the P0 the
 * code path was built to fix.
 *
 * It was investigated twice and both investigations produced garbage, for the same reason: two agent
 * sessions were driving ONE shared in-app browser profile against production. Each was signing the
 * other out mid-run and reading the other's session. A "reproduction" turned out to be the two pages
 * fighting; a strand rate of 2-in-4 turned out to be unusable.
 *
 * So this owns its own browser. Puppeteer launches a private profile per run, which cannot be reached
 * by anything else on the machine, and every run asserts WHO it is before and after signing in. An
 * unexpected identity is a collision, not a bug, and it aborts the run rather than reporting it.
 *
 * NO MAIL IS SENT. It mints the custom token itself, exactly as worker.js verifySigninCode does after
 * a correct code, so it exercises the real post-verify boot path without touching Resend, the code
 * store, or the per-address cooldown. Needs tools/serviceAccountKey.json (gitignored).
 *
 * IT CLEANS UP. Every account, users doc and household it creates is deleted at the end, and it says
 * what it removed. Reserved TLD addresses, so no real mailbox can ever be involved.
 *
 * DELIBERATELY NOT IN tools/gates.js: it writes to production and needs a private key, the same
 * reasons signin_live_check.js is kept out. Its home is the post-deploy list in OPERATIONS.md.
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));

const BASE = (process.argv[2] || 'https://little-cubby.com').replace(/\/$/, '');
const RUNS = Number(process.argv[3] || 3);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SA = require(path.join(__dirname, 'serviceAccountKey.json'));
const API_KEY = 'AIzaSyBj10mZkKlaX4BvYprssPdnUKsIXUCVvZU';
const b64u = (b) => Buffer.from(b).toString('base64url');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64u(JSON.stringify({ iss: SA.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + c), SA.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + h + '.' + c + '.' + b64u(sig) });
  return (await r.json()).access_token;
}
// Byte-for-byte the shape worker.js mints: a uid and nothing else.
function customToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64u(JSON.stringify({ iss: SA.client_email, sub: SA.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 300, uid }));
  return h + '.' + c + '.' + b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + c), SA.private_key));
}

(async () => {
  const tok = await accessToken();
  const IDP = 'https://identitytoolkit.googleapis.com/v1/projects/' + SA.project_id;
  const FS = 'https://firestore.googleapis.com/v1/projects/' + SA.project_id + '/databases/(default)/documents';
  const H = { authorization: 'Bearer ' + tok, 'content-type': 'application/json' };
  const made = [];                                   // everything to remove afterwards
  const results = [];

  console.log('\nsign-in boot probe — ' + BASE + ', ' + RUNS + ' run(s)');
  console.log('own browser profile per run, no mail, cleans up after itself\n');

  for (let n = 1; n <= RUNS; n++) {
    const email = 'bootprobe-' + Date.now() + '-' + n + '@example.test';
    const cr = await fetch(IDP + '/accounts', { method: 'POST', headers: H, body: JSON.stringify({ email, emailVerified: true }) });
    const uid = (await cr.json()).localId;
    if (!uid) { console.log('run ' + n + ': could not create the probe account'); continue; }
    made.push({ uid, email });

    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(String(m.text()).slice(0, 220)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 220)));

    const row = { n, email, uid };
    try {
      await page.goto(BASE + '/app/', { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForFunction('!!(window.firebase && firebase.auth)', { timeout: 30000 });

      /* PRECONDITION. A clean page, and nobody else's session. Both investigations that produced
         garbage would have been stopped right here. */
      const pre = await page.evaluate(() => ({
        signedIn: !!(firebase.auth().currentUser),
        who: firebase.auth().currentUser ? firebase.auth().currentUser.email : null,
        card: !!document.querySelector('.ll-email-row, .ll-cta, #llGoogleBtn'),
      }));
      if (pre.signedIn) { row.verdict = 'ABORTED — page already signed in as ' + pre.who + ' (collision, not a result)'; results.push(row); await browser.close(); continue; }
      if (!pre.card) { row.verdict = 'ABORTED — no sign-in card on a signed-out page'; results.push(row); await browser.close(); continue; }

      // The real post-verify step: exactly what showCodeBox does with the worker's token.
      const t0 = Date.now();
      await page.evaluate((t) => firebase.auth().signInWithCustomToken(t), customToken(uid));

      /* WATCH THE WHOLE ARC, then classify. Two earlier versions of this loop reported a false
         strand, each by stopping at a moment that looked final and was not:
           - "the timeline painted" -> a brand-new parent lands on the first-run wizard, no timeline
           - "the sign-in gate is gone" -> that happens the instant showStatus('Setting things up…')
             replaces the card, seconds before resolveHousehold has finished
         So sample every second for the full window and decide at the end. The states that matter are
         SETTLED (she is in), BACK AT THE DOOR (the throw path), and STILL SETTING UP (a hang). */
      const frames = [];
      for (let i = 0; i < 40; i++) {
        await wait(1000);
        const f = await page.evaluate(() => {
          const gate = !!document.querySelector('#llGoogleBtn, .ll-email-row');
          const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
          const sc = document.getElementById('scroll');
          return { gate, settingUp: /Setting things up/.test(txt),
            kids: sc ? sc.children.length : 0,
            firstRun: /Where are you|expecting|Add your baby|trying/i.test(txt.slice(0, 400)),
            msg: (document.querySelector('.ll-auth-msg') || {}).textContent || null };
        });
        frames.push(f);
        if ((f.kids > 0 || f.firstRun) && !f.settingUp) break;      // settled, she is in
        if (f.gate && i > 2) break;                                 // back at the door
      }
      const last = frames[frames.length - 1] || {};
      const painted = (last.kids > 0 || last.firstRun) && !last.settingUp;
      row.ms = Date.now() - t0;
      row.arc = frames.length + 's: ' + (last.gate ? 'BACK AT THE DOOR' : last.settingUp ? 'STILL SETTING UP' : 'settled');
      row.cardMsg = last.msg;
      const post = await page.evaluate(async () => {
        const u = firebase.auth().currentUser;
        if (!u) return { signedIn: false };
        let hid = null;
        try { const s = await firebase.firestore().collection('users').doc(u.uid).get(); hid = s.exists ? (s.data().householdId || null) : null; } catch (e) {}
        return { signedIn: true, uid: u.uid, email: u.email, householdId: hid,
          authMsg: (document.querySelector('.ll-auth-msg') || {}).textContent || null };
      });

      // IDENTITY. Anything other than the account this run created is contamination.
      if (post.signedIn && post.uid !== uid) { row.verdict = 'ABORTED — signed in as ' + post.email + ', not mine (collision)'; results.push(row); await browser.close(); continue; }

      row.householdId = post.householdId || null;
      row.authMsg = post.authMsg;
      row.errors = errs.slice(0, 4);
      row.verdict = painted && post.householdId ? 'BOOTED'
        : !post.signedIn ? 'NOT SIGNED IN'
        : last.gate ? 'STRANDED — signed in, handed back to the door'
        : last.settingUp ? 'HUNG — signed in, stuck on "Setting things up"'
        : 'UNCLEAR — signed in, no household, no gate';
      if (row.householdId) made.push({ household: row.householdId });
    } catch (e) {
      row.verdict = 'ERROR — ' + String(e.message).slice(0, 120);
    }
    results.push(row);
    await browser.close();
    console.log('run ' + n + ': ' + row.verdict + (row.ms ? '  (' + row.ms + 'ms)' : '') + (row.householdId ? '  household ' + row.householdId : ''));
    if (row.arc) console.log('        arc: ' + row.arc + (row.cardMsg ? '  card says: "' + row.cardMsg + '"' : ''));
    if (row.errors && row.errors.length) row.errors.forEach((e) => console.log('        console: ' + e));
  }

  console.log('\ncleaning up');
  for (const m of made) {
    if (m.household) { const r = await fetch(FS + '/households/' + m.household, { method: 'DELETE', headers: H }); console.log('  household ' + m.household + ' -> ' + r.status); }
    else {
      await fetch(FS + '/users/' + m.uid, { method: 'DELETE', headers: H }).catch(() => {});
      await fetch(IDP + '/accounts:delete', { method: 'POST', headers: H, body: JSON.stringify({ localId: m.uid }) }).catch(() => {});
      console.log('  account ' + m.email + ' + users doc removed');
    }
  }
  const left = ((await (await fetch(IDP + '/accounts:query', { method: 'POST', headers: H, body: JSON.stringify({}) })).json()).userInfo || []).filter((u) => /^bootprobe-/.test(u.email || ''));
  console.log('  probe accounts remaining: ' + left.length);

  const counted = results.filter((r) => /BOOTED|STRANDED/.test(r.verdict || ''));
  const stranded = counted.filter((r) => r.verdict.indexOf('STRANDED') === 0);
  const aborted = results.filter((r) => (r.verdict || '').indexOf('ABORTED') === 0).length;
  console.log('\n' + counted.length + ' usable run(s), ' + stranded.length + ' stranded' + (aborted ? ', ' + aborted + ' aborted on a dirty page' : ''));
  console.log(stranded.length ? 'BOOT-PROBE: FAIL' : (counted.length ? 'BOOT-PROBE: PASS' : 'BOOT-PROBE: NO USABLE RUNS'));
  process.exit(stranded.length || !counted.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
