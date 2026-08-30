#!/usr/bin/env node
/* Build app/ask-data.json: the ask box's whole world.
   ------------------------------------------------------------------------------------------------
   The ask box does RETRIEVAL ONLY. It never writes a sentence of its own, so every word it can ever
   show a parent has to exist, already written and already edited, before the app ships. That is what
   this file makes: the question-and-answer pairs Cubby already publishes in each article's FAQPage
   JSON-LD, lifted out verbatim and keyed by article.

   Why the FAQ blocks and not the article body: they are the only part of the corpus that is already
   a question paired with a short, self-contained, on-voice paragraph. Anything else would have to be
   summarised to fit the answer slot, and summarising is generating.

   WHICH ARTICLES. articles/index.html already carries the taxonomy the site filters by, so the split
   is taken from there rather than re-guessed: data-view="baby" is the baby corpus and data-view="you"
   is the parent's own postpartum wellbeing, which is the same person at the same 3am. Pregnancy is
   excluded because this box lives on the baby Home and on Health, and because every loss and
   bereavement article in the library sits under that view: a baby-stage parent typing "bleeding"
   must not be handed a miscarriage read. "cubby" and "compare" are marketing pages about the product
   and have no business answering a question about a baby.

   Run: node tools/build_ask_index.js         (writes app/ask-data.json, prints the counts)
        node tools/build_ask_index.js --check (verifies the committed file still matches the corpus)
*/
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'app', 'ask-data.json');
const VIEWS = { baby: 1, you: 1 };

function articleViews() {
  const hub = fs.readFileSync(path.join(ROOT, 'articles', 'index.html'), 'utf8');
  const map = {};
  const re = /data-cat="([^"]*)"[^>]*data-view="([^"]*)"[^>]*href="\/articles\/([a-z0-9-]+)\/"/g;
  let m;
  while ((m = re.exec(hub))) map[m[3]] = { cat: m[1], view: m[2] };
  return map;
}

/* NO EM-DASH GETS INTO THE APP. The house voice (DESIGN.md A1) has no em-dash in it, and the ask box
   renders these pairs byte for byte, so four articles were about to put one on a Cubby screen for
   the first time - one of them reachable by typing "should i be worried". The articles themselves
   are not touched here; the index is where the app reads from, so the index is where it is fixed.
   A lone dash is a sentence break, so it becomes a full stop and the next word is capitalised. A
   pair of dashes is a parenthesis, so both become commas. A dash between two digits is a range. */
function deDash(s) {
  let t = String(s).replace(/(\d)\s*[—–]\s*(\d)/g, '$1 to $2');
  const n = (t.match(/[—–]/g) || []).length;
  if (!n) return t;
  if (n % 2 === 0) return t.replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');
  return t.replace(/\s*[—–]\s*(.)/g, (m, c) => '. ' + c.toUpperCase());
}

// The FAQ block is one of several JSON-LD scripts on the page, so it is found by type, not position.
function faqPairs(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (raw.indexOf('FAQPage') < 0) continue;
    let o;
    try { o = JSON.parse(raw); } catch (e) { continue; }
    (o.mainEntity || []).forEach((q) => {
      const a = q && q.acceptedAnswer && q.acceptedAnswer.text;
      if (q && q.name && a) out.push([deDash(String(q.name).trim()), deDash(String(a).trim())]);
    });
  }
  return out;
}

function title(html) {
  const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (h) return h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const t = html.match(/<title>([^<]*)<\/title>/);
  return t ? t[1].split('|')[0].trim() : '';
}

function build() {
  const views = articleViews();
  const dir = path.join(ROOT, 'articles');
  const slugs = fs.readdirSync(dir).filter((s) => {
    const v = views[s];
    return v && VIEWS[v.view] && v.cat !== 'compare' && v.cat !== 'cubby'
      && fs.existsSync(path.join(dir, s, 'index.html'));
  }).sort();
  const docs = [];
  let pairs = 0;
  slugs.forEach((s) => {
    const html = fs.readFileSync(path.join(dir, s, 'index.html'), 'utf8');
    const q = faqPairs(html);
    if (!q.length) return;
    pairs += q.length;
    docs.push({ s: s, t: title(html), q: q });
  });
  return { v: 1, n: pairs, d: docs };
}

const data = build();
const json = JSON.stringify(data);
if (process.argv.indexOf('--check') >= 0) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have === json) {
    console.log('ask-data.json is current: ' + data.d.length + ' articles, ' + data.n + ' pairs');
    process.exit(0);
  }
  console.error('ask-data.json is STALE. Run: node tools/build_ask_index.js');
  process.exit(1);
}
fs.writeFileSync(OUT, json);
console.log('app/ask-data.json  ' + data.d.length + ' articles, ' + data.n + ' Q&A pairs, '
  + Math.round(json.length / 1024) + 'KB');
