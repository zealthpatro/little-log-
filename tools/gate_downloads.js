#!/usr/bin/env node
/* Where a gate's Chrome saves files. Never the founder's ~/Downloads.
 *
 *   const dl = require('./gate_downloads');
 *   puppeteer.launch({ ..., downloadBehavior: dl.downloadBehavior() })
 *   browser.createBrowserContext({ downloadBehavior: dl.downloadBehavior() })   a new context does NOT inherit it
 *
 *   node tools/gate_downloads.js --self-test <base-url>   a real saveFile() lands in the temp dir, and the matcher can go red
 *
 * WHY. Headless Chrome saves an <a download> into the real ~/Downloads, and saveFile() in app/index.html
 * is exactly that. By 2026-09-24 the gates that click Cubby's calendar exports had left 223 copies of
 * robin-vaccines*.ics and cubby-pregnancy-weeks*.ics there, a pair every suite run. This REDIRECTS, it
 * does not deny: a download is behaviour under test, and a gate that wants the bytes can read them back
 * from downloadDir(). tools/gates.js snapshots ~/Downloads around every gate and fails the one that adds
 * to it, so the next gate that forgets this is named on its first run.
 *
 * The temp dir is per process (each gate is its own process, so per run) and is left in os.tmpdir() for
 * the OS to clear: nothing here deletes files.
 *
 * Two ways 'allow' differs from Chrome's default, both measured 2026-10-06. It lets every scripted
 * download through, where the default silently drops a second one from the same page (flow_walk's
 * cubby-pregnancy-weeks-off.ics never reached ~/Downloads; here it arrives). And a second file of the
 * same name REPLACES the first instead of becoming "name (1)", so a gate that reads bytes back sees
 * only the latest save of each name.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let dir = null;
/* Created on first use, so a gate that never downloads leaves nothing behind. */
function downloadDir() {
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cubby-gate-downloads-'));
  return dir;
}
function downloadBehavior() {
  return { policy: 'allow', downloadPath: downloadDir() };
}

/* The guard's half. ~/Downloads, or null where there is none to protect (CI is Linux). */
function userDownloads(home) {
  const d = path.join(home || os.homedir(), 'Downloads');
  try { return fs.statSync(d).isDirectory() ? d : null; } catch (e) { return null; }
}
/* Finder writes these when someone merely opens the folder; they are not downloads. */
const NOT_A_DOWNLOAD = new Set(['.DS_Store', '.localized']);
function snapshot(d) {
  if (!d) return null;
  try { return new Set(fs.readdirSync(d)); } catch (e) { return null; }
}
function added(before, after) {
  if (!before || !after) return [];
  return [...after].filter((n) => !before.has(n) && !NOT_A_DOWNLOAD.has(n)).sort();
}
/* macOS stamps every download with the app that saved it. A gate's file says Chrome; one the founder
   saved from the Claude app said Claude, mid-suite, on the first run of this guard. Shown, not
   trusted: a person's own Chrome download says Chrome too. */
function savedBy(d, name) {
  if (process.platform !== 'darwin') return '';
  const r = require('child_process').spawnSync('xattr', ['-p', 'com.apple.quarantine', path.join(d, name)]);
  const agent = r.status === 0 ? String(r.stdout).split(';')[2] : '';
  return agent ? ' (saved by ' + agent.trim() + ')' : '';
}
function guardMessage(gate, names, d) {
  const shown = names.slice(0, 8).map((n) => n + savedBy(d, n)).join(', ') + (names.length > 8 ? ', and ' + (names.length - 8) + ' more' : '');
  return [
    'FAIL downloads guard: ' + gate + ' left ' + names.length + ' new ' + (names.length === 1 ? 'entry' : 'entries') + ' in ' + d + ': ' + shown,
    '     Give its Chrome downloadBehavior from tools/gate_downloads.js, on puppeteer.launch() and on every',
    '     browser.createBrowserContext() too. That REDIRECTS the file to a temp dir; do not stub it away.',
    '     A download you made yourself, or another gate run on this machine, during this gate trips it too:',
    '     if that is what happened, re-run this gate alone.',
  ].join('\n');
}

