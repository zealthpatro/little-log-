#!/usr/bin/env node
/* THE ONLY PICTURES ON A CUBBY SCREEN ARE THE PAINTED ONES.
 *
 * On 2026-11-13 the founder looked at the app and said "we should never have such horrible drawings,
 * let's ensure we have the standard logo everywhere, the one that we got ChatGPT, show it to me that
 * those images are the only ones that stay on screens". Two bears had been competing for five months:
 * every illustration inside the app was painted, while the app icon, the favicon, the sign-in card, the
 * landing page and the nav of ~680 pages showed a FLAT brown face a script drew out of Pillow circles in
 * June, and 🐻 sat in about 90 strings standing in for art. He chose the painted face for everything,
 * the icon too, and "remove every emoji bear".
 *
 * tools/brand-images.json is the approved set: every image file allowed on a screen, with where it came
 * from. This gate holds the tree to it, two ways.
 *
 * STATIC (no browser):
 *   1. no emoji bear (🐻 🧸 🐼 🐨, raw or escaped) in app/, worker.js, workers/ or any served page,
 *      script, stylesheet or SVG of the site (*.md, tools/, test/ and docs/ are not pages);
 *   2. every image a served file points at (src, srcset, href, og:image, url(), manifest and JSON
 *      strings) is a file in the approved set, and every inlined data: image is one the registry names;
 *      no page or script draws a bear in inline SVG (five or more filled circles and no text);
 *   3. the approved set is intact: each file exists with the bytes it was approved with;
 *   4. no retired logo's bytes appear anywhere in the tree, under any name: the June flat face (hashed
 *      from 866851ac) and the November white cub with its icons and text cards (hashed from c1fb604a);
 *      and every image FILE the site serves (the tree minus .assetsignore) is approved or pending,
 *      whether or not any page names it;
 *   5. the web icons are exactly what the master gives (tools/gen_brand_icons.py --check) and every card
 *      carries the current master's logo, never the drawn bear or a retired one (tools/card_logo.py --check).
 * RUNTIME (headless Chrome on THIS tree, localhost only, 390px):
 *   6. it boots the app the way the other gates do (?e2e=1, seeded) and walks every main tab top and
 *      bottom, the first-run cards, the landing, the sign-in card, the boot card, the invite sheet, the
 *      dead-invite note, the access-lost overlay, the account-deleted goodbye, the birth arrival and the
 *      Add-to-Cubby sheet, plus the marketing home page and an article page. On each it collects every
 *      rendered image (img/picture currentSrc, CSS background-image including ::before/::after, every
 *      image response with its bytes), every inline SVG, and the visible text. It fails on any picture
 *      outside the approved set, a retired logo's bytes under any URL, an inline SVG drawing (five or
 *      more filled circles or ellipses and no text: the old cubbyBear() was thirteen), or an emoji bear.
 *      The overlays that live inside store-firebase.js's closure are reached through a probe the gate
 *      adds to the script it SERVES to its own browser; the file on disk is never touched.
 *
 *   node tools/brand_image_check.js http://127.0.0.1:PORT              both halves
 *   node tools/brand_image_check.js --static-only
 *   node tools/brand_image_check.js http://127.0.0.1:PORT --self-test  plant each retired logo, a 🐻 in a
 *        visible string and an unapproved file into the page, and an emoji bear, an escaped teddy, a copy
 *        of each retired logo, an unapproved reference and an unreferenced unapproved file into a scratch
 *        copy of the static inputs: each must be caught (and every spelling of every bear, and no wolf)
 *   node tools/brand_image_check.js http://... --shots=DIR             also save a screenshot per screen (--width=320 to look narrower)
 *   node tools/brand_image_check.js --hash FILE...                     the registry line for a new picture
 *   node tools/brand_image_check.js --approve-cards                    re-approve the article card families
 *        after a new article or a new master (refuses while any card's logo is not the current master's)
 *   --root=DIR grades another tree (used to show the gate red on the pristine base).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ARGS = process.argv.slice(2);
const flag = (f) => ARGS.includes(f);
const opt = (k) => { const a = ARGS.find((x) => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : null; };
const BASE = (ARGS.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');
const ROOT = path.resolve(opt('--root') || path.join(__dirname, '..'));
const REG_PATH = opt('--registry') || path.join(__dirname, 'brand-images.json');
const SELF = flag('--self-test');
const STATIC_ONLY = flag('--static-only') || !BASE;
const SHOTS = opt('--shots');
const WIDTH = +(opt('--width') || 390);   // 390 is the gate; --width=320 is for looking at the narrowest phone

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 900) : '')); }
};
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

if (flag('--hash')) {
  ARGS.filter((a) => !a.startsWith('--')).forEach((f) => console.log(JSON.stringify(f) + ': ' + JSON.stringify(sha(fs.readFileSync(f))) + ','));
  process.exit(0);
}

/* ---------------- the registry ---------------- */
const REG = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
// Retired logos, each a named set of hashes whose bytes may never be in the tree or on a screen again:
// the June flat face (Pillow circles) and, since 2026-11-14, the November white cub on flat honey.
// (Until then `retired` was one object; both shapes are read.)
const RETIRED_SETS = [].concat(REG.retired || []).map((r) => ({
  name: r.name || 'the flat face', sha: new Set(Object.values(r.sha256 || {})), blob: r.git_blob || {},
}));
const RETIRED = new Set(RETIRED_SETS.reduce((a, r) => a.concat([...r.sha]), []));
const retiredName = (h) => (RETIRED_SETS.find((r) => r.sha.has(h)) || { name: 'a retired logo' }).name;
const globRe = (g) => new RegExp('^' + g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$');
function approvedSet() {
  const exact = new Map();          // path -> sha256
  const globs = [];
  (REG.families || []).forEach((f) => {
    Object.entries(f.files || {}).forEach(([p, h]) => exact.set(p, h));
    if (f.glob) globs.push({ re: globRe(f.glob), fam: f });
  });
  if (REG.master) exact.set(REG.master.path, REG.master.sha256);
  const pending = new Map();
  (REG.needs_founder_decision || []).forEach((d) => (d.files || []).forEach((p) => pending.set(p, (d.sha256 || {})[p])));
  return { exact, globs, pending };
}
const APPROVED = approvedSet();
const INLINE = new Set((REG.inline || []).map((i) => i.sha256));
function verdict(p) {
  if (APPROVED.exact.has(p)) return 'approved';
  if (APPROVED.globs.some((g) => g.re.test(p))) return 'approved';
  if (APPROVED.pending.has(p)) return 'pending';
  return 'unapproved';
}

/* ---------------- walking the tree ---------------- */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools', 'test', 'docs', 'art-src', '.claude', '.githooks',
  '_local', 'native-build', 'ios', 'android', 'credentials', 'App']);
