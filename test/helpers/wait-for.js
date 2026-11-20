/* Wait for what the next assertion needs, never for a length of time (Nov 2026).
 *
 * test/ios-signin-code.test.js read the sign-in card 3.5 s after page.goto(networkidle2), betting the app had
 * drawn it by then. On an iPhone user agent that is a bet on the internet. Firebase Auth 10.12.2 (compat)
 * initialises its popup/redirect resolver BEFORE it reports any auth state on a mobile, iOS or Safari user
 * agent (_shouldInitProactively): it loads https://apis.google.com/js/api.js with a plain script tag, runs
 * gapi.load('gapi.iframes'), opens the Auth emulator's helper iframe (which loads api.js and gapi.iframes
 * again) and pings it. The first onAuthStateChanged, so showSignIn, so the card, waits for all of it, and
 * networkidle2 does not, because it allows two connections still open. The pre-push run of 17 Nov 2026 read
 * null; holding that one script for 6 s reproduces the exact line every time. The test's other fixed sleeps
 * lose the same way to a slow Auth emulator, a slow stand-in endpoint, or a late 60 ms timer.
 *
 *   const w = await waitFor(() => page.evaluate(() => !!document.querySelector('.x')), { timeout: 30000 });
 *
 * check() may be sync or async. It is called every `every` ms until it returns something truthy or `timeout`
 * ms have passed. waitFor never throws: it resolves { ok, value, ms, error }, where value is what check() last
 * returned and error what it last threw (a page in the middle of a navigation throws, which means "not yet",
 * not a verdict). A check that hangs is abandoned when the time is up. The caller still makes its assertion
 * on what it reads afterwards, so a product that never gets there still fails, after the timeout, and
 * w.ok === false lets the failure say what never appeared.
 */
'use strict';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, opts) {
  const timeout = (opts && opts.timeout) || 30000, every = (opts && opts.every) || 50;
  const t0 = Date.now();
  let value, error = null;
  for (;;) {
    const left = timeout - (Date.now() - t0);
    let timer = null;
    try {
      value = await Promise.race([
        Promise.resolve().then(check),
        // At least 1 s per check, so the last one is answered rather than cut off; only a hung one is abandoned.
        new Promise((res, rej) => { timer = setTimeout(() => rej(new Error('check() was still running when the time was up')), Math.max(left, 1000)); }),
      ]);
      error = null;
    } catch (e) { value = undefined; error = String((e && e.message) || e).slice(0, 200); }
    clearTimeout(timer);
    if (value) return { ok: true, value, ms: Date.now() - t0, error: null };
    if (Date.now() - t0 >= timeout) return { ok: false, value, ms: Date.now() - t0, error };
    await sleep(Math.min(every, Math.max(0, timeout - (Date.now() - t0))));
  }
}

module.exports = { waitFor };
