// Cubby journey-card art generator.
//
// Generates the Moments gentle-library illustrations (the bear-cub / Mama-Bear cards)
// to the founder's watercolour bar, then they get baked by tools/compose_cards.js.
//
// Engines (pick with --engine, default gemini):
//   gemini  -> Gemini 2.5 Flash Image ("Nano Banana"), great at keeping the SAME character
//              across many cards when you pass a reference image (--ref). Recommended.
//   openai  -> OpenAI gpt-image-1.
//
// The API key is read from a gitignored file so it never touches the repo or chat:
//   art-src/gemini.key   (or env GEMINI_API_KEY)
//   art-src/openai.key   (or env OPENAI_API_KEY)
//
// IMPORTANT: image generation is NOT free on either engine. The consumer plans
// (Google AI Pro, ChatGPT Plus) do NOT cover the API. You need Gemini API billing
// enabled on the key's Google Cloud project, or prepaid OpenAI credit. A 429
// "RESOURCE_EXHAUSTED / check your billing" means the key is valid but has no quota.
//
// Usage:
//   node tools/gen_art.js --prompt "..." --out art-src/hero-cub.png [--engine gemini] [--ref art-src/sample.png] [--aspect 4:5]
//   node tools/gen_art.js --jobs art-src/jobs.json [--engine gemini]      # batch
//   node tools/gen_art.js --check [--engine gemini]                       # validate key + quota cheaply
//   node tools/gen_art.js --prompt "..." --out x.png --dry-run            # print the request, send nothing
//
// jobs.json = [ { "out": "art-src/001_....png", "prompt": "...", "ref": "art-src/hero-mama.png" }, ... ]
//
// Style anchors + art-direction rules live in docs/journey-art-brief.md and the skill
// at .claude/skills/cubby-journey-art/. Keep captions OUT of the image (baked in code),
// leave the TOP third empty, no border/rounded corners, pregnancy art stays sex-neutral.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ARTSRC = path.join(ROOT, 'art-src');

function parseArgs(argv) {
  const a = { engine: 'gemini', aspect: '4:5' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--dry-run') a.dryRun = true;
    else if (k === '--check') a.check = true;
    else if (k.startsWith('--')) { a[k.slice(2)] = argv[i + 1]; i++; }
  }
  return a;
}

function readKey(engine) {
  const envName = engine === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
  if (process.env[envName]) return process.env[envName].trim();
  const f = path.join(ARTSRC, engine + '.key');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  throw new Error(`No key for ${engine}: set ${envName} or write art-src/${engine}.key`);
}

function refPart(refPath) {
  const buf = fs.readFileSync(refPath);
  const ext = path.extname(refPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
  return { mimeType: mime, b64: buf.toString('base64') };
}

// ---- Gemini (Nano Banana) ----
async function genGemini(key, { prompt, ref, aspect, dryRun }) {
  const parts = [{ text: prompt }];
  if (ref) { const r = refPart(ref); parts.push({ inlineData: { mimeType: r.mimeType, data: r.b64 } }); }
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } } };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=' + key;
  if (dryRun) { console.log('[dry-run] POST gemini-2.5-flash-image  aspect=' + aspect + (ref ? '  ref=' + ref : '') + '\n  prompt: ' + prompt.slice(0, 120) + '…'); return null; }
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error('gemini ' + r.status + ' ' + j.error.status + ': ' + (j.error.message || '').slice(0, 160));
  const ps = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  const img = ps.find(p => p.inlineData);
  if (!img) throw new Error('gemini returned no image (finishReason=' + (((j.candidates || [])[0]) || {}).finishReason + ')');
  return Buffer.from(img.inlineData.data, 'base64');
}

// ---- OpenAI gpt-image-1 ----
function openaiSize(aspect) { return aspect === '4:5' || aspect === '2:3' || aspect === '3:4' ? '1024x1536' : (aspect === '3:2' || aspect === '16:9' ? '1536x1024' : '1024x1024'); }
async function genOpenAI(key, { prompt, ref, aspect, dryRun }) {
  const size = openaiSize(aspect);
  if (dryRun) { console.log('[dry-run] POST openai gpt-image-1  size=' + size + (ref ? '  edit(ref=' + ref + ')' : '  generation') + '\n  prompt: ' + prompt.slice(0, 120) + '…'); return null; }
  let r;
  if (ref) {
    const fd = new FormData();
    fd.append('model', 'gpt-image-1'); fd.append('prompt', prompt); fd.append('size', size);
    fd.append('image', new Blob([fs.readFileSync(ref)]), path.basename(ref));
    r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  } else {
    r = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }) });
  }
  const j = await r.json();
  if (j.error) throw new Error('openai ' + r.status + ': ' + (j.error.message || '').slice(0, 160));
  const b64 = ((j.data || [])[0] || {}).b64_json;
  if (!b64) throw new Error('openai returned no image');
  return Buffer.from(b64, 'base64');
}

async function generate(engine, key, opts) {
  return engine === 'openai' ? genOpenAI(key, opts) : genGemini(key, opts);
}

// Cheap validity/quota probe: a tiny generation. Reports key-valid vs needs-billing.
async function check(engine, key) {
  try {
    const buf = await generate(engine, key, { prompt: 'a small soft cream circle on a pale background', aspect: '1:1' });
    console.log('✅ ' + engine + ': key valid AND image quota available (' + (buf ? buf.length : 0) + ' bytes).');
  } catch (e) {
    const m = String(e.message || e);
    if (/429|RESOURCE_EXHAUSTED|quota|billing/i.test(m)) console.log('⚠️  ' + engine + ': key is VALID but has NO image quota — enable billing/credit. (' + m + ')');
    else if (/401|403|API_KEY|invalid|Unauthorized/i.test(m)) console.log('❌ ' + engine + ': key invalid/unauthorized. (' + m + ')');
    else console.log('❓ ' + engine + ': ' + m);
  }
}

(async () => {
  const a = parseArgs(process.argv);
  const engine = a.engine === 'openai' ? 'openai' : 'gemini';
  let key = null;
  try { key = readKey(engine); } catch (e) { if (!a.dryRun) { console.error(String(e.message)); process.exit(2); } }

  if (a.check) { await check(engine, key); return; }

  fs.mkdirSync(ARTSRC, { recursive: true });
  const jobs = a.jobs
    ? JSON.parse(fs.readFileSync(path.isAbsolute(a.jobs) ? a.jobs : path.join(ROOT, a.jobs), 'utf8'))
    : [{ out: a.out, prompt: a.prompt, ref: a.ref, aspect: a.aspect }];

  let ok = 0, fail = 0;
  for (const job of jobs) {
    if (!job.out || !job.prompt) { console.error('skip: job needs out + prompt'); fail++; continue; }
    const out = path.isAbsolute(job.out) ? job.out : path.join(ROOT, job.out);
    const ref = job.ref ? (path.isAbsolute(job.ref) ? job.ref : path.join(ROOT, job.ref)) : null;
    try {
      const buf = await generate(engine, key, { prompt: job.prompt, ref, aspect: job.aspect || a.aspect, dryRun: a.dryRun });
      if (a.dryRun) { ok++; continue; }
      fs.writeFileSync(out, buf);
      console.log('✅ ' + path.relative(ROOT, out) + '  (' + Math.round(buf.length / 1024) + ' KB)');
      ok++;
    } catch (e) { console.error('❌ ' + (job.out) + ' — ' + String(e.message || e)); fail++; }
  }
  console.log(`\ndone: ${ok} ok, ${fail} failed` + (a.dryRun ? ' (dry-run)' : ''));
  if (fail && !ok) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
