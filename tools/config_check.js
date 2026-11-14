#!/usr/bin/env node
/* Remote config (layer 1 of docs/plans/2026-10-09-ADR-001-sdui.md) lets one Firestore document,
 * config/app, change words, switches and the order of home widgets on every phone at once, with no
 * deploy and no review. That is the point of it, and it is also the risk: the only thing standing
 * between a typo in the Firebase console and every parent's home screen is cubbyConfigClean. A
 * validator that quietly loosens does not fail anything visible. It just waits for the first bad
 * document.
 *
 * So this states the contract in its own words and holds the validator to it:
 *   - no document, or a broken one, renders exactly what app/index.html compiles in
 *   - text is plain: no markup, quotes, backslashes or control characters, 1 to 160 characters
 *   - checkout links are https on little-cubby.com, workers.dev or lemonsqueezy.com, nothing else
 *   - the safety widgets are locked and can never be hidden (the list is written out below, not
 *     read from HOME_WIDGETS, so unlocking the dose pill in the app turns this red)
 *   - reordering an anchor can never drop a widget
 *   - config carries nothing beyond pro, rollout and home
 *   - a cached copy is re-validated on every boot and never written back
 *   - every widget renderHome builds is in the registry and every registry id is built, because a
 *     widget missing from HOME_WIDGETS silently never renders
 *
 * Static: it lifts the config core out of app/index.html and runs it in a vm, no browser.
 *
 *   node tools/config_check.js               check the tree
 *   node tools/config_check.js --self-test   first break the source ten ways and require each break
 *                                            to turn its own check red, then check the tree
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');

/* THE SPEC. Written here, not derived from the code it checks. */
const LOCKED = ['alerts', 'consent', 'dose', 'fever', 'illness', 'preg-weeks', 'vaccine', 'visit'];
const TOP_KEYS = ['home', 'pro', 'rollout'];
const PRO_KEYS = ['checkoutUrl', 'launch', 'portalUrl', 'priceLine', 'taste'];

const sorted = (a) => a.slice().sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function slice(src, start, end, label) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`cannot find ${label} (${JSON.stringify(start)}) in app/index.html`);
  const j = src.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`cannot find the end of ${label} in app/index.html`);
  return src.slice(i, j + end.length);
}

/* The config core plus the three compiled defaults it falls back to, in a fresh context each time,
   because CFG is module state and one check must never see another check's document. */
