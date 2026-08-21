/* One sign-in email that is right in every case, and the routing that must never lie about it.
 *
 * WHY THIS EXISTS. The founder's report was "we say we send a code but we never send a code, we only
 * send a link." Two senders had grown side by side in worker.js — subject 'Your Cubby sign-in link'
 * and subject 'Your Cubby sign-in code' — each with its own template, chosen by a client-side guess
 * about which storage container the parent was standing in. A guess is the wrong instrument: which
 * half works depends on WHERE SHE READS THE MAIL, which we cannot see from the server or the page.
 * Ask on the laptop and read on the phone, and the link signs the phone in while the laptop never
 * moves. Ask from an installed iOS app and the link opens Safari, whose storage jar the app cannot
 * see (docs/postmortems/2026-08-19-installed-ios-pwa-cannot-sign-in.md).
 *
 * So the email carries BOTH, and this gate holds three things that must not drift apart again:
 *   1. the template really does render both halves, and degrades to the half that survived
 *   2. BOTH senders use that one template, under one subject
 *   3. no screen can promise a code that the email in her inbox does not carry
 *
 * Plus the code's security properties, because adding the link must not have loosened any of them:
 * HMAC'd, address-bound, plaintext never stored, single-use, replace-not-merge, tries spent first.
 *
 *   node test/signin-email.test.js
 *   node test/signin-email.test.js --self-test   (prove the assertions can actually fail)
 */
const fs = require('fs');
const path = require('path');
const { webcrypto: crypto } = require('crypto');

const SELF = process.argv.includes('--self-test');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

const WORKER = fs.readFileSync(path.join(__dirname, '..', 'worker.js'), 'utf8');
const STORE = fs.readFileSync(path.join(__dirname, '..', 'app', 'store-firebase.js'), 'utf8');

/* The real template, lifted out of worker.js and evaluated. Not a paraphrase: if the source stops
   parsing out of this file the gate fails loudly rather than grading a stale copy of itself. */
function loadTemplate(src) {
  const start = src.indexOf('function signinEmailHtml(code, link) {');
  if (start < 0) return null;
  // Walk braces to the end of the function so the gate never depends on what follows it.
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(start, end) + '; return signinEmailHtml;')();
}

const CODE = '481902';
const LINK = 'https://little-cubby.com/__/auth/action?mode=signIn&oobCode=abc123';

