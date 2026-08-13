/* The dose ticket, which is the only thing standing between a notification button and a stranger
 * writing into a family's health record.
 *
 * The device has no identity to offer: the wrapper sets skipNativeAuth deliberately so the JS SDK
 * stays the single source of truth, and FirebaseFirestore is not even linked into the binary. So the
 * server states in advance, under its own signature, exactly one thing it is willing to do, and the
 * device echoes that statement back. Everything below is about that statement being unforgeable and
 * un-editable.
 *
 * A mirror of mintDoseTicket/readDoseTicket in worker.js, driven directly so every rejection path is
 * reachable without a Worker runtime. Source assertions at the bottom keep the mirror honest.
 *
 *   node test/dose-ticket.test.js
 */
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
const crypto = webcrypto;

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

const INFO = 'cubby-dose-ticket-v1';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key-just-bytes-to-derive-from\n-----END PRIVATE KEY-----\n';

function b64urlFromBytes(b) {
  let s = ''; const a = new Uint8Array(b); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return Buffer.from(s, 'binary').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return new Uint8Array(Buffer.from(s, 'base64'));
}
const b64urlToStr = (s) => new TextDecoder().decode(b64urlToBytes(s));

async function key(privateKey) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(privateKey)), { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(INFO) }, base, 256);
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function mint(pk, claims) {
  const body = b64urlFromBytes(new TextEncoder().encode(JSON.stringify(Object.assign({}, claims, { x: (Number(claims.t) || Date.now()) + 6 * 3600000 }))));
  const sig = await crypto.subtle.sign('HMAC', await key(pk), new TextEncoder().encode('v1.' + body));
  return 'v1.' + body + '.' + b64urlFromBytes(sig);
}
async function read(pk, t) {
  if (typeof t !== 'string' || t.length > 2048) return null;
  const p = t.split('.');
  if (p.length !== 3 || p[0] !== 'v1') return null;
  const okSig = await crypto.subtle.verify('HMAC', await key(pk), b64urlToBytes(p[2]), new TextEncoder().encode('v1.' + p[1]));
  if (!okSig) return null;
  let c; try { c = JSON.parse(b64urlToStr(p[1])); } catch (e) { return null; }
  if (!c || typeof c !== 'object') return null;
  if (!(Number(c.x) > Date.now())) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(c.u || ''))) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(c.h || ''))) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(c.m || ''))) return null;
  return c;
}

const CLAIMS = { u: 'uid123', h: 'hhABC', m: 'med9', b: 'baby1', mn: 'Calpol', d: '5', n: 'ml', t: Date.now(), i: 21600000 };

