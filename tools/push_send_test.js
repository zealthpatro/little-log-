/* Send a REAL push to a REAL registered device, to prove the last mile.
 *
 * Everything upstream is already proven: tools/push_e2e.js shows web push arriving end to end, and
 * the Worker's cron, caps and consent are gated by test/push-caps.test.js. What no test can prove
 * from this machine is that an iOS wrapper build registers with APNs and receives what we send.
 * That needs a phone. This is the other half of that test.
 *
 *   node tools/push_send_test.js            list the devices that have registered
 *   node tools/push_send_test.js --send     send a test push to every registered device
 *   node tools/push_send_test.js --send ios send only to devices that look like the wrapper
 *
 * Reads users/{uid}.push.tokens with the service account. Prints only a token PREFIX and a coarse
 * platform guess, never a whole token and never anything else from the document.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SA_PATH = path.join(__dirname, 'serviceAccountKey.json');
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const uns = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify(claim));
  const jwt = uns + '.' + b64u(crypto.createSign('RSA-SHA256').update(uns).sign(sa.private_key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('no access token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

(async () => {
  if (!fs.existsSync(SA_PATH)) { console.error('tools/serviceAccountKey.json is missing'); process.exit(1); }
  const sa = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
  const send = process.argv.includes('--send');
  const onlyIos = process.argv.includes('ios');
  const tok = await accessToken(sa, 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging');
  const base = 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents';

  let pageToken = '', devices = [];
  do {
    const r = await fetch(base + '/users?pageSize=100' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''),
      { headers: { authorization: 'Bearer ' + tok } });
    const j = await r.json();
    for (const d of (j.documents || [])) {
      const uid = d.name.split('/documents/users/')[1];
      const push = d.fields && d.fields.push && d.fields.push.mapValue && d.fields.push.mapValue.fields;
      const tm = push && push.tokens && push.tokens.mapValue && push.tokens.mapValue.fields;
      if (!tm) continue;
      const enabled = !!(push.enabled && push.enabled.booleanValue);
      const tz = (push.tz && push.tz.stringValue) || '';
      for (const t of Object.keys(tm)) {
        const meta = tm[t].mapValue && tm[t].mapValue.fields;
        const ua = (meta && meta.ua && meta.ua.stringValue) || '';
        // The wrapper is a WKWebView, so its UA carries iPhone/iPad and no Chrome/Safari version.
        const platform = /iPhone|iPad/i.test(ua) ? 'ios' : (/Android/i.test(ua) ? 'android' : 'web');
        devices.push({ uid: uid.slice(0, 6) + '…', token: t, prefix: t.slice(0, 14) + '…', platform, enabled, tz, ua: ua.slice(0, 60) });
      }
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);

  if (!devices.length) {
    console.log('\nNo device has registered for push yet.');
    console.log('On the phone: open Cubby, Settings then Reminders, turn Dose alerts on, and accept the iOS prompt.');
    console.log('Then run this again.');
    process.exit(0);
  }

  console.log('\nregistered devices (' + devices.length + '):');
  for (const d of devices) console.log(`  ${d.platform.padEnd(7)} ${d.prefix}  enabled=${d.enabled}  tz=${d.tz || '-'}  uid=${d.uid}`);

  if (!send) { console.log('\nRe-run with --send to send a real test push.'); process.exit(0); }

  const targets = onlyIos ? devices.filter((d) => d.platform === 'ios') : devices;
  if (!targets.length) { console.log('\nnothing matched that filter'); process.exit(0); }

  console.log('\nsending to ' + targets.length + ' device(s)…');
  let ok = 0;
  for (const d of targets) {
    const r = await fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
      method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: d.token,
        notification: { title: 'Cubby', body: 'Push works. This is the test nudge.' },
        data: { tag: 'cubby-test', cat: 'critical' },
        // Time-sensitive so a dose reminder is not held by Focus. Harmless if the entitlement is absent.
        apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default', 'interruption-level': 'time-sensitive' } } },
        webpush: { fcmOptions: { link: 'https://little-cubby.com/app/' } } } })
    });
    const body = await r.text();
    if (r.ok) { ok++; console.log(`  ok   ${d.platform} ${d.prefix}`); }
    else {
      // The two that matter: UNREGISTERED means a dead token, SENDER_ID_MISMATCH/THIRD_PARTY_AUTH_ERROR
      // usually means the APNs key is missing or the entitlement environment is wrong.
      let why = '';
      try { const j = JSON.parse(body); why = (j.error && (j.error.status || j.error.message)) || ''; } catch (e) {}
      const det = (() => { try { return JSON.parse(body).error.details.map((x) => x.errorCode).filter(Boolean).join(','); } catch (e) { return ''; } })();
      console.log(`  FAIL ${d.platform} ${d.prefix}  ${r.status} ${why} ${det}`);
      if (/THIRD_PARTY_AUTH_ERROR/.test(body)) console.log('       -> APNs rejected it: the .p8 in Firebase, or the aps-environment in the build, does not match.');
      if (/UNREGISTERED|INVALID_ARGUMENT/.test(body)) console.log('       -> dead token: the app was deleted, or this token belongs to a different build.');
    }
  }
  console.log('\n' + ok + '/' + targets.length + ' accepted by FCM. Check the phone.');
})().catch((e) => { console.error('failed:', (e && e.message) || e); process.exit(1); });
