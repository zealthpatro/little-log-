/* Is the harness layer real? .claude/settings.json hooks, their scripts, and .claude/rules.
 *
 *   node tools/harness_check.js
 *   node tools/harness_check.js --self-test     also prove every line here can go red
 *
 * WHY. CLAUDE.md is context, not enforcement. The docs say to block an action regardless of what
 * Claude decides you use a PreToolUse hook, and that hooks in .claude/settings.json ship with the
 * repo. So this repo now has them. But a hook is a shell script named in a JSON file, which is the
 * exact shape of thing that looks installed and does nothing: the pre-push hook sat dead for three
 * weeks that way (docs/postmortems/2026-09-04-pre-push-hook-dead-on-arrival.md). So this does not
 * ask whether the files exist. It runs the guard with real commands on stdin and asserts allow and
 * deny, runs the session hook and asserts it speaks, and checks every path the rules name.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');
const RULES_MAX_LINES = 120;
const EVENTS = new Set(['SessionStart','Setup','UserPromptSubmit','UserPromptExpansion','PreToolUse','PermissionRequest',
  'PermissionDenied','PostToolUse','PostToolUseFailure','PostToolBatch','Notification','MessageDisplay','SubagentStart',
  'SubagentStop','TaskCreated','TaskCompleted','Stop','StopFailure','TeammateIdle','InstructionsLoaded','ConfigChange',
  'CwdChanged','DirectoryAdded','FileChanged','WorktreeCreate','WorktreeRemove','PreCompact','PostCompact',
  'PreModelSwitch','PostModelSwitch','Elicitation','ElicitationResult','SessionEnd']);
// Mirrors tools/claudemd_check.js pathTokens on purpose; keep the two in step.
const EXT = /\.(md|js|py|rules|toml|css|html|sh|json|xml|txt)$/;
const SKIP = new Set(['tools/node_modules']);
function pathTokens(text) {
  const out = new Set();
  for (const raw of text.split(/[\s`"'()]+/)) {
    let t = raw.replace(/[.,:;!?—]+$/, '');
    if (!t || t.includes('*') || t.includes('..') || t.includes('$') || /^https?:/.test(t)) continue;
    if (t.startsWith('/')) t = t.slice(1);
    if (!t) continue;
    if (!(t.includes('/') || EXT.test(t) || /^\.[A-Za-z][A-Za-z0-9_.]*$/.test(t))) continue;
    out.add(t.replace(/\/$/, ''));
  }
  return [...out];
}

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 300) : '')); } };

function runHook(script, stdinJson) {
  const r = spawnSync('sh', [script], { input: stdinJson, encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: ROOT }), timeout: 20000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const bashCall = (command) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

function check(root, label) {
  console.log('\n' + label);
  const sp = path.join(root, '.claude', 'settings.json');
  let settings = null;
  try { settings = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch (e) { settings = null; }
  ok('.claude/settings.json exists and parses', !!settings, sp);
  const hooks = (settings && settings.hooks) || {};
  const events = Object.keys(hooks);
  ok('it registers at least one hook event', events.length > 0);
  for (const ev of events) ok('event "' + ev + '" is one Claude Code fires', EVENTS.has(ev), ev);
  const cmds = [];
  for (const ev of events) for (const group of hooks[ev] || []) for (const h of group.hooks || []) if (h.command) cmds.push({ ev, cmd: h.command });
  for (const { ev, cmd } of cmds) {
    const p = cmd.replace('${CLAUDE_PROJECT_DIR}', root);
    ok(ev + ' hook script exists: ' + path.relative(root, p), fs.existsSync(p), p);
    let exe = false; try { exe = (fs.statSync(p).mode & 0o111) !== 0; } catch (e) {}
    ok('and it is executable', exe, p);
  }
  ok('PreToolUse is guarded on Bash', cmds.some((c) => c.ev === 'PreToolUse'));
  ok('SessionStart reports enforcement state', cmds.some((c) => c.ev === 'SessionStart'));

  /* Behaviour, not existence. */
  const guard = path.join(root, '.claude', 'hooks', 'guard-bash.sh');
  if (fs.existsSync(guard)) {
    const denyCases = ['git push origin main --no-verify', 'git worktree remove ../x', 'git branch -D claude/foo',
      'git stash pop', 'git reset --hard origin/main', 'rm -rf .claude/worktrees/abc'];
    for (const c of denyCases) {
      const r = runHook(guard, bashCall(c));
      ok('guard DENIES: ' + c, r.code === 2 && /"permissionDecision":"deny"/.test(r.out), 'exit ' + r.code + ' ' + r.out.slice(0, 80));
    }
    const allowCases = ['git status', 'node tools/gates.js', 'git commit -o app/index.html -m x', 'git stash list', 'ls -la'];
    for (const c of allowCases) {
      const r = runHook(guard, bashCall(c));
      ok('guard allows: ' + c, r.code === 0 && r.out === '', 'exit ' + r.code + ' ' + r.out.slice(0, 80));
    }
    const bad = runHook(guard, 'not json at all');
    ok('guard fails OPEN on malformed input, never blocks by accident', bad.code === 0, 'exit ' + bad.code);
  }
  const ss = path.join(root, '.claude', 'hooks', 'session-start.sh');
  if (fs.existsSync(ss)) {
    const r = runHook(ss, '{}');
    ok('session-start exits 0 and says something', r.code === 0 && r.out.length > 20, 'exit ' + r.code + ' "' + r.out.slice(0, 60) + '"');
    ok('and it names where the rules live', /\.claude\/rules\//.test(r.out), r.out.slice(0, 120));
  }

  /* The rules files: short, and every path they name exists. */
  const rd = path.join(root, '.claude', 'rules');
  const rules = fs.existsSync(rd) ? fs.readdirSync(rd).filter((f) => f.endsWith('.md')) : [];
  ok('.claude/rules has at least one rule file', rules.length > 0);
  for (const f of rules) {
    const text = fs.readFileSync(path.join(rd, f), 'utf8');
    const lines = text.split('\n').length;
    ok(f + ' stays under ' + RULES_MAX_LINES + ' lines (' + lines + ')', lines <= RULES_MAX_LINES);
    const missing = pathTokens(text).filter((t) => !SKIP.has(t) && !fs.existsSync(path.join(root, t)));
    ok(f + ' names only paths that exist', missing.length === 0, 'missing: ' + missing.join(', '));
  }
}