(async () => {
  console.log('\n1. a ticket this server made is accepted, unchanged');
  {
    const t = await mint(FAKE_KEY, CLAIMS);
    const c = await read(FAKE_KEY, t);
    ok('round trips', !!c, c);
    ok('and every claim survives exactly', c && c.u === CLAIMS.u && c.h === CLAIMS.h && c.m === CLAIMS.m && c.b === CLAIMS.b && c.mn === CLAIMS.mn);
  }

  console.log('\n2. it cannot be edited into a DIFFERENT write');
  {
    const t = await mint(FAKE_KEY, CLAIMS);
    const p = t.split('.');
    const claims = JSON.parse(b64urlToStr(p[1]));
    // The attack that matters: same signature, someone else's household.
    claims.h = 'someone-elses-household';
    const forged = 'v1.' + b64urlFromBytes(new TextEncoder().encode(JSON.stringify(claims))) + '.' + p[2];
    ok('swapping the household is rejected', (await read(FAKE_KEY, forged)) === null);

    const c2 = JSON.parse(b64urlToStr(p[1])); c2.m = 'another-medicine';
    ok('swapping the medicine is rejected',
       (await read(FAKE_KEY, 'v1.' + b64urlFromBytes(new TextEncoder().encode(JSON.stringify(c2))) + '.' + p[2])) === null);

    const c3 = JSON.parse(b64urlToStr(p[1])); c3.x = Date.now() + 10 * 365 * 86400000;
    ok('extending its life is rejected',
       (await read(FAKE_KEY, 'v1.' + b64urlFromBytes(new TextEncoder().encode(JSON.stringify(c3))) + '.' + p[2])) === null);
  }

  console.log('\n3. a ticket signed by anyone else is worthless');
  {
    const t = await mint('-----BEGIN PRIVATE KEY-----\nattacker\n-----END PRIVATE KEY-----\n', CLAIMS);
    ok('a different key does not verify', (await read(FAKE_KEY, t)) === null);
  }

  console.log('\n4. it stops working');
  {
    const old = await mint(FAKE_KEY, Object.assign({}, CLAIMS, { t: Date.now() - 7 * 3600000 }));
    ok('six hours after the dose it is dead', (await read(FAKE_KEY, old)) === null);
    const fresh = await mint(FAKE_KEY, Object.assign({}, CLAIMS, { t: Date.now() - 3 * 3600000 }));
    ok('but a genuinely late tap still works', (await read(FAKE_KEY, fresh)) !== null);
  }

  console.log('\n5. malformed input is refused without throwing');
  for (const bad of ['', 'x', 'v1.a', 'v2.a.b', 'v1..', 'v1.!!!.!!!', null, undefined, 12345, 'v1.' + 'a'.repeat(4000) + '.b']) {
    const r = await read(FAKE_KEY, bad).catch(() => 'THREW');
    ok('refuses ' + JSON.stringify(String(bad).slice(0, 18)), r === null, r);
  }

  console.log('\n6. the document id is deterministic, which is what makes a double tap harmless');
  {
    const id = (c) => 'dose-' + c.m + '-' + (Number(c.t) || 0);
    const a = await read(FAKE_KEY, await mint(FAKE_KEY, CLAIMS));
    const b = await read(FAKE_KEY, await mint(FAKE_KEY, CLAIMS));
    ok('two mints of the same dose address the same document', id(a) === id(b), [id(a), id(b)]);
    const other = await read(FAKE_KEY, await mint(FAKE_KEY, Object.assign({}, CLAIMS, { t: CLAIMS.t + 3600000 })));
    ok('a different dose time addresses a different one', id(a) !== id(other));
  }

  console.log('\n7. worker.js really works this way');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
    ok('the key is DERIVED, so there is no eighth secret to go missing', src.includes("const DOSE_TICKET_INFO = 'cubby-dose-ticket-v1'"));
    ok('signature check is constant time (subtle.verify, not a string compare)', src.includes("crypto.subtle.verify('HMAC', key,"));
    ok('expiry is enforced', src.includes('if (!(Number(c.x) > Date.now())) return null;'));
    ok('the endpoint accepts ONLY the ticket, so the caller cannot choose what is written',
       src.includes('const c = await readDoseTicket(sa, (body && body.n) || \'\');'));
    ok('the document id is deterministic', src.includes("const docId = 'dose-' + c.m + '-' + (Number(c.t) || 0);"));
    ok('ALREADY_EXISTS counts as success, so a retry is not an error',
       src.includes("if (r.status === 409 || /ALREADY_EXISTS/.test(txt)) return json({ ok: true, already: true });"));
    ok('every rejection returns the same message', src.includes("return json({ error: 'bad_ticket' }, 401);"));
    ok('a ticket is minted only for a real per-medicine reminder', src.includes('const ticket = msg.medId ? await mintDoseTicket'));
    ok('the digest therefore carries no category and no button', src.includes('} : {}) })'));

    const sw = fs.readFileSync(path.join(__dirname, '..', 'app', 'sw.js'), 'utf8');
    ok('the web button appears only when a ticket came with the push', sw.includes("if (d.nonce) opts.actions = [{ action: 'dose', title: 'Log it' }];"));
    ok('and tapping it does NOT open a window', sw.includes("if (e.action === 'dose' && d.nonce) {"));

    const app = fs.readFileSync(path.join(__dirname, '..', 'app', 'index.html'), 'utf8');
    ok('the client states babyId rather than inheriting it', app.includes('babyId:(m.babyId||state.activeBabyId)'));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'DOSE-TICKET: FAIL' : 'DOSE-TICKET: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
