/* The tracking plan and the running code must say the same thing.
 *
 *   node tools/tracking_plan_check.js               judge this checkout
 *   node tools/tracking_plan_check.js --self-test   first stage every failure below in a temporary copy of
 *                                                   the files it reads (each must be caught, for the right
 *                                                   reason), then judge this checkout
 *   node tools/tracking_plan_check.js --root=<dir>  judge another tree (what the self-test runs)
 *
 * .telemetry/tracking-plan.yaml is what the founder reads to know what Cubby measures, and it is what
 * the App Store privacy answer rests on. A plan that has drifted from the code is worse than no plan,
 * because it is a confident, specific, wrong answer to "what do you collect". So this holds them equal:
 *
 *   1. Every household event the plan says is EMITTED by the client exists in the funnel allowlist
 *      (workers/funnel/core.mjs STEP_EVENTS), with exactly the same properties and the same values.
 *      And the reverse: the allowlist carries nothing the plan does not declare.
 *   2. No event property is shaped like an identifier, in any event. Version 2 changed this rule on
 *      purpose (spec §15.3): a linked usage event does carry a uid and a household, but only in the
 *      envelope the SERVER sets. So this also proves the envelope is the only place either can appear:
 *      the plan says the server sets them, and core.mjs refuses a body that names them.
 *   3. The funnel reader in worker.js never touches the three records the plan promises it will not:
 *      her private health, her loss archive, and the map where names live.
 *   4. There is no loss event, in the household plan, the linked plan or the allowlist. That is a
 *      decision, not an omission, and it must not quietly come back.
 *   5. The plan counts its own events correctly.
 *   6. The linked usage events (spec §8.3 to §8.5, §14) and workers/usage/core.mjs USAGE_EVENTS are the
 *      same: names, before-sign-in, properties, values, bounds and formats; the envelope's formats
 *      behave as core.mjs does; every linked property has an enum, a bounded integer or a format, and
 *      every format is one of the spec's three, pinned, and refuses free text. Every household property
 *      has an enum, a bound or a yes or no flag, except eleven frozen ones the plan's decisions name.
 *   7. No property name is a content word (amount, ml, dose, note, name, ...), matched as whole tokens
 *      split on '_', so template is not temp and screen is not screen_name; and every property name is
 *      snake_case, so amountMl cannot pass as one token.
 *   8. No screen, feature, linked event name or linked property value matches the never-instrumented
 *      pattern (spec §8.4: "no screen name, no feature name, no event").
 *   9. app/usage-allowlist.js is byte for byte what core.mjs generates.
 *  10. JOURNEY_KEYS is not empty and holds every pregnancy-only or trying-only screen and feature.
 *  11. Retention days and the USAGE_MODE switch in the plan are the code's, and the plan says families
 *      are not measured for as long as the switch is not "on".
 *  12. THE STORE ANSWERS (spec §15.1). While the allowlist is not empty, the App Store package (the
 *      listing's §4, its review note, and the submit runbook) must not say usage data is not collected
 *      or that no user id is used, and must declare what §15.1 declares.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ARGS = process.argv.slice(2);
const SELF_TEST = ARGS.includes('--self-test');
const ROOT_ARG = (ARGS.find((a) => a.startsWith('--root=')) || '').slice(7);
const ROOT = ROOT_ARG ? path.resolve(ROOT_ARG) : path.join(__dirname, '..');

const PLAN = '.telemetry/tracking-plan.yaml';
const LISTING = 'docs/plans/2026-08-04-app-store-listing.md';
const RUNBOOK = 'docs/plans/2026-08-15-submit-runbook.md';
/* Every file this gate reads. The self-test copies exactly these. */
const INPUTS = [PLAN, 'workers/funnel/core.mjs', 'workers/usage/core.mjs', 'worker.js', 'app/usage-allowlist.js',
  'wrangler.toml', LISTING, RUNBOOK];

/* ---- the matchers, named once so the companions below test the very same objects ---- */

const IDENT = /(^|_)(uid|user_id|email|name|household|hid|household_id|phone|note|text|body|address|ip)($|_)/;
/* Spec §14's content words, plus the long forms of temp and dose, and a plural s, all as WHOLE tokens. */
const CONTENT_WORDS = ['amount', 'ml', 'oz', 'dose', 'dosage', 'temp', 'temperature', 'weight', 'height', 'note', 'text',
  'body', 'comment', 'message', 'mood', 'symptom', 'name', 'email', 'phone', 'address', 'value', 'reading', 'pressure',
  'caption', 'photo', 'query', 'search', 'url'];
const CONTENT = new RegExp('(^|_)(' + CONTENT_WORDS.join('|') + ')s?($|_)');
/* The whole-token match above only holds if '_' is the only joint a name can have: amountMl has no '_', so
   it would pass as one harmless token. So every property name must be snake_case (the plan's own naming). */
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
/* Spec §8.5 (1): a property may use one of three formats, no more: the version, the nudge id and the yes or
   no flag (core.mjs spells that one as an enum). A format is the one way a free string could come back, so
   each is pinned here by name and by pattern, and every format is also judged by what it accepts. */
const ALLOWED_FORMATS = { version: '^v\\d{1,5}$', nudge_id: '^n_[a-z0-9]{8}$', yes_no: '^(yes|no)$' };
/* What a family might type. A format that accepts any of these could carry it. */
const FREE_TEXT = ['', ' ', 'a b', 'Maya', 'maya', 'calpol', 'fever', 'v', '120ml', '120 ml', 'Maya drank 120 ml, Calpol 5ml at 3am',
  'a'.repeat(65), '0'.repeat(65)];
const refusesFreeText = (re) => re instanceof RegExp && re.flags === '' && /^\^/.test(re.source) && /\$$/.test(re.source)
  && FREE_TEXT.every((s) => !re.test(s));
const reOf = (src) => { try { return new RegExp(src); } catch (e) { return null; } };
/* Spec §8.5 (1) covers every property in the plan, the household events included. These eleven, from the
   September 2026 household plan, carry values that are not a fixed list today. They are frozen here and
   named in the plan's decisions; any other household property without an enum, a bound or a yes or no
   flag fails. */
const FREE_HOUSEHOLD = ['visit.landed.path', 'user.attributed.source', 'user.attributed.medium', 'user.attributed.campaign',
  'user.attributed.content', 'household.created.acq_source', 'household.activated.entry_type', 'care_entry.logged.entry_type',
  'member.joined.days_since_created', 'household.shared_logging_reached.days_since_created', 'pro.waitlist_joined.acq_source'];
/* Spec §8.4, literally, as a substring match: stricter than core.mjs's own, which tokenises bp. Spec §8.4
   says no screen name, no feature name AND no event, so it runs over event names and every value too. */
const NEVER = /loss|mood|mhealth|wellbeing|bp|blood|archive|private/;
/* By NAME. visit.ended is the one .ended event that is not about a pregnancy; it is named, not patterned. */
const LOSS_EVENT = /loss|\.ended\b|_ended\b|miscarr|stillbirth/i;
const NOT_LOSS = new Set(['visit.ended']);
const isLossEvent = (n) => LOSS_EVENT.test(n) && !NOT_LOSS.has(n);
const LOSS_VALUE = /loss|miscarr|stillbirth/i;
/* Names that can only mean the pregnancy or trying path. Any screen or feature matching one must be a
   JOURNEY_KEY. 'journey' is not here: the Moments journey library is for babies too. */
