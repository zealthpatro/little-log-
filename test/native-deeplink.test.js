/* The native iOS/Android wrapper routes each link once, and keeps an invite link's join value.
 *
 * WHY (join). The wrapper loads a FIXED url (capacitor.config.json server.url), so a universal link's
 * query never reaches location.search. app/native-bridge.js reads it from getLaunchUrl / appUrlOpen and
 * hands it to the web app through sessionStorage 'cubby-join', which resolveHousehold reads. It used
 * to keep only ?join=1, so a single-use token link (?join=<22 chars>) opened in the installed native
 * app was dropped: the invitee silently became the owner of an empty Cubby and the owner's link sat
 * unclaimed (final review DW-2, 2026-11-12). The web page has always kept any join value.
 *
 * WHY (once). Capacitor's getLaunchUrl is not "the link that launched the app". It answers with
 * ApplicationDelegateProxy.lastURL (@capacitor/ios 8.4.2), which every open sets and nothing clears
 * while the app process lives, and the bridge asked it on EVERY page load. A sign-in link answers
 * with location.replace, a page load, which asked again: on the founder's simulator (16 Nov 2026) a
 * tapped sign-in link reloaded the app five times in a minute with the bare "Confirm your email" box
 * each time, and she was never signed in. Every other link (join, go, stage, read, tab) was routed
 * again on every later page load of that process. So the device is modelled the way iOS keeps it:
 * a PROCESS holds lastURL and the webview's sessionStorage; the DEVICE holds localStorage; each page
 * load boots the bridge afresh inside a process.
 *
 * This runs the real app/native-bridge.js in a vm with a stubbed Capacitor, the way the wrapper
 * calls it, and reads back what it did.
 *
 *   node test/native-deeplink.test.js              judge app/native-bridge.js
 *   node test/native-deeplink.test.js --self-test  first prove each check can go red: run the suite on
 *                                                  mutated copies of the bridge, each mutant must turn
 *                                                  its named checks red, then judge the real file
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REAL = fs.readFileSync(path.join(__dirname, '..', 'app', 'native-bridge.js'), 'utf8');
const TOKEN = 'Ab3dEf6hIj9kLm2nOp5qRs';   // the shape newInviteToken() mints: 22 base62 characters
const OOB = 'oob-Code_123-abcDEF';
const SIGNIN = 'https://little-cubby.com/__/auth/action?apiKey=AIzaFAKE&mode=signIn&oobCode=' + OOB + '&continueUrl=https%3A%2F%2Flittle-cubby.com%2Fapp%2F&lang=en';
const SIGNIN_AT = '/app/?apiKey=AIzaFAKE&mode=signIn&oobCode=' + OOB + '&continueUrl=https%3A%2F%2Flittle-cubby.com%2Fapp%2F&lang=en';
const APP = 'https://little-cubby.com/app/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mapStore(m, refuse) {
  return {
    setItem: (k, v) => { if (refuse) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    getItem: (k) => { if (refuse) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    removeItem: (k) => { m.delete(k); },
  };
}
/* The phone: localStorage outlives every process. */
const device = () => ({ local: new Map() });
/* One app process: Capacitor's lastURL and the webview's sessionStorage live exactly as long as it.
   refuse: a webview whose storage throws, the way private modes and full disks do. */
const proc = (dev, lastUrl, refuse) => ({ dev, lastUrl: lastUrl || null, session: new Map(), refuse: !!refuse, clock: 1.8e12 });

/* One page load inside a process, booting the bridge at `href` as the wrapper does.
   opts.retained: an appUrlOpen Capacitor held for the first listener (a cold launch can deliver the
   same link that way AND through getLaunchUrl); opts.launchFirst delivers it after getLaunchUrl.
   opts.signedIn: a session already restored on this page. */
