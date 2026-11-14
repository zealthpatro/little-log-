#!/usr/bin/env node
/* No personal email address in any tracked file (admin spec S34, anti-goal A3). The repo is PUBLIC.
 *
 *   node tools/address_check.js               scan every tracked file
 *   node tools/address_check.js --self-test   also stage each way it can go red, in scratch trees
 *
 * WHY. The admin dashboard is the first thing in this repo that exists for exactly one person, and his
 * address must live only in the Cloudflare Access policy and one Worker secret. The tree already carried
 * personal addresses (a tool's defaults and four documents); git history keeps them, which is stated in
 * the admin spec, not hidden. From here on the TREE stays clean.
 *
 * Allowed, so the gate can be green on a real tree (S34): role addresses at little-cubby.com and
 * mail.little-cubby.com, by NAME (ROLES below: a personal inbox at the brand's own domain is still personal),
 * and the app's own appointment UID there (UID:cubby-appt-<base36 id>@little-cubby.com, an event id, not
 * an inbox; any other local part after "UID:" is checked like any address);
 * example.com, example.org, example.net; the reserved names .test, .invalid,
 * .example, .localhost; *.gserviceaccount.com (service accounts appear in tools and tests); the legacy
 * test fixtures x.com, y.com and else.com (new fixtures use example.com); and three exact non-personal
 * strings: git@github.com (an SSH host), noreply@anthropic.com (a commit trailer quoted in a plan), and
 * the you@email.com placeholder in the newsletter form. A file name such as icon@2x.png is not an address.
 *
 * And a second, stricter list that never enters the repo: a local file OUTSIDE it, one address per
 * line (default ~/.cubby/private-addresses.txt, or CUBBY_PRIVATE_ADDRESSES=<path>). Any tracked file
 * containing one of those fails, allowlisted domain or not. The pre-push suite runs this gate.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ADDRESS = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
const FILE_EXT = /\.(png|jpe?g|webp|gif|svg|ico|avif|heic|pdf|woff2?|ttf|mp4|mov|js|mjs|css|json|html?)$/i;
const BRAND = ['little-cubby.com', 'mail.little-cubby.com'];
/* Role inboxes, the only local parts allowed at BRAND: the ones in use (support, noreply), the usual role
   names (RFC 2142 and the like), and probe, the sign-in probe's synthetic test inbox. A new one is a
   one-word change here, in review, never a personal name. */
const ROLES = new Set(['hello', 'support', 'help', 'contact', 'team', 'privacy', 'security', 'legal', 'press', 'billing',
  'noreply', 'no-reply', 'notifications', 'alerts', 'postmaster', 'abuse', 'hostmaster', 'webmaster', 'dmarc', 'probe']);
const DOMAINS = ['example.com', 'example.org', 'example.net', 'x.com', 'y.com', 'else.com'];
const RESERVED = /\.(test|invalid|example|localhost)$/i;
const SERVICE = /(^|\.)gserviceaccount\.com$/i;
const EXACT = new Set(['git@github.com', 'noreply@anthropic.com', 'you@email.com']);
/* The one event id the app writes at the brand domain, exactly as apptIcsUidFor() in app/index.html builds it:
   cubby-appt-<base36 id>@little-cubby.com, after "UID:". Any other local part there is read as an address. */
const APPT_UID = /^cubby-appt-[a-z0-9]+@little-cubby\.com$/;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 600) : '')); } };

function allowed(addr) {
  const a = addr.toLowerCase();
  if (EXACT.has(a)) return true;
  const [local, domain] = a.split('@');
  if (BRAND.includes(domain)) return ROLES.has(local);
  return DOMAINS.includes(domain) || RESERVED.test(domain) || SERVICE.test(domain);
}

function listFiles(root) {
  const r = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'buffer' });
  if (r.status === 0) return r.stdout.toString().split('\0').filter(Boolean);
  const out = [], stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') stack.push(p); } else out.push(p);
    }
  }
  return out;
}

function readText(abs) {
  let st; try { st = fs.lstatSync(abs); } catch (e) { return null; }
  if (!st.isFile() || st.size > 4 * 1024 * 1024) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8192).includes(0)) return null;
  return buf.toString('utf8');
}

function privateList() {
  const p = process.env.CUBBY_PRIVATE_ADDRESSES || path.join(os.homedir(), '.cubby', 'private-addresses.txt');
  const abs = path.resolve(p);
  if (abs.startsWith(path.resolve(ROOT) + path.sep)) throw new Error('the private list must live OUTSIDE the repo, not at ' + abs);
  if (!fs.existsSync(abs)) return { path: abs, list: [] };
  const list = fs.readFileSync(abs, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#') && l.includes('@'));
  return { path: abs, list };
}

/* Returns [{file, line, why}] with the address itself NEVER printed: a gate log is not a place for it. */
function scan(root, priv) {
  const hits = [];
  for (const rel of listFiles(root)) {
    const text = readText(path.join(root, rel));
    if (text === null) continue;
    const lower = text.toLowerCase();
    for (const p of priv) if (lower.includes(p)) hits.push({ file: rel, line: lower.slice(0, lower.indexOf(p)).split('\n').length, why: 'an address from the private list' });
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ADDRESS.lastIndex = 0;
      let m;
      while ((m = ADDRESS.exec(lines[i]))) {
        if (FILE_EXT.test(m[1]) && !/\.(com|org|net)$/i.test(m[1])) continue;   // icon@2x.png is a file, not an address
        if (APPT_UID.test(m[0]) && /UID:$/.test(lines[i].slice(0, m.index))) continue;   // the app's own iCalendar event id
        if (!allowed(m[0])) hits.push({ file: rel, line: i + 1, why: 'an address at ' + m[1].replace(/^.*?([^.]+\.[^.]+)$/, '$1') + ' (not on the allowlist)' });
      }
    }
  }
  return hits;
}