const PREG = /pregnan|kick|contraction|cycle|trying|ttc|bump|ovulat|fertil|period|bbt|labou?r|birth_plan|hospital_bag|antenatal|prenatal|due_date|trimester/;
const SPEC_JOURNEY_MIN = ['pregnancy_week', 'kicks', 'contractions', 'cycle'];   // spec §8.4, by name
/* A sentence that answers No (or Not Linked, or calls declaring it over-declaring) ... */
const STORE_NEG = new RegExp(['not collected', "n['\u2019]t collected", '\\banswer(?:ed)? no\\b', '\\bno to everything\\b',
  '\\bdo(?:es)? not collect', "\\bdo(?:es)?n['\u2019]t collect", '\\bnever collect', '\\bcollect(?:s|ed)? no\\b', '\\bkeeps? no\\b',
  '\\bkept no\\b', '\\bno (?:usage data|product interaction|diagnostics?|device ids?)\\b', 'not linked to you', 'over-?declar'].join('|'), 'i');
/* ... about something §15.1 now declares as collected and linked. */
const STORE_TOPIC = /usage data|product interaction|diagnostic|device id/i;
const STORE_NOUID = /\b(?:no|without(?: a| any)?) (?:user|household) ids?\b/i;
const MUST_BE_LIVE = /must be live in App Store Connect before `?USAGE_MODE`? becomes "on"/i;

