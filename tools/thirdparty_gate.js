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
  const seen = new Map();   // origin -> Set(pages it appeared on)
  p.on('request', (r) => {
    let host;
    try { host = new URL(r.url()).hostname; } catch (e) { return; }
    if (host === new URL(BASE).hostname || host === 'localhost') return;
    if (ALLOWED.some(a => host === a || host.endsWith('.' + a))) return;
    if (!seen.has(host)) seen.set(host, new Set());
    seen.get(host).add(p.url());
  });

  console.log('\nwalking ' + PAGES.length + ' surfaces on ' + BASE);
  for (const path of PAGES) {
    try {
      await p.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise(r => setTimeout(r, 900));   // let deferred and injected scripts run
      console.log('  visited ' + path);
    } catch (e) { console.log('  (could not load ' + path + ': ' + e.message.split('\n')[0] + ')'); }
  }

  console.log('\nthird-party origins contacted');
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
