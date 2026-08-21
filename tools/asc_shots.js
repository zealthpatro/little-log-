#!/usr/bin/env node
/* Upload the store screenshots to App Store Connect.
 *
 * Apple's asset flow is three steps and every one of them can half-succeed:
 *   1. reserve   POST /appScreenshots with the file name and size -> uploadOperations
 *   2. transfer  PUT each part to the URL Apple hands back, with the exact headers it lists
 *   3. commit    PATCH uploaded:true plus the md5, and Apple then processes it asynchronously
 * A reservation that is never committed sits in the set as a broken asset and blocks submission,
 * which is why this deletes any incomplete screenshot it finds before uploading.
 *
 *   node tools/asc_shots.js            show what is there now
 *   node tools/asc_shots.js --write    replace the 6.7" set with docs/store/shots/*.png
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'store', 'shots');
const APP = '6791454709';
const DISPLAY = 'APP_IPHONE_67';            // 1290 x 2796, the size we shoot
const WRITE = process.argv.includes('--write');

const asc = (args) => {
  const out = execFileSync('node', [path.join(__dirname, 'asc.js')].concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 });
  return out.trim() ? JSON.parse(out) : null;
};
const get = (p) => asc(['get', p]);
const post = (type, body) => asc(['post', type, JSON.stringify(body)]);
const patch = (type, id, body) => asc(['patch', type, id, JSON.stringify(body)]);
const del = (p) => execFileSync('node', [path.join(__dirname, 'asc.js'), 'delete', p], { encoding: 'utf8' });

(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();
  console.log('\n' + files.length + ' screenshots in ' + DIR);

  const vers = get('/apps/' + APP + '/appStoreVersions?limit=1');
  const v = vers.data[0];
  const locs = get('/appStoreVersions/' + v.id + '/appStoreVersionLocalizations');
  const loc = locs.data.find((l) => l.attributes.locale === 'en-US');
  console.log('version ' + v.attributes.versionString + ', locale ' + loc.attributes.locale);

  const sets = get('/appStoreVersionLocalizations/' + loc.id + '/appScreenshotSets');
  let set = sets.data.find((s) => s.attributes.screenshotDisplayType === DISPLAY);
  if (set) {
    const cur = get('/appScreenshotSets/' + set.id + '/appScreenshots');
    console.log('existing ' + DISPLAY + ' set: ' + cur.data.length + ' screenshot(s)');
    cur.data.forEach((s) => console.log('  ' + s.attributes.fileName + '  ' + ((s.attributes.assetDeliveryState || {}).state || '?')));
    if (!WRITE) { console.log('\n(dry run. --write to replace them.)'); return; }
    for (const s of cur.data) { del('/appScreenshots/' + s.id); }
    console.log('cleared ' + cur.data.length + ' existing');
  } else {
    if (!WRITE) { console.log('no ' + DISPLAY + ' set yet.\n\n(dry run. --write to create and fill it.)'); return; }
    set = post('appScreenshotSets', { data: { type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: DISPLAY },
      relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } }).data;
    console.log('created a ' + DISPLAY + ' set');
  }

  for (const f of files) {
    const buf = fs.readFileSync(path.join(DIR, f));
    const res = post('appScreenshots', { data: { type: 'appScreenshots',
      attributes: { fileName: f, fileSize: buf.length },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } }).data;

    for (const op of res.attributes.uploadOperations) {
      const headers = {};
      (op.requestHeaders || []).forEach((h) => { headers[h.name] = h.value; });
      const r = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
      if (!r.ok) throw new Error('upload part failed for ' + f + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
    }
    patch('appScreenshots', res.id, { data: { type: 'appScreenshots', id: res.id,
      attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(buf).digest('hex') } } });
    console.log('  uploaded ' + f + '  (' + Math.round(buf.length / 1024) + 'kb)');
  }

  // Apple processes asynchronously; a set that still says UPLOAD_COMPLETE is fine, FAILED is not.
  const after = get('/appScreenshotSets/' + set.id + '/appScreenshots');
  console.log('\nset now holds ' + after.data.length + ':');
  after.data.forEach((s) => {
    const st = (s.attributes.assetDeliveryState || {});
    console.log('  ' + s.attributes.fileName + '  ' + (st.state || '?')
      + (st.errors && st.errors.length ? '  ERRORS: ' + JSON.stringify(st.errors) : ''));
  });
})().catch((e) => { console.error('\n' + e.message + '\n'); process.exit(1); });
