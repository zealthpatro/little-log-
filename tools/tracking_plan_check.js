/* The tracking plan and the running code must say the same thing.
 *
 *   node tools/tracking_plan_check.js
 *
 * .telemetry/tracking-plan.yaml is what the founder reads to know what Cubby measures, and it is what
 * the App Store privacy answer rests on. A plan that has drifted from the code is worse than no plan,
 * because it is a confident, specific, wrong answer to "what do you collect". So this holds them equal:
 *
 *   1. Every event the plan says is EMITTED by the client exists in the Worker's allowlist
 *      (workers/funnel/core.mjs STEP_EVENTS), with exactly the same properties and the same values.
 *      And the reverse: the allowlist carries nothing the plan does not declare.
 *   2. No event property is shaped like an identifier. One would move the privacy label from
 *      Not Linked to You to Linked to You.
 *   3. The funnel reader in worker.js never touches the three records the plan promises it will not:
 *      her private health, her loss archive, and the map where names live.
 *   4. There is no loss event. That is a decision, not an omission, and it must not quietly come back.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 400) : '')); } };

/* The plan is YAML; this repo carries no YAML parser, and one is not worth a dependency for a file
   this regular. Ruby ships with macOS and parses it properly, so the gate shells out once. */
function loadPlan() {
  const { execFileSync } = require('child_process');
  const out = execFileSync('ruby', ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.load_file(ARGV[0]))',
    path.join(ROOT, '.telemetry', 'tracking-plan.yaml')], { encoding: 'utf8' });
  return JSON.parse(out);
}

(async () => {
  const core = await import('file://' + path.join(ROOT, 'workers', 'funnel', 'core.mjs'));
  const plan = loadPlan();
  const events = plan.events || [];
  console.log('\ntracking plan: the document and the code agree\n');

  console.log('1. the client-emitted events and the Worker allowlist are the same set');
  /* visit.landed is emitted by the Worker's page counter and account.deleted by its purge; neither is
     client input, so neither belongs in the allowlist a browser can call. */
  const SERVER_EMITTED = ['visit.landed', 'account.deleted'];
  const planned = events.filter((e) => e.source === 'emitted' && SERVER_EMITTED.indexOf(e.name) < 0);
  const allow = core.STEP_EVENTS;
  const plannedNames = planned.map((e) => e.name).sort();
  const allowNames = Object.keys(allow).sort();
  ok('the plan and the allowlist name the same client events', JSON.stringify(plannedNames) === JSON.stringify(allowNames),
     { plan: plannedNames, allowlist: allowNames });
  for (const e of planned) {
    const spec = allow[e.name] || {};
    const pprops = (e.properties || []).map((p) => p.name).sort();
    ok(e.name + ': same properties in plan and allowlist', JSON.stringify(pprops) === JSON.stringify(Object.keys(spec).sort()),
       { plan: pprops, allowlist: Object.keys(spec).sort() });
    for (const p of e.properties || []) {
      const a = (spec[p.name] || []).slice().sort(), b = (p.enum || []).slice().sort();
      ok(e.name + '.' + p.name + ': same values in plan and allowlist', JSON.stringify(a) === JSON.stringify(b), { plan: b, allowlist: a });
      ok(e.name + '.' + p.name + ': marked required, because stepKey requires every property', p.required === true, p.required);
    }
  }

  console.log('\n2. nothing in any event is shaped like an identifier');
  const IDENT = /(^|_)(uid|user_id|email|name|household|hid|household_id|phone|note|text|body|address|ip)($|_)/;
  const suspicious = [];
  for (const e of events) for (const p of e.properties || []) if (IDENT.test(p.name)) suspicious.push(e.name + '.' + p.name);
  ok('no event property is named like a person or a household', suspicious.length === 0, suspicious);
  ok('the plan declares no personal data in events', (plan.meta || {}).pii_policy === 'none', (plan.meta || {}).pii_policy);
  /* Paired: the check above has to be able to fire. */
  ok('and that check does catch an identifier when one is there', IDENT.test('owner_uid') && IDENT.test('email') && !IDENT.test('entry_point'));

  console.log('\n3. the reader never touches what the plan promises it will not');
  const worker = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
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

  console.log('\n4. a loss is not a funnel event');
  /* By NAME. The first version also read descriptions and excused any that said "never", which let
     pregnancy.ended straight through, because its description says "never a segment, never a trigger".
     A check whose escape hatch is shaped exactly like the thing it hunts is not a check. */
  const lossy = events.filter((e) => /loss|\.ended\b|_ended\b|miscarr|stillbirth/i.test(e.name));
  ok('no event in the plan measures a pregnancy loss', lossy.length === 0, lossy.map((e) => e.name));
  ok('and the reason is written down, so it is not re-added as an oversight', /pregnancyArchive/.test(JSON.stringify(plan)));

  console.log('\n5. the plan counts its own events correctly');
  const derived = events.filter((e) => e.source === 'derived').length;
  const emitted = events.filter((e) => e.source === 'emitted').length;
  const header = fs.readFileSync(path.join(ROOT, '.telemetry', 'tracking-plan.yaml'), 'utf8');
  const m = /(\d+) of the (\d+) events here are derived/.exec(header);
  ok('its header states the true derived and total counts', !!m && Number(m[1]) === derived && Number(m[2]) === events.length,
     { header: m && m[0], derived, total: events.length, emitted });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('TRACKING-PLAN: ' + (fail ? 'FAIL' : 'PASS') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('threw:', e.message || e); process.exit(1); });