console.log('\nno personal address: not one in any tracked file (admin spec S34)');
let priv;
try { priv = privateList(); } catch (e) { ok('the private list is outside the repo', false, e.message); priv = { list: [] }; }
const hits = scan(ROOT, priv.list);
ok('no tracked file holds a personal address' + (priv.list.length ? ' (and none of the ' + priv.list.length + ' on the private list)' : ' (no private list on this machine)'),
  hits.length === 0, hits.slice(0, 12).map((h) => h.file + ':' + h.line + ' ' + h.why).join('\n         '));

if (process.argv.includes('--self-test')) {
  console.log('\nself-test');
  const scratch = (files) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-address-'));
    for (const [rel, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), body); }
    return d;
  };
  const personal = 'someone.real' + '@' + 'gmail.com';
  ok('a personal address in a tracked file goes RED', scan(scratch({ 'docs/a.md': 'mail ' + personal + ' today' }), []).length === 1);
  ok('so does one in a test fixture', scan(scratch({ 'test/x.test.js': "const e = '" + 'parent' + '@' + "icloud.com';" }), []).length === 1);
  ok('icon@2x.png is a file name, not an address', scan(scratch({ 'app/a.html': '<img src="icon@2x.png"> <img srcset="cub@3x.webp 3x">' }), []).length === 0);
  ok('role addresses, example.com, reserved names, service accounts and legacy fixtures pass',
    scan(scratch({ 'a.js': 'support@little-cubby.com noreply@mail.little-cubby.com a@example.com b@example.org c@cubby.test d@cubby.invalid e@x.com f@y.com g@else.com sa@demo.iam.gserviceaccount.com' }), []).length === 0);
  /* Built from parts, so this file never holds the strings it stages. */
  const at = (local, domain) => local + '@' + domain;
  /* The private list is for an address the allowlist would pass: say the founder signs in as a role inbox. */
  const alias = at('hello', 'little-cubby.com');
  ok('an address on the private list goes RED even when the allowlist would pass it', scan(scratch({ 'b.md': 'ask ' + alias }), [alias]).length === 1);
  ok('in any case', scan(scratch({ 'b.md': 'ask ' + at('HELLO', 'Little-Cubby.com') }), [alias]).length === 1);
  /* At the brand's own domains, only named role inboxes: a personal one there is still personal (S34). */
  for (const a of [at('zeal', 'little-cubby.com'), at('founder', 'mail.little-cubby.com'), at('first.last', 'little-cubby.com'), at('cubby-appt-a1', 'little-cubby.com')]) {
    ok('a non-role address at the brand domain goes RED (' + a.replace(/^[^@]+/, (l) => l[0] + '...') + ')', scan(scratch({ 'c.md': 'write to ' + a }), []).length === 1);
  }
  ok('the role inboxes pass (hello, support, privacy, security, legal, noreply, no-reply, postmaster, abuse)',
    scan(scratch({ 'd.md': ['hello', 'support', 'privacy', 'security', 'legal', 'noreply', 'no-reply', 'postmaster', 'abuse'].map((l) => at(l, 'little-cubby.com') + ' ' + at(l, 'mail.little-cubby.com')).join(' ') }), []).length === 0);
  ok('an iCalendar UID at the brand domain (UID:...) is not an address', scan(scratch({ 'e.js': "t.indexOf('UID:" + at('cubby-appt-a1', 'little-cubby.com') + "')" }), []).length === 0);
  /* Only the app's own appointment UID shape is an event id (apptIcsUidFor: cubby-appt-<base36 id>). Anything
     else after "UID:" is an address like any other, so a personal inbox cannot hide behind the prefix. */
  for (const a of [at('zeal', 'little-cubby.com'), at('first.last', 'little-cubby.com'), at('cubby-appt-first.last', 'little-cubby.com'),
    at('cubby-appt-a1', 'mail.little-cubby.com'), at('Cubby-Appt-A1', 'little-cubby.com')]) {
    ok('a UID: prefix does not excuse a non-generator address (' + a.replace(/^[^@]+/, (l) => l.slice(0, 2) + '...') + ')', scan(scratch({ 'f.ics': 'UID:' + a + '\r\n' }), []).length === 1);
  }
  const r = scan(scratch({ 'c.md': 'x ' + personal }), []);
  ok('and the report never prints the address itself', r.length === 1 && !JSON.stringify(r).includes(personal), JSON.stringify(r));
  const inside = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { CUBBY_PRIVATE_ADDRESSES: path.join(ROOT, 'private.txt') }), encoding: 'utf8' });
  ok('a private list kept INSIDE the repo is refused', inside.status !== 0 && /OUTSIDE the repo/.test(inside.stdout), inside.stdout.slice(-200));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('NO-PERSONAL-ADDRESS: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