function load(src) {
  const core = slice(src, 'const CONFIG_KEY', '\nconst AVATAR_COLORS', 'the remote config core').replace(/\nconst AVATAR_COLORS$/, '');
  const defaults = [
    slice(src, 'const PRO_CFG = {', '\n};', 'PRO_CFG'),
    slice(src, 'const PRO_LAUNCH =', ';', 'PRO_LAUNCH'),
    slice(src, 'const PRO_TASTE=', ';', 'PRO_TASTE')
  ].join('\n');
  const store = {};
  const ctx = {
    window: {},
    store,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(defaults + '\n' + core + '\nthis.api = { cubbyConfigClean, cubbyApplyConfig, proLaunch, proCfg, proTasteMax, homeHidden, homeOrder, HOME_WIDGETS, CONFIG_KEY, PRO_CFG, PRO_LAUNCH, PRO_TASTE };', ctx);
  return { api: ctx.api, store };
}

const CHECKS = [
  ['no document, or a broken one, renders the compiled defaults', (src) => {
    const bad = [];
    [null, undefined, 'config', 42, [], {}, { pro: 'x', home: [], rollout: 7 }].forEach((raw) => {
      const { api } = load(src);
      api.cubbyApplyConfig(raw, true);
      const ids = api.HOME_WIDGETS.feed.map((w) => w[0]);
      if (api.proLaunch() !== api.PRO_LAUNCH || api.proCfg('priceLine') !== api.PRO_CFG.priceLine
        || api.proTasteMax('voice') !== api.PRO_TASTE.voice || !same(api.homeOrder('feed'), ids)
        || api.homeHidden('tips')) bad.push(JSON.stringify(raw === undefined ? 'undefined' : raw));
    });
    return bad.length ? bad : true;
  }],

  ['plain words are taken (the companion: the matcher that refuses markup still accepts copy)', (src) => {
    const { api } = load(src);
    const long = 'a'.repeat(160);
    api.cubbyApplyConfig({ pro: { launch: 'February 2027', priceLine: 'Cubby Pro · $9 a month, or $90 a year · 7-day free trial' } }, true);
    const one = api.proLaunch() === 'February 2027' && api.proCfg('priceLine').startsWith('Cubby Pro · $9');
    api.cubbyApplyConfig({ pro: { launch: long } }, true);
    return (one && api.proLaunch() === long) || [api.proLaunch(), api.proCfg('priceLine')];
  }],

  ['markup, quotes, backslashes and control characters are refused', (src) => {
    const bad = [];
    ['<b>soon</b>', 'He said "soon"', "it's soon", 'a`b', 'a & b', 'a\\b', 'line\nbreak', 'tab\there', '',
      'a'.repeat(161), 2027, null, {}, ['January']].forEach((v) => {
      ['launch', 'priceLine'].forEach((k) => {
        const { api } = load(src);
        if (k in api.cubbyConfigClean({ pro: { [k]: v } }).pro) bad.push(k + '=' + JSON.stringify(v));
      });
    });
    return bad.length ? bad : true;
  }],

  ['checkout links are https on the three known hosts, and nothing else', (src) => {
    const { api } = load(src);
    const takes = (u) => 'checkoutUrl' in api.cubbyConfigClean({ pro: { checkoutUrl: u } }).pro;
    const good = ['https://cubby-billing.acct.workers.dev/checkout', 'https://little-cubby.com/pro',
      'https://pay.lemonsqueezy.com/buy/abc', ''];
    const bad = ['http://little-cubby.com/pro', 'ftp://little-cubby.com/pro', 'https://little-cubby.com.example.net/pro',
      'https://evillittle-cubby.com/pro', 'https://little-cubby.com@example.net/', 'https://little-cubby.com/pro?ref=1',
      'https://little-cubby.com:8443/pro', 'https://LITTLE-CUBBY.COM/pro', 'data:text/plain,hi', '//little-cubby.com/pro', 7];
    const wrong = good.filter((u) => !takes(u)).map((u) => 'refused ' + JSON.stringify(u))
      .concat(bad.filter(takes).map((u) => 'took ' + JSON.stringify(u)));
    const portal = 'portalUrl' in api.cubbyConfigClean({ pro: { portalUrl: 'http://little-cubby.com/x' } }).pro;
    if (portal) wrong.push('portalUrl took http');
    return wrong.length ? wrong : true;
  }],

  ['taste counts are whole numbers from 0 to 20, for known treats only', (src) => {
    const { api } = load(src);
    const t = (v) => api.cubbyConfigClean({ pro: { taste: { voice: v } } }).pro.taste;
    const wrong = [];
    [0, 7, 20].forEach((n) => { if (t(n).voice !== n) wrong.push('refused ' + n); });
    [21, -1, 2.5, '3', NaN, null, true].forEach((n) => { if ('voice' in t(n)) wrong.push('took ' + JSON.stringify(n)); });
    if ('bogus' in api.cubbyConfigClean({ pro: { taste: { bogus: 3 } } }).pro.taste) wrong.push('took an unknown treat');
    api.cubbyApplyConfig({ pro: { taste: { voice: 99 } } }, true);
    if (api.proTasteMax('voice') !== api.PRO_TASTE.voice) wrong.push('a refused count did not fall back');
    return wrong.length ? wrong : true;
  }],

  ['rollout takes native, all or off, for well-formed keys, at most 50', (src) => {
    const { api } = load(src);
    const r = (o) => api.cubbyConfigClean({ rollout: o }).rollout;
    const wrong = [];
    if (!same(r({ journeyBook: 'native', x_1: 'off', y: 'all' }), { journeyBook: 'native', x_1: 'off', y: 'all' })) wrong.push('refused good stages');
    if (Object.keys(r({ a: 'beta', b: true, c: 1 })).length) wrong.push('took a bad stage');
    if (Object.keys(r({ 'has space': 'all', 'a.b': 'all', ['x'.repeat(41)]: 'all' })).length) wrong.push('took a bad key');
    const many = {}; for (let i = 0; i < 60; i++) many['k' + i] = 'all';
    if (Object.keys(r(many)).length > 50) wrong.push('kept more than 50');
    return wrong.length ? wrong : true;
  }],

  ['the locked widgets are exactly the ones the spec names', (src) => {
    const { api } = load(src);
    const locked = [];
    Object.keys(api.HOME_WIDGETS).forEach((a) => api.HOME_WIDGETS[a].forEach(([id, l]) => { if (l) locked.push(id); }));
    return same(sorted(locked), LOCKED) || { locked: sorted(locked), spec: LOCKED };
  }],

  ['a locked widget can never be hidden, and an unlocked one can', (src) => {
    const { api } = load(src);
    const wrong = [];
    const hid = api.cubbyConfigClean({ home: { hide: LOCKED } }).home.hide;
    if (hid.length) wrong.push('hid ' + hid.join(','));
    const ok = api.cubbyConfigClean({ home: { hide: ['tips', 'hero', 'tips', 'banner', 7] } }).home.hide;
    if (!same(ok, ['tips', 'hero'])) wrong.push('hide tips,hero gave ' + JSON.stringify(ok));
    api.cubbyApplyConfig({ home: { hide: ['tips', 'dose'] } }, true);
    if (!api.homeHidden('tips') || api.homeHidden('dose')) wrong.push('homeHidden disagrees with the clean list');
    return wrong.length ? wrong : true;
  }],

  ['reordering an anchor never drops or invents a widget', (src) => {
    const wrong = [];
    const { api: base } = load(src);
    Object.keys(base.HOME_WIDGETS).forEach((a) => {
      const ids = base.HOME_WIDGETS[a].map((w) => w[0]);
      const other = Object.keys(base.HOME_WIDGETS).filter((b) => b !== a).map((b) => base.HOME_WIDGETS[b][0][0]);
      const want = ids.slice(-2).reverse();
      const { api } = load(src);
      api.cubbyApplyConfig({ home: { order: { [a]: want.concat([want[0], 'banner'], other) } } }, true);
      const got = api.homeOrder(a);
      if (!same(sorted(got), sorted(ids)) || got.length !== ids.length) wrong.push(a + ' became ' + got.join(','));
      else if (!same(got.slice(0, 2), want)) wrong.push(a + ' ignored the configured order');
    });
    return wrong.length ? wrong : true;
  }],

  ['config carries nothing beyond pro, rollout and home', (src) => {
    const { api } = load(src);
    const out = api.cubbyConfigClean({ features: { den: true }, logging: {}, html: '<p>', pro: { launch: 'June', extra: 1 },
      home: { hide: [], order: {}, layout: 'free' }, rollout: {} });
    const wrong = [];
    if (!same(sorted(Object.keys(out)), TOP_KEYS)) wrong.push('top keys ' + Object.keys(out).join(','));
    if (Object.keys(out.pro).some((k) => PRO_KEYS.indexOf(k) < 0)) wrong.push('pro keys ' + Object.keys(out.pro).join(','));
    if (!same(sorted(Object.keys(out.home)), ['hide', 'order'])) wrong.push('home keys ' + Object.keys(out.home).join(','));
    return wrong.length ? wrong : true;
  }],

  ['a cached copy is re-validated and never written back; a live one is cached', (src) => {
    const { api, store } = load(src);
    const wrong = [];
    // Spaced out on purpose: a write-back re-serialises it, so the bytes change if it happens.
    store[api.CONFIG_KEY] = '{ "pro": { "launch": "<i>x</i>" } }';
    const before = store[api.CONFIG_KEY];
    api.cubbyApplyConfig(JSON.parse(before), true);
    if (api.proLaunch() !== api.PRO_LAUNCH) wrong.push('a cached bad launch was used');
    if (store[api.CONFIG_KEY] !== before) wrong.push('the boot read wrote itself back');
    api.cubbyApplyConfig({ pro: { launch: 'March 2027' } }, false);
    if (!String(store[api.CONFIG_KEY] || '').includes('March 2027')) wrong.push('a live document was not cached');
    api.cubbyApplyConfig(null, false);
    if (api.CONFIG_KEY in store) wrong.push('a deleted document stayed cached');
    return wrong.length ? wrong : true;
  }],

  ['every widget renderHome builds is in the registry, and every registry id is built', (src) => {
    const { api } = load(src);
    const fn = slice(src, 'function renderHome(){', '\n}\n', 'renderHome');
    const wKeys = []; let m;
    const wRe = /\bw(?:\.([a-z][\w]*)|\['([a-z-]+)'\])\s*=(?!=)/g;
    while ((m = wRe.exec(fn))) wKeys.push(m[1] || m[2]);
    const alLit = (fn.match(/const al=\{([^}]*)\}/) || [])[1];
    if (alLit === undefined) return ['cannot find the al={...} alert slots in renderHome'];
    const alKeys = []; const kRe = /(?:'([a-z-]+)'|([a-z][\w]*))\s*:/g;
    while ((m = kRe.exec(alLit))) alKeys.push(m[1] || m[2]);
    const ids = (a) => api.HOME_WIDGETS[a].map((w) => w[0]);
    const wrong = [];
    if (!same(sorted(wKeys), sorted(ids('top').concat(ids('feed'))))) wrong.push({ built: sorted(wKeys), registry: sorted(ids('top').concat(ids('feed'))) });
    if (!same(sorted(alKeys), sorted(ids('alerts')))) wrong.push({ alerts: sorted(alKeys), registry: sorted(ids('alerts')) });
    ['top', 'feed'].forEach((a) => { if (!fn.includes(`slot('${a}')`)) wrong.push(`renderHome never prints slot('${a}')`); });
    if (!/w\.alerts\s*=\s*homeOrder\('alerts'\)/.test(fn)) wrong.push("the alert pills are not ordered by homeOrder('alerts')");
    return wrong.length ? wrong : true;
  }]
];