const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.xml', '.txt']);
const IMG_EXT = /\.(png|jpe?g|webp|gif|svg|ico|avif)$/i;
function walk(dir, out, skip) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skip.has(e.name)) walk(p, out, skip); }
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/* The four bears, and every way a source file can spell one. Until 2026-11-14 only 🐻 had its escapes
   listed, so `emoji:'\u{1F9F8}'` in app/milestone-data.js passed the gate (the brand verifier's mutant B).
   Each form is built from the code point, so a fifth bear is one entry in BEARS. */
const BEARS = [[0x1F43B, 'BEAR FACE'], [0x1F9F8, 'TEDDY BEAR'], [0x1F43C, 'PANDA FACE'], [0x1F428, 'KOALA']];
const reLit = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function bearSpellings(cp, name) {
  const hex = cp.toString(16);
  const hi = (0xD800 + ((cp - 0x10000) >> 10)).toString(16), lo = (0xDC00 + ((cp - 0x10000) & 0x3FF)).toString(16);
  const bytes = [...Buffer.from(String.fromCodePoint(cp), 'utf8')].map((b) => b.toString(16));
  return [
    ['raw', reLit(String.fromCodePoint(cp)), (c) => String.fromCodePoint(c)],
    ['JS/Ruby \\u{…}', '\\\\u\\{0*' + hex + '\\}', (c) => '\\u{' + c.toString(16).toUpperCase() + '}'],
    ['JS/JSON surrogate pair', '\\\\u' + hi + '\\\\u' + lo, () => '\\u' + hi.toUpperCase() + '\\u' + lo.toUpperCase()],
    ['Python/C \\U…', '\\\\U0*' + hex + '(?![0-9a-f])', (c) => '\\U000' + c.toString(16).toUpperCase()],
    ['Perl \\x{…}', '\\\\x\\{0*' + hex + '\\}', (c) => '\\x{' + c.toString(16) + '}'],
    ['CSS \\…', '\\\\0*' + hex + '(?![0-9a-f])', (c) => '\\' + c.toString(16).toUpperCase() + ' '],
    ['HTML hex entity', '&#x0*' + hex + '(?![0-9a-f])', (c) => '&#x' + c.toString(16).toUpperCase() + ';'],
    ['HTML decimal entity', '&#0*' + cp + '(?![0-9])', (c) => '&#' + c + ';'],
    ['URL-encoded UTF-8', bytes.map((b) => '%' + b).join(''), () => bytes.map((b) => '%' + b.toUpperCase()).join('')],
    ['UTF-8 byte escapes', bytes.map((b) => '\\\\x' + b).join(''), () => bytes.map((b) => '\\x' + b.toUpperCase()).join('')],
    ['Python \\N{…}', '\\\\N\\{' + reLit(name) + '\\}', () => '\\N{' + name + '}'],
  ];
}
const BEAR_RE = new RegExp(BEARS.map(([cp, n]) => bearSpellings(cp, n).map((s) => s[1]).join('|')).join('|'), 'iu');
const BEAR_TEXT_RE = /\u{1F43B}|\u{1F9F8}|\u{1F43C}|\u{1F428}/u;
// An image path inside quotes, url(), an attribute, or a JSON value.
const REF_RE = /(["'(\s=,])((?:https?:\/\/[^"'()\s<>]+?)|(?:[^"'()\s<>`]*?))\.(png|jpe?g|webp|gif|svg|ico|avif)(?=[?#"')\s,;\\]|$)/gim;
const DATA_RE = /data:image\/(png|jpe?g|webp|gif|svg\+xml)(;base64)?,([^"')\s`]+)/gi;

