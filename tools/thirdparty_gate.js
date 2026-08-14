// Gate for the promise Cubby makes on its own privacy page: no third-party trackers.
//
// The claim is published in these words, on the home page, the privacy page, the FAQ, inside the app
// itself, and in an article that compares Cubby favourably to a competitor on exactly this point:
//
//     "No third-party trackers"
//     "No third-party analytics scripts that observe your behaviour and report it somewhere else"
//     "No third-party SDKs, no ads, no data sales"
//
// A source scan cannot verify that. Nothing in the repo loads a tracker, and the promise can still be
// broken above the code: a host or CDN can inject a script into every HTML response, and it will only
// ever appear in a real browser. So this check runs against the LIVE site and reads the DOM.
//
// Found on 2026-08-10 by a self-containment assertion in tools/sitesw_gate.js: Cloudflare Web Analytics
// was injecting static.cloudflareinsights.com/beacon.min.js, with a token, into every page including
// /app/. Nothing in the repo asked for it and nothing in the repo could see it.
//
// The allowlist is deliberately tiny. Firebase and Google's sign-in origins are how the app
// authenticates and syncs, which is a stated function rather than an observer.
//
//   node tools/thirdparty_gate.js [baseUrl]        # defaults to the live site
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = (process.argv[2] || 'https://little-cubby.com').replace(/\/$/, '');

// Origins the product genuinely needs to function. Anything else on a page is a finding.
const ALLOWED = [
  'firebaseapp.com', 'googleapis.com', 'gstatic.com', 'firebaseio.com',
  'firebasestorage.app', 'accounts.google.com', 'appleid.apple.com', 'appleid.cdn-apple.com',
];
// Surfaces a real person reaches, one of each kind.
const PAGES = ['/', '/privacy/', '/faq/', '/articles/cubby-privacy/', '/app/', '/g/testcode'];

let fails = 0, passes = 0;
const ck = (ok, what, d) => { ok ? (passes++, console.log('  ok   ' + what)) : (fails++, console.log('  FAIL ' + what + (d ? '\n         ' + d : ''))); };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 850 });
  /* The promise is that nothing third-party OBSERVES you, so what matters is whether a request
     completed, not whether the browser queued one. Chrome fires 'request' first and only then
     applies the Content-Security-Policy, so a script the CSP refuses looks identical here to one
     that loaded and ran. This gate used to count both and could therefore never pass, even with
     the tracker provably dead: measured on live, the beacon reports `requested, FAILED`, defines
     none of its globals, and logs a CSP refusal.
     Blocked attempts are still REPORTED, because the zone is still injecting the tag and that is
     worth seeing. They just do not fail the promise, since a script that never executes cannot
     watch anybody. */
  const seen = new Map();      // origin -> Set(pages) where a request actually completed
  const blocked = new Map();   // origin -> Set(pages) where it was refused before running
  const third = (u) => {
    let host; try { host = new URL(u).hostname; } catch (e) { return null; }
    if (host === new URL(BASE).hostname || host === 'localhost') return null;
    if (ALLOWED.some(a => host === a || host.endsWith('.' + a))) return null;
    return host;
  };
  const note = (m, host) => { if (!m.has(host)) m.set(host, new Set()); m.get(host).add(p.url()); };
  p.on('response', (r) => { const h = third(r.url()); if (h && r.status() < 400) note(seen, h); });
  p.on('requestfailed', (r) => {
    const h = third(r.url()); if (!h) return;
    /* A SCRIPT that failed never executed, so it observed nothing, whatever the reason. Note it
       and move on. Anything else that failed (a fetch, an image pixel, a sendBeacon) may still
       have carried data out of the browser before dying, so that stays a failure.
       Deliberately not keyed on errorText: Chrome reports a CSP refusal here with an EMPTY
       errorText, which is what made the first version of this check silently classify a blocked
       beacon as a loaded one. */
    if (r.resourceType() === 'script') note(blocked, h); else note(seen, h);
  });

  console.log('\nwalking ' + PAGES.length + ' surfaces on ' + BASE);
  for (const path of PAGES) {
    try {
      await p.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 900));   // let deferred and injected scripts run
      console.log('  visited ' + path);
    } catch (e) { console.log('  (could not load ' + path + ': ' + e.message.split('\n')[0] + ')'); }
  }

  if (blocked.size) {
    console.log('\nthird-party scripts REFUSED before running (the promise holds, but note them)');
    for (const [host, pages] of blocked) {
      console.log('  --   ' + host + '\n         on: ' + [...pages].map(u => u.replace(BASE, '') || '/').join(', ')
        + (/cloudflareinsights/.test(host)
          ? '\n         Cloudflare Web Analytics, injected by the zone. The script-src in _headers stops it'
          + '\n         executing, so nothing is observed, but the dashboard toggle is still on. Removing that'
          + '\n         directive would make it live again.'
          : ''));
    }
  }

  console.log('\nthird-party origins that actually loaded');
  if (!seen.size) {
    ck(true, 'none. The promise holds on every surface walked.');
  } else {
    for (const [host, pages] of seen) {
      ck(false, 'third-party request to ' + host,
        'on: ' + [...pages].map(u => u.replace(BASE, '') || '/').join(', ')
        + (/cloudflareinsights/.test(host)
          ? '\n         This is Cloudflare Web Analytics, injected by the zone, not by anything in this repo.'
          + '\n         Turn it off: Cloudflare dashboard -> the cubby Worker/Pages project -> Settings ->'
          + '\n         Web Analytics -> disable automatic setup. It cannot be switched off from wrangler.toml.'
          : ''));
    }
  }

  console.log('\n' + (fails ? 'FAIL' : 'PASS') + ' — ' + passes + ' passed, ' + fails + ' failed');
  await b.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