async function load(SRC, p, href, opts) {
  opts = opts || {};
  const listeners = {};
  const out = { replaced: [], dlRuns: 0, tracked: 0 };
  const u = new URL(href, APP);
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {
        App: {
          addListener: (name, cb) => {
            listeners[name] = cb;
            if (name === 'appUrlOpen' && opts.retained) {
              const url = opts.retained; opts.retained = null;
              if (opts.launchFirst) setTimeout(() => cb({ url }), 5); else Promise.resolve().then(() => cb({ url }));
            }
            return { remove() {} };
          },
          getLaunchUrl: () => Promise.resolve(p.lastUrl ? { url: p.lastUrl } : {}),
        },
      },
    },
    cubbyTrackLinkOpened: () => { out.tracked++; },
    LL: opts.signedIn ? { auth: { currentUser: { uid: 'U1' } } } : { auth: { currentUser: null } },
  };
  const ctx = {
    window: win,
    document: {
      readyState: 'complete',
      documentElement: { setAttribute() {}, getAttribute: () => 'day' },
      addEventListener() {},
      getElementById: () => null,
    },
    sessionStorage: mapStore(p.session, p.refuse),
    localStorage: mapStore(p.dev.local, false),
    location: { href: u.href, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, replace: (x) => out.replaced.push(x) },
    navigator: { userAgent: 'iPhone' },
    maybeRunDeepLink: () => { out.dlRuns++; },
    URL, URLSearchParams, setTimeout, clearTimeout, console, Promise, Math,
    Date: { now: () => p.clock },   // the process's clock, so a test can let time pass without waiting
  };
  win.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'native-bridge.js' });
  await sleep(30);          // getLaunchUrl resolves on a microtask, a retained event within 5 ms
  out.listening = !!listeners.appUrlOpen;
  /* A tap on a link while this page is up: iOS sets lastURL first, then Capacitor fires appUrlOpen. */
  out.tap = async (url) => { p.lastUrl = url; if (listeners.appUrlOpen) listeners.appUrlOpen({ url }); await sleep(10); };
  out.session = p.session;
  return out;
}

