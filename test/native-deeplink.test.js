/* The native iOS/Android wrapper keeps an invite link's join value, token links included.
 *
 * WHY. The wrapper loads a FIXED url (capacitor.config.json server.url), so a universal link's query
 * never reaches location.search. app/native-bridge.js reads it from getLaunchUrl / appUrlOpen and
 * hands it to the web app through sessionStorage 'cubby-join', which resolveHousehold reads. It used
 * to keep only ?join=1, so a single-use token link (?join=<22 chars>) opened in the installed native
 * app was dropped: the invitee silently became the owner of an empty Cubby and the owner's link sat
 * unclaimed (final review DW-2, 2026-11-12). The web page has always kept any join value.
 *
 * This runs the real app/native-bridge.js in a vm with a stubbed Capacitor, the way the wrapper
 * calls it, and reads back what it stored.
 *
 *   node test/native-deeplink.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'app', 'native-bridge.js'), 'utf8');
const TOKEN = 'Ab3dEf6hIj9kLm2nOp5qRs';   // the shape newInviteToken() mints: 22 base62 characters

/* Boot the bridge as the native app would, with a launch url and/or a later appUrlOpen. */
async function run(launchUrl, openUrl) {
  const store = new Map();
  const listeners = {};
  const replaced = [];
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {
        App: {
          addListener: (name, cb) => { listeners[name] = cb; return { remove() {} }; },
          getLaunchUrl: () => Promise.resolve(launchUrl ? { url: launchUrl } : {}),
        },
      },
    },
  };
  const ctx = {
    window: win,
    document: {
      readyState: 'complete',
      documentElement: { setAttribute() {}, getAttribute: () => 'day' },
      addEventListener() {},
      getElementById: () => null,
    },
    sessionStorage: { setItem: (k, v) => store.set(k, String(v)), getItem: (k) => (store.has(k) ? store.get(k) : null), removeItem: (k) => store.delete(k) },
    localStorage: { setItem() {}, getItem: () => null, removeItem() {} },
    location: { href: 'https://little-cubby.com/app/', origin: 'https://little-cubby.com', replace: (u) => replaced.push(u) },
    navigator: { userAgent: 'iPhone' },
    URL, setTimeout, clearTimeout, console, Promise,
  };
  win.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'native-bridge.js' });
  await new Promise((r) => setTimeout(r, 20));          // getLaunchUrl resolves on a microtask
  if (openUrl && listeners.appUrlOpen) listeners.appUrlOpen({ url: openUrl });
  return { join: store.has('cubby-join') ? store.get('cubby-join') : null, listening: !!listeners.appUrlOpen, replaced };
}

(async () => {
  console.log('\nthe native wrapper keeps an invite link\'s join value\n');
  const one = await run('https://little-cubby.com/app/?join=1');
  ok('the bridge listens for links opened while it runs', one.listening, one);
  ok('an intent-only link (?join=1) is kept, as it always was', one.join === '1', one);
  const cold = await run('https://little-cubby.com/app/?join=' + TOKEN);
  ok('a token link that cold-launches the app keeps its token', cold.join === TOKEN, cold);
  const warm = await run(null, 'https://little-cubby.com/app/?join=' + TOKEN);
  ok('a token link opened while the app is running keeps its token', warm.join === TOKEN, warm);
  const junk = await run('https://little-cubby.com/app/?join=' + encodeURIComponent('../users/x'));
  ok('a value that is not token-shaped is not stored (it lands in a document path)', junk.join === null, junk);
  const short = await run('https://little-cubby.com/app/?join=abc');
  ok('nor is a value too short to be a token', short.join === null, short);
  const none = await run('https://little-cubby.com/app/?go=log');
  ok('a link with no join stores nothing', none.join === null, none);
  const signin = await run('https://little-cubby.com/app/?mode=signIn&oobCode=X');
  ok('an email sign-in link is handed to the web app, not parsed for join', signin.replaced.length === 1 && signin.join === null, signin);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'NATIVE-DEEPLINK: FAIL' : 'NATIVE-DEEPLINK: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
