// Gate for the ROOT service worker (/sw.js) that serves our offline page for the marketing site and
// the 660-odd articles.
//
// This is the highest-blast-radius file in the repo. A root-scoped worker sees every page on the
// origin, and a browser that has cached the wrong thing cannot be reached to be told otherwise. So the
// assertions here are mostly about what it must REFUSE to do:
//
//   - it must cache NO content. Not one article. Three entries, all of them the offline page and its
//     picture, or a stale copy of a 660-page site becomes unfixable.
//   - it must handle NAVIGATIONS ONLY, so a bug here can never serve a stale stylesheet or script.
//   - it must pass /app/ and /g/ straight through. Scope matching normally gives /app/* to app/sw.js,
//     but there is a window before the app has ever registered its own worker where this one controls
//     that navigation, and it must do nothing with it.
//   - its activate must delete only ITS OWN caches, by prefix. Caches are per-ORIGIN: the stub this
//     replaces deleted every cache it could enumerate, which from the root would wipe the app's
//     precache (little-log-v*) and leave an installed PWA unable to open offline.
//   - a real answer from the server, including a 404, is passed through. Only a failure to REACH the
//     server is ours to answer.
//
// Taking the worker offline needs CDP. page.setOfflineMode() emulates conditions on the PAGE's network
// session only, so a service worker's own fetch() sails straight past it and the test would silently
// prove nothing. This attaches to the service-worker target and takes that offline too.
//
//   node tools/serve.js &   &&   node tools/sitesw_gate.js [baseUrl]
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.argv[2] || 'http://localhost:8080';
const ROOT = path.join(__dirname, '..');
const ART = process.env.ART_SLUG || 'aap-safe-sleep-guidelines';

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '  ' + d : ''))); };

/* ONE session per target, reused for both toggles. Creating a fresh CDP session each time leaves the
   previous one attached with its own conflicting network override, and Chrome does not resolve that the
   way you would hope: the first session's `offline: true` kept winning, so "back online" silently
   stayed offline and two later checks failed for a reason that had nothing to do with the worker. */