function run(src) {
  return CHECKS.map(([name, fn]) => {
    let r;
    try { r = fn(src); } catch (e) { r = ['threw: ' + e.message]; }
    return { name, ok: r === true, detail: r === true ? null : r };
  });
}

/* Each break names the check it must turn red. A break that no longer applies is itself a failure:
   the source moved, and a self-test that mutates nothing proves nothing. */
const MUTATIONS = [
  ['plain-text pattern loosened', 'markup, quotes', (s) => s.replace(/const CONFIG_TEXT = [^\n]*;/, 'const CONFIG_TEXT = /^[\\s\\S]{0,999}$/;')],
  ['link pattern loosened to any https', 'checkout links', (s) => s.replace(/const CONFIG_URL = [^\n]*;/, 'const CONFIG_URL = /^https:\\/\\//;')],
  ['the dose pill unlocked in the registry', 'locked widgets are exactly', (s) => s.replace("['dose',1]", "['dose',0]")],
  ['the validator stops honouring locks', 'can never be hidden', (s) => s.replace('if(l) locked[id]=1;', 'void l;')],
  ['a short order list drops the rest', 'never drops', (s) => s.replace('return first.concat(ids.filter(id=>first.indexOf(id)<0));', 'return first.length?first:ids;')],
  ['taste cap raised to 200', 'taste counts', (s) => s.replace('n>=0 && n<=20', 'n>=0 && n<=200')],
  ['an extra key passed through', 'nothing beyond', (s) => s.replace('if(seen.length) out.home.order[a]=seen; });\n  return out;', 'if(seen.length) out.home.order[a]=seen; });\n  if(raw.features) out.features=raw.features;\n  return out;')],
  ['the boot read writes itself back', 'never written back', (s) => s.replace('if(!fromCache){', 'if(true){')],
  ['renderHome builds a widget the registry lacks', 'every widget renderHome', (s) => s.replace('  const slot = a =>', "  w.promo = '';\n  const slot = a =>")],
  ['the launch accessor loses its fallback', 'no document', (s) => s.replace("function proLaunch(){ return ('launch' in CFG.pro) ? CFG.pro.launch : PRO_LAUNCH; }", 'function proLaunch(){ return CFG.pro.launch; }')]
];

function selfTest(src) {
  let good = true;
  MUTATIONS.forEach(([label, target, mutate]) => {
    const bent = mutate(src);
    const applied = bent !== src;
    const red = applied ? run(bent).filter((r) => !r.ok).map((r) => r.name) : [];
    const pass = applied && red.some((n) => n.includes(target));
    if (!pass) good = false;
    console.log(`  self-test ${pass ? 'ok ' : 'BAD'} ${label}${!applied ? ' (mutation did not apply: the source moved)' : (pass ? '' : ' (stayed green: ' + target + ')')}`);
  });
  return good;
}

const src = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
if (SELF_TEST) {
  console.log('self-test: every break must turn its own check red');
  if (!selfTest(src)) {
    console.error('config: FAIL, self-test broken; a gate that cannot go red proves nothing');
    process.exit(1);
  }
}
const results = run(src);
results.forEach((r) => console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n         got: ' + JSON.stringify(r.detail)}`));
const failed = results.filter((r) => !r.ok).length;
if (failed) { console.error(`config: FAIL, ${failed} of ${results.length} checks`); process.exit(1); }
console.log(`config: PASS, ${results.length} checks${SELF_TEST ? `, ${MUTATIONS.length} breaks each went red` : ''}`);
