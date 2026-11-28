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
const failedNames = []; // the self-test counts which lines went red, not only how many
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; failedNames.push(n); console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + String(x).slice(0, 300) : '')); } };

function runHook(script, stdinJson, extraEnv) {
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: ROOT }, extraEnv || {});
  if (!extraEnv || !('CUBBY_BIG_READ_LINES' in extraEnv)) delete env.CUBBY_BIG_READ_LINES; // a value in the caller's shell must not move the threshold under test
  const r = spawnSync('sh', [script], { input: stdinJson, encoding: 'utf8', env, timeout: 20000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const bashCall = (command, cwd) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd });
const readCall = (input) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: input });

/* Executing these must be denied by guard-bash. Module scope, so the self-test can require every one red. */
const DENY_CASES = ['git push origin main --no-verify', 'git worktree remove ../x', 'git branch -D claude/foo',
  'git stash pop', 'git reset --hard origin/main', 'rm -rf .claude/worktrees/abc', 'rm -rf /', 'rm -rf app',
  'rm -rf ./tools/node_modules', 'cd /tmp && git stash drop', 'M=/x; cd $M && git clean -fd'];

/* Fixtures for the big-read hook: a file over the 400-line default, one under it, and a big one Read pages
   itself. In a temp dir, never in the repo, so the verdict does not move when a repo file grows. */
const os = require('os');
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bigread-'));
const BIG = path.join(FIX, 'big file.txt'), SMALL = path.join(FIX, 'small.txt'), BIGPDF = path.join(FIX, 'big.pdf');
fs.writeFileSync(BIG, Array.from({ length: 1000 }, (_, i) => 'line ' + i).join('\n') + '\n');
fs.writeFileSync(SMALL, Array.from({ length: 10 }, (_, i) => 'line ' + i).join('\n') + '\n');
fs.writeFileSync(BIGPDF, fs.readFileSync(BIG));
const BIG_Q = JSON.stringify(BIG); // the name has a space, so the shell form is quoted
const EMPTY = path.join(FIX, 'empty'); fs.mkdirSync(EMPTY); // a cwd where "big file.txt" does not exist
let bigReadBlockLines = 0; // how many lines must go red when the threshold is removed

/* Is the big-read hook wired on BOTH tools, and does it block a whole read of a big file and nothing else?
   Every line here is named "big-read ..." so the self-test can require these lines, not just any, go red. */
