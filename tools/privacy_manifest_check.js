#!/usr/bin/env node
/* Apple's privacy manifest for the native iOS app: present, parseable, in the App target, and honest about
 * tracking.
 *
 *   node tools/privacy_manifest_check.js              judge this checkout
 *   node tools/privacy_manifest_check.js --self-test  first stage every failure below in temp copies and
 *                                                     require each to go red, then judge this checkout
 *   node tools/privacy_manifest_check.js --root=<dir> judge another tree (the self-test uses this)
 *
 * ios/ is gitignored and regenerated, so the tracked source is native-ios/PrivacyInfo.xcprivacy and
 * tools/cap_ios_configure.rb copies it into ios/App/App and adds it to Copy Bundle Resources. This gate
 * checks only tracked files: the source and the configure script's wiring. It never reads a local ios/
 * project, whose state is whatever the last build left (the main checkout's would fail every push from
 * there). tools/ios_launch_smoke.sh checks the built .app itself.
 *
 * What it refuses: a missing or malformed manifest; NSPrivacyTracking anything but false; any tracking
 * domain; a collected data type marked as used for tracking, or with no purpose; a required-reason API with
 * no reason; a configure script that no longer copies and bundles it, or no longer stops when it is not
 * bundled. Parses the XML itself so it runs on Linux CI without plutil.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ARGS = process.argv.slice(2);
const ROOT = (ARGS.find((a) => a.startsWith('--root=')) || '').slice(7) || path.join(__dirname, '..');
const SRC = 'native-ios/PrivacyInfo.xcprivacy';
const CONFIGURE = 'tools/cap_ios_configure.rb';

/* A small XML property-list parser: dict, array, key, string, integer, real, date, data, true, false. */
function parsePlist(xml) {
  const body = xml.replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const toks = body.match(/<[^>]+>|[^<]+/g) || [];
  let i = 0;
  const next = () => { while (i < toks.length && /^\s*$/.test(toks[i])) i++; return toks[i++]; };
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  function text(tag) {
    let s = '';
    while (i < toks.length && toks[i] !== `</${tag}>`) {
      if (toks[i][0] === '<') throw new Error(`unexpected ${toks[i]} inside <${tag}>`);
      s += toks[i++];
    }
    if (toks[i++] !== `</${tag}>`) throw new Error(`unclosed <${tag}>`);
    return unesc(s);
  }
  function value(t) {
    if (t === undefined) throw new Error('unexpected end of file');
    if (t === '<true/>') return true;
    if (t === '<false/>') return false;
    if (t === '<array/>') return [];
    if (t === '<dict/>') return {};
    if (t === '<string/>') return '';
    if (t === '<array>') {
      const a = [];
      for (let u = next(); u !== '</array>'; u = next()) a.push(value(u));
      return a;
    }
    if (t === '<dict>') {
      const d = {};
      for (let u = next(); u !== '</dict>'; u = next()) {
        if (u !== '<key>') throw new Error(`expected <key> in <dict>, got ${u}`);
        const k = text('key');
        d[k] = value(next());
      }
      return d;
    }
    const m = /^<(string|integer|real|date|data)>$/.exec(t);
    if (m) {
      const s = text(m[1]);
      if (m[1] === 'integer' || m[1] === 'real') {
        if (!/^-?\d+(\.\d+)?$/.test(s.trim())) throw new Error(`bad <${m[1]}> ${s}`);
        return Number(s);
      }
      return s;
    }
    throw new Error(`unexpected token ${t}`);
  }
  if (next() !== '<plist version="1.0">') throw new Error('no <plist version="1.0"> root');
  const v = value(next());
  if (next() !== '</plist>') throw new Error('trailing content after the root value');
  if (next() !== undefined) throw new Error('content after </plist>');
  return v;
}

const API_CATEGORIES = ['FileTimestamp', 'SystemBootTime', 'DiskSpace', 'ActiveKeyboards', 'UserDefaults']
  .map((c) => `NSPrivacyAccessedAPICategory${c}`);