module.exports = { downloadDir, downloadBehavior, userDownloads, snapshot, added, guardMessage };

if (require.main === module && process.argv.includes('--self-test')) {
  const BASE = (process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');
  const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let pass = 0, fail = 0;
  const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '\n         ' + JSON.stringify(x).slice(0, 240) : '')); } };
  /* A name nothing else on this machine writes, so another session's gate run cannot fake either answer. */
  const NAME = 'gate-downloads-selftest-' + process.pid + '.ics';
  const landed = async (where, ms) => {
    const stop = Date.now() + ms;
    for (;;) {
      if (fs.existsSync(path.join(where, NAME))) return true;
      if (Date.now() > stop) return false;
      await sleep(150);
    }
  };
  /* Through the app's own exit, not a stand-in anchor, so a change to saveFile() is graded here too. */
  const save = async (page) => {
    await page.goto(BASE + '/app/?e2e=1', { waitUntil: 'networkidle2', timeout: 40000 });
    await page.waitForFunction(() => typeof saveFile === 'function', { timeout: 15000 });
    await page.evaluate((n) => {
      const b = new Blob(['BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'], { type: 'text/calendar' });
      saveFile(URL.createObjectURL(b), n);
    }, NAME);
  };

  (async () => {
    console.log('\ngate downloads: a gate\'s Chrome saves into a temp dir, never ~/Downloads');
    if (!BASE) { console.log('  FAIL pass a base URL (tools/gates.js does)'); process.exit(1); }
    const home = userDownloads();
    const before = snapshot(home);
    const where = downloadDir();
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], downloadBehavior: downloadBehavior() });
    try {
      console.log('\nthe default context, set at launch');
      const page = await browser.newPage();
      await save(page);
      ok('saveFile() lands in ' + where, await landed(where, 10000), fs.readdirSync(where));
      ok('byte for byte', fs.existsSync(path.join(where, NAME)) && /^BEGIN:VCALENDAR/.test(fs.readFileSync(path.join(where, NAME), 'utf8')));
      fs.renameSync(path.join(where, NAME), path.join(where, 'launch-' + NAME));

      console.log('\na context made later, which inherits nothing from launch');
      const ctx = await browser.createBrowserContext({ downloadBehavior: downloadBehavior() });
      await save(await ctx.newPage());
      ok('saveFile() in it lands in the same temp dir', await landed(where, 10000), fs.readdirSync(where));
      fs.renameSync(path.join(where, NAME), path.join(where, 'context-' + NAME));
      await ctx.close();

      /* The assertion above is "the file appeared". Prove it can say no: a context that refuses
         downloads must leave the same matcher empty. ('deny' is only the red half of this test; the
         gates REDIRECT, because the download is what they are testing.) */
      console.log('\nself-test');
      const denied = await browser.createBrowserContext({ downloadBehavior: { policy: 'deny' } });
      await save(await denied.newPage());
      ok('a context that drops the download leaves the matcher RED', !(await landed(where, 3000)), fs.readdirSync(where));
      await denied.close();
    } catch (e) {
      ok('the self-test ran to the end', false, String(e && e.message || e));
    } finally {
      await browser.close();
    }
    /* Named, not a whole-folder diff: another session's suite may be writing there right now. */
    const after = snapshot(home);
    if (home) ok('and nothing by this name reached ' + home, !added(before, after).some((n) => n.indexOf('gate-downloads-selftest-') === 0), added(before, after));
    else console.log('  (no ~/Downloads on this machine, nothing to check there)');

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    console.log('GATE-DOWNLOADS: ' + (fail ? 'FAIL' : 'PASS') + '\n');
    process.exit(fail ? 1 : 0);
  })();
}