const _cdp = new Map();
async function offlineEverywhere(browser, page, off) {
  const cond = { offline: off, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  await page.setOfflineMode(off);
  // ...and the service worker's own network session, which is a separate target: page.setOfflineMode
  // emulates conditions on the PAGE's session only, so a worker's fetch() sails straight past it.
  for (const t of browser.targets()) {
    if (t.type() !== 'service_worker' && t.type() !== 'shared_worker') continue;
    try {
      let s = _cdp.get(t);
      if (!s) { s = await t.createCDPSession(); await s.send('Network.enable'); _cdp.set(t, s); }
      await s.send('Network.emulateNetworkConditions', cond);
    } catch (e) { _cdp.delete(t); /* a target that went away mid-flight */ }
  }
}

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

  console.log('\n1. the file itself');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ck(/req\.mode\s*!==\s*'navigate'/.test(sw), 'navigations only');
  ck(/startsWith\('\/app\/'\)/.test(sw) && /startsWith\('\/g\/'\)/.test(sw), '/app/ and /g/ are bypassed');
  ck(/k\.startsWith\(PREFIX\)/.test(sw), 'activate deletes only its own caches, by prefix');
  ck(!/caches\.keys\(\)[\s\S]{0,120}keys\.map\(/.test(sw), 'and never maps over every cache on the origin');
  // The precache list, not the whole file: the comment at the top of sw.js names /articles/<slug>/
  // when it explains what problem this solves, which is not the same as precaching one.
  const assetsBlock = ((sw.match(/const ASSETS\s*=\s*\[([\s\S]*?)\];/) || [])[1] || '');
  ck(assetsBlock.length > 0, 'the precache list is findable');
  ck(!/articles/.test(assetsBlock), 'and no article is in it', assetsBlock.replace(/\s+/g, ' ').slice(0, 100));
  const reg = fs.readFileSync(path.join(ROOT, 'install.js'), 'utf8');
  ck(/navigator\.serviceWorker\.register\("\/sw\.js"\)/.test(reg), 'install.js registers it');
  ck(fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8').indexOf('install.js') < 0,
    'and the app does NOT load install.js, so the app never registers a root-scoped worker');

  console.log('\n2. it registers on an article, at root scope');
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 850 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE + '/articles/' + ART + '/', { waitUntil: 'networkidle2' });
  const info = await p.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    for (let i = 0; i < 60 && !navigator.serviceWorker.controller; i++) await new Promise(z => setTimeout(z, 250));
    const regs = await navigator.serviceWorker.getRegistrations();
    return {
      controlled: !!navigator.serviceWorker.controller,
      scopes: regs.map(x => x.scope),
      script: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
    };
  });
  ck(info.controlled, 'the page is controlled');
  ck(/\/sw\.js$/.test(info.script || ''), 'by the root worker', String(info.script));
  ck(info.scopes.some(s => new URL(s).pathname === '/'), 'whose scope is /', JSON.stringify(info.scopes));

  console.log('\n3. it caches no content');
  const cached = await p.evaluate(async () => {
    const keys = await caches.keys();
    const mine = keys.filter(k => k.indexOf('cubby-site-') === 0);
    const out = {};
    for (const k of mine) out[k] = (await (await caches.open(k)).keys()).map(r => new URL(r.url).pathname);
    return { keys, mine, out };
  });
  const entries = cached.mine.length ? cached.out[cached.mine[0]] : [];
  ck(cached.mine.length === 1, 'exactly one cache of its own', JSON.stringify(cached.mine));
  ck(entries.indexOf('/offline.html') >= 0, 'holding the offline page', JSON.stringify(entries));
  ck(!entries.some(u => u.indexOf('/articles/') === 0), 'and not a single article', JSON.stringify(entries));
  ck(entries.length <= 3, 'three entries at most', String(entries.length));

  console.log('\n4. offline, an article it has never seen');
  await offlineEverywhere(b, p, true);
  const off = await p.goto(BASE + '/articles/cutting-baby-nails/', { waitUntil: 'domcontentloaded' })
    .then(async (r) => ({
      status: r.status(),
      text: (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').trim(),
      ours: await p.evaluate(() => !!document.querySelector('.card .brand')),
      art: await p.evaluate(() => { const i = document.querySelector('img.art'); return i ? (i.complete && i.naturalWidth > 0) : null; }),
      retry: await p.evaluate(() => !!document.querySelector('button')),
    }))
    .catch(e => ({ err: e.message }));
  ck(!off.err, 'the navigation resolves instead of failing', off.err || '');
  ck(off.ours, 'and it is OUR page, not the browser\'s error page', (off.text || '').slice(0, 80));
  ck(/You look offline/.test(off.text || ''), 'saying what happened', (off.text || '').slice(0, 80));
  ck(/saved on your phone/.test(off.text || ''), 'and that her logs are safe', (off.text || '').slice(0, 120));
  ck(off.art === true, 'with the balloon actually rendered from cache', String(off.art));
  ck(off.retry, 'and something to tap');
  try { await p.screenshot({ path: '/tmp/site-offline.png' }); } catch (e) { /* the page may be an error page */ }

  /* The cached entry must not be a REDIRECTED response. Cloudflare answers /offline.html with a 307 to
     /offline, and respondWith() of a redirected response to a navigation (redirect: 'manual') throws —
     so the cache looked perfect, every local assertion passed, and production failed with ERR_FAILED.
     This is the assertion that would have caught it, and it is why this gate must also be run against
     the live host: no local server rewrites URLs, so nothing local can reproduce it. */
  const stored = await p.evaluate(async () => {
    const r = await caches.match('/offline.html');
    if (!r) return { missing: true };
    return { redirected: r.redirected, type: r.type, status: r.status, url: r.url };
  });
  ck(!stored.missing, 'the offline page is in the cache to inspect');
  ck(stored.redirected === false, 'and it is NOT a redirected response, which a navigation cannot be given',
    JSON.stringify(stored));
  ck(stored.status === 200, 'stored as a plain 200', JSON.stringify(stored));

  console.log('\n5. offline, the app is untouched by all this');
  const appOff = await p.goto(BASE + '/app/', { waitUntil: 'domcontentloaded' })
    .then(async (r) => ({ status: r.status(), title: await p.title(), ours: await p.evaluate(() => !!document.querySelector('img.art')) }))
    .catch(e => ({ err: e.message }));
  // The app has its own worker; whether it opens here depends on whether it was ever visited in this
  // profile. What must NEVER happen is the root worker answering for /app/ with the offline page.
  ck(!appOff.ours, 'the root worker does not answer for /app/', JSON.stringify(appOff).slice(0, 100));

  console.log('\n6. back online, nothing is stale');
  await offlineEverywhere(b, p, false);
  const live = await p.goto(BASE + '/articles/cutting-baby-nails/', { waitUntil: 'networkidle2' })
    .then(async () => ({ text: (await p.evaluate(() => document.body.innerText)).slice(0, 120), ours: await p.evaluate(() => !!document.querySelector('img.art')) }));
  ck(!live.ours, 'the real article is served, not the cached offline page', live.text.replace(/\s+/g, ' ').slice(0, 70));
  const after = await p.evaluate(async () => {
    const c = await caches.open('cubby-site-v1');
    return (await c.keys()).map(r => new URL(r.url).pathname);
  });
  ck(!after.some(u => u.indexOf('/articles/') === 0), 'and visiting it cached nothing', JSON.stringify(after));

  console.log('\n7. a 404 is the server\'s answer, not ours');
  const notFound = await p.goto(BASE + '/articles/there-is-no-such-article-here/', { waitUntil: 'domcontentloaded' })
    .then(async (r) => ({ status: r.status(), ours: await p.evaluate(() => !!document.querySelector('img.art')) }))
    .catch(e => ({ err: e.message }));
  ck(!notFound.ours, 'a missing page is not dressed up as being offline', JSON.stringify(notFound));

  console.log('\n8. the two workers share an origin without eating each other');
  /* The check this section used to make was worthless: it looked for orphans of our OWN prefix and
     never let the app's worker install, so it passed green while the app was deleting our offline page
     on its very first activation. Cache storage is per-ORIGIN. app/sw.js used to sweep every cache
     except its own, which is fine when you are the only worker on the origin and a silent eviction the
     moment you are not — and it never healed, because a precache is only filled during install.
     This drives the real sequence: article (site worker installs) -> /app/ (app worker installs and
     activates) -> is the offline page still there? */
  const appSw = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8');
  ck(/k\.indexOf\('little-log-'\)\s*===\s*0/.test(appSw),
    'app/sw.js deletes only its own caches, by prefix');
  ck(!/keys\.filter\(\(k\)\s*=>\s*k\s*!==\s*CACHE\)/.test(appSw),
    'and no longer sweeps every cache on the origin');

  const both = await p.evaluate(async () => {
    const before = await caches.keys();
    return { before, offlineBefore: !!(await caches.match('/offline.html')) };
  });
  ck(both.offlineBefore, 'the offline page is cached before the app is opened', JSON.stringify(both.before));
  await p.goto(BASE + '/app/', { waitUntil: 'networkidle2' });
  await p.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 60; i++) {
      if ((await navigator.serviceWorker.getRegistrations()).some(r => /\/app\/sw\.js$/.test((r.active || {}).scriptURL || ''))) break;
      await new Promise(z => setTimeout(z, 250));
    }
    await new Promise(z => setTimeout(z, 800));   // let activate run to completion
  });
  const after8 = await p.evaluate(async () => ({
    keys: await caches.keys(),
    offline: !!(await caches.match('/offline.html')),
    appShell: !!(await caches.match('/app/index.html')),
  }));
  ck(after8.appShell, 'the app precached its own shell', JSON.stringify(after8.keys));
  ck(after8.offline, 'AND the offline page survived the app worker activating', JSON.stringify(after8.keys));
  ck(after8.keys.some(k => k.indexOf('cubby-site-') === 0), 'our cache is still there by name', JSON.stringify(after8.keys));

  console.log('\n9. the offline page itself');
  /* The "Open Cubby" link is revealed only when the app shell is genuinely in cache, because a button
     that leads to a second failure is worse than no button. Both directions have to be checked, and the
     hidden one needs a storage partition with no app in it — measuring it in this profile proves
     nothing, since step 8 has just cached the app here (and that is exactly how an earlier version of
     this assertion "passed"). */
  const READ = `(function(){
    var link=document.getElementById('openApp'), btn=document.querySelector('button');
    var cs=getComputedStyle(btn);
    function lum(c){ var p=c.match(/\\d+/g).map(Number).map(function(v){ v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); });
      return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2]; }
    function ratio(a,b){ var s=[lum(a),lum(b)].sort(function(m,n){return n-m;}); return Math.round(((s[0]+0.05)/(s[1]+0.05))*100)/100; }
    return {
      linkAttrHidden: link?link.hasAttribute('hidden'):null,
      linkShown: link?getComputedStyle(link).display!=='none':null,
      btnRatio: ratio(cs.color, cs.backgroundColor),
      btnH: btn.getBoundingClientRect().height,
      external: [].slice.call(document.querySelectorAll('link[rel=stylesheet],script[src],img[src]'))
        .map(function(n){ return n.getAttribute('href')||n.getAttribute('src'); })
        .filter(function(u){ return u && u.indexOf('data:')!==0; })
    };
  })()`;

  const fresh = await b.createBrowserContext();
  const fp = await fresh.newPage();
  await fp.setViewport({ width: 390, height: 850 });
  await fp.goto(BASE + '/offline.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 500));
  const clean = await fp.evaluate(code => eval(code), READ);
  ck(clean.linkShown === false,
    'with no app in cache, "Open Cubby" stays hidden, so it cannot be a dead tap',
    'attr=' + clean.linkAttrHidden + ' shown=' + clean.linkShown);
  ck(clean.btnRatio >= 4.5, 'the recovery button clears AA (light)', String(clean.btnRatio) + ':1');
  ck(clean.btnH >= 44, 'and meets the 44px target', String(clean.btnH));
  ck(clean.external.length === 0,
    'nothing on the page is fetched over the connection it is telling you about', JSON.stringify(clean.external));
  await fp.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await new Promise(r => setTimeout(r, 250));
  const dark = await fp.evaluate(code => eval(code), READ);
  ck(dark.btnRatio >= 4.5, 'and clears AA in dark too', String(dark.btnRatio) + ':1');
  await fp.screenshot({ path: '/tmp/site-offline-dark.png' });
  await fresh.close();

  // And the other direction, in this profile, where the app IS cached.
  await p.goto(BASE + '/offline.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 500));
  const withApp = await p.evaluate(code => eval(code), READ);
  ck(withApp.linkShown === true,
    'and it DOES appear once the app is genuinely reachable offline',
    'shown=' + withApp.linkShown);

  console.log('\n10. clean console');
  ck(errs.length === 0, 'no uncaught page errors', errs.join(' | '));

  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