function judge(root) {
  const fails = [];
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { return null; } };
  const src = read(SRC);
  if (src === null) return [`${SRC} is missing`];
  let m;
  try { m = parsePlist(src); } catch (e) { return [`${SRC} does not parse: ${e.message}`]; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [`${SRC}: the root is not a dict`];

  if (m.NSPrivacyTracking !== false) fails.push(`NSPrivacyTracking must be false, is ${JSON.stringify(m.NSPrivacyTracking)}`);
  if (!Array.isArray(m.NSPrivacyTrackingDomains)) fails.push('NSPrivacyTrackingDomains must be present, as an array');
  else if (m.NSPrivacyTrackingDomains.length) fails.push(`tracking domains declared: ${m.NSPrivacyTrackingDomains.join(', ')}`);

  const types = m.NSPrivacyCollectedDataTypes;
  if (!Array.isArray(types) || !types.length) fails.push('NSPrivacyCollectedDataTypes must list what Cubby collects (accounts and logs are collected)');
  else types.forEach((t, n) => {
    const name = (t && t.NSPrivacyCollectedDataType) || `entry ${n}`;
    if (!/^NSPrivacyCollectedDataType[A-Za-z]+$/.test(String(t && t.NSPrivacyCollectedDataType))) fails.push(`${name}: no NSPrivacyCollectedDataType`);
    if (t.NSPrivacyCollectedDataTypeTracking !== false) fails.push(`${name}: NSPrivacyCollectedDataTypeTracking must be false`);
    if (typeof t.NSPrivacyCollectedDataTypeLinked !== 'boolean') fails.push(`${name}: NSPrivacyCollectedDataTypeLinked must be true or false`);
    const p = t.NSPrivacyCollectedDataTypePurposes;
    if (!Array.isArray(p) || !p.length || p.some((x) => !/^NSPrivacyCollectedDataTypePurpose[A-Za-z]+$/.test(x))) fails.push(`${name}: needs at least one purpose`);
    if (Array.isArray(p) && p.includes('NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising')) fails.push(`${name}: third-party advertising purpose`);
  });

  const apis = m.NSPrivacyAccessedAPITypes;
  if (!Array.isArray(apis)) fails.push('NSPrivacyAccessedAPITypes must be present, as an array');
  else apis.forEach((a) => {
    const c = a && a.NSPrivacyAccessedAPIType;
    if (!API_CATEGORIES.includes(c)) fails.push(`unknown required-reason API category ${JSON.stringify(c)}`);
    const r = a && a.NSPrivacyAccessedAPITypeReasons;
    if (!Array.isArray(r) || !r.length || r.some((x) => !/^[0-9A-F]{4}\.\d$/.test(x))) fails.push(`${c}: needs at least one reason code like C617.1`);
  });

  const rb = read(CONFIGURE) || '';
  if (!/File\.join\(ROOT, 'native-ios', 'PrivacyInfo\.xcprivacy'\)/.test(rb)) fails.push(`${CONFIGURE} no longer reads ${SRC}`);
  if (!/FileUtils\.cp\(PRIVACY_SRC, PRIVACY_DST\)/.test(rb)) fails.push(`${CONFIGURE} no longer copies the manifest into ios/App/App`);
  if (!/target\.add_resources\(\[priv_ref\]\)/.test(rb)) fails.push(`${CONFIGURE} no longer adds the manifest to Copy Bundle Resources`);
  if (!/abort\([^\n]*\) unless target\.resources_build_phase\.files_references\.include\?\(priv_ref\)/.test(rb)) fails.push(`${CONFIGURE} no longer stops when the manifest is not in the App target resources`);

  return fails;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'privacy-manifest-'));
  const src = fs.readFileSync(path.join(ROOT, SRC), 'utf8');
  const rb = fs.readFileSync(path.join(ROOT, CONFIGURE), 'utf8');
  const stage = (name, mut) => {
    const d = path.join(tmp, name);
    const files = { [SRC]: src, [CONFIGURE]: rb };
    mut(files);
    for (const [rel, body] of Object.entries(files)) {
      if (body === null) continue;
      fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true });
      fs.writeFileSync(path.join(d, rel), body);
    }
    return d;
  };
  const swap = (s, a, b) => { if (!s.includes(a)) throw new Error(`self-test cannot stage: ${a.slice(0, 60)} not found`); return s.replace(a, b); };
  const trackKey = '<key>NSPrivacyTracking</key>\n\t<false/>';
  const cases = [
    ['tracking true', (f) => { f[SRC] = swap(src, trackKey, '<key>NSPrivacyTracking</key>\n\t<true/>'); }],
    ['tracking key missing', (f) => { f[SRC] = swap(src, trackKey, ''); }],
    ['malformed XML', (f) => { f[SRC] = swap(src, '</dict>\n</plist>', '</plist>'); }],
    ['manifest missing', (f) => { f[SRC] = null; }],
    ['a tracking domain', (f) => { f[SRC] = swap(src, '<array/>', '<array>\n\t\t<string>ads.example.com</string>\n\t</array>'); }],
    ['a collected type used for tracking', (f) => { f[SRC] = swap(src, '<key>NSPrivacyCollectedDataTypeTracking</key>\n\t\t\t<false/>', '<key>NSPrivacyCollectedDataTypeTracking</key>\n\t\t\t<true/>'); }],
    ['an API with no reason', (f) => { f[SRC] = swap(src, '<string>C617.1</string>', ''); }],
    ['configure does not bundle it', (f) => { f[CONFIGURE] = swap(rb, 'target.add_resources([priv_ref])', 'nil'); }],
    ['configure no longer checks it is bundled', (f) => { f[CONFIGURE] = swap(rb, "abort('✖ PrivacyInfo.xcprivacy is not in the App target resources') unless target.resources_build_phase.files_references.include?(priv_ref)", 'nil'); }],
  ];
  let bad = 0;
  const clean = judge(stage('clean', () => {}));
  if (clean.length) { console.log(`✖ self-test: the clean staged copy should pass, got: ${clean.join('; ')}`); bad++; }
  for (const [name, mut] of cases) {
    const r = judge(stage(name.replace(/\W+/g, '-'), mut));
    if (r.length) console.log(`  ✓ red as it should be: ${name} (${r[0]})`);
    else { console.log(`  ✖ self-test: "${name}" was NOT caught`); bad++; }
  }
  // Local ios/ state must never decide the verdict: a stale project is the main checkout's normal state.
  const stale = stage('stale-ios', () => {});
  for (const d of ['ios/App/App.xcodeproj', 'ios/App/App']) fs.mkdirSync(path.join(stale, d), { recursive: true });
  fs.writeFileSync(path.join(stale, 'ios/App/App.xcodeproj/project.pbxproj'), '// no PrivacyInfo here\n');
  fs.writeFileSync(path.join(stale, 'ios/App/App/PrivacyInfo.xcprivacy'), 'stale');
  const st = judge(stale);
  if (st.length) { console.log(`  ✖ self-test: local ios/ state changed the verdict: ${st.join('; ')}`); bad++; }
  else console.log('  ✓ a stale local ios/ project is ignored (the gate grades tracked files only)');
  // The CLI exit code too, not only judge(): a gate that prints red and exits 0 is green to gates.js.
  const cli = spawnSync(process.execPath, [__filename, `--root=${stage('cli', (f) => { f[SRC] = swap(src, trackKey, '<key>NSPrivacyTracking</key>\n\t<true/>'); })}`], { encoding: 'utf8' });
  if (cli.status === 0) { console.log('  ✖ self-test: the CLI exited 0 on a tracking manifest'); bad++; }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad) { console.log(`✖ privacy manifest self-test: ${bad} problem(s)`); process.exit(1); }
  console.log(`✓ self-test: ${cases.length} staged failures each went red, the clean copy passed`);
}

if (ARGS.includes('--self-test')) selfTest();
const fails = judge(ROOT);
if (fails.length) {
  for (const f of fails) console.log(`✖ ${f}`);
  process.exit(1);
}
const m = parsePlist(fs.readFileSync(path.join(ROOT, SRC), 'utf8'));
console.log(`✓ privacy manifest: tracking false, no tracking domains, ${m.NSPrivacyCollectedDataTypes.length} collected types, ${m.NSPrivacyAccessedAPITypes.length} required-reason API(s); checked the tracked source and configure wiring`);
