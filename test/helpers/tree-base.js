/* The app server a browser suite drives, proven to be THIS tree's before anything is graded (16 Nov 2026).
 *
 * Two tree-tier suites that start their own Firestore emulator (test/preg-tick-race.test.js and
 * test/two-caregiver-journey.test.js) ignored the URL tools/gates.js passed them. Each drove whatever answered
 * on a fixed localhost port (8097, 8380), reusing ANY server that gave a 200 there, with fixed emulator ports
 * beside it, and neither one's catch path stopped the serve.js it had started, so one throw left a server for
 * every later run on every checkout to grade. Given the URL of a tree with no app while another checkout's
 * server listened on the wildcard address of that port, they passed 8 of 8 and 26 of 26 (two-caregivers even
 * said "the static server is serving this checkout": it only asked for a 200). So, for both:
 *   - freePorts(names): every port they bind comes from the runner's own picker
 *     (`node tools/gates.js --free-ports=N`, inside EMU_PORT_RANGE when set, free at every address);
 *   - appServer(url, port): the base URL the runner passed, or, run alone, this tree's own serve.js on a free
 *     port, inside the wrapper tools/gates.js uses (it exits when its stdin, a pipe only this process holds,
 *     closes, so no ending of the suite leaves it behind), once it has said it is listening;
 *   - provenThisTree(base, plantPort): `node tools/gates.js --served-is-this-tree=<base>` must say yes (this
 *     tree's app/index.html, app/store-firebase.js and app/sw.js, byte for byte), and, as its companion, the
 *     same check must say no to a server planted here whose app/index.html has one comment more.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* node tools/gates.js <args>: its output and exit code. Asynchronous, so a server planted in this process answers. */
function gatesTool(args) {
  return new Promise((res) => {
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) if (/^GIT_/.test(k)) delete env[k];
    const p = spawn(process.execPath, [path.join(REPO, 'tools', 'gates.js')].concat(args), { cwd: REPO, env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => res({ code, out: out.trim() }));
    p.on('error', (e) => res({ code: 127, out: String(e.message) }));
  });
}

/* { NAME: port } for each name, or a thrown Error saying why not. */
async function freePorts(names) {
  const r = await gatesTool(['--free-ports=' + names.length]);
  const nums = r.out.split(/\s+/).map(Number);
  if (r.code !== 0 || nums.length !== names.length || !nums.every((x) => x > 0)) throw new Error('no ' + names.length + ' free ports: ' + r.out);
  const out = {};
  names.forEach((n, i) => { out[n] = nums[i]; });
  return out;
}

/* serve.js inside the wrapper tools/gates.js uses: it exits when its stdin closes. */
const TETHER = 'process.stdin.on("end", () => process.exit(0)); process.stdin.on("error", () => process.exit(0));'
  + ' process.stdin.resume(); require(process.argv[1]);';

/* { base, stop() }: `url` when the runner passed one (stop() does nothing then), else this tree's serve.js on
   `port`, resolved once it has printed its "serving" line; a thrown Error if it exits first or never says so. */
async function appServer(url, port) {
  if (url) return { base: String(url).replace(/\/+$/, ''), stop() {} };
  const proc = spawn(process.execPath, ['-e', TETHER, path.join(REPO, 'tools', 'serve.js')],
    { cwd: REPO, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: ['pipe', 'pipe', 'pipe'] });
  const srv = { base: 'http://127.0.0.1:' + port, stop() { try { proc.kill(); } catch (e) { /* gone */ } } };
  process.on('exit', srv.stop);
  let said = '', gone = null;
  proc.stdout.on('data', (d) => { said += d; });
  proc.stderr.on('data', (d) => { said += d; });
  proc.on('close', (code, signal) => { gone = signal || ('exit ' + code); });
  proc.on('error', (e) => { gone = e.message; });
  const until = Date.now() + 15000;
  while (!/^serving /m.test(said)) {
    if (gone) throw new Error('this tree\'s serve.js on :' + port + ' exited before it was listening (' + gone + '): ' + said.trim().slice(0, 200));
    if (Date.now() > until) { srv.stop(); throw new Error('this tree\'s serve.js on :' + port + ' never said it was listening'); }
    await sleep(50);
  }
  return srv;
}

/* The two checks, as [name, passed, detail]: the server at `base` serves this tree, and (the companion) the
   same check says no to a server on `plantPort` whose app/index.html differs. */
async function provenThisTree(base, plantPort) {
  const mine = await gatesTool(['--served-is-this-tree=' + base]);
  const files = {};
  for (const rel of ['app/index.html', 'app/store-firebase.js', 'app/sw.js']) files['/' + rel] = fs.readFileSync(path.join(REPO, rel));
  files['/app/index.html'] = Buffer.concat([files['/app/index.html'], Buffer.from('<!-- another checkout -->\n')]);
  const plant = http.createServer((q, r) => { const b = files[String(q.url).split('?')[0]]; r.writeHead(b ? 200 : 404); r.end(b || '404'); });
  const err = await new Promise((res) => { plant.once('error', (e) => res(e.code)); plant.listen(plantPort, '127.0.0.1', () => res(null)); });
  const other = err ? { code: null, out: 'the planted server could not listen on :' + plantPort + ': ' + err } : await gatesTool(['--served-is-this-tree=http://127.0.0.1:' + plantPort]);
  if (!err) plant.close();
  return [
    ['the server at ' + base + ' serves this tree\'s app byte for byte', mine.code === 0, mine.out],
    ['companion: that check says no to a server whose app/index.html differs, naming that file', other.code === 1 && /app\/index\.html differs/.test(other.out), other.out],
  ];
}

module.exports = { REPO, gatesTool, freePorts, appServer, provenThisTree };