function resolveRef(file, raw, root) {
  let u = raw.replace(/\\\//g, '/');
  if (/^https?:\/\//i.test(u)) {
    const m = /^https?:\/\/(?:www\.)?little-cubby\.com\/(.*)$/i.exec(u);
    if (!m) return { external: u };
    return { path: m[1] };
  }
  if (u.indexOf('${') >= 0 || u.indexOf('+') >= 0 || u.indexOf('*') >= 0 || u === '' || /^[.]+$/.test(u)) return null;
  if (u.startsWith('/')) return { path: u.slice(1) };
  const dir = path.dirname(path.relative(root, file).split(path.sep).join('/'));
  const cands = [path.posix.normalize(path.posix.join(dir, u)), path.posix.normalize(path.posix.join('app', u)), path.posix.normalize(u)];
  const hit = cands.find((c) => fs.existsSync(path.join(root, c)));
  if (hit) return { path: hit };
  // A bare file name (journey-catalogue.js lists '001_….webp' and the composer adds the folder) is that
  // approved file when exactly one approved file has the name; otherwise it is a name being built
  // (a download called '<baby>-moment.jpg'), not a picture.
  if (u.indexOf('/') < 0) {
    const named = [...APPROVED.exact.keys(), ...APPROVED.pending.keys()].filter((p) => p.split('/').pop() === u);
    return named.length === 1 ? { path: named[0] } : null;
  }
  return { path: cands[0] };
}

function staticScan(root) {
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const R = { bears: [], refs: [], external: [], missing: [], unapproved: [], pending: new Set(), dataBad: [], drawnSvg: [], retiredFiles: [], scanned: 0 };
  const served = walk(root, [], SKIP_DIRS).filter((p) => TEXT_EXT.has(path.extname(p).toLowerCase()) && !/\.md$/i.test(p));
  // workers/ and worker.js are in by construction (not in SKIP_DIRS); vendor bundles are third-party code, not copy.
  const files = served.filter((p) => !/\/app\/vendor\//.test(p) && !/\/tools\//.test(p));
  for (const f of files) {
    let s;
    try { s = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    R.scanned++;
    const r = rel(f);
    s.split('\n').forEach((line, i) => { if (BEAR_RE.test(line)) R.bears.push(r + ':' + (i + 1) + '  ' + line.trim().slice(0, 110)); });
    if (/\.json$/.test(f) && /brand-images\.json$/.test(f)) continue;
    let m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(s))) {
      if (!m[2] || /\/$/.test(m[2])) continue;      // '.webp' glued onto a variable: the browser walk grades those
      const raw = m[2] + '.' + m[3];
      if (/^data:/i.test(raw)) continue;
      const res = resolveRef(f, raw, root);
      if (!res) continue;
      if (res.external) { R.external.push(r + ' -> ' + res.external); continue; }
      const p = res.path.split('?')[0].split('#')[0];
      R.refs.push(p);
      const v = verdict(p);
      if (!fs.existsSync(path.join(root, p))) {
        if (v === 'unapproved') R.missing.push(r + ' -> ' + p);
        continue;
      }
      if (v === 'unapproved') R.unapproved.push(r + ' -> ' + p);
      if (v === 'pending') R.pending.add(p);
    }
    // A bear drawn in markup: an inline <svg> in a page or a script with five or more filled circles or
    // ellipses and no text (the social quote template drew one with seven; cubbyBear() has fourteen).
    // cubbyBear() itself stays in app/cubby-extras.js as dead code nothing calls, because the runtime
    // self-test draws it to prove the walk catches it; the runtime half proves no screen does.
    if (/\.(html?|m?js)$/i.test(f)) {
      const SVG_RE = /<svg\b[\s\S]*?<\/svg>/gi;
      while ((m = SVG_RE.exec(s))) {
        const filled = (m[0].match(/<(circle|ellipse)\b(?![^>]*fill=["']none)[^>]*>/gi) || []).length;
        if (filled < 5 || /<text\b/i.test(m[0])) continue;
        const fn = s.lastIndexOf('function cubbyBear(', m.index);
        if (r === 'app/cubby-extras.js' && fn >= 0 && m.index - fn < 1500) continue;
        R.drawnSvg.push(r + ':' + (s.slice(0, m.index).split('\n').length) + ' -> an inline SVG drawing (' + filled + ' filled circles)');
      }
    }
    DATA_RE.lastIndex = 0;
    while ((m = DATA_RE.exec(s))) {
      if (m[1] === 'svg+xml') {
        const svg = decodeURIComponent(m[3].replace(/%(?![0-9a-f]{2})/gi, '%25'));
        const filled = (svg.match(/<(circle|ellipse)\b(?![^>]*fill=["']none)[^>]*>/gi) || []).length;
        if (filled >= 5) R.dataBad.push(r + ' -> an inline SVG drawing (' + filled + ' filled circles)');
        continue;
      }
      if (!m[2]) continue;
      if (m[3].length < 64) continue;   // a regex or a prefix in code, not an image
      let buf;
      try { buf = Buffer.from(m[3], 'base64'); } catch (e) { continue; }
      const h = sha(buf);
      if (RETIRED.has(h)) R.dataBad.push(r + ' -> ' + retiredName(h) + ', inlined');
      else if (!INLINE.has(h)) R.dataBad.push(r + ' -> an inlined ' + m[1] + ' the registry does not name (sha256 ' + h.slice(0, 16) + ')');
    }
  }
  // Retired bytes anywhere, under any name, in the WHOLE tree (tools/ and docs/ too).
  const every = walk(root, [], new Set(['.git', 'node_modules']));
  R.retiredWhich = {};
  for (const f of every) {
    if (!/\.(png|jpe?g|webp|gif|ico|avif)$/i.test(f)) continue;
    let st; try { st = fs.statSync(f); } catch (e) { continue; }
    if (st.size > 20 * 1024 * 1024) continue;
    const h = sha(fs.readFileSync(f));
    if (RETIRED.has(h)) { R.retiredFiles.push(rel(f)); R.retiredWhich[rel(f)] = retiredName(h); }
  }
  // Every image FILE the site serves is in the registry, referenced or not. The reference scan above
  // cannot see a picture whose path is built at runtime (`/app/spot-art/${name}_x.webp`), and the browser
  // walk only sees the screens it visits, so an unregistered file on an unvisited sub-tab passed both
  // (the brand verifier's mutant B, 2026-11-14). "Served" is what Cloudflare uploads: the tree minus
  // .assetsignore and the gate's own skips.
  R.servedImages = servedImages(root);
  R.servedUnregistered = R.servedImages.filter((p) => verdict(p) === 'unapproved');
  return R;
}

function assetIgnore(root) {
  let lines = [];
  try { lines = fs.readFileSync(path.join(root, '.assetsignore'), 'utf8').split('\n'); } catch (e) { /* none: SKIP_DIRS alone */ }
  const names = new Set(SKIP_DIRS), globs = [];
  lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((l) => {
    const p = l.replace(/^\/+|\/+$/g, '');
    if (p.indexOf('*') >= 0) globs.push(globRe(p)); else names.add(p);
  });
  return { names, globs };
}
function servedImages(root) {
  const ig = assetIgnore(root);
  const out = [];
  (function go(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (ig.names.has(e.name) || ig.globs.some((g) => g.test(e.name))) continue;
      if (e.name.startsWith('.') && e.name !== '.well-known') continue;     // .git, .wrangler, .agents: not pages
      const p = path.join(dir, e.name);
      if (e.isDirectory()) go(p);
      else if (e.isFile() && IMG_EXT.test(e.name)) out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  })(root);
  return out.sort();
}

// A family approved by glob (660 share cards, 571 heroes) is pinned by its file count and one digest over
// every file's path and sha256, so a picture slipped in under that name, or a card changed, is caught.
function globDigest(root, glob) {
  const re = globRe(glob);
  const top = glob.split('/')[0];
  const list = walk(path.join(root, top), [], new Set(['node_modules'])).map((f) => path.relative(root, f).split(path.sep).join('/')).filter((p) => re.test(p)).sort();
  const h = crypto.createHash('sha256');
  list.forEach((p) => h.update(p + ' ' + sha(fs.readFileSync(path.join(root, p))) + '\n'));
  return { list, digest: h.digest('hex') };
}

function registryIntegrity(root) {
  const bad = [];
  const master = REG.master || {};
  const mp = path.join(root, master.path || 'icons/icon-master-1024.png');
  if (!fs.existsSync(mp)) bad.push('the master ' + master.path + ' is missing');
  else if (sha(fs.readFileSync(mp)) !== master.sha256) bad.push('the master ' + master.path + ' is not the one the founder chose');
  for (const fam of REG.families || []) {
    for (const [p, h] of Object.entries(fam.files || {})) {
      const f = path.join(root, p);
      if (!fs.existsSync(f)) { bad.push(fam.name + ': ' + p + ' is missing'); continue; }
      if (sha(fs.readFileSync(f)) !== h) bad.push(fam.name + ': ' + p + ' is not the approved file (sha256 changed)');
    }
    if (fam.glob) {
      const { list, digest: d } = globDigest(root, fam.glob);
      const how = '. New or regenerated cards from tools/gen_article_img.py? node tools/brand_image_check.js --approve-cards'
        + ' re-approves them, and refuses while any card carries a logo that is not the current master\'s.';
      if (list.length !== fam.count) bad.push(fam.name + ': ' + list.length + ' files match ' + fam.glob + ', the registry approved ' + fam.count + how);
      else if (d !== fam.digest) bad.push(fam.name + ': a file under ' + fam.glob + ' changed (digest ' + d.slice(0, 16) + ', approved ' + String(fam.digest).slice(0, 16) + ')' + how);
    }
  }
  return bad;
}

function pyCheck(script, root) {
  const p = path.join(root, script);
  if (!fs.existsSync(p)) return { ok: false, out: script + ' is not in this tree' };
  const r = spawnSync('python3', [p, '--check'], { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-3).join(' | ') };
}

function runStatic(root, label) {
  console.log('\nstatic: ' + label + ' (' + root + ')');
  const R = staticScan(root);
  ok('scanned the served text files (' + R.scanned + ')', R.scanned > 100, R.scanned);
  ok('no emoji bear in app/, worker.js, workers/ or any served page, script or stylesheet', R.bears.length === 0, R.bears.length + ' lines, e.g.\n         ' + R.bears.slice(0, 8).join('\n         '));
  ok('found the image references it is grading (' + R.refs.length + ')', R.refs.length > 1000, R.refs.length);
  ok('every image a served file points at is in the approved set', R.unapproved.length === 0, R.unapproved.length + ', e.g.\n         ' + [...new Set(R.unapproved)].slice(0, 8).join('\n         '));
  ok('and every one of them exists', R.missing.length === 0, [...new Set(R.missing)].slice(0, 8).join('\n         '));
  ok('no image is loaded from another host', R.external.length === 0, [...new Set(R.external)].slice(0, 6).join('\n         '));
  ok('every inlined data: image is one the registry names, and none is a drawing or a retired logo', R.dataBad.length === 0, R.dataBad.slice(0, 6).join('\n         '));
  ok('no page or script draws a picture in inline SVG circles (a hand-coded bear)', R.drawnSvg.length === 0, R.drawnSvg.slice(0, 6).join('\n         '));
  ok('found the image files the site serves (' + R.servedImages.length + ')', R.servedImages.length > 1000, R.servedImages.length);
  ok('every image file the site serves is approved or pending in tools/brand-images.json, referenced or not', R.servedUnregistered.length === 0,
    R.servedUnregistered.length + ', e.g.\n         ' + R.servedUnregistered.slice(0, 8).join('\n         ') + '\n         (a new picture: node tools/brand_image_check.js --hash <file>)');
  ok('no retired logo\'s bytes (' + RETIRED_SETS.map((s) => s.name).join(', ') + ') appear anywhere in the tree, under any name', R.retiredFiles.length === 0,
    R.retiredFiles.map((f) => f + ' (' + R.retiredWhich[f] + ')').join(', '));
  const integ = registryIntegrity(root);
  ok('the approved set is intact: every file exists with the bytes it was approved with', integ.length === 0, integ.slice(0, 8).join('\n         '));
  const ic = pyCheck('tools/gen_brand_icons.py', root);
  ok('the web icons are exactly what the painted master gives', ic.ok, ic.out);
  const cl = pyCheck('tools/card_logo.py', root);
  ok('every share card, hero card and promo card carries the current master\'s logo (no drawn bear, no retired logo)', cl.ok, cl.out);
  if (R.pending.size) console.log('  note pending the founder\'s decision, unchanged: ' + [...R.pending].join(', '));
  return R;
}

/* ---------------- the app's precache: fresh icons, untouched vendor files ---------------- */
/* The painted logo kept the retired faces' file names, and /icons/* is browser-cached for a month, so an
   installed PWA could precache an old face from its own HTTP cache. app/sw.js asks for /icons/* with
   cache:'no-cache' (or 'reload') and leaves every other file to the normal fetch: forcing the immutable
   vendor files past the HTTP cache re-downloaded them on every deploy (brand verifier F3). This runs the
   SW's real install handler in a sandbox and reads back what it would ask for: behaviour, not grep. */
async function swPrecache(src) {
  const vm = require('vm');
  const handlers = {}, reqs = [];
  class Req { constructor(u, init) { this.url = String(u); this.cache = (init && init.cache) || 'default'; } }
  const sandbox = {
    self: { addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve() }, registration: {} },
    caches: { open: () => Promise.resolve({ addAll: (list) => { list.forEach((x) => reqs.push(typeof x === 'string' ? { url: x, cache: 'default' } : { url: x.url, cache: x.cache })); return Promise.resolve(); } }), keys: () => Promise.resolve([]) },
    Request: Req, URL, Promise, setTimeout, fetch: () => Promise.reject(new Error('no network in the sandbox')), console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { timeout: 2000 });
  if (!handlers.install) return { reqs, error: 'no install handler' };
  await new Promise((done) => handlers.install({ waitUntil: (p) => Promise.resolve(p).then(done, done) }));
  return { reqs };
}
function gradePrecache(reqs) {
  const icons = reqs.filter((r) => r.url.indexOf('/icons/') === 0);
  const rest = reqs.filter((r) => r.url.indexOf('/icons/') !== 0);
  return {
    icons, rest,
    staleIcons: icons.filter((r) => r.cache !== 'no-cache' && r.cache !== 'reload').map((r) => r.url + ' (' + r.cache + ')'),
    forced: rest.filter((r) => r.cache !== 'default').map((r) => r.url + ' (' + r.cache + ')'),
  };
}
async function runPrecache(root) {
  const f = path.join(root, 'app/sw.js');
  if (!fs.existsSync(f)) { ok('the app service worker is in this tree', false, 'app/sw.js'); return; }
  const { reqs, error } = await swPrecache(fs.readFileSync(f, 'utf8'));
  const g = gradePrecache(reqs);
  ok('the app SW precaches the icons (' + g.icons.length + ') and the rest (' + g.rest.length + ')', !error && g.icons.length >= 3 && g.rest.length > 10, error || reqs.length);
  ok('it asks for every /icons/* file past the HTTP cache (no-cache or reload), so no retired face is precached', g.staleIcons.length === 0, g.staleIcons);
  ok('and leaves every other file to the normal fetch (the vendor files stay cached)', g.forced.length === 0, g.forced.slice(0, 6));
}
async function precacheSelfTest() {
  console.log('\nself-test (precache): the same reading of two mutant service workers');
  const src = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8');
  const install = /self\.addEventListener\('install', \(e\) => \{[\s\S]*?\n\}\);/;
  if (!install.test(src)) { ok('found the install handler to mutate', false); return; }
  const every = src.replace(install, "self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))); });");
  const none = src.replace(install, "self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS))); });");
  const a = gradePrecache((await swPrecache(every)).reqs), b = gradePrecache((await swPrecache(none)).reqs);
  ok('catches a SW that forces EVERY file past the HTTP cache (the November build)', a.forced.some((x) => /\/app\/vendor\//.test(x)), a.forced);
  ok('catches a SW that lets the icons come from the HTTP cache (the June build)', b.staleIcons.some((x) => /\/icons\/logo-512\.png/.test(x)), b.staleIcons);
}

/* ---------------- self-test of the static half: a scratch copy with six plants ---------------- */
function staticSelfTest() {
  console.log('\nself-test (static): plant each defect in a scratch copy and watch the same checks catch it');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-brand-'));
  const copy = (p) => { const d = path.join(tmp, p); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(ROOT, p), d); };
  ['app/index.html', 'index.html', 'worker.js', 'app/milestone-data.js', '.assetsignore'].forEach(copy);
  // A teddy spelled as an escape, the brand verifier's mutant B (2026-11-14): this passed the gate then.
  fs.appendFileSync(path.join(tmp, 'app/milestone-data.js'), "\n  ({key:'planted-teddy', title:'Planted', emoji:'\\u{1F9F8}'});\n");
  // A picture nobody approved that no file names (its path is built at runtime), in a served folder; and
  // the same bytes in two folders the site never serves, which must NOT count.
  fs.mkdirSync(path.join(tmp, 'app/spot-art'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'app/spot-art/rituals_x.webp'), tinyPng());
  ['docs', 'social'].forEach((d) => { fs.mkdirSync(path.join(tmp, d), { recursive: true }); fs.writeFileSync(path.join(tmp, d, 'planted-unserved.png'), tinyPng()); });
  // A bear in a visible string, each retired logo under a new name, a reference to a picture nobody approved,
  fs.appendFileSync(path.join(tmp, 'app/index.html'), '\n<div class="planted">Good evening \u{1F43B}</div>\n');
  fs.appendFileSync(path.join(tmp, 'worker.js'), "\n// planted\nconst planted = '<img src=\"https://little-cubby.com/icons/planted-unapproved.png\">';\n");
  // a picture from another host, and an inlined picture nobody approved.
  fs.appendFileSync(path.join(tmp, 'index.html'), '\n<img src="https://example.invalid/planted.png"><img src="data:image/png;base64,' + tinyPng().toString('base64') + '">\n');
  // and a bear drawn in inline SVG circles, the way social/card-quote.html drew one until 2026-11-13.
  fs.appendFileSync(path.join(tmp, 'index.html'), '\n<svg width="60" height="60" viewBox="0 0 60 60"><circle cx="22" cy="22" r="8" fill="#C9A57E"/><circle cx="38" cy="22" r="8" fill="#C9A57E"/>'
    + '<circle cx="30" cy="33" r="16" fill="#C9A57E"/><ellipse cx="30" cy="38" rx="8" ry="6" fill="#F1E4D0"/><circle cx="24" cy="30" r="2.6" fill="#3E3228"/><circle cx="36" cy="30" r="2.6" fill="#3E3228"/></svg>\n');
  RETIRED_SETS.forEach((s, i) => fs.writeFileSync(path.join(tmp, 'icons-planted-' + i + '.png'), retiredBytes(s)));
  fs.mkdirSync(path.join(tmp, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'icons/planted-unapproved.png'), tinyPng());
  const R = staticScan(tmp);
  ok('catches the planted 🐻', R.bears.some((b) => /app\/index\.html:\d+ .*planted/.test(b)), R.bears);
  ok('catches the planted teddy spelled \\u{1F9F8} (mutant B)', R.bears.some((b) => /app\/milestone-data\.js:\d+ .*planted-teddy/.test(b)), R.bears);
  ok('catches the planted reference to an unapproved file', R.unapproved.some((u) => /icons\/planted-unapproved\.png/.test(u)), R.unapproved);
  RETIRED_SETS.forEach((s, i) => ok('catches ' + s.name + ' under a new name', R.retiredFiles.includes('icons-planted-' + i + '.png') && R.retiredWhich['icons-planted-' + i + '.png'] === s.name, R.retiredFiles));
  ok('catches the planted picture from another host', R.external.some((e) => /example\.invalid\/planted\.png/.test(e)), R.external);
  ok('catches the planted inlined picture nobody approved', R.dataBad.some((d) => /^index\.html -> an inlined png/.test(d)), R.dataBad);
  ok('catches the planted bear drawn in inline SVG', R.drawnSvg.some((d) => /^index\.html:\d+ -> an inline SVG drawing \(6 filled/.test(d)), R.drawnSvg);
  ok('catches the planted unregistered file no page names (app/spot-art/rituals_x.webp)', R.servedUnregistered.includes('app/spot-art/rituals_x.webp'), R.servedUnregistered);
  ok('and does not count the same bytes in folders the site never serves (docs/, social/)', !R.servedUnregistered.some((p) => /planted-unserved/.test(p)) && !R.servedImages.some((p) => /planted-unserved/.test(p)), R.servedImages);
  // Every spelling of every bear, and none of the near misses (the wolf and the dog sit beside them).
  const miss = [], hit = [];
  BEARS.forEach(([cp, n]) => bearSpellings(cp, n).forEach(([form, , make]) => { if (!BEAR_RE.test('x = "' + make(cp) + '";')) miss.push(form + ' of U+' + cp.toString(16).toUpperCase()); }));
  [[0x1F43A, 'WOLF FACE'], [0x1F436, 'DOG FACE']].forEach(([cp, n]) => bearSpellings(cp, n).forEach(([form, , make]) => { if (BEAR_RE.test('x = "' + make(cp) + '";')) hit.push(form + ' of U+' + cp.toString(16).toUpperCase()); }));
  const forms = BEARS.length * bearSpellings(BEARS[0][0], BEARS[0][1]).length;
  ok('catches every spelling of all four bears (' + (forms - miss.length) + ' of ' + forms + ')', miss.length === 0, miss);
  ok('and none of the wolf\'s or the dog\'s', hit.length === 0, hit);
  const clean = staticScan(path.join(ROOT));
  ok('and the real tree has none of these', clean.bears.length === 0 && clean.unapproved.length === 0 && clean.retiredFiles.length === 0 && clean.external.length === 0
    && clean.dataBad.length === 0 && clean.drawnSvg.length === 0 && clean.servedUnregistered.length === 0);
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* A retired logo's bytes, for the plants. From git's object store (any clone of this repo has them, as
   long as lanes are merged rather than squashed), or from the tree itself when it IS the old tree.
   Never written into the tree. */
function retiredBytes(set) {
  const s = set || RETIRED_SETS[0];
  for (const [p, blob] of Object.entries(s.blob)) {
    const r = spawnSync('git', ['cat-file', 'blob', blob], { cwd: ROOT, maxBuffer: 1 << 26 });
    if (r.status === 0 && s.sha.has(sha(r.stdout))) return r.stdout;
    const f = path.join(ROOT, p);
    if (fs.existsSync(f) && s.sha.has(sha(fs.readFileSync(f)))) return fs.readFileSync(f);
  }
  throw new Error('cannot find the bytes of ' + s.name + ' to plant: git objects ' + Object.values(s.blob).join(', ') + ' are not in this clone and the tree no longer has the old files'
    + ' (a shallow clone lacks them: git fetch --unshallow). The self-test refuses to pass without proving the real bytes are caught.');
}
function tinyPng() {
  const zlib = require('zlib');
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(8 * (1 + 8 * 3)); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const o = y * 25 + 1 + x * 3; raw[o] = 196; raw[o + 1] = 134; raw[o + 2] = 68; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------- runtime ---------------- */
const COLLECT = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const urls = [];
  // Anything inside the self-test's planted box is tagged, so the clean grading sets aside exactly the
  // plants and nothing else (an earlier version set aside every 'Good evening' and every drawing on the
  // access-lost screen, which would have hidden a real greeting bear on the first-run card).
  const planted = (el) => !!(el.closest && el.closest('#brand-plant'));
  document.querySelectorAll('img').forEach((i) => { if (vis(i) && (i.currentSrc || i.src)) urls.push({ url: i.currentSrc || i.src, how: 'img' + (i.className ? '.' + String(i.className).split(' ')[0] : ''), planted: planted(i) }); });
  const bgRe = /url\(["']?([^"')]+)["']?\)/g;
  document.querySelectorAll('*').forEach((el) => {
    ['', '::before', '::after'].forEach((pseudo) => {
      const b = getComputedStyle(el, pseudo || null).backgroundImage;
      if (!b || b === 'none' || b.indexOf('url(') < 0) return;
      if (!pseudo && !vis(el)) return;
      let m; bgRe.lastIndex = 0;
      while ((m = bgRe.exec(b))) urls.push({ url: m[1], how: 'background' + pseudo + ' on ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), planted: planted(el) });
    });
  });
  const svgs = [];
  document.querySelectorAll('svg').forEach((s) => {
    if (!vis(s) || s.parentElement && s.parentElement.closest('svg')) return;
    let filled = 0;
    s.querySelectorAll('circle,ellipse').forEach((c) => { const f = (c.getAttribute('fill') || getComputedStyle(c).fill || '').toLowerCase(); if (f && f !== 'none' && f !== 'transparent' && !/rgba\(.*,\s*0\)/.test(f)) filled++; });
    const shapes = s.querySelectorAll('path,circle,ellipse,rect,polygon,polyline,line').length;
    const r = s.getBoundingClientRect();
    svgs.push({ filled, shapes, text: s.querySelectorAll('text').length, w: Math.round(r.width), h: Math.round(r.height), where: (s.closest('[id]') || {}).id || s.parentElement.className || '', planted: planted(s) });
  });
  let pseudoBears = [];
  document.querySelectorAll('*').forEach((el) => ['::before', '::after'].forEach((p) => { const c = getComputedStyle(el, p).content; if (c && /\u{1F43B}|\u{1F9F8}|\u{1F43C}|\u{1F428}/u.test(c)) pseudoBears.push(el.tagName + p); }));
  const text = document.body ? document.body.innerText : '';
  const bears = (text.match(/[^\n]{0,40}(?:\u{1F43B}|\u{1F9F8}|\u{1F43C}|\u{1F428})[^\n]{0,20}/gu) || []).concat(pseudoBears);
  return { urls, svgs, bears };
};

async function runtime(base) {
  const puppeteer = require(path.join(__dirname, 'node_modules/puppeteer-core'));
  const dl = require(path.join(__dirname, 'gate_downloads.js'));
  const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DAY = 86400000;
  const CLOCK = (() => { const d = new Date(); d.setHours(13, 0, 0, 0); return d.getTime(); })();
  const OFFSET = CLOCK - Date.now();
  const seed = () => ({
    babies: [{ id: 'b1', name: 'Robin', birth: CLOCK - 60 * DAY, sex: 'F', routines: [], doctors: [], allergies: [] }],
    activeBabyId: 'b1', events: [], illnesses: [],
    settings: { unit: 'ml', wUnit: 'kg', hUnit: 'cm', tempUnit: 'C', seen: {} },
    timers: {}, milestones: [], meds: [], photos: [], vaccines: {}, pregnancy: null, notes: [],
  });
  const PROBE = '\n  window.__brandProbe = { accessLost: showAccessLost, inviteMismatch: showInviteMismatch, pendingInvite: maybePromptPendingInvite, showSignIn: showSignIn, showStatus: showStatus, hideOverlay: hideOverlay };\n';
  const PLANT_RETIRED = RETIRED_SETS.map((s, i) => '/__brand_selftest/retired-' + i + '.png'), PLANT_OTHER = '/__brand_selftest/unapproved.png';

  console.log('\nruntime: ' + base + ' at ' + WIDTH + 'px' + (SELF ? ', with plants' : ''));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: dl.downloadBehavior() });
  const ctx = await browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() });
  const page = await ctx.newPage();
  await page.setBypassServiceWorker(true);
  await page.setViewport({ width: WIDTH, height: 844, deviceScaleFactor: SHOTS ? 2 : 1 });
  // Light, whatever the machine's own appearance is: headless Chrome follows the Mac into Night.
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.evaluateOnNewDocument((shift) => {
    const R = Date;
    function D(...a) { return a.length === 0 ? new R(R.now() + shift) : new R(...a); }
    D.prototype = R.prototype; D.now = () => R.now() + shift; D.parse = R.parse; D.UTC = R.UTC;
    window.Date = D;
  }, OFFSET);
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const loaded = new Map();      // url -> sha256
  const blocked = [];
  let probeServed = false;
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = req.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    let url; try { url = new URL(u); } catch (e) { return req.abort(); }
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      if (req.resourceType() === 'image') blocked.push(u);
      return req.abort();
    }
    try {
      const ri = PLANT_RETIRED.indexOf(url.pathname);
      if (ri >= 0) return req.respond({ status: 200, contentType: 'image/png', body: retiredBytes(RETIRED_SETS[ri]) });
      if (url.pathname === PLANT_OTHER) return req.respond({ status: 200, contentType: 'image/png', body: tinyPng() });
      if (url.pathname === '/app/store-firebase.js') {
        const r = await fetch(u);
        let js = await r.text();
        if (js.indexOf('(function () {\n') >= 0) { js = js.replace('(function () {\n', '(function () {\n' + PROBE); probeServed = true; }
        return req.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body: js });
      }
    } catch (e) { /* fall through */ }
    req.continue();
  });
  page.on('response', async (res) => {
    try {
      const rt = res.request().resourceType();
      if (rt !== 'image') return;
      const u = res.url();
      if (u.startsWith('data:')) return;
      const buf = await res.buffer();
      loaded.set(u, sha(buf));
    } catch (e) {}
  });

  const screens = [];
  const take = async (name, prep) => {
    if (prep) { try { await prep(); } catch (e) { screens.push({ name, error: String(e.message || e) }); return; } }
    await sleep(700);
    const c = await page.evaluate(COLLECT);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png') }); }
    screens.push(Object.assign({ name }, c));
  };
  const boot = async (mode) => {
    await page.goto(base + '/app/?e2e=' + mode, { waitUntil: 'networkidle2', timeout: 45000 });
    if (mode === '1') {
      await page.evaluate(() => localStorage.setItem('cubby-quick-uid', 'local'));
      await page.evaluate((x) => localStorage.setItem('little-log-v1', JSON.stringify(x)), seed());
      await page.reload({ waitUntil: 'networkidle2' });
    }
    await sleep(1800);
  };
  const scrollTo = (where) => page.evaluate((w) => { const s = document.getElementById('scroll'); if (s) s.scrollTop = w === 'bottom' ? s.scrollHeight : 0; }, where);
  const plant = async () => {
    if (!SELF) return;
    await page.evaluate((a, b) => {
      const d = document.createElement('div');
      d.id = 'brand-plant';
      d.setAttribute('style', 'position:fixed;left:8px;top:8px;z-index:99999;background:#fff;padding:4px');
      d.innerHTML = a.map((u) => '<img src="' + u + '" width="40" height="40">').join('') + '<img src="' + b + '" width="40" height="40"><span>BRAND-SELFTEST-PLANT Good evening \u{1F43B}</span>'
        + '<img src="https://example.invalid/planted.png" width="40" height="40">'
        // and the hand-coded bear the avatars used to fall back to, drawn by the app's own cubbyBear()
        + (typeof window.cubbyBear === 'function' ? '<span style="display:inline-block;width:40px;height:40px">' + window.cubbyBear({ size: 40 }) + '</span>' : '');
      document.body.appendChild(d);
    }, PLANT_RETIRED, PLANT_OTHER);
    await sleep(600);
  };

  // The first-run cards, from a clean profile.
  await boot('onboard');
  await take('first-run');

  await boot('1');
  for (const tab of ['home', 'log', 'album', 'health']) {
    await take('tab ' + tab, async () => { await page.evaluate((t) => { go(t); }, tab); await sleep(500); await scrollTo('top'); });
    await take('tab ' + tab + ' (bottom)', async () => { await scrollTo('bottom'); });
    await scrollTo('top');
  }
  await page.evaluate(() => { try { go('home'); } catch (e) {} });
  await take('add-to-cubby sheet', () => page.evaluate(() => openAddEntry()));
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
  await take('settings sheet', () => page.evaluate(() => openSettings()));
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
  await take('birth arrival', () => page.evaluate(() => showBirthArrival((state.babies || [])[0])));
  await page.evaluate(() => { const o = document.getElementById('cb-birth-arrival'); if (o) o.remove(); });

  const P = (expr) => page.evaluate(new Function('if (!window.__brandProbe) throw new Error("the probe did not reach store-firebase.js"); ' + expr));
  await take('landing (signed out)', () => P('window.__brandProbe.showSignIn();'));
  await take('sign-in card', () => P('var L = window.cubbyLanding; window.cubbyLanding = undefined; try { window.__brandProbe.showSignIn(); } finally { window.cubbyLanding = L; }'));
  await take('boot card', () => P('window.__brandProbe.showStatus("Signing you in…");'));
  await P('window.__brandProbe.hideOverlay();');
  await take('invite sheet', () => P('window.LL.pendingInvite = { invitedBy: "Sam", role: "caregiver" }; window.__brandProbe.pendingInvite();'));
  await page.evaluate(() => { try { closeSheet(); } catch (e) {} });
  await take('dead invite link', () => P('window.__brandProbe.inviteMismatch("sam@example.com", true);'));
  await page.evaluate(() => { const o = document.getElementById('ll-invite-mismatch'); if (o) o.remove(); });
  await take('access lost', async () => { await P('window.__brandProbe.accessLost();'); await plant(); });
  await page.evaluate(() => { ['ll-access-lost', 'brand-plant'].forEach((i) => { const o = document.getElementById(i); if (o) o.remove(); }); });
  await take('account deleted', () => page.evaluate(() => showDeletedGoodbye()));

  // The website: the home page, and an article whose hero card is shown on the page.
  await take('website home', () => page.goto(base + '/', { waitUntil: 'networkidle2' }));
  await take('article page', () => page.goto(base + '/articles/baby-blues-explained/', { waitUntil: 'networkidle2' }));

  await browser.close();

  /* ---- grading ---- */
  const origin = new URL(base).origin;
  const toPath = (u) => { try { const x = new URL(u, base); return x.origin === origin ? decodeURIComponent(x.pathname).replace(/^\//, '') : null; } catch (e) { return null; } };
  const report = [];
  let unapproved = [], flat = [], drawn = [], bears = [], errors = [];
  for (const s of screens) {
    if (s.error) { errors.push(s.name + ': ' + s.error); continue; }
    const imgs = [];
    for (const { url, how, planted } of s.urls) {
      if (/^(data|blob):/.test(url)) { imgs.push({ file: url.slice(0, 30) + '…', how, verdict: 'runtime picture (data/blob)' }); continue; }
      const p = toPath(url);
      const h = loaded.get(new URL(url, base).href);
      if (h && RETIRED.has(h)) flat.push(s.name + ': ' + url + ' [' + retiredName(h) + ']' + (planted ? ' [plant]' : ''));
      const tag = planted ? ' [plant]' : '';
      if (p === null) { unapproved.push(s.name + ': ' + url + ' (another host)' + tag); imgs.push({ file: url, how, verdict: 'unapproved' }); continue; }
      const v = verdict(p);
      if (v === 'unapproved') unapproved.push(s.name + ': ' + p + ' (' + how + ')' + tag);
      imgs.push({ file: p, how, verdict: v });
    }
    s.svgs.filter((g) => g.filled >= 5 && g.text === 0).forEach((g) => drawn.push(s.name + ': an inline SVG drawing with ' + g.filled + ' filled circles (' + g.w + 'x' + g.h + ' in ' + g.where + ')' + (g.planted ? ' [plant]' : '')));
    s.bears.forEach((b) => bears.push(s.name + ': ' + b));
    report.push({ screen: s.name, images: imgs, svgs: s.svgs.length, bears: s.bears });
  }
  // Every image that crossed the wire, whether or not it is still in the DOM.
  for (const [u, h] of loaded) {
    if (RETIRED.has(h)) flat.push('network: ' + u + ' [' + retiredName(h) + ']');
    const p = toPath(u);
    if (p !== null && verdict(p) === 'unapproved' && !unapproved.some((x) => x.indexOf(p) >= 0)) unapproved.push('network: ' + p);
  }
  const results = { report, unapproved, flat, drawn, bears, errors, blocked, loaded: loaded.size, probeServed, pageErrors: errs };
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'screens.json'), JSON.stringify(report, null, 1));
  return results;
}

function gradeRuntime(R, label) {
  console.log('\n' + label);
  ok('the probe reached store-firebase.js', R.probeServed);
  ok('every screen rendered (' + R.report.length + ' of them)', R.errors.length === 0 && R.report.length >= 20, R.errors);
  const imgCount = R.report.reduce((n, s) => n + s.images.length, 0);
  ok('and they drew pictures to grade (' + imgCount + ' rendered images, ' + R.loaded + ' fetched)', imgCount > 15 && R.loaded >= 4, imgCount + ' rendered, ' + R.loaded + ' fetched');
  ok('the painted face is on the landing, the sign-in card and the access-lost overlay',
    ['landing (signed out)', 'sign-in card', 'access lost'].every((n) => (R.report.find((s) => s.screen === n) || { images: [] }).images.some((i) => i.file === 'icons/logo-512.png')),
    R.report.filter((s) => /landing|sign-in|access/.test(s.screen)).map((s) => s.screen + ': ' + s.images.map((i) => i.file).join(',')));
  ok('every rendered picture is in the approved set', R.unapproved.length === 0, R.unapproved.slice(0, 10).join('\n         '));
  ok('no retired logo (' + RETIRED_SETS.map((s) => s.name).join(', ') + ') is on any screen, under any URL', R.flat.length === 0, R.flat.slice(0, 6).join('\n         '));
  ok('no inline SVG drawing stands in for art', R.drawn.length === 0, R.drawn.slice(0, 6).join('\n         '));
  ok('no emoji bear in any visible text', R.bears.length === 0, R.bears.slice(0, 10).join('\n         '));
  ok('no image was fetched from another host', R.blocked.length === 0, R.blocked.slice(0, 5));
}

/* A new article brings a new share card and hero card from tools/gen_article_img.py, which pastes the
   painted master (card_logo.paste_logo); a new master re-swaps every card (card_logo.py --swap).
   Re-approving them is one command, and it refuses unless every card's logo is the current master's. */
if (flag('--approve-cards')) {
  const cl = pyCheck('tools/card_logo.py', ROOT);
  if (!cl.ok) { console.log('refused, a card carries a logo that is not the current master\'s: ' + cl.out); process.exit(1); }
  (REG.families || []).filter((f) => f.glob).forEach((f) => {
    const { list, digest } = globDigest(ROOT, f.glob);
    console.log(f.glob + ': ' + f.count + ' -> ' + list.length + ' files' + (digest === f.digest ? ', unchanged' : ', re-approved'));
    f.count = list.length; f.digest = digest;
  });
  fs.writeFileSync(REG_PATH, JSON.stringify(REG, null, 1) + '\n');
  process.exit(0);
}

(async () => {
  console.log('\nBrand images: only the painted art on a Cubby screen');
  console.log('tree ' + ROOT + (BASE ? ', served at ' + BASE : '') + ', registry ' + path.relative(process.cwd(), REG_PATH));
  runStatic(ROOT, 'this tree');
  await runPrecache(ROOT);
  if (SELF) { staticSelfTest(); await precacheSelfTest(); }
  if (!STATIC_ONLY) {
    const R = await runtime(BASE);
    if (!SELF) gradeRuntime(R, 'runtime: every screen');
    else {
      console.log('\nself-test (runtime): the walk ran with each retired logo, an unapproved file and a 🐻 planted on the access-lost overlay');
      RETIRED_SETS.forEach((s, i) => ok('catches ' + s.name + ', planted on a screen', R.flat.some((f) => new RegExp('access lost: .*retired-' + i + '\\.png.*\\[' + s.name + '\\]').test(f)), R.flat));
      ok('catches the planted unapproved file', R.unapproved.some((u) => /access lost: __brand_selftest\/unapproved\.png/.test(u)), R.unapproved);
      ok('catches the planted 🐻 in visible text', R.bears.some((b) => /access lost: .*BRAND-SELFTEST-PLANT/.test(b)), R.bears);
      ok('catches the planted hand-coded SVG bear (the old cubbyBear())', R.drawn.some((d) => /^access lost: an inline SVG drawing.*\[plant\]$/.test(d)), R.drawn);
      ok('catches the planted picture from another host (refused, never fetched)', R.blocked.some((u) => /example\.invalid\/planted\.png/.test(u)), R.blocked);
      // Set aside the plants and only the plants: each is tagged where it was collected.
      const notPlant = (x) => !/\[plant\]$/.test(x);
      const clean = Object.assign({}, R, {
        unapproved: R.unapproved.filter(notPlant).filter((u) => u.indexOf('__brand_selftest') < 0),
        flat: R.flat.filter(notPlant).filter((u) => u.indexOf('__brand_selftest') < 0),
        bears: R.bears.filter((b) => !/BRAND-SELFTEST-PLANT/.test(b)),
        drawn: R.drawn.filter(notPlant),
        blocked: R.blocked.filter((u) => !/example\.invalid\/planted/.test(u)),
      });
      gradeRuntime(clean, 'runtime: every screen, plants set aside');
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('BRAND-IMAGES: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
