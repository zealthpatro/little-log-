#!/usr/bin/env node
/* App Store Connect from the terminal, so a submission is a reviewable command rather than forty
 * minutes of clicking a form nobody can diff.
 *
 * The key never leaves ~/.appstore-keys. It is NEVER read from the repo: this Worker serves the
 * whole checkout, so a .p8 committed here would be downloadable at little-cubby.com/AuthKey_*.p8.
 *
 *   node tools/asc.js state                     what is filled in, what is missing, what blocks
 *   node tools/asc.js builds                    uploaded builds and their processing state
 *   node tools/asc.js get <path>                raw GET against the v1 API
 *   node tools/asc.js patch <type> <id> <json>  raw PATCH
 *
 * ASC signs with ES256. Node's crypto emits DER for EC signatures and JOSE wants raw r||s, so the
 * signature is unpacked by hand below; getting that wrong yields a 401 that looks like a bad key.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEY_ID = process.env.ASC_KEY_ID || '33AU4Z9QJ4';           // Admin key; App-Manager cannot cloud-sign
const ISSUER = process.env.ASC_ISSUER || '6b58eca9-6e61-450a-8b7c-f49fcb03a7e6';
const KEY_PATH = path.join(os.homedir(), '.appstore-keys', 'AuthKey_' + KEY_ID + '.p8');
const BUNDLE = process.env.ASC_BUNDLE || 'com.littlecubby.app';
const API = 'https://api.appstoreconnect.apple.com/v1';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

function derToRaw(der) {
  // SEQUENCE { INTEGER r, INTEGER s } -> r||s, each left-padded to 32 bytes.
  let o = 2; if (der[1] & 0x80) o = 2 + (der[1] & 0x7f);
  const rl = der[o + 1]; let r = der.slice(o + 2, o + 2 + rl);
  const so = o + 2 + rl; const sl = der[so + 1]; let s = der.slice(so + 2, so + 2 + sl);
  const pad = (x) => x.length >= 32 ? x.slice(x.length - 32) : Buffer.concat([Buffer.alloc(32 - x.length), x]);
  return Buffer.concat([pad(r), pad(s)]);
}
function token() {
  if (!fs.existsSync(KEY_PATH)) {
    console.error('\nNo key at ' + KEY_PATH + '.\nThe .p8 lives there and never in the repo.\n');
    process.exit(2);
  }
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }));
  const sig = crypto.createSign('SHA256').update(head + '.' + body).sign({ key: fs.readFileSync(KEY_PATH), dsaEncoding: 'der' });
  return head + '.' + body + '.' + b64u(derToRaw(sig));
}
async function api(method, p, body) {
  const r = await fetch(p.startsWith('http') ? p : API + p, {
    method,
    headers: Object.assign({ authorization: 'Bearer ' + token() }, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = { raw: txt }; }
  if (!r.ok) {
    const errs = (j && j.errors) ? j.errors.map((e) => e.title + ': ' + (e.detail || '')).join('\n  ') : txt.slice(0, 300);
    throw new Error(method + ' ' + p + ' -> ' + r.status + '\n  ' + errs);
  }
  return j;
}
const get = (p) => api('GET', p);

async function app() {
  const r = await get('/apps?filter[bundleId]=' + encodeURIComponent(BUNDLE) + '&limit=1');
  if (!r.data.length) throw new Error('No app record for ' + BUNDLE + '. It must be created once in App Store Connect.');
  return r.data[0];
}
const YES = (v) => v ? 'yes' : 'NO';

async function state() {
  const a = await app();
  console.log('\n' + a.attributes.name + '  (' + BUNDLE + ')');
  console.log('  sku ' + a.attributes.sku + '   primary locale ' + a.attributes.primaryLocale + '   id ' + a.id);

  const vers = await get('/apps/' + a.id + '/appStoreVersions?limit=5');
  if (!vers.data.length) { console.log('\nNO VERSION RECORD. Nothing can be submitted until one exists.'); return; }
  for (const v of vers.data) {
    const at = v.attributes;
    console.log('\nversion ' + at.versionString + '  [' + at.appStoreState + ']  ' + (at.releaseType || ''));
    const locs = await get('/appStoreVersions/' + v.id + '/appStoreVersionLocalizations');
    for (const l of locs.data) {
      const la = l.attributes;
      console.log('  ' + la.locale + ':');
      console.log('    description   ' + (la.description ? la.description.length + ' chars' : 'MISSING'));
      console.log('    keywords      ' + (la.keywords ? '"' + la.keywords + '" (' + la.keywords.length + '/100)' : 'MISSING'));
      console.log('    whatsNew      ' + (la.whatsNew ? la.whatsNew.length + ' chars' : '(none, fine for 1.0)'));
      console.log('    promo text    ' + (la.promotionalText ? la.promotionalText.length + ' chars' : '(none, optional)'));
      console.log('    support URL   ' + (la.supportUrl || 'MISSING'));
      console.log('    marketing URL ' + (la.marketingUrl || '(none, optional)'));
      const sets = await get('/appStoreVersionLocalizations/' + l.id + '/appScreenshotSets');
      if (!sets.data.length) console.log('    screenshots   NONE. At least one 6.9" set is required.');
      for (const s of sets.data) {
        const shots = await get('/appScreenshotSets/' + s.id + '/appScreenshots');
        const done = shots.data.filter((x) => (x.attributes.assetDeliveryState || {}).state === 'COMPLETE').length;
        console.log('    screenshots   ' + s.attributes.screenshotDisplayType + ': ' + shots.data.length + ' (' + done + ' processed)');
      }
    }
    // What actually gates the submit button.
    try {
      const b = await get('/appStoreVersions/' + v.id + '/build');
      console.log('  build         ' + (b.data ? b.data.id : 'NONE ATTACHED'));
    } catch (e) { console.log('  build         NONE ATTACHED'); }
    try {
      const rd = await get('/appStoreVersions/' + v.id + '/appStoreReviewDetail');
      const r = rd.data ? rd.data.attributes : {};
      console.log('  review contact ' + (r.contactEmail || 'MISSING') + ' / ' + (r.contactPhone || 'MISSING'));
      console.log('  demo account   ' + (r.demoAccountRequired === false ? 'declared not required'
        : (r.demoAccountName ? 'set' : 'MISSING (App Review must be able to sign in)')));
      console.log('  review notes   ' + (r.notes ? r.notes.length + ' chars' : 'MISSING'));
    } catch (e) { console.log('  review detail  NOT CREATED'); }
  }

  const infos = await get('/apps/' + a.id + '/appInfos');
  for (const i of infos.data) {
    const ia = i.attributes;
    console.log('\napp info [' + ia.appStoreState + ']');
    console.log('  age rating    ' + (ia.appStoreAgeRating || 'MISSING'));
    console.log('  content rights ' + (ia.brazilAgeRating ? '' : '') + (ia.appStoreAgeRating ? '' : ''));
    const cats = await get('/appInfos/' + i.id + '?include=primaryCategory,secondaryCategory');
    const inc = cats.included || [];
    console.log('  categories    ' + (inc.length ? inc.map((c) => c.id).join(', ') : 'MISSING'));
    const locs = await get('/appInfos/' + i.id + '/appInfoLocalizations');
    for (const l of locs.data) {
      console.log('  ' + l.attributes.locale + ': name "' + (l.attributes.name || 'MISSING')
        + '"  subtitle "' + (l.attributes.subtitle || '(none)') + '"'
        + '  privacy URL ' + (l.attributes.privacyPolicyUrl || 'MISSING'));
    }
  }
}

async function builds() {
  const a = await app();
  const r = await get('/builds?filter[app]=' + a.id + '&limit=10&sort=-uploadedDate');
  if (!r.data.length) { console.log('\nNo builds uploaded at all.'); return; }
  console.log('\nversion  build  state                 uploaded             expired');
  for (const b of r.data) {
    const at = b.attributes;
    console.log('  ' + String(at.version).padEnd(8) + String(at.processingState).padEnd(12)
      + String(at.uploadedDate || '').slice(0, 19).padEnd(21) + (at.expired ? 'EXPIRED' : ''));
  }
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (!cmd || cmd === 'state') await state();
    else if (cmd === 'builds') await builds();
    else if (cmd === 'get') console.log(JSON.stringify(await get(rest[0]), null, 1));
    else if (cmd === 'patch') console.log(JSON.stringify(await api('PATCH', '/' + rest[0] + '/' + rest[1], JSON.parse(rest[2])), null, 1));
    else if (cmd === 'post') console.log(JSON.stringify(await api('POST', '/' + rest[0], JSON.parse(rest[1])), null, 1));
    else if (cmd === 'delete') { await api('DELETE', rest[0]); console.log('deleted ' + rest[0]); }
    else { console.error('unknown command: ' + cmd); process.exit(2); }
  } catch (e) { console.error('\n' + e.message + '\n'); process.exit(1); }
})();