async function suite(SRC) {
  const R = {};
  const ok = (id, n, c, x) => { R[id] = { n, c: !!c, x }; };

  /* ---- what it always did: the join value ---- */
  const run = async (launchUrl, openUrl) => {
    const p = proc(device(), launchUrl);
    const pg = await load(SRC, p, APP);
    if (openUrl) await pg.tap(openUrl);
    return { join: p.session.has('cubby-join') ? p.session.get('cubby-join') : null, listening: pg.listening, replaced: pg.replaced };
  };
  const one = await run('https://little-cubby.com/app/?join=1');
  ok('J.listen', 'the bridge listens for links opened while it runs', one.listening, one);
  ok('J.intent', 'an intent-only link (?join=1) is kept, as it always was', one.join === '1', one);
  const cold = await run('https://little-cubby.com/app/?join=' + TOKEN);
  ok('J.cold', 'a token link that cold-launches the app keeps its token', cold.join === TOKEN, cold);
  const warm = await run(null, 'https://little-cubby.com/app/?join=' + TOKEN);
  ok('J.warm', 'a token link opened while the app is running keeps its token', warm.join === TOKEN, warm);
  const junk = await run('https://little-cubby.com/app/?join=' + encodeURIComponent('../users/x'));
  ok('J.junk', 'a value that is not token-shaped is not stored (it lands in a document path)', junk.join === null, junk);
  const short = await run('https://little-cubby.com/app/?join=abc');
  ok('J.short', 'nor is a value too short to be a token', short.join === null, short);
  const none = await run('https://little-cubby.com/app/?go=log');
  ok('J.none', 'a link with no join stores nothing', none.join === null, none);
  const signin = await run(SIGNIN);
  ok('J.signin', 'an email sign-in link is handed to the web app, not parsed for join', signin.replaced.length === 1 && signin.join === null, signin);

  /* ---- the founder's case: a sign-in link tapped while the app sits on its sign-in screen ---- */
  {
    const p = proc(device(), null);
    const screen = await load(SRC, p, APP);
    await screen.tap(SIGNIN);
    ok('L.tap', 'the tapped sign-in link is loaded into the app once, for the web app to finish',
      screen.replaced.length === 1 && screen.replaced[0] === SIGNIN_AT, screen.replaced);
    // The page that load produced asks getLaunchUrl too, and is answered with the same link.
    const finishing = await load(SRC, p, SIGNIN_AT);
    ok('L.noloop', 'the page finishing that link is not loaded again (it was, on every load: the loop)', finishing.replaced.length === 0, finishing.replaced);
    // Signed in, the address is stripped (maybeFinishEmailLink). Any later load in this process: a
    // join's reload, Try again, signing out.
    const later = await load(SRC, p, APP, { signedIn: true });
    const later2 = await load(SRC, p, APP);
    ok('L.later', 'no later page load of the same process runs the spent link again', later.replaced.length === 0 && later2.replaced.length === 0, [later.replaced, later2.replaced]);
    ok('L.tracked', 'and the link counts as one link-opened visit, not one per page load',
      screen.tracked + finishing.tracked + later.tracked + later2.tracked === 1, [screen.tracked, finishing.tracked, later.tracked, later2.tracked]);
    const kept = Array.from(p.session.values()).concat(Array.from(p.dev.local.values())).join(' ');
    ok('L.nocode', 'the link\'s one-time code is never written to storage to remember it', kept.indexOf(OOB) === -1 && kept.indexOf('oobCode') === -1, kept);
    // She taps the same link again, already signed in by it: a spent code can only ask for her email and fail.
    await later.tap(SIGNIN);
    ok('L.spent', 'tapping the same link again once it has signed her in loads nothing', later.replaced.length === 0, later.replaced);
    ok('L.spentVisit', 'though that tap still brought the app forward by a link, and counts as one', later.tracked === 1, later.tracked);
  }
  {
    // She dismissed the "Confirm your email" box, so she is still signed out, and taps the link again.
    const p = proc(device(), null);
    const screen = await load(SRC, p, APP);
    await screen.tap(SIGNIN);
    const back = await load(SRC, p, SIGNIN_AT);
    await back.tap(SIGNIN);
    ok('L.retry', 'tapping it again while still signed out gives her another go', back.replaced.length === 1 && back.replaced[0] === SIGNIN_AT, back.replaced);
  }

  /* ---- a cold launch: the link arrives through getLaunchUrl alone ---- */
  {
    const dev = device();
    const p = proc(dev, SIGNIN);
    const first = await load(SRC, p, APP);
    ok('C.cold', 'a sign-in link that cold-launches the app is loaded, once', first.replaced.length === 1 && first.replaced[0] === SIGNIN_AT, first.replaced);
    const next = await load(SRC, p, SIGNIN_AT);
    ok('C.next', 'and the page it loads does not load it again', next.replaced.length === 0, next.replaced);
    // Killed and relaunched by the same link: a new process, so it is a new open.
    const p2 = proc(dev, SIGNIN);
    const again = await load(SRC, p2, APP);
    ok('C.newproc', 'a new app process launched by a link routes it, whatever the last process did', again.replaced.length === 1, again.replaced);
  }
  for (const launchFirst of [false, true]) {
    // Capacitor can ALSO hold the cold-launch link as an appUrlOpen for the first listener.
    const p = proc(device(), SIGNIN);
    const pg = await load(SRC, p, APP, { retained: SIGNIN, launchFirst });
    ok(launchFirst ? 'C.both2' : 'C.both1', 'a cold-launch link delivered by both getLaunchUrl and appUrlOpen' + (launchFirst ? ' (getLaunchUrl first)' : '') + ' is loaded once, and counts one link visit',
      pg.replaced.length === 1 && pg.tracked === 1, { replaced: pg.replaced, tracked: pg.tracked });
  }
  {
    // A deep link that cold-launched the app, tapped again later on that same page: a new open.
    const p = proc(device(), 'https://little-cubby.com/app/?go=log');
    const pg = await load(SRC, p, APP);
    p.clock += 60 * 1000;
    await pg.tap('https://little-cubby.com/app/?go=log');
    ok('C.retapLater', 'the link that cold-launched the app, tapped again a minute later, opens again', pg.dlRuns === 2, pg.dlRuns);
  }
  {
    // Storage that throws: nothing can be remembered, and the page that IS the link still must not reload itself.
    const p = proc(device(), null, true);
    const screen = await load(SRC, p, APP);
    await screen.tap(SIGNIN);
    const finishing = await load(SRC, p, SIGNIN_AT);
    ok('C.refused', 'with storage refused, the page already holding the link is still not loaded onto itself',
      screen.replaced.length === 1 && finishing.replaced.length === 0, [screen.replaced, finishing.replaced]);
  }

  /* ---- every other deep link: routed once per open, not once per page load ---- */
  {
    const p = proc(device(), 'https://little-cubby.com/app/?join=1');
    const first = await load(SRC, p, APP);
    ok('D.join1', 'a join link from getLaunchUrl is kept on the first load', p.session.get('cubby-join') === '1', Array.from(p.session));
    p.session.delete('cubby-join');                 // resolveHousehold used it (she joined) and let it go
    await load(SRC, p, APP);                        // the join's own reload
    ok('D.join2', 'and is not planted again on the next page load of the same process', !p.session.has('cubby-join'), Array.from(p.session));
    void first;
  }
  {
    const p = proc(device(), 'https://little-cubby.com/app/?go=log');
    const first = await load(SRC, p, APP);
    const second = await load(SRC, p, APP);
    ok('D.go', 'a ?go= link from getLaunchUrl opens its screen once, not on every later page load', first.dlRuns === 1 && second.dlRuns === 0, [first.dlRuns, second.dlRuns]);
    // She taps the same link again later: that is a new open, and it must still work.
    await second.tap('https://little-cubby.com/app/?go=log');
    ok('D.retap', 'tapping the same deep link again in that process still opens it', second.dlRuns === 1, second.dlRuns);
    // A different link tapped warm, then the page reloads: only the open counted, not the reload.
    await second.tap('https://little-cubby.com/app/?go=feed');
    const third = await load(SRC, p, APP);
    ok('D.warm', 'a deep link tapped while running opens once, and a reload after it opens nothing', second.dlRuns === 2 && third.dlRuns === 0, [second.dlRuns, third.dlRuns]);
  }
  return R;
}

