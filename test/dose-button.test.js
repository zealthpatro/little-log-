/* What the "Log it" button tells a parent, for every answer /api/dose can give.
 *
 * The button saved nothing for every on-schedule tap from 2026-10-26 to 2026-11-20 and said "Dose
 * logged" each time, because app/sw.js read any 200 as a dose written: the route's `already` answer
 * (nothing written) got the same words as a real save. A parent believes it is recorded, a partner
 * sees no dose, and may give another (docs/postmortems/2026-11-20-dose-button-saved-nothing.md).
 *
 * The rule, which this file holds app/sw.js to:
 *   - "Dose logged" only when the server says it wrote one
 *   - "Two doses logged" / "One at 1:55 AM and one now. Tap to check them." when it wrote one and
 *     another dose already sat in that slot: facts, the time as the app writes it (fmtClock), no advice
 *   - "Already logged" when this person's dose for this reminder was already on the record
 *   - "Could not log that dose" for anything else, including a 200 it cannot read
 *   - never a medicine or a person named on the lock screen (founder decision C6)
 *   - every string in ONE block (DOSE_COPY), so the words live in one place
 *
 * Runs the real app/sw.js in a node sandbox with a stand-in `self`, the way
 * tools/usage_tracker_check.js S15 does, and hands it the tap a real notification gets. The clock is
 * pinned to UTC so "1:55 AM" is a fixed fact, day included.
 *
 *   node test/dose-button.test.js
 *   node test/dose-button.test.js --self-test   (re-run against broken copies of sw.js)
 */
process.env.TZ = 'UTC';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SELF = process.argv.includes('--self-test');
const ROOT = path.join(__dirname, '..');
const say = console.log.bind(console);
const ORIGIN = 'https://little-cubby.com';
const AT = (h, m) => Date.UTC(2026, 0, 15, h, m);   // 2026-01-15, a fixed day

/* One tap of "Log it" on a reminder, with /api/dose answering `reply`:
   { status, body } | { throws: true } | { status, raw } (a body that is not JSON). */
async function tap(src, reply) {
  const shown = [], requests = [];
  const handlers = {};
  const self = {
    addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: ORIGIN }, skipWaiting() {},
    clients: { matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve(), claim() {} },
    registration: { showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } }
  };
  const fetch = (url, init) => {
    requests.push({ url: String(url), init });
    if (reply.throws) return Promise.reject(new TypeError('Failed to fetch'));
    const text = reply.raw !== undefined ? reply.raw : JSON.stringify(reply.body);
    return Promise.resolve({ ok: reply.status >= 200 && reply.status < 300, status: reply.status,
      json: () => Promise.resolve().then(() => JSON.parse(text)), text: () => Promise.resolve(text) });
  };
  const ctx = vm.createContext({ self, caches: {}, fetch, URL, URLSearchParams, console, Promise, setTimeout, Date, JSON, Math, String, Number });
  vm.runInContext(src, ctx);
  let waited = Promise.resolve();
  const data = { tag: 'med-medCalpol-1768440000000', medId: 'medCalpol', medName: 'Calpol', nonce: 'v1.ticket.sig' };
  handlers.notificationclick({ notification: { close() {}, data }, action: 'dose', waitUntil(p) { waited = p; } });
  // A handler that rejects shows the parent nothing at all: recorded as zero notifications, not a crash.
  await Promise.resolve(waited).catch(() => {});
  return { shown, requests };
}