console.log('\nharness: are the hooks and rules that every session gets actually real?');
check(ROOT, 'this checkout');

if (SELF_TEST) {
  /* Stage the failures this gate exists to catch, in a scratch tree, and require red. */
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-red-'));
  fs.mkdirSync(path.join(tmp, '.claude', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.claude/hooks/missing.sh' }] }], Bogus: [] } }));
  fs.writeFileSync(path.join(tmp, '.claude', 'hooks', 'guard-bash.sh'), '#!/bin/sh\nexit 0\n'); // a guard that never denies
  fs.chmodSync(path.join(tmp, '.claude', 'hooks', 'guard-bash.sh'), 0o755);
  fs.writeFileSync(path.join(tmp, '.claude', 'rules', 'r.md'), '# r\nSee tools/does_not_exist.js\n');
  const before = fail;
  const quiet = console.log; console.log = () => {};
  check(tmp, 'self-test scratch');
  console.log = quiet;
  const staged = fail - before;
  fail = before; // the scratch failures are the point, not a verdict on this checkout
  console.log('\nself-test');
  ok('a missing hook script, a bogus event, a guard that never denies, and a stale path all go RED (' + staged + ' lines)', staged >= 8, staged);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('HARNESS: ' + (fail ? 'FAIL' : 'PASS') + '\n');
process.exit(fail ? 1 : 0);