/* A document as the sentences and table rows a reader would take one at a time. */
function chunks(text) {
  return String(text || '').split(/\n\s*\n|\n(?=\s*(?:[-*|]|\d+\.)\s)/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z*"(`])/))
    .map((s) => s.trim()).filter(Boolean);
}
/* A table row that answers No in its Collected cell for one of those topics says "not collected" without
   the words: | Usage data: other usage data | No | n/a | ... | */
const staleRows = (text) => String(text || '').split('\n').filter((l) => /^\s*\|/.test(l)).filter((l) => {
  const cells = l.split('|').slice(1, -1).map((c) => c.trim());
  return cells.length >= 2 && STORE_TOPIC.test(cells[0]) && /^(?:\*\*)?no\b/i.test(cells[1]);
}).map((l) => l.trim());
const staleSentences = (text) => chunks(text).filter((s) => STORE_NEG.test(s) && STORE_TOPIC.test(s)).concat(staleRows(text));
/* A markdown section from its heading to the next level-2 heading. '' when the heading is gone. */
function section(md, headRe) {
  const m = headRe.exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const end = rest.search(/\n## /);
  return m[0] + (end < 0 ? rest : rest.slice(0, end));
}
const fenced = (text) => Array.from(String(text || '').matchAll(/```[a-z]*\n([\s\S]*?)```/g)).map((m) => m[1]);
/* The header comment (the leading block, before the first YAML key) as one line of prose, so a sentence
   wrapped across '# ' lines still reads whole, and a comment further down cannot stand in for it. */
function headerProse(raw) {
  const lines = raw.split('\n');
  const out = [];
  for (const l of lines) { if (/^#/.test(l)) out.push(l.replace(/^#\s?/, '').trim()); else if (l.trim()) break; }
  return out.join(' ').replace(/\s+/g, ' ');
}

/* The plan is YAML; this repo carries no YAML parser, and one is not worth a dependency for a file
   this regular. Ruby ships with macOS and parses it properly, so the gate shells out once. safe_load
   with Date permitted reads the same on macOS's Ruby 2.6 and a Linux runner's Ruby 3, where a bare
   load refuses an unquoted date. */
function loadPlan() {
  const out = execFileSync('ruby', ['-ryaml', '-rjson', '-rdate', '-e',
    'puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), permitted_classes: [Date], aliases: false))',
    path.join(ROOT, PLAN)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out);
}
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => (Array.isArray(a) ? a.slice().map(String).sort() : a);

async function judge() {
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 400) : '')); } };

  const funnel = await import('file://' + path.join(ROOT, 'workers', 'funnel', 'core.mjs'));
  const core = await import('file://' + path.join(ROOT, 'workers', 'usage', 'core.mjs'));
  const plan = loadPlan();
  const raw = read(PLAN);
  const events = plan.events || [];
  const lu = plan.linked_usage || {};
  const lev = Array.isArray(lu.events) ? lu.events : [];
  const U = core.USAGE_EVENTS || {};
  console.log('\ntracking plan: the document and the code agree' + (ROOT_ARG ? ' (' + ROOT + ')' : '') + '\n');

  console.log('1. the client-emitted household events and the funnel allowlist are the same set');
  /* visit.landed is emitted by the Worker's page counter and account.deleted by its purge; neither is
     client input, so neither belongs in the allowlist a browser can call. */
  const SERVER_EMITTED = ['visit.landed', 'account.deleted'];
  const planned = events.filter((e) => e.source === 'emitted' && SERVER_EMITTED.indexOf(e.name) < 0);
  const allow = funnel.STEP_EVENTS;
  const plannedNames = planned.map((e) => e.name).sort();
  const allowNames = Object.keys(allow).sort();
  ok('the plan and the allowlist name the same client events', same(plannedNames, allowNames), { plan: plannedNames, allowlist: allowNames });
  for (const e of planned) {
    const spec = allow[e.name] || {};
    const pprops = (e.properties || []).map((p) => p.name).sort();
    ok(e.name + ': same properties in plan and allowlist', same(pprops, Object.keys(spec).sort()), { plan: pprops, allowlist: Object.keys(spec).sort() });
    for (const p of e.properties || []) {
      const a = (spec[p.name] || []).slice().sort(), b = (p.enum || []).slice().sort();
      ok(e.name + '.' + p.name + ': same values in plan and allowlist', same(a, b), { plan: b, allowlist: a });
      ok(e.name + '.' + p.name + ': marked required, because stepKey requires every property', p.required === true, p.required);
    }
  }

  /* Every property name the plan or the allowlist carries, wherever it lives. Kept as { tag, name }, so a
     name with a dot or a space in it is judged whole, not cut at the separator. */
  const allProps = [];
  for (const e of events) for (const p of e.properties || []) allProps.push({ tag: e.name + '.' + p.name, name: String(p.name) });
  for (const e of lev) for (const p of e.properties || []) allProps.push({ tag: e.name + '.' + p.name, name: String(p.name) });
  for (const [n, s] of Object.entries(U)) for (const k of Object.keys((s && s.props) || {})) allProps.push({ tag: n + '.' + k + ' (core.mjs)', name: k });
  const propName = (x) => x.name;

  console.log('\n2. nothing in any event property is shaped like an identifier; the envelope is the only place');
  const suspicious = allProps.filter((f) => IDENT.test(propName(f))).map((f) => f.tag);
  ok('no event property is named like a person or a household', suspicious.length === 0, suspicious);
  ok('the plan\'s pii_policy is linked_envelope_only (identity only in the server-set envelope)', (plan.meta || {}).pii_policy === 'linked_envelope_only', (plan.meta || {}).pii_policy);
  ok('the plan is version 2', (plan.meta || {}).version === 2, (plan.meta || {}).version);
  /* Paired: the check above has to be able to fire. */
  ok('and that check does catch an identifier when one is there', IDENT.test('owner_uid') && IDENT.test('email') && IDENT.test('user_id') && !IDENT.test('entry_point') && !IDENT.test('nudge_id'));
  const envFields = ((lu.envelope || {}).fields) || [];
  const setBy = (f) => (envFields.find((x) => x.field === f) || {}).set_by;
  ok('envelope: uid, hid and role are set by the server only', setBy('uid') === 'server' && setBy('hid') === 'server' && setBy('role') === 'server',
     { uid: setBy('uid'), hid: setBy('hid'), role: setBy('role') });
  const goodBody = { v: 1, tz: 'UTC', device: 'd_abcdefghijkl', platform: 'browser', app_version: 'v369', events: [] };
  const env = (over) => (core.checkEnvelope ? core.checkEnvelope(Object.assign({}, goodBody, over)) : { ok: true, env: {} });
  ok('core.mjs refuses a body naming uid', env({ uid: 'u1' }).ok === false);
  ok('core.mjs refuses a body naming hid', env({ hid: 'h1' }).ok === false);
  ok('companion: core.mjs accepts the same body without them', env({}).ok === true);

  console.log('\n3. the reader never touches what the plan promises it will not');
  const worker = read('worker.js');
  /* From the FIRST reader helper, not from funnelInput. When the pregnancy read moved into its own
     helper above funnelInput, a span starting at funnelInput stopped covering it, and an mhealth read
     added there would have passed this gate. funnelPage is the first function every read goes through. */
  const start = worker.indexOf('async function funnelPage(');
  const end = worker.indexOf('async function funnelStepTotals(');
  ok('the funnel reader is found in worker.js', start > 0 && end > start, { start, end });
  /* CODE, not prose. The comments here document the prohibition ("mhealth is never read"), and a raw text
     search went red over that sentence, which also meant a mutation that ADDED an mhealth read was "caught"
     for the wrong reason. Comments are stripped first, so only an actual reference in code can fail. */
  const reader = worker.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
  for (const [what, why] of [['mhealth', 'her private health'], ['pregnancyArchive', 'her kept-after-loss record'], ['memberInfo', 'where names live']]) {
    ok('the reader never names ' + what + ' (' + why + ')', reader.indexOf(what) < 0);
  }
  ok('care logs are read with a field mask', /'\/events',\s*\['time',\s*'authorId',\s*'type'\]/.test(reader));

  console.log('\n4. a loss is not an event, anywhere');
  /* By NAME. The first version also read descriptions and excused any that said "never", which let
     pregnancy.ended straight through, because its description says "never a segment, never a trigger".
     A check whose escape hatch is shaped exactly like the thing it hunts is not a check. The one
     exception is a NAME, visit.ended, and the companion below proves pregnancy.ended is still caught. */
  const allNames = events.map((e) => e.name).concat(lev.map((e) => e.name), Object.keys(U).map((n) => n + ' (core.mjs)'));
  const lossy = allNames.filter((n) => isLossEvent(n.split(' ')[0]));
  ok('no event measures a pregnancy loss (household plan, linked plan, core.mjs)', lossy.length === 0, lossy);
  const values = [];
  for (const e of lev) for (const p of e.properties || []) for (const v of p.enum || []) values.push(e.name + '.' + p.name + '=' + v);
  for (const [n, s] of Object.entries(U)) for (const [k, p] of Object.entries((s && s.props) || {})) for (const v of (p && p.enum) || []) values.push(n + '.' + k + '=' + v);
  ok('no linked property value names a loss', values.filter((v) => LOSS_VALUE.test(v.split('=')[1])).length === 0, values.filter((v) => LOSS_VALUE.test(v.split('=')[1])));
  /* Paired: outside screens and features (which check 8 also covers) this is the only loss guard on a
     value, a push kind, an error or a channel, so it must be seen to fire, and to stay quiet on today's. */
  ok('companion: the loss-value matcher catches loss_followup, miscarriage and stillbirth_care, and no value in use today',
     ['loss_followup', 'miscarriage', 'stillbirth_care'].every((v) => LOSS_VALUE.test(v)) && values.length > 50
     && ['medicine', 'appointment', 'team_note', 'popup_closed', 'permission_denied', 'ios_instructions'].every((v) => !LOSS_VALUE.test(v)));
  ok('companion: the loss matcher catches pregnancy.ended, journey_ended and loss.recorded, and lets visit.ended pass',
     isLossEvent('pregnancy.ended') && isLossEvent('journey_ended') && isLossEvent('loss.recorded') && isLossEvent('stillbirth.logged') && !isLossEvent('visit.ended') && NOT_LOSS.size === 1);
  ok('and the reason is written down, so it is not re-added as an oversight', /pregnancyArchive/.test(JSON.stringify(plan)));

  console.log('\n5. the plan counts its own events correctly');
  const derived = events.filter((e) => e.source === 'derived').length;
  const emitted = events.filter((e) => e.source === 'emitted').length;
  const head = headerProse(raw);
  const m = /(\d+) of the (\d+) events here are derived/.exec(head);
  ok('its header states the true derived and total counts', !!m && Number(m[1]) === derived && Number(m[2]) === events.length,
     { header: m && m[0], derived, total: events.length, emitted });
  const lm = /(\d+) of the (\d+) linked events are sent by a device, (\d+) (?:is|are) derived and (\d+) (?:is|are) written by the server/.exec(head);
  const lc = { device: lev.filter((e) => e.source === 'new').length, derived: lev.filter((e) => e.source === 'derived').length, server: lev.filter((e) => e.source === 'server').length, total: lev.length };
  ok('its header states the true linked counts', !!lm && Number(lm[1]) === lc.device && Number(lm[2]) === lc.total && Number(lm[3]) === lc.derived && Number(lm[4]) === lc.server,
     { header: lm && lm[0], counts: lc });

  console.log('\n6. the linked usage events and workers/usage/core.mjs are the same (spec §8.3)');
  ok('every linked event says where it comes from (new, derived or server)', lev.length > 0 && lev.every((e) => ['new', 'derived', 'server'].includes(e.source)), lev.map((e) => e.name + ':' + e.source));
  const deviceSent = lev.filter((e) => e.source === 'new');
  ok('linked: the plan and core.mjs name the same device-sent events', same(deviceSent.map((e) => e.name).sort(), Object.keys(U).sort()),
     { plan: deviceSent.map((e) => e.name).sort(), core: Object.keys(U).sort() });
  const formats = lu.formats || {};
  const coreFormats = Object.fromEntries(Object.entries(core.FORMATS || {}).map(([k, re]) => [k, re.source]));
  ok('formats: the plan\'s patterns are core.mjs\'s', same(Object.keys(formats).sort(), Object.keys(coreFormats).sort()) && Object.keys(coreFormats).every((k) => formats[k] === coreFormats[k]),
     { plan: formats, core: coreFormats });
  /* Spec §8.5 (1): "one of three formats ... Free strings are not expressible." Equal is not enough: the plan
     and core.mjs can agree on a format that takes a sentence. */
  const offList = Object.entries(core.FORMATS || {}).filter(([k, re]) => !(Object.prototype.hasOwnProperty.call(ALLOWED_FORMATS, k) && re instanceof RegExp && re.source === ALLOWED_FORMATS[k] && re.flags === ''))
    .map(([k, re]) => k + ' ' + String(re));
  ok('formats: core.mjs has only the spec\'s formats (version, nudge id, the yes or no flag), each with its pinned pattern', Object.keys(core.FORMATS || {}).length > 0 && offList.length === 0, offList);
  const loose = [].concat(Object.entries(core.FORMATS || {}).filter(([, re]) => !refusesFreeText(re)).map(([k]) => k + ' (core.mjs)'),
    Object.entries(formats).filter(([, s]) => !refusesFreeText(reOf(s))).map(([k]) => k + ' (plan)'));
  ok('formats: every format is anchored and refuses free text (a name, a dose, a sentence, 65 characters)', loose.length === 0, loose);
  ok('companion: the free-text test refuses a catch-all, a lowercase word and an unanchored pattern, and accepts the three pinned formats',
     !refusesFreeText(/^[\s\S]{0,200}$/) && !refusesFreeText(/^[a-z]{1,40}$/) && !refusesFreeText(/v\d{1,5}/) && !refusesFreeText(/^v\d{1,5}$/i)
     && Object.values(ALLOWED_FORMATS).every((s) => refusesFreeText(reOf(s))));
  for (const e of deviceSent) {
    const spec = U[e.name] || { props: {} };
    ok(e.name + ': may arrive before sign-in in plan and core.mjs alike', e.before_sign_in === !!spec.anon, { plan: e.before_sign_in, core: !!spec.anon });
    if (spec.anonScreens || e.before_sign_in_screens) ok(e.name + ': the same screens before sign-in', same(sorted(e.before_sign_in_screens), sorted(spec.anonScreens)), { plan: e.before_sign_in_screens, core: spec.anonScreens });
    const pnames = (e.properties || []).map((p) => p.name).sort();
    ok(e.name + ': same properties in plan and core.mjs', same(pnames, Object.keys(spec.props || {}).sort()), { plan: pnames, core: Object.keys(spec.props || {}).sort() });
    for (const p of e.properties || []) {
      const c = (spec.props || {})[p.name];
      if (!c) continue;
      const tag = e.name + '.' + p.name;
      if (c.enum) ok(tag + ': same values in plan and core.mjs', same(sorted(p.enum), sorted(c.enum)), { plan: p.enum, core: c.enum });
      else if (c.int) ok(tag + ': same bounds in plan and core.mjs', p.type === 'integer' && p.min === c.int[0] && p.max === c.int[1], { plan: [p.type, p.min, p.max], core: c.int });
      else if (c.format) ok(tag + ': same format in plan and core.mjs', p.format === c.format, { plan: p.format, core: c.format });
      else ok(tag + ': core.mjs gives it an enum, bounds or a format', false, c);
    }
  }
  /* Spec §8.5 (1): free strings are not expressible. Every linked property, derived ones included. */
  for (const e of lev) for (const p of e.properties || []) {
    const isEnum = Array.isArray(p.enum) && p.enum.length > 0 && p.enum.every((v) => typeof v === 'string');
    const isInt = p.type === 'integer' && Number.isInteger(p.min) && Number.isInteger(p.max) && p.min <= p.max;
    const isFmt = typeof p.format === 'string' && Object.prototype.hasOwnProperty.call(formats, p.format) && Object.prototype.hasOwnProperty.call(ALLOWED_FORMATS, p.format);
    ok(e.name + '.' + p.name + ': declares an enum, a bounded integer or a format', [isEnum, isInt, isFmt].filter(Boolean).length === 1, p);
  }
  /* The same rule for the household events, where a yes or no flag is a boolean. The eleven free ones from
     September 2026 are frozen in FREE_HOUSEHOLD and must be named, with the reason, in the plan's decisions. */
  const freeHousehold = [];
  for (const e of events) for (const p of e.properties || []) {
    const fixed = (Array.isArray(p.enum) && p.enum.length > 0 && p.enum.every((v) => typeof v === 'string'))
      || (p.type === 'integer' && Number.isInteger(p.min) && Number.isInteger(p.max) && p.min <= p.max)
      || (p.type === 'boolean' && p.enum === undefined);
    if (!fixed) freeHousehold.push(e.name + '.' + p.name);
  }
  const newFree = freeHousehold.filter((t) => !FREE_HOUSEHOLD.includes(t));
  ok('household: every property declares an enum, a bounded integer or a yes or no flag, or is one of the eleven named in decisions', newFree.length === 0, newFree);
  const freeDecision = (plan.decisions || []).find((d) => d && Array.isArray(d.free_properties)) || {};
  ok('household: the plan\'s decisions name exactly the free properties this gate allows, with a reason', same(sorted(freeDecision.free_properties), sorted(FREE_HOUSEHOLD))
     && String(freeDecision.because || '').length > 80, { plan: freeDecision.free_properties, gate: FREE_HOUSEHOLD });
  /* The envelope's formats, judged by behaviour: the plan's pattern and core.mjs answer the same samples. */
  const envFmt = (f) => { const x = envFields.find((y) => y.field === f); try { return x && x.format ? new RegExp(x.format) : null; } catch (e) { return null; } };
  const evOk = (over) => { const r = core.checkEvent ? core.checkEvent(Object.assign({ id: '6f1c0b8e-0000-4000-8000-000000000001', visit: 'v_abcd1234', t: 1, name: 'visit.started', props: { opened_from: 'icon', start: 'cold' } }, over), 1, true) : { ok: false }; return r.ok; };
  const agree = (f, samples, coreSays) => { const re = envFmt(f); return !!re && samples.every((s) => re.test(s) === coreSays(s)); };
  ok('envelope.device: the plan\'s format behaves as core.mjs does', agree('device', ['d_abcdefghijkl', 'd_abc', 'd_ABCDEFGHIJKL', 'd_abcdefghijklm', 'x_abcdefghijkl', 'd_abcdefghij'], (s) => env({ device: s }).ok));
  ok('envelope.app_version: the plan\'s format behaves as core.mjs does', agree('app_version', ['v1', 'v369', 'v12345', 'v123456', '369', 'vx'], (s) => env({ app_version: s }).ok));
  ok('envelope.native_version: the plan\'s format behaves as core.mjs does', agree('native_version', ['1.4.0', '1', '1.2.3.4', '1.2.3.4.5', '1.4 Maya', '2026.46.2'], (s) => (env({ native_version: s }).env || {}).native_version === s));
  ok('envelope.id: the plan\'s format behaves as core.mjs does', agree('id', ['6f1c0b8e-0000-4000-8000-000000000001', '6f1c0b8e-0000-1000-8000-000000000001', '6F1C0B8E-0000-4000-8000-000000000001', 'x'], (s) => evOk({ id: s })));
  ok('envelope.visit: the plan\'s format behaves as core.mjs does', agree('visit', ['v_abcd1234', 'v_ABCD1234', 'v_abc', 'v_abcd12345', 'x'], (s) => evOk({ visit: s })));
  ok('envelope.platform: the plan\'s values are core.mjs\'s', same(sorted((envFields.find((x) => x.field === 'platform') || {}).enum), sorted(core.PLATFORMS)));

  console.log('\n7. no property name could hold what someone logged');
  const contentHits = allProps.filter((f) => CONTENT.test(propName(f))).map((f) => f.tag);
  ok('no property name is a content word (whole tokens split on _)', contentHits.length === 0, contentHits);
  ok('companion: the matcher catches amount_ml, temp, screen_name, notes and dose, and not template_id, screen or content',
     CONTENT.test('amount_ml') && CONTENT.test('temp') && CONTENT.test('screen_name') && CONTENT.test('notes') && CONTENT.test('dose')
     && !CONTENT.test('template_id') && !CONTENT.test('screen') && !CONTENT.test('content') && !CONTENT.test('attempt') && !CONTENT.test('nudge_id'));
  const notSnake = allProps.filter((f) => !SNAKE.test(propName(f))).map((f) => f.tag);
  ok('every property name is snake_case, so a content word is always a whole token (household, linked and core.mjs)', allProps.length > 0 && notSnake.length === 0, notSnake);
  ok('companion: snake_case refuses amountMl, doseMg, babyName, amount-ml, amount.ml and Amount, and accepts amount_ml, template_id and within_7_days',
     ['amountMl', 'doseMg', 'babyName', 'amount-ml', 'amount.ml', 'Amount', 'amount ml', '_ml'].every((s) => !SNAKE.test(s))
     && ['amount_ml', 'template_id', 'within_7_days', 'minutes_to_activate_bucket', 'seconds'].every((s) => SNAKE.test(s)));

  console.log('\n8. nothing never-instrumented has a name (spec §8.4)');
  const vocab = new Set([].concat(core.SCREENS || [], core.FEATURES || [], core.JOURNEY_KEYS || []));
  for (const e of lev) for (const p of e.properties || []) if (p.name === 'screen' || p.name === 'feature') (p.enum || []).forEach((v) => vocab.add(v));
  for (const s of Object.values(U)) for (const [k, p] of Object.entries((s && s.props) || {})) if (k === 'screen' || k === 'feature') ((p && p.enum) || []).forEach((v) => vocab.add(v));
  const never = Array.from(vocab).filter((v) => NEVER.test(v));
  ok('no screen or feature matches the never-instrumented pattern', vocab.size > 0 && never.length === 0, never);
  /* "No screen name, no feature name, no event": every linked event name, in the plan and in core.mjs. */
  const evNames = Array.from(new Set(lev.map((e) => String(e.name)).concat(Object.keys(U))));
  const neverEv = evNames.filter((n) => NEVER.test(n));
  ok('no linked event name matches the never-instrumented pattern', evNames.length > 0 && neverEv.length === 0, neverEv);
  /* And every other value: a push kind, an error, a channel. A "mood" push kind is a mood signal. */
  const neverVal = values.filter((v) => NEVER.test(v.split('=')[1]));
  ok('no linked property value matches the never-instrumented pattern', values.length > 0 && neverVal.length === 0, neverVal);
  ok('the plan\'s never-instrumented pattern is core.mjs\'s', !!core.NEVER_INSTRUMENTED && (lu.never_instrumented || {}).pattern === core.NEVER_INSTRUMENTED.source,
     { plan: (lu.never_instrumented || {}).pattern, core: core.NEVER_INSTRUMENTED && core.NEVER_INSTRUMENTED.source });
  const staged = ['mood', 'loss_holding', 'mhealth', 'bp', 'blood_pressure', 'kept_archive', 'private_notes', 'wellbeing'];
  ok('companion: the pattern catches mood, loss_holding, mhealth, bp, blood_pressure, kept_archive, private_notes, wellbeing; not home, log_feed or kicks',
     staged.every((s) => NEVER.test(s)) && !NEVER.test('home') && !NEVER.test('log_feed') && !NEVER.test('kicks'));
  ok('and core.mjs\'s own pattern catches every one of them too', !!core.NEVER_INSTRUMENTED && staged.every((s) => core.NEVER_INSTRUMENTED.test(s)));

  console.log('\n9. the phone\'s copy of the allowlist is the generated one');
  ok('app/usage-allowlist.js is exactly what core.mjs generates', !!core.allowlistSource && read('app/usage-allowlist.js') === core.allowlistSource());

  console.log('\n10. pregnancy and trying tools are JOURNEY_KEYS');
  const JK = core.JOURNEY_KEYS || [];
  ok('JOURNEY_KEYS is not empty', JK.length > 0, JK);
  const pregNames = Array.from(new Set([].concat(core.SCREENS || [], core.FEATURES || []))).filter((n) => PREG.test(n));
  const missing = SPEC_JOURNEY_MIN.concat(pregNames).filter((n) => !JK.includes(n));
  ok('JOURNEY_KEYS holds every pregnancy-only screen and feature', missing.length === 0, { missing: Array.from(new Set(missing)), journey: JK });
  ok('every JOURNEY_KEY is a real screen or feature', JK.every((k) => (core.SCREENS || []).includes(k) || (core.FEATURES || []).includes(k)), JK);
  ok('the plan\'s journey_keys are core.mjs\'s', same(sorted(lu.journey_keys), sorted(JK)), { plan: lu.journey_keys, core: JK });
  ok('companion: the pregnancy matcher catches bump_photos, birth_plan, trying_home and ovulation; not home, health or appointments',
     ['bump_photos', 'birth_plan', 'trying_home', 'ovulation'].every((s) => PREG.test(s)) && !['home', 'health', 'appointments', 'log_feed'].some((s) => PREG.test(s)));

  console.log('\n11. retention and the switch');
  const R = core.RETENTION || {}, pr = lu.retention || {};
  ok('retention: the plan\'s days are core.mjs\'s', pr.events_days === R.eventsDays && pr.anon_days === R.anonDays && pr.journey_days === R.journeyDays
     && pr.aggregate_days === R.aggregateDays && pr.refused_days === R.refusedDays, { plan: pr, core: R });
  ok('retention: the plan carries the spec §10 table', Array.isArray(pr.table) && pr.table.length >= 7);
  const wm = /^\s*USAGE_MODE\s*=\s*"([^"]*)"/m.exec(read('wrangler.toml'));
  const shipped = wm ? wm[1] : null;
  const um = lu.usage_mode || {};
  ok('the plan names the USAGE_MODE that wrangler.toml ships', !!shipped && um.current === shipped, { plan: um.current, wrangler: shipped });
  ok('the plan names the three modes core.mjs knows', same(((um.modes || []).map((x) => x.mode)).sort(), ['internal', 'off', 'on'])
     && ['off', 'internal', 'on'].every((x) => core.modeOf && core.modeOf({ USAGE_MODE: x }) === x));
  ok('families_measured is true only when USAGE_MODE is "on"', lu.families_measured === (shipped === 'on'), { families_measured: lu.families_measured, wrangler: shipped });
  if (lu.families_measured !== true) {
    const said = /FAMILIES ARE NOT MEASURED until the last step of phase 3/;
    ok('while families are not measured, the plan says so in rule 1 and in linked_usage', said.test(head) && said.test(String(lu.families || '')) && /measure households, not people/i.test(String(lu.families || '')));
  }
  const label = (plan.privacy_label || {}).answers || [];
  const ans = (re) => label.find((a) => re.test(String(a.data || ''))) || {};
  ok('the plan\'s privacy_label declares Usage Data linked, for Analytics (spec §15.1)', ans(/usage data: product interaction/i).linked === true && (ans(/usage data: product interaction/i).purposes || []).includes('Analytics'));
  ok('the plan\'s privacy_label declares Diagnostics and Device ID linked', ans(/^diagnostics/i).linked === true && ans(/device id/i).linked === true);

  console.log('\n12. the App Store answers say what the code does (spec §15.1)');
  if (Object.keys(U).length === 0) {
    console.log('  store answers: not required while the allowlist is empty');
  } else {
    const listing = read(LISTING), runbook = read(RUNBOOK);
    const s4 = section(listing, /^## 4\. App Privacy[^\n]*/m);
    const noteSec = section(listing, /^### Notes text for the reviewer[^\n]*/m);
    const notes = fenced(noteSec);
    const r3 = section(runbook, /^## 3\. App Privacy answers[^\n]*/m);
    ok('store: the listing has its App Privacy section (§4)', s4.length > 400, s4.slice(0, 80));
    ok('store: the listing has its reviewer note, with a PRIVACY paragraph', notes.length > 0 && /PRIVACY/.test(notes[0]), notes.length);
    ok('store: the runbook has its App Privacy answers section (§3)', r3.length > 200, r3.slice(0, 80));
    ok('store: the listing §4 never says usage data, diagnostics or a device id is not collected', staleSentences(s4).length === 0, staleSentences(s4));
    ok('store: the reviewer note never says usage data, diagnostics or a device id is not collected', staleSentences(noteSec).length === 0, staleSentences(noteSec));
    ok('store: the runbook never says usage data, diagnostics or a device id is not collected', staleSentences(runbook).length === 0, staleSentences(runbook));
    const nouid = chunks(s4 + '\n\n' + noteSec + '\n\n' + runbook).filter((s) => STORE_NOUID.test(s));
    ok('store: no store document says "no user id"', nouid.length === 0, nouid);
    ok('store: the listing §4 declares Usage Data, Product Interaction as linked, for Analytics', /\|\s*Usage data: product interaction\s*\|\s*Yes\s*\|[^|\n]*Analytics/i.test(s4));
    ok('store: the listing §4 declares Diagnostics as linked', /\|\s*Diagnostics: other diagnostic data\s*\|\s*Yes\s*\|/i.test(s4));
    ok('store: the listing §4 declares Device ID as linked, for Analytics', /\|\s*Identifiers: device ID\s*\|\s*Yes\s*\|[^|\n]*Analytics/i.test(s4));
    ok('store: the listing §4 gives User ID the Analytics purpose', /\|\s*Identifiers: user ID\s*\|\s*Yes\s*\|[^|\n]*Analytics/i.test(s4));
    ok('store: the runbook §3 names Product Interaction, device ID and Diagnostics as linked', /Linked to the user[^\n]*Analytics/i.test(r3) && /Product Interaction/.test(r3) && /device ID/i.test(r3) && /Diagnostics/.test(r3));
    ok('store: the listing says the answers must be live before USAGE_MODE becomes "on"', MUST_BE_LIVE.test(s4.replace(/\s+/g, ' ')));
    ok('store: the runbook says the answers must be live before USAGE_MODE becomes "on"', MUST_BE_LIVE.test(r3.replace(/\*\*/g, '').replace(/\s+/g, ' ')));
    ok('store: the reviewer note says usage is linked to the signed-in account', /linked to the signed-in account/i.test(notes[0] || ''));
    ok('store: the reviewer note has no em-dash (DESIGN.md §A7)', notes.length > 0 && notes.every((n) => n.indexOf('\u2014') < 0));
  }
  /* Companions: the same matchers fire on the old text, word for word, and stay quiet on the new. */
  ok('companion: the store matchers catch the August answers and pass the new ones',
     staleSentences('**Data NOT collected (answer No):** contacts, usage data (no analytics SDK, first-party stance), diagnostics (no crash SDK).').length === 1
     && staleSentences('- **Answer No to everything else**, in particular location, contacts, search\n  history, purchase history, financial info, usage data and diagnostics. There is no analytics SDK.').length === 1
     && staleSentences('Over-declaring (for example claiming we collect location or usage data) is as untruthful as under-declaring.').length === 1
     && STORE_NOUID.test('with no user id, no household id, no cookie')
     && staleSentences('| Usage data: product interaction | Yes | App functionality, Analytics | Never what anyone types or logs. |').length === 0
     && staleSentences('- **Answer No to everything else**, in particular location, contacts and financial info.').length === 0
     && !STORE_NOUID.test('linked to the signed-in account and kept on Cubby\'s own servers'));
  /* The same answer in other words, and as a bare No in the table, must be caught too; the new rows must not. */
  ok('companion: the store matchers catch paraphrases (don\'t collect, collect no, keeps no, isn\'t collected) and a No table row',
     ['We collect no usage data.', 'We don’t collect usage data.', 'Cubby doesn\'t collect diagnostics.', 'Cubby keeps no device ID.',
      'Usage data isn\'t collected.', 'There are no diagnostics.'].every((s) => staleSentences(s).length === 1)
     && staleSentences('| Data type | Collected? |\n|---|---|\n| Usage data: other usage data | No | n/a | Not applicable. |').length === 1
     && staleSentences('| Diagnostics: crash data | **No** | | |').length === 1
     && staleSentences('| Usage data: product interaction | Yes | App functionality, Analytics | Never what anyone types or logs. |\n| Contact info: name | Yes | App functionality | No. |').length === 0
     && staleSentences('There is no analytics SDK, no ads SDK and no crash SDK.').length === 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('TRACKING-PLAN: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  return fail;
}

/* ---------- self-test: every failure, staged in a temporary copy, must be caught for its reason ---------- */

const P = PLAN, C = 'workers/usage/core.mjs', F = 'workers/funnel/core.mjs', W = 'worker.js', A = 'app/usage-allowlist.js', T = 'wrangler.toml', L = LISTING, R = RUNBOOK;
const STAGES = [
  // 6. plan and allowlist
  ['core.mjs gains an event the plan does not list', 'linked: the plan and core.mjs name the same device-sent events',
    [[C, "  'install.prompted': {", "  'help.opened': { anon: false, props: { start: e('cold', 'warm') } },\n  'install.prompted': {"]]],
  ['the plan drops a value', 'visit.started.start: same values in plan and core.mjs', [[P, '{ name: start, type: string, enum: [cold, warm] }', '{ name: start, type: string, enum: [cold] }']]],
  ['a bound differs', 'visit.ended.seconds: same bounds in plan and core.mjs', [[P, 'min: 0, max: 86400 }', 'min: 0, max: 86401 }']]],
  ['a format pattern differs', 'formats: the plan\'s patterns are core.mjs\'s', [[P, "    version: '^v\\d{1,5}$'", "    version: '^v\\d{1,6}$'"]]],
  ['a property names another format', 'app.updated.from_version: same format in plan and core.mjs', [[P, '{ name: from_version, type: string, format: version }', '{ name: from_version, type: string, format: nudge_id }']]],
  ['before-sign-in differs', 'feature.used: may arrive before sign-in in plan and core.mjs alike',
    [[P, '      before_sign_in: false\n      fires_when: A control that does something', '      before_sign_in: true\n      fires_when: A control that does something']]],
  ['the before-sign-in screens differ', 'screen.viewed: the same screens before sign-in', [[P, 'before_sign_in_screens: [signin, landing]', 'before_sign_in_screens: [signin]']]],
  ['a free string property', 'visit.ended.reason: declares an enum, a bounded integer or a format', [[P, '{ name: reason, type: string, enum: [hidden, idle] }', '{ name: reason, type: string }']]],
  ['an unbounded integer', 'signin.attempted.attempt: declares an enum, a bounded integer or a format', [[P, '{ name: attempt, type: integer, min: 1, max: 20 }', '{ name: attempt, type: integer }']]],
  ['a free string on a derived linked event', 'member.joined.role: declares an enum, a bounded integer or a format', [[P, '{ name: role, type: string, enum: [owner, caregiver] }', '{ name: role, type: string }']]],
  ['the envelope format drifts', 'envelope.device: the plan\'s format behaves as core.mjs does', [[P, "format: '^d_[a-z0-9]{12}$'", "format: '^d_[a-z0-9]{10,12}$'"]]],
  ['a free-text format, the same in plan and core', 'formats: core.mjs has only the spec\'s formats', [
    [C, '  nudge_id: /^n_[a-z0-9]{8}$/,\n};', '  nudge_id: /^n_[a-z0-9]{8}$/,\n  label: /^[\\s\\S]{0,200}$/,\n};'],
    [C, 'retries: int(0, 50),', "retries: int(0, 50), label: fmt('label'),"],
    [P, "    nudge_id: '^n_[a-z0-9]{8}$'\n", "    nudge_id: '^n_[a-z0-9]{8}$'\n    label: '^[\\s\\S]{0,200}$'\n"],
    [P, '        - { name: retries, type: integer, min: 0, max: 50 }\n', '        - { name: retries, type: integer, min: 0, max: 50 }\n        - { name: label, type: string, format: label }\n']]],
  ['the version format widened to free text under its own name', 'formats: every format is anchored and refuses free text', [
    [C, '  version: /^v\\d{1,5}$/,', '  version: /^[\\s\\S]{0,200}$/,'], [P, "    version: '^v\\d{1,5}$'", "    version: '^[\\s\\S]{0,200}$'"]]],
  ['a free string on a household event', 'household: every property declares an enum, a bounded integer or a yes or no flag', [[P,
    '      - { name: acq_source, type: string, required: false }\n    expected_frequency: low\n\n  - name: onboarding.step_reached',
    '      - { name: acq_source, type: string, required: false }\n      - { name: detail, type: string, required: false }\n    expected_frequency: low\n\n  - name: onboarding.step_reached']]],
  ['the plan\'s decisions stop naming a free household property', 'household: the plan\'s decisions name exactly the free properties', [[P, 'free_properties: [visit.landed.path, ', 'free_properties: [']]],
  // 2. identity
  ['an identifier-shaped property, in plan and core alike', 'no event property is named like a person or a household',
    [[C, 'attempt: int(1, 20)', 'user_id: int(1, 20)'], [P, '{ name: attempt, type: integer, min: 1, max: 20 }', '{ name: user_id, type: integer, min: 1, max: 20 }']]],
  ['core.mjs stops refusing a body uid', 'core.mjs refuses a body naming uid', [[C, "for (const k of ['uid', 'hid', 'role', 'householdId', 'userId'])", "for (const k of ['householdId', 'userId'])"]]],
  ['the plan lets the client set hid', 'envelope: uid, hid and role are set by the server only', [[P, '{ field: hid, set_by: server,', '{ field: hid, set_by: client,']]],
  ['pii_policy goes back to none', 'the plan\'s pii_policy is linked_envelope_only', [[P, 'pii_policy: linked_envelope_only ', 'pii_policy: none ']]],
  // 7. content words
  ['amount_ml, in plan and core alike', 'no property name is a content word', [[C, 'retries: int(0, 50)', 'amount_ml: int(0, 50)'], [P, '{ name: retries, type: integer, min: 0, max: 50 }', '{ name: amount_ml, type: integer, min: 0, max: 50 }']]],
  ['a content word on a household event', 'no property name is a content word',
    [[P, 'carrying the journey across. Counted, not timed.\n    properties: []', 'carrying the journey across. Counted, not timed.\n    properties: [{ name: baby_name, type: string }]']]],
  ['amountMl, a content word in camelCase, in plan and core alike', 'every property name is snake_case', [[C, 'retries: int(0, 50),', 'retries: int(0, 50), amountMl: int(0, 500),'],
    [P, '        - { name: retries, type: integer, min: 0, max: 50 }\n', '        - { name: retries, type: integer, min: 0, max: 50 }\n        - { name: amountMl, type: integer, min: 0, max: 500 }\n']]],
  // 8. never instrumented
  ['a mood screen', 'no screen or feature matches the never-instrumented pattern', [[C, "'den', 'onboarding',\n];", "'den', 'onboarding', 'mood',\n];"], [P, '                 onboarding]', '                 onboarding, mood]']]],
  ['a private feature', 'no screen or feature matches the never-instrumented pattern', [[C, "'export', 'games', 'pro', 'theme',", "'export', 'games', 'pro', 'theme', 'private_notes',"], [P, '                 export, games, pro, theme]', '                 export, games, pro, theme, private_notes]']]],
  ['the plan\'s pattern drifts', 'the plan\'s never-instrumented pattern is core.mjs\'s', [[P, "|blood|archive|private'", "|blood|archive'"]]],
  ['an event named mood.logged', 'no linked event name matches the never-instrumented pattern', [[C, "  'install.prompted': {", "  'mood.logged': { anon: false, props: { action: e('logged') } },\n  'install.prompted': {"],
    [P, '    - name: install.prompted\n', '    - name: mood.logged\n      source: new\n      before_sign_in: false\n      properties:\n        - { name: action, type: string, enum: [logged] }\n\n    - name: install.prompted\n'],
    [P, '13 of the 18 linked', '14 of the 19 linked']]],
  ['a push kind named mood', 'no linked property value matches the never-instrumented pattern', [[C, "'team_note', 'other'];", "'team_note', 'mood', 'other'];"],
    [P, 'enum: [medicine, feed, sleep, appointment, vaccine, feature, marketing, team_note, other]', 'enum: [medicine, feed, sleep, appointment, vaccine, feature, marketing, team_note, mood, other]']]],
  // 4. loss
  ['a loss event in the linked plan', 'no event measures a pregnancy loss', [[P, '    - name: nudge.acted\n', '    - name: pregnancy.ended\n      source: derived\n      before_sign_in: false\n      properties: []\n\n    - name: nudge.acted\n']]],
  ['a loss event in core.mjs', 'no event measures a pregnancy loss', [[C, "  'install.prompted': {", "  'loss.recorded': { anon: false, props: {} },\n  'install.prompted': {"]]],
  ['a loss event in the household plan', 'no event measures a pregnancy loss', [[P, '  - name: pro.waitlist_joined\n', '  - name: pregnancy.ended\n    source: derived\n    properties: []\n\n  - name: pro.waitlist_joined\n']]],
  ['a loss value in a push kind (miscarriage_followup), outside the never pattern', 'no linked property value names a loss', [[C, "'team_note', 'other'];", "'team_note', 'miscarriage_followup', 'other'];"],
    [P, 'enum: [medicine, feed, sleep, appointment, vaccine, feature, marketing, team_note, other]', 'enum: [medicine, feed, sleep, appointment, vaccine, feature, marketing, team_note, miscarriage_followup, other]']]],
  // 9. the phone's copy
  ['app/usage-allowlist.js hand-edited', 'app/usage-allowlist.js is exactly what core.mjs generates', [[A, '"ios_instructions"', '"ios_instruction"']]],
  // 10. journey keys
  ['JOURNEY_KEYS emptied', 'JOURNEY_KEYS is not empty', [[C, "export const JOURNEY_KEYS = ['pregnancy_week', 'kicks', 'contractions', 'cycle'];", 'export const JOURNEY_KEYS = [];'], [P, 'journey_keys: [pregnancy_week, kicks, contractions, cycle]', 'journey_keys: []']]],
  ['kicks dropped from JOURNEY_KEYS', 'JOURNEY_KEYS holds every pregnancy-only screen and feature', [[C, "['pregnancy_week', 'kicks', 'contractions', 'cycle'];", "['pregnancy_week', 'contractions', 'cycle'];"], [P, 'journey_keys: [pregnancy_week, kicks, contractions, cycle]', 'journey_keys: [pregnancy_week, contractions, cycle]']]],
  ['a new pregnancy screen outside JOURNEY_KEYS', 'JOURNEY_KEYS holds every pregnancy-only screen and feature', [[C, "'den', 'onboarding',\n];", "'den', 'onboarding', 'bump_photos',\n];"], [P, '                 onboarding]', '                 onboarding, bump_photos]']]],
  ['the plan\'s journey_keys drift', 'the plan\'s journey_keys are core.mjs\'s', [[P, 'journey_keys: [pregnancy_week, kicks, contractions, cycle]', 'journey_keys: [pregnancy_week, kicks, contractions]']]],
  ['a JOURNEY_KEY that is no screen or feature', 'every JOURNEY_KEY is a real screen or feature', [[C, "export const JOURNEY_KEYS = ['pregnancy_week', 'kicks', 'contractions', 'cycle'];", "export const JOURNEY_KEYS = ['pregnancy_week', 'kicks', 'contractions', 'cycle', 'bogus'];"],
    [P, 'journey_keys: [pregnancy_week, kicks, contractions, cycle]', 'journey_keys: [pregnancy_week, kicks, contractions, cycle, bogus]']]],
  // 11. retention and the switch
  ['retention drifts', 'retention: the plan\'s days are core.mjs\'s', [[P, 'anon_days: 30 ', 'anon_days: 31 ']]],
  ['wrangler.toml ships another mode', 'the plan names the USAGE_MODE that wrangler.toml ships', [[T, 'USAGE_MODE = "off"', 'USAGE_MODE = "internal"']]],
  ['the plan claims families are measured while the switch is off', 'families_measured is true only when USAGE_MODE is "on"', [[P, '  families_measured: false', '  families_measured: true']]],
  ['rule 1 stops saying families are not measured', 'while families are not measured, the plan says so', [[P, '#      FAMILIES ARE NOT MEASURED until the last step of phase 3', '#      Families are measured from phase 2']]],
  ['the privacy label goes back to Not Linked', 'the plan\'s privacy_label declares Usage Data linked', [[P, '{ data: "Usage Data: Product Interaction", linked: true,', '{ data: "Usage Data: Product Interaction", linked: false,']]],
  // 5. counts
  ['the linked count is wrong', 'its header states the true linked counts', [[P, '13 of the 18 linked', '13 of the 17 linked']]],
  ['the household count is wrong', 'its header states the true derived and total counts', [[P, '13 of the 19 events here are', '12 of the 19 events here are']]],
  // 1 and 3, kept from version 1
  ['the funnel allowlist gains a value', 'onboarding.step_reached.step: same values in plan and allowlist', [[F, "step: ['stage_chosen', 'details_entered', 'first_log_offered', 'invite_offered'],", "step: ['stage_chosen', 'details_entered', 'first_log_offered', 'invite_offered', 'x_step'],"]]],
  ['the funnel reader reads mhealth', 'the reader never names mhealth', [[W, 'async function funnelStepTotals(', "const readsHer = 'mhealth';\nasync function funnelStepTotals("]]],
  // 12. the store answers
  ['§4 answers No to usage data again', 'store: the listing §4 never says usage data, diagnostics or a device id is not collected', [[L, 'financial info, sensitive info categories', 'financial info, usage data (no analytics SDK), sensitive info categories']]],
  ['§4 calls declaring usage data over-declaring', 'store: the listing §4 never says usage data, diagnostics or a device id is not collected', [[L, '(for example claiming we collect location)', '(for example claiming we collect location or usage data)']]],
  ['the review note says no user id', 'store: no store document says "no user id"', [[L, 'linked to the signed-in account and kept on Cubby\'s own servers', 'with no user id and no household id, kept on Cubby\'s own servers']]],
  ['the runbook answers No to usage data', 'store: the runbook never says usage data, diagnostics or a device id is not collected', [[R, 'purchase history and financial info.', 'purchase history, financial info, usage data and diagnostics.']]],
  ['the runbook says "We collect no usage data"', 'store: the runbook never says usage data, diagnostics or a device id is not collected', [[R, 'purchase history and financial info.', 'purchase history and financial info. We collect no usage data.']]],
  ['§4 says "We don\'t collect usage data"', 'store: the listing §4 never says usage data, diagnostics or a device id is not collected', [[L, 'surroundings, body data beyond the declared health logs.', 'surroundings, body data beyond the declared health logs. We don\'t collect usage data.']]],
  ['§4 gains a No row for usage data, in plain words', 'store: the listing §4 never says usage data, diagnostics or a device id is not collected', [[L, '| Diagnostics: other diagnostic data | Yes |', '| Usage data: other usage data | No | n/a | Not applicable. |\n| Diagnostics: other diagnostic data | Yes |']]],
  ['the reviewer note says usage data is not collected', 'store: the reviewer note never says usage data, diagnostics or a device id is not collected', [[L, 'Thank you for reviewing Cubby.\n', 'Thank you for reviewing Cubby.\n\nUsage data is not collected.\n']]],
  ['§4 loses the Product Interaction row', 'store: the listing §4 declares Usage Data, Product Interaction as linked', [[L, '| Usage data: product interaction | Yes | App functionality, Analytics |', '| Usage data: product interaction | No | App functionality |']]],
  ['the runbook loses the before-USAGE_MODE line', 'store: the runbook says the answers must be live before USAGE_MODE becomes "on"', [[R, '**These answers must be live in App Store Connect before `USAGE_MODE` becomes "on"**', '**Publish these answers**']]],
  ['an em-dash in the reviewer note', 'store: the reviewer note has no em-dash', [[L, 'Thank you for reviewing Cubby.', 'Thank you for reviewing Cubby \u2014 truly.']]],
];
/* The store check is conditional on a non-empty allowlist. This staging must NOT be caught by it. */
const QUIET = ['an empty allowlist, with stale store documents, is not a store failure',
  [[C, 'export const USAGE_EVENTS = {', 'export const USAGE_EVENTS = {};\nconst UNUSED_EVENTS = {'], [L, 'financial info, sensitive info categories', 'financial info, usage data (no analytics SDK), sensitive info categories']]];

function stageTree(edits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracking-plan-st-'));
  for (const rel of INPUTS) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(dir, rel));
  }
  for (const [rel, find, repl] of edits) {
    const f = path.join(dir, rel);
    const s = fs.readFileSync(f, 'utf8');
    const at = s.indexOf(find);
    if (at < 0 || s.indexOf(find, at + 1) >= 0) { fs.rmSync(dir, { recursive: true, force: true }); return { error: (at < 0 ? 'anchor missing' : 'anchor not unique') + ' in ' + rel + ': ' + find.slice(0, 60) }; }
    fs.writeFileSync(f, s.slice(0, at) + repl + s.slice(at + find.length));
  }
  return { dir };
}
function runOn(dir) {
  return new Promise((res) => {
    const ch = spawn(process.execPath, [__filename, '--root=' + dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { out += d; });
    ch.on('close', (code) => res({ code, out }));
  });
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function selfTest() {
  console.log('\ntracking plan self-test: each failure is staged in a temporary copy and must be caught for its reason\n');
  let bad = 0;
  const base = stageTree([]);
  const b = await runOn(base.dir);
  fs.rmSync(base.dir, { recursive: true, force: true });
  if (b.code === 0) console.log('  ok   an unaltered copy passes, so every red below is the staging\'s');
  else { bad++; console.log('  FAIL an unaltered copy does not pass:\n' + b.out.split('\n').filter((l) => /FAIL|threw/.test(l)).join('\n')); }

  const results = await pool(STAGES, 8, async ([name, expect, edits]) => {
    const t = stageTree(edits);
    if (t.error) return { name, caught: false, why: t.error };
    const r = await runOn(t.dir);
    fs.rmSync(t.dir, { recursive: true, force: true });
    const hit = r.out.split('\n').some((l) => l.startsWith('  FAIL ' + expect));
    return { name, caught: r.code !== 0 && hit, why: r.code === 0 ? 'the gate passed' : 'red, but not for: ' + expect };
  });
  for (const r of results) {
    if (r.caught) console.log('  ok   caught: ' + r.name);
    else { bad++; console.log('  FAIL not caught: ' + r.name + ' (' + r.why + ')'); }
  }
  const q = stageTree(QUIET[1]);
  if (q.error) { bad++; console.log('  FAIL ' + QUIET[0] + ': ' + q.error); }
  else {
    const r = await runOn(q.dir);
    fs.rmSync(q.dir, { recursive: true, force: true });
    const quiet = /store answers: not required while the allowlist is empty/.test(r.out) && !/\n {2}FAIL store:/.test(r.out);
    if (quiet) console.log('  ok   ' + QUIET[0]);
    else { bad++; console.log('  FAIL ' + QUIET[0]); }
  }
  const caught = results.filter((r) => r.caught).length;
  console.log('\nself-test: ' + caught + ' of ' + STAGES.length + ' stagings caught' + (bad ? ', ' + bad + ' problem(s)' : ''));
  console.log('TRACKING-PLAN SELF-TEST: ' + (bad ? 'FAIL' : 'PASS'));
  return bad;
}

(async () => {
  let failed = 0;
  if (SELF_TEST) failed += await selfTest();
  failed += await judge();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('threw:', e && e.message || e); process.exit(1); });