async function suite(src, quiet) {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => {
    if (c) { pass++; if (!quiet) say('  ok   ' + n); }
    else { fail++; if (!quiet) say('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 300) : '')); }
  };
  const head = (s) => { if (!quiet) say('\n' + s); };
  const one = (x) => (x.shown.length === 1 ? x.shown[0] : { title: '(' + x.shown.length + ' notifications)', opts: {} });
  const named = (n) => /Calpol|medCalpol|Gran|Sam/.test(n.title + ' ' + ((n.opts && n.opts.body) || ''));

  head('1. the tap reaches the route with the ticket and nothing else (control)');
  {
    const x = await tap(src, { status: 200, body: { ok: true, at: AT(2, 10) } });
    ok('one POST to /api/dose', x.requests.length === 1 && x.requests[0].url === '/api/dose' && x.requests[0].init.method === 'POST', x.requests.map((r) => r.url));
    ok('carrying only the ticket', x.requests.length === 1 && x.requests[0].init.body === JSON.stringify({ n: 'v1.ticket.sig' }), x.requests[0] && x.requests[0].init.body);
  }

  head('2. what the parent reads, for each answer');
  const cases = [
    ['a dose written', { status: 200, body: { ok: true, at: AT(2, 10) } }, 'Dose logged', (b) => b === "It's on the record."],
    ['a dose written, another already in that slot at 1:55 AM', { status: 200, body: { ok: true, at: AT(2, 10), earlier: AT(1, 55) } },
      'Two doses logged', (b) => b === 'One at 1:55 AM and one now. Tap to check them.'],
    ['the earlier one in the afternoon (fmtClock: 1:05 PM)', { status: 200, body: { ok: true, at: AT(13, 30), earlier: AT(13, 5) } },
      'Two doses logged', (b) => b === 'One at 1:05 PM and one now. Tap to check them.'],
    ['the earlier one just after midnight (12:07 AM, not 0:07)', { status: 200, body: { ok: true, at: AT(0, 30), earlier: AT(0, 7) } },
      'Two doses logged', (b) => b === 'One at 12:07 AM and one now. Tap to check them.'],
    ['this person already logged this reminder (nothing new written)', { status: 200, body: { ok: true, already: true } },
      'Already logged', (b) => b === 'This dose was already on the record.'],
    ['the ticket refused (a removed member, an expired ticket)', { status: 401, body: { error: 'bad_ticket' } },
      'Could not log that dose', (b) => b === 'Open Cubby and log it there, so nothing is missed.'],
    ['the server unavailable', { status: 503, body: { error: 'unavailable' } },
      'Could not log that dose', (b) => b === 'Open Cubby and log it there, so nothing is missed.'],
    ['a 200 whose body cannot be read: it never claims a save it cannot see', { status: 200, raw: '<html>' },
      'Could not log that dose', (b) => b === 'Open Cubby and log it there, so nothing is missed.'],
    ['a 200 that does not say ok', { status: 200, body: {} },
      'Could not log that dose', (b) => b === 'Open Cubby and log it there, so nothing is missed.'],
    ['offline', { throws: true }, 'Could not log that dose', (b) => b === 'You look offline. Open Cubby and log it there.']
  ];
  for (const [name, reply, title, bodyOk] of cases) {
    const x = await tap(src, reply);
    const n = one(x);
    ok(name + ': "' + title + '"', n.title === title && bodyOk(n.opts && n.opts.body), [n.title, n.opts && n.opts.body]);
    ok(name + ': names no medicine and no person (C6)', !named(n), [n.title, n.opts && n.opts.body]);
    ok(name + ': replaces the reminder rather than stacking (tag ...-done)', n.opts && n.opts.tag === 'med-medCalpol-1768440000000-done', n.opts && n.opts.tag);
  }
  {
    const x = await tap(src, { status: 200, body: { ok: true, already: true } });
    ok('"Dose logged" is never shown when nothing was written', one(x).title !== 'Dose logged', one(x).title);
  }

  head('3. the words live in one place');
  {
    ok('sw.js has one DOSE_COPY block', (src.match(/const DOSE_COPY = \{/g) || []).length === 1);
    const at = src.indexOf('const DOSE_COPY = {'), end = at >= 0 ? src.indexOf('\n};', at) : -1;
    const block = at >= 0 && end > at ? src.slice(at, end) : '', rest = block ? src.replace(block, '') : src;
    for (const w of ['Dose logged', 'Two doses logged', 'Already logged', 'Could not log that dose']) {
      ok('"' + w + '" is written only inside it', block.includes("'" + w + "'") && !rest.includes("'" + w + "'"), [block.includes(w), rest.split(w).length - 1]);
    }
  }
  return { pass, fail };
}

(async () => {
  say('\nthe "Log it" button: what it tells a parent');
  const SRC = fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8');
  const r = await suite(SRC, false);
  let pass = r.pass, fail = r.fail;
  const ok = (n, c, x) => { if (c) { pass++; say('  ok   ' + n); } else { fail++; say('  FAIL ' + n + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };

  say('\n4. the wiring');
  {
    const gates = fs.readFileSync(path.join(ROOT, 'tools', 'gates.js'), 'utf8');
    ok('tools/gates.js runs this file with --self-test', /cmd: \['node', 'test\/dose-button\.test\.js', '--self-test'\]/.test(gates));
  }

  if (SELF) {
    say('\n5. --self-test: each break is caught');
    const MUTANTS = [
      ['any 200 reads as "Dose logged" again (the bug)', 'if (b && b.ok === true && b.already) return DOSE_COPY.already;', ''],
      ['the earlier dose is ignored', 'if (b && b.ok === true && b.earlier) return { title: DOSE_COPY.twice.title, body: DOSE_COPY.twice.body.replace(\'{time}\', doseClock(b.earlier)) };', ''],
      ['the time is written 24-hour', "const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;", "const ap = '';"],
      ['an unreadable 200 is read as a save', '.catch(() => null)', '.catch(() => ({ ok: true }))'],
      ['the medicine is named again', "body: \"It's on the record.\"", "body: (DOSE_NAME || '') + \" is on the record.\""]
    ];
    for (const [name, find, repl] of MUTANTS) {
      if (!SRC.includes(find)) { ok('catches: ' + name + ' (anchor still present in sw.js)', false, find); continue; }
      let mut = SRC.split(find).join(repl);
      if (name.startsWith('the medicine is named')) mut = mut.replace("const DOSE_COPY = {", "var DOSE_NAME = 'Calpol';\nconst DOSE_COPY = {");
      let caught = false;
      try { caught = (await suite(mut, true)).fail > 0; } catch (e) { caught = true; }
      ok('catches: ' + name, caught);
    }
  }

  say('\n' + pass + ' passed, ' + fail + ' failed');
  say(fail ? 'DOSE-BUTTON: FAIL' : 'DOSE-BUTTON: PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
