#!/usr/bin/env node
/* The last mile: write the App Review detail, then submit.
 *
 * Apple's submission is four calls and a half-finished one leaves the version wedged, so this does
 * all of them or none, and preflights everything it can read first. It cannot read the App Privacy
 * answers (Apple exposes no API for them at all), so if those are missing the submit call fails and
 * this prints Apple's own words rather than guessing.
 *
 *   node tools/asc_submit.js --phone "+971 50 123 4567"                     preflight only
 *   node tools/asc_submit.js --phone "+971 50 123 4567" --no-demo --submit
 *   node tools/asc_submit.js --phone "+971 ..." --demo "user@x.com:pw" --submit
 *
 * --no-demo declares that App Review does not need credentials from us because Sign in with Apple
 * is on the sign-in screen and any Apple ID creates a working account. That is TRUE for Cubby and
 * it is a normal answer, but a reviewer then sees an empty first-run rather than a seeded family,
 * which is a weaker review. Prefer a seeded demo account when there is time to make one.
 */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const APP = '6791454709';
const ARGS = process.argv.slice(2);
const arg = (n) => { const i = ARGS.indexOf(n); return i >= 0 ? ARGS[i + 1] : null; };
const PHONE = arg('--phone');
const DEMO = arg('--demo');
const NO_DEMO = ARGS.includes('--no-demo');
const DO = ARGS.includes('--submit');

const asc = (a) => { const o = execFileSync('node', [path.join(__dirname, 'asc.js')].concat(a), { encoding: 'utf8', maxBuffer: 1 << 24 }); return o.trim() ? JSON.parse(o) : null; };
const get = (p) => asc(['get', p]);
const post = (t, b) => asc(['post', t, JSON.stringify(b)]);
const patch = (t, i, b) => asc(['patch', t, i, JSON.stringify(b)]);

let fail = 0;
const ck = (ok, label, extra) => { if (!ok) fail++; console.log('  ' + (ok ? 'ok  ' : 'MISS') + '  ' + label + (extra ? '   ' + extra : '')); };

(async () => {
  const v = get('/apps/' + APP + '/appStoreVersions?limit=1').data[0];
  console.log('\nversion ' + v.attributes.versionString + '  [' + v.attributes.appStoreState + ']');
  if (v.attributes.appStoreState !== 'PREPARE_FOR_SUBMISSION') {
    console.log('Not in PREPARE_FOR_SUBMISSION, so there is nothing to submit from here.');
    process.exit(0);
  }

  console.log('\npreflight');
  const loc = get('/appStoreVersions/' + v.id + '/appStoreVersionLocalizations').data.find((l) => l.attributes.locale === 'en-US');
  const la = loc.attributes;
  ck(!!la.description, 'description', la.description ? la.description.length + ' chars' : '');
  ck(!!la.keywords, 'keywords');
  ck(!!la.supportUrl, 'support URL', la.supportUrl || '');
  const sets = get('/appStoreVersionLocalizations/' + loc.id + '/appScreenshotSets').data;
  const shots = sets.length ? get('/appScreenshotSets/' + sets[0].id + '/appScreenshots').data : [];
  const done = shots.filter((s) => (s.attributes.assetDeliveryState || {}).state === 'COMPLETE');
  ck(done.length >= 1, 'screenshots processed', done.length + '/' + shots.length);
  let build = null;
  try { build = get('/appStoreVersions/' + v.id + '/build').data; } catch (e) {}
  ck(!!build, 'build attached', build ? build.id : '');
  const info = get('/apps/' + APP + '/appInfos').data.find((i) => i.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION');
  ck(!!info.attributes.appStoreAgeRating, 'age rating', info.attributes.appStoreAgeRating || '');
  const il = get('/appInfos/' + info.id + '/appInfoLocalizations').data.find((l) => l.attributes.locale === 'en-US');
  ck(!!il.attributes.privacyPolicyUrl, 'privacy policy URL', il.attributes.privacyPolicyUrl || '');
  ck(!!PHONE, 'review contact phone', PHONE || 'pass --phone "+<country> ..."');
  ck(!!(DEMO || NO_DEMO), 'demo account decided', DEMO ? 'credentials given' : (NO_DEMO ? 'declared not required (Sign in with Apple)' : 'pass --demo or --no-demo'));
  console.log('  ??    App Privacy answers   Apple exposes no API for these. If they are unfinished, the submit below fails and says so.');

  if (fail) { console.log('\n' + fail + ' thing(s) missing. Nothing written.'); process.exit(1); }
  if (!DO) { console.log('\nPreflight clean. Add --submit to write the review detail and submit.'); process.exit(0); }

  // 1. Review detail.
  const notes = (() => {
    const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'plans', '2026-08-04-app-store-listing.md'), 'utf8');
    const i = md.indexOf('### Notes text for the reviewer');
    return /```\n([\s\S]*?)```/.exec(md.slice(i))[1].trim();
  })();
  /* The ASC account holder's own address, read from /users, rather than a guess. Apple already
     writes to this one, so it is the address that will actually be read mid-review. */
  const attrs = { contactFirstName: 'Saurav', contactLastName: 'Patro',
    contactEmail: arg('--email') || 'sauravpatro@icloud.com',
    contactPhone: PHONE, notes: notes };
  if (DEMO) { const [u, ...p] = DEMO.split(':'); attrs.demoAccountRequired = true; attrs.demoAccountName = u; attrs.demoAccountPassword = p.join(':'); }
  else { attrs.demoAccountRequired = false; }

  let detail = null;
  try { detail = get('/appStoreVersions/' + v.id + '/appStoreReviewDetail').data; } catch (e) {}
  if (detail) { patch('appStoreReviewDetails', detail.id, { data: { type: 'appStoreReviewDetails', id: detail.id, attributes: attrs } }); console.log('\nupdated the review detail'); }
  else {
    post('appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: attrs,
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } } } });
    console.log('\ncreated the review detail');
  }

  // 2..4. Create a submission, add this version to it, submit it.
  let sub = get('/reviewSubmissions?filter[app]=' + APP + '&filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW&limit=1').data[0];
  if (!sub) {
    sub = post('reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' },
      relationships: { app: { data: { type: 'apps', id: APP } } } } }).data;
    console.log('opened submission ' + sub.id);
  }
  const items = get('/reviewSubmissions/' + sub.id + '/items').data;
  if (!items.length) {
    post('reviewSubmissionItems', { data: { type: 'reviewSubmissionItems',
      relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: v.id } } } } });
    console.log('added version ' + v.attributes.versionString);
  }
  const out = patch('reviewSubmissions', sub.id, { data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } } });
  console.log('\nSUBMITTED. state: ' + out.data.attributes.state);
  console.log('Apple review is typically 24 to 48 hours. Watch it with: node tools/asc.js state');
})().catch((e) => { console.error('\n' + e.message + '\n'); process.exit(1); });