function checkBigRead(root, hooks) {
  const pre = (hooks && hooks.PreToolUse) || [];
  const wiredOn = (tool) => pre.some((g) => { let m = false; try { m = new RegExp('^(?:' + (g.matcher || '.*') + ')$').test(tool); } catch (e) {}
    return m && (g.hooks || []).some((h) => /\/\.claude\/hooks\/big-read\.sh$/.test(String(h.command || ''))); });
  ok('big-read hook is wired on PreToolUse Read', wiredOn('Read'));
  ok('big-read hook is wired on PreToolUse Bash', wiredOn('Bash'));
  const br = path.join(root, '.claude', 'hooks', 'big-read.sh');
  ok('big-read hook script exists', fs.existsSync(br), br);
  if (!fs.existsSync(br)) return;
  const blocks = (r, n) => r.code === 2 && /"permissionDecision":"deny"/.test(r.out) && r.err.indexOf('This file has ' + n + ' lines') === 0 && /cfind/.test(r.err) && /bulk-read --question/.test(r.err);
  const passes = (r) => r.code === 0 && r.out === '';
  const show = (r) => 'exit ' + r.code + ' out=' + r.out.slice(0, 80) + ' err=' + r.err.slice(0, 80);
  const B = [
    ['big-read BLOCKS a whole Read of a 1000-line file', readCall({ file_path: BIG }), 1000],
    ['big-read BLOCKS an unpiped cat of it', bashCall('cat ' + BIG_Q), 1000],
    ['big-read BLOCKS cat -n of it after a cd', bashCall('cd /tmp && cat -n ' + BIG_Q), 1000],
    ['big-read BLOCKS a relative cat, resolved against the call\'s cwd', bashCall('cat "big file.txt"', FIX), 1000],
    ['big-read BLOCKS a relative cat after a cd INTO its directory (not the call\'s cwd)', bashCall('cd ' + JSON.stringify(FIX) + ' && cat "big file.txt"', EMPTY), 1000],
  ];
  bigReadBlockLines = B.length + 1;
  for (const [n, j, lines] of B) { const r = runHook(br, j); ok(n, blocks(r, lines), show(r)); }
  const r5 = runHook(br, readCall({ file_path: SMALL }), { CUBBY_BIG_READ_LINES: '5' });
  ok('big-read honours CUBBY_BIG_READ_LINES (5: the 10-line file is blocked)', blocks(r5, 10), show(r5));
  const P = [
    ['big-read passes a Read of it with offset', readCall({ file_path: BIG, offset: 200 })],
    ['big-read passes a Read of it with limit', readCall({ file_path: BIG, limit: 50 })],
    ['big-read passes a whole Read of a 10-line file', readCall({ file_path: SMALL })],
    ['big-read passes a file that does not exist (Read reports it)', readCall({ file_path: path.join(FIX, 'nope.txt') })],
    ['big-read passes a PDF (Read pages it)', readCall({ file_path: BIGPDF })],
    ['big-read passes a piped cat', bashCall('cat ' + BIG_Q + ' | head -50')],
    ['big-read passes cat into a file', bashCall('cat ' + BIG_Q + ' > /tmp/harness-bigread-copy.txt')],
    ['big-read passes cat into a file with &>', bashCall('cat ' + BIG_Q + ' &>/tmp/harness-bigread-copy.txt')],
    ['big-read passes a relative cat after a cd AWAY from it (the call\'s cwd has it)', bashCall('cd ' + JSON.stringify(EMPTY) + ' && cat "big file.txt"', FIX)],
    ['big-read passes a relative cat after a cd it cannot resolve', bashCall('cd $SOMEWHERE && cat "big file.txt"', FIX)],
    ['big-read passes cat of a 10-line file', bashCall('cat ' + SMALL)],
    ['big-read passes a MENTION of cat in a string', bashCall('echo "cat ' + BIG + '"')],
    ['big-read passes grep -n on it', bashCall('grep -n "line 5" ' + BIG_Q)],
    ['big-read passes a heredoc cat that writes a file', bashCall("cat > /tmp/harness-bigread-x <<'EOF'\n" + BIG + "\nEOF")],
  ];
  for (const [n, j] of P) { const r = runHook(br, j); ok(n, passes(r), show(r)); }
  const bad = runHook(br, 'not json at all');
  ok('big-read fails OPEN on malformed input', bad.code === 0, 'exit ' + bad.code);
}

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
    ok('and it is executable here', exe, p);
    /* And committed that way, or every clone gets a hook the harness cannot run (see hooks_check). */
    const rel = path.relative(root, p).split(path.sep).join('/');
    let committed = '';
    try { committed = spawnSync('git', ['ls-tree', 'HEAD', '--', rel], { cwd: root, encoding: 'utf8' }).stdout.split(/\s+/)[0] || ''; } catch (e) {}
    if (committed) ok('and committed as 100755, so a clone can run it', committed === '100755', rel + ' is ' + committed + ' (fix: git update-index --chmod=+x ' + rel + ')');
  }
  ok('PreToolUse is guarded on Bash', cmds.some((c) => c.ev === 'PreToolUse'));
  checkBigRead(root, hooks);
  ok('SessionStart reports enforcement state', cmds.some((c) => c.ev === 'SessionStart'));

  /* Behaviour, not existence. */
  const guard = path.join(root, '.claude', 'hooks', 'guard-bash.sh');
  if (fs.existsSync(guard)) {
    /* Executing these must be denied. */
    for (const c of DENY_CASES) {
      const r = runHook(guard, bashCall(c));
      ok('guard DENIES: ' + c, r.code === 2 && /"permissionDecision":"deny"/.test(r.out), 'exit ' + r.code + ' ' + r.out.slice(0, 80));
    }
    /* MENTIONING them must not be. The first guard blocked a test fixture inside a heredoc and a scratch
       rm under /tmp, which is how a guard teaches people to route around it. Every case below is a real
       command this repo's own tooling runs. */
    const allowCases = ['git status', 'node tools/gates.js', 'git commit -o app/index.html -m x', 'git stash list', 'ls -la',
      'rm -rf /tmp/fresh-clone', 'rm -rf /private/tmp/claude-501/x/scratch', 'rm -rf node_modules/.cache',
      'echo "git stash pop is blocked here"', 'grep -c "git reset --hard" tools/harness_check.js',
      "cat <<'EOF'\nrm -rf app\ngit worktree remove x\nEOF", "python3 - <<'PY'\ns='rm -rf .claude/worktrees/abc'\nPY",
      'cp .claude/hooks/guard-bash.sh .claude/worktrees/eager/.claude/hooks/guard-bash.sh', 'git push origin main'];
    for (const c of allowCases) {
      const r = runHook(guard, bashCall(c));
      ok('guard allows: ' + c.split('\n')[0].slice(0, 60), r.code === 0 && r.out === '', 'exit ' + r.code + ' ' + r.out.slice(0, 80));
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
    /* .git paths resolve against git's COMMON dir. In a worktree .git is a file pointing at the main
       repository, so ".git/hooks" never exists under root there and this went red in every worktree over
       a rules file that was correct. Same fix, same reason, as tools/claudemd_check.js. */
    let gitCommon = null;
    try { gitCommon = path.resolve(root, require('child_process').execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch (e) {}
    const named = (t) => (gitCommon && (t === '.git' || t.indexOf('.git/') === 0)) ? path.join(gitCommon, t.slice(5)) : path.join(root, t);
    const missing = pathTokens(text).filter((t) => !SKIP.has(t) && !fs.existsSync(named(t)));
    ok(f + ' names only paths that exist', missing.length === 0, 'missing: ' + missing.join(', '));
  }
}

console.log('\nharness: are the hooks and rules that every session gets actually real?');
check(ROOT, 'this checkout');

if (SELF_TEST) {
  /* Stage the failures this gate exists to catch, in a scratch tree, and require red. */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-red-'));
  fs.mkdirSync(path.join(tmp, '.claude', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(tmp, '.claude', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '${CLAUDE_PROJECT_DIR}/.claude/hooks/missing.sh' }] }], Bogus: [] } }));
  fs.writeFileSync(path.join(tmp, '.claude', 'hooks', 'guard-bash.sh'), '#!/bin/sh\nexit 0\n'); // a guard that never denies
  fs.chmodSync(path.join(tmp, '.claude', 'hooks', 'guard-bash.sh'), 0o755);
  fs.writeFileSync(path.join(tmp, '.claude', 'rules', 'r.md'), '# r\nSee tools/does_not_exist.js\n');
  const before = fail, n0 = failedNames.length;
  const quiet = console.log; console.log = () => {};
  check(tmp, 'self-test scratch');
  console.log = quiet;
  /* The scratch tree has no big-read hook, so check() adds big-read lines of its own. They are left out
     of this count: three of them once padded it to 8 while every guard line had stopped going red. */
  const redNames = failedNames.slice(n0).filter((n) => n.indexOf('big-read') !== 0);
  const staged = redNames.length;
  const guardRed = redNames.filter((n) => n.indexOf('guard DENIES: ') === 0).length;
  fail = before; failedNames.length = n0; // the scratch failures are the point, not a verdict on this checkout
  console.log('\nself-test');
  ok('a missing hook script, a bogus event, a guard that never denies, and a stale path all go RED (' + staged + ' lines, big-read lines not counted)', staged >= 8, staged);
  ok('a guard that never denies goes RED on every guard DENIES line (' + guardRed + ' of ' + DENY_CASES.length + ')', guardRed === DENY_CASES.length, redNames.join(' | '));
  fs.rmSync(tmp, { recursive: true, force: true });

  /* The big-read hook, two ways it can die while looking installed: the settings stop naming it, and its
     threshold test is removed so it passes everything. Each must turn ITS lines red. */
  const realBR = fs.readFileSync(path.join(ROOT, '.claude', 'hooks', 'big-read.sh'), 'utf8');
  const realSettings = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8'));
  const stage = (settings, script) => {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-bigread-red-'));
    fs.mkdirSync(path.join(t, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(t, '.claude', 'settings.json'), JSON.stringify(settings));
    fs.writeFileSync(path.join(t, '.claude', 'hooks', 'big-read.sh'), script);
    fs.chmodSync(path.join(t, '.claude', 'hooks', 'big-read.sh'), 0o755);
    const f0 = fail, n0 = failedNames.length;
    console.log = () => {};
    check(t, 'big-read scratch');
    console.log = quiet;
    const red = failedNames.slice(n0).filter((n) => n.indexOf('big-read') === 0);
    fail = f0; failedNames.length = n0;
    fs.rmSync(t, { recursive: true, force: true });
    return red;
  };
  const unwired = JSON.parse(JSON.stringify(realSettings));
  unwired.hooks.PreToolUse = unwired.hooks.PreToolUse.filter((g) => !(g.hooks || []).some((h) => /big-read/.test(h.command || '')));
  const redUnwired = stage(unwired, realBR);
  ok('big-read UNWIRED from settings goes RED on both wiring lines (' + redUnwired.length + ')',
    redUnwired.includes('big-read hook is wired on PreToolUse Read') && redUnwired.includes('big-read hook is wired on PreToolUse Bash'), redUnwired.join(' | '));
  const THRESH = 'if(n>LIMIT) block(n,f);';
  const occurrences = realBR.split(THRESH).length - 1;
  ok('the threshold test the mutation removes is in big-read.sh (' + occurrences + ' places)', occurrences === 2, occurrences);
  const redNoThreshold = stage(realSettings, realBR.split(THRESH).join(''));
  const blockLines = redNoThreshold.filter((n) => /BLOCKS|honours/.test(n));
  ok('big-read with its THRESHOLD REMOVED goes RED on every block line (' + blockLines.length + ' of ' + bigReadBlockLines + ')', bigReadBlockLines >= 6 && blockLines.length === bigReadBlockLines, redNoThreshold.join(' | '));
}
fs.rmSync(FIX, { recursive: true, force: true });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
console.log('HARNESS: ' + (fail ? 'FAIL' : 'PASS') + '\n');
process.exit(fail ? 1 : 0);