function report(R, quiet) {
  let pass = 0, fail = 0;
  for (const id of Object.keys(R)) {
    const r = R[id];
    if (r.c) pass++; else fail++;
    if (!quiet) console.log((r.c ? '  ok   ' : '  FAIL ') + id + ' ' + r.n + (r.c || r.x === undefined ? '' : '  ' + JSON.stringify(r.x)));
  }
  return { pass, fail };
}

/* Each mutant re-breaks one thing the bridge does on purpose; the named checks must go red on it. */
const MUTANTS = [
  { id: 'launch-every-load', want: ['L.noloop', 'L.later', 'C.next', 'D.join2', 'D.go'],
    note: 'the 9f66ef19 bug: getLaunchUrl routed on every page load',
    edits: [['if (fromLaunch && seen === mark) return;', ''],
      ["if (fromLaunch && code && code === new URLSearchParams(location.search).get('oobCode')) return;", '']] },
  { id: 'no-session-mark', want: ['L.later', 'D.join2', 'D.go'],
    note: 'the page-holds-this-link check alone: every later load still runs the spent link and the deep links',
    edits: [['if (fromLaunch && seen === mark) return;', '']] },
  { id: 'no-self-check', want: ['C.refused'],
    note: 'without the page-holds-this-link check, refused storage loops again',
    edits: [["if (fromLaunch && code && code === new URLSearchParams(location.search).get('oobCode')) return;", '']] },
  { id: 'no-cold-dedupe', want: ['C.both2'],
    note: 'a cold launch that delivers both ways loads the link twice',
    edits: [['if (!fromLaunch && bootRouted === mark && Date.now() - bootAt < 3000) { bootRouted = null; return; }', '']] },
  { id: 'cold-dedupe-forever', want: ['C.retapLater'],
    note: 'the cold-launch dedupe with no time limit swallows her next real tap of that link',
    edits: [[' && Date.now() - bootAt < 3000', '']] },
  { id: 'taps-deduped', want: ['D.retap', 'L.retry'],
    note: 'a real tap treated like the stale launch url: a second tap of a link does nothing',
    edits: [['if (fromLaunch && seen === mark) return;', 'if (seen === mark) return;']] },
  { id: 'process-outlives', want: ['C.newproc'],
    note: 'remembering in localStorage outlives lastURL: a relaunch by the same link does nothing',
    edits: [[/sessionStorage\.(getItem|setItem)\(ROUTED/g, 'localStorage.$1(ROUTED']] },
  { id: 'no-spent-check', want: ['L.spent'],
    note: 'a re-tap of the link that signed her in loads the spent code',
    edits: [['if (!fromLaunch && signin && seen === mark && signedIn()) return;', '']] },
  { id: 'spent-tap-uncounted', want: ['L.spentVisit'],
    note: 'the spent-link check ahead of the link-opened count: a tap that brought the app forward goes unrecorded',
    edits: [["      try { if (window.cubbyTrackLinkOpened) window.cubbyTrackLinkOpened(); } catch (e) {}\n      if (!fromLaunch && signin && seen === mark && signedIn()) return;",
      "      if (!fromLaunch && signin && seen === mark && signedIn()) return;\n      try { if (window.cubbyTrackLinkOpened) window.cubbyTrackLinkOpened(); } catch (e) {}"]] },
  { id: 'plain-mark', want: ['L.nocode'],
    note: 'the remembered link kept in plain text, one-time code and all',
    edits: [['var mark = linkMark(rawUrl)', 'var mark = String(rawUrl)']] },
  { id: 'track-every-load', want: ['L.tracked'],
    note: 'link-opened counted before the dedupe, so once per page load',
    edits: [['      var mark = linkMark(rawUrl)', "      try { if (window.cubbyTrackLinkOpened) window.cubbyTrackLinkOpened(); } catch (e) {}\n      var mark = linkMark(rawUrl)"]] },
];

function mutate(src, edits) {
  let out = src;
  for (const [from, to] of edits) {
    const before = out;
    out = typeof from === 'string' ? out.split(from).join(to) : out.replace(from, to);
    if (out === before) return null;          // an edit that no longer applies is itself a failure
  }
  return out;
}

(async () => {
  let bad = 0;
  if (process.argv.includes('--self-test')) {
    console.log('\nself-test: every mutant must turn its named checks red\n');
    for (const m of MUTANTS) {
      const src = mutate(REAL, m.edits);
      if (!src) { bad++; console.log('  FAIL ' + m.id + ': its edit no longer applies to app/native-bridge.js'); continue; }
      const R = await suite(src);
      const missed = m.want.filter((id) => !R[id] || R[id].c);
      if (missed.length) { bad++; console.log('  FAIL ' + m.id + ' (' + m.note + ') left green: ' + missed.join(', ')); }
      else console.log('  ok   ' + m.id + ' (' + m.note + ') turns red: ' + m.want.join(', '));
    }
  }
  console.log('\nthe native wrapper routes each link once and keeps an invite link\'s join value\n');
  const { pass, fail } = report(await suite(REAL));
  console.log('\n' + pass + ' passed, ' + fail + ' failed' + (bad ? ', ' + bad + ' mutant(s) not caught' : ''));
  const red = fail || bad;
  console.log(red ? 'NATIVE-DEEPLINK: FAIL' : 'NATIVE-DEEPLINK: PASS');
  process.exit(red ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