(async () => {
  const signinEmailHtml = loadTemplate(WORKER);
  ok('worker.js still defines signinEmailHtml(code, link)', typeof signinEmailHtml === 'function');
  if (typeof signinEmailHtml !== 'function') { console.log('\nSIGNIN-EMAIL: FAIL'); process.exit(1); }

  console.log('\n1. one email carries BOTH, so it is right wherever she reads it');
  {
    const html = signinEmailHtml(CODE, LINK);
    ok('the 6-digit code is in the email', html.includes(CODE));
    ok('the link is a real tappable href', html.includes('href="' + LINK + '"'));
    ok('the link is also spelled out for copy/paste', html.split(LINK).length - 1 >= 2);
    /* Order matters, and it is not decoration. The code is the half that works from ANY device; the
       link only works on the one she is holding. Whichever is on top is the one she reaches for. */
    ok('the code comes FIRST, above the link', html.indexOf(CODE) < html.indexOf('href="' + LINK));
    ok('it says how long the code lasts and that it is single use', /10 minutes, once/.test(html));
    ok('and it tells someone who did not ask that ignoring it is safe', /ignore this email/.test(html));
    ok('still the table-based template the other Cubby emails use', html.includes('<table role="presentation"') && html.includes('🐻'));
  }

  console.log('\n2. it degrades to the half that survived, rather than rendering a broken one');
  {
    const codeOnly = signinEmailHtml(CODE, '');
    ok('code-only: the code is there', codeOnly.includes(CODE));
    ok('code-only: NO empty href is emitted', !codeOnly.includes('href=""') && !/href="\s*"/.test(codeOnly));
    ok('code-only: no dangling "or tap instead" with nothing to tap', !/Tap instead|Tap the button/.test(codeOnly));

    const linkOnly = signinEmailHtml('', LINK);
    ok('link-only: the link is there', linkOnly.includes('href="' + LINK + '"'));
    ok('link-only: no empty code block is drawn', !/YOUR SIGN-IN CODE/.test(linkOnly));
    ok('link-only: it reads as a link email on its own terms', /Tap the button to sign in/.test(linkOnly));
    ok('link-only: and does not promise a code', !/10 minutes, once/.test(linkOnly));

    const neither = signinEmailHtml('', '');
    ok('neither half: still valid HTML, no half-drawn furniture', neither.includes('</html>') && !neither.includes('href=""'));
  }

  console.log('\n3. BOTH senders use that one template, under one subject');
  {
    const subjects = WORKER.match(/subject: 'Your Cubby sign-in[^']*'/g) || [];
    ok('there are exactly two sign-in sends', subjects.length === 2, subjects);
    ok('and they carry the SAME subject', subjects.length === 2 && subjects[0] === subjects[1], subjects);
    ok('the subject is about signing in', subjects.every((s) => /sign-in/.test(s)));
    const uses = WORKER.match(/html: signinEmailHtml\(code, link\)/g) || [];
    ok('both sends render the shared both-halves template', uses.length === 2, uses.length);
    ok('the old link-only template is gone', !/function emailHtml\(link\)/.test(WORKER));
    ok('the old code-only template is gone', !/function signinCodeHtml\(/.test(WORKER));

    ok('the LINK endpoint now also mints a code', /let link = await generateSignInLink[\s\S]{0,900}?const code = await issueSigninCode\(sa, token, email\);/.test(WORKER));
    ok('the CODE endpoint now also mints a link', /const code = await issueSigninCode\(sa, token, email\);[\s\S]{0,900}?link = await generateSignInLink/.test(WORKER));
    /* Each endpoint keeps the half it is named for as the hard requirement and treats the other as a
       bonus, so one slow dependency degrades the email instead of costing her the sign-in. */
    ok('no code means no email from the CODE endpoint', WORKER.includes("if (!code) return json({ error: 'store_failed' }, 502);"));
    ok('but a missing code only costs the LINK endpoint its code half', /catch \(e\) \{ return ''; \}/.test(WORKER));
    ok('and a missing link only costs the CODE endpoint its link half', /catch \(e\) \{ link = ''; \}/.test(WORKER));
  }

  console.log('\n4. adding the link did not loosen a single property of the code');
  {
    ok('one place mints and stores a code, so the two senders cannot drift', (WORKER.match(/async function issueSigninCode\(/g) || []).length === 1);
    /* The whole single-live-code rule rests on this PATCH carrying no updateMask: with one it would
       MERGE, leaving the previous mac in place and two codes alive at once. */
    const issue = WORKER.slice(WORKER.indexOf('async function issueSigninCode('), WORKER.indexOf('/* Same-origin + per-IP volume'));
    ok('the issue PATCH carries NO updateMask, so a new code REPLACES the old one', issue.includes("method: 'PATCH'") && !issue.includes('updateMask'));
    ok('only the MAC is stored, never the code itself', issue.includes('mac: { stringValue: mac }') && !/code: \{ stringValue: code \}/.test(issue));
    ok('the code is fresh per issue', issue.includes('const code = newSigninCode();'));
    ok('the TTL and the try budget are set at issue', issue.includes('SIGNIN_CODE_TTL_MS') && issue.includes('SIGNIN_CODE_TRIES'));

    ok('the address is inside the MAC, so a code cannot be replayed at another address', WORKER.includes("new TextEncoder().encode('code:' + email + ':' + code)"));
    ok('verification is constant time', WORKER.includes("crypto.subtle.verify('HMAC', key, _b64urlToBytes(storedMac),"));
    ok('the attempt is spent BEFORE the compare', WORKER.indexOf("?updateMask.fieldPaths=tries") < WORKER.indexOf("const ok = await crypto.subtle.verify('HMAC', key, _b64urlToBytes(storedMac)"));
    ok('a good code is burned, always', /await dead\(\);\s*\/\/ single use, always/.test(WORKER));
    ok('both new endpoints sit behind the same-origin guard', (WORKER.match(/const bad = await signinGuard\(request, env\); if \(bad\) return bad;/g) || []).length === 2);
    const cools = WORKER.match(/await cache\.put\(cooldown,/g) || [];
    ok('both senders still arm a per-address cooldown', cools.length === 2, cools.length);
    ok('and only ever after a real send', !/await cache\.put\(cooldown[\s\S]{0,200}?if \(!r\.ok\)/.test(WORKER));
  }

  console.log('\n5. the MAC actually does what the gate above claims');
  {
    const FAKE = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key-just-bytes\n-----END PRIVATE KEY-----\n';
    const key = async () => {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(FAKE), { name: 'HKDF' }, false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('cubby-signin-code-v1') }, base, 256);
      return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    };
    const mac = async (email, code) => crypto.subtle.sign('HMAC', await key(), new TextEncoder().encode('code:' + email + ':' + code));
    const verify = async (sig, email, code) => crypto.subtle.verify('HMAC', await key(), sig, new TextEncoder().encode('code:' + email + ':' + code));

    const sig = await mac('mum@example.com', CODE);
    ok('the right code at the right address verifies', await verify(sig, 'mum@example.com', CODE));
    ok('a wrong code does not', !(await verify(sig, 'mum@example.com', '000000')));
    ok('and the SAME code at a different address does not', !(await verify(sig, 'someone@else.com', CODE)));
    ok('the stored MAC reveals nothing that looks like the code', !Buffer.from(sig).toString('base64').includes(CODE));

    const draws = new Set();
    for (let i = 0; i < 400; i++) {
      const a = new Uint32Array(1); let n;
      do { crypto.getRandomValues(a); n = a[0]; } while (n >= 4294000000);
      draws.add(String(n % 1000000).padStart(6, '0'));
    }
    ok('codes are six digits and not repeating', draws.size > 380 && [...draws].every((d) => /^[0-9]{6}$/.test(d)), draws.size);
  }

  console.log('\n6. no screen promises a code the inbox does not carry');
  {
    // Call sites only; the `function showCodeEntry(` declaration is not one of them.
    ok('the code panel is reachable only from the code endpoint', (STORE.match(/(?<!function )showCodeEntry\(/g) || []).length === 1
      && /sendCode\(email\)\s*\n\s*\.then\(function \(d\) \{[^}]*showCodeEntry\(email, d && d\.cached\)/.test(STORE));
    ok('sendCode has no link fallback to fall into', /function sendCode\(email\) \{[\s\S]{0,400}?\}\n/.test(STORE)
      && !/function sendCode\([\s\S]{0,400}?sendSignInLinkToEmail/.test(STORE));
    /* Firebase's own sender mails a bare link. If we ever fall back to it there is no code in her
       inbox, so there must be no code box on her screen — the same bug, wearing the other shoe. */
    ok('the Firebase fallback is labelled as link-only', STORE.includes('return { fallback: true };'));
    ok('and that label hides the code box', STORE.includes("if (res.fallback) codeForm.style.display = 'none'; else showCodeBox(email);"));
    ok('a cooldown that sent NOTHING is not reported as a fresh send', /function sentLine\(email, cached, what\)/.test(STORE) && /We already sent /.test(STORE));
    ok('the worker response really is passed through to say so', STORE.includes('return d || {};'));
    ok('one code-submit implementation, shared by both panels', (STORE.match(/function showCodeBox\(/g) || []).length === 1
      && (STORE.match(/\/api\/signin-verify/g) || []).length === 1);
    ok('the code box is rendered on every surface now, not only installed iOS', /\+ '<form class="ll-code-form"/.test(STORE)
      && !/code \? '<form class="ll-code-form"/.test(STORE));
    ok('the session is still created in THIS container by custom token', STORE.includes('auth.signInWithCustomToken(d.token)'));
  }

  /* --self-test: the assertions above are only worth their runtime if they can fail. Re-run the
     source-shaped ones against deliberately broken copies and require each break to be caught.
     Every gate in this repo that never failed was a gate nobody had proved could. */
  if (SELF) {
    console.log('\n7. --self-test: each assertion catches the break it exists for');
    const mut = [
      ['link dropped from the code email', WORKER.replace('html: signinEmailHtml(code, link)\n      })\n    });\n    if (!r.ok) return json({ error: \'send_failed\' }, 502);\n    await cache.put(cooldown', 'html: signinEmailHtml(code, \'\')\n      })\n    });\n    if (!r.ok) return json({ error: \'send_failed\' }, 502);\n    await cache.put(cooldown'),
        (s) => (s.match(/html: signinEmailHtml\(code, link\)/g) || []).length === 2],
      ['the two subjects drift apart again', WORKER.replace("subject: 'Your Cubby sign-in code',", "subject: 'Your Cubby sign-in link',"),
        (s) => { const x = s.match(/subject: 'Your Cubby sign-in[^']*'/g) || []; return x.length === 2 && x[0] === x[1]; }],
      ['an updateMask sneaks onto the issue PATCH', WORKER.replace("'/signinCodes/' + docId, {\n      method: 'PATCH',", "'/signinCodes/' + docId + '?updateMask.fieldPaths=mac', {\n      method: 'PATCH',"),
        (s) => { const i = s.slice(s.indexOf('async function issueSigninCode('), s.indexOf('/* Same-origin + per-IP volume')); return !i.includes('updateMask'); }],
      ['the plaintext code gets stored next to its MAC', WORKER.replace('mac: { stringValue: mac },', 'mac: { stringValue: mac }, code: { stringValue: code },'),
        (s) => { const i = s.slice(s.indexOf('async function issueSigninCode('), s.indexOf('/* Same-origin + per-IP volume')); return !/code: \{ stringValue: code \}/.test(i); }],
      ['the code box is shown over a link-only fallback email', STORE.replace("if (res.fallback) codeForm.style.display = 'none'; else showCodeBox(email);", 'showCodeBox(email);'),
        (s) => s.includes("if (res.fallback) codeForm.style.display = 'none'; else showCodeBox(email);")],
      ['a no-send cooldown is reported as a fresh send', STORE.replace('function sentLine(email, cached, what)', 'function sentLineOld(email, cached, what)'),
        (s) => /function sentLine\(email, cached, what\)/.test(s)],
    ];
    for (const [name, broken, assertion] of mut) {
      ok('catches: ' + name, assertion(broken) === false);
    }
    const tpl = loadTemplate(WORKER.replace("+ codeBlock + rule + linkBlock", "+ rule + linkBlock"));
    ok('catches: the code block dropped from the template', !(tpl && tpl(CODE, LINK).includes(CODE)));
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log(fail ? 'SIGNIN-EMAIL: FAIL' : 'SIGNIN-EMAIL: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
