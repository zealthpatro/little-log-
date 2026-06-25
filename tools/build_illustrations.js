// Derives the de-duplicated illustration list from the card catalog. Captions are overlaid by
// the app, so several cards can share ONE text-free illustration. ALIAS maps a card key -> the
// card whose illustration it reuses (conservative — only genuine visual duplicates, so we don't
// flatten the variety). Output: docs/journey-illustrations.json = the exact set to generate,
// each with its prompt + which captions reuse it. Run: node tools/build_illustrations.js
const fs = require('fs');
const path = require('path');
const cat = require('../docs/journey-cards.json');

// card key -> key whose illustration it reuses (same scene, caption differs)
const ALIAS = {
  'pmem-youarehere': 'bm-hello',   // newborn cub wrapped
  'bp-bathtime': 'bf-bath',        // cub with a towel
  'bp-tummytime': 'bm-w2',         // cub lying on tummy
  'bp-teddy': 'bm-18',             // cub hugging a plush
  'bp-happy': 'bf-smile',          // smiling cub
  'bp-madesmile': 'bf-smile',      // cheerful smiling cub
  'bm-2': 'bf-smile',              // smiling softly
  'pt-tri1': 'pm-3',               // small bump
  'pt-tri2': 'pm-6',               // medium bump
  'pt-tri3': 'pm-8',               // large bump
  'pt-halfway': 'pm-5',            // medium bump
  'pt-almost': 'pm-8',             // large bump
  'pt-countdown': 'pm-9',          // very large bump
  'pt-duesoon': 'pm-9',
  'pt-readytopop': 'pm-9',
  'pmem-lastbump': 'pm-9'
};

const byKey = {};
cat.cards.forEach(c => { byKey[c.key] = c; });
const artOf = (k) => ALIAS[k] || k;

const illos = {};
cat.cards.forEach(c => {
  const art = artOf(c.key);
  const src = byKey[art];
  if (!illos[art]) illos[art] = { art: art, file: art + '.webp', who: src.who, prompt: src.illo, captions: [], cards: [] };
  illos[art].captions.push(c.cap || '(free caption)');
  illos[art].cards.push(c.key);
});

const list = Object.values(illos).sort((a, b) => a.art.localeCompare(b.art));
const out = {
  _README: 'De-duplicated illustration set to generate. file = app/journey-art/<art>.webp (text-FREE; app overlays each caption). cards[] = every catalog card that reuses this illustration. Derived from journey-cards.json by tools/build_illustrations.js — edit the ALIAS map there, not this file.',
  totalCards: cat.cards.length,
  uniqueIllustrations: list.length,
  reused: cat.cards.length - list.length,
  illustrations: list
};
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'journey-illustrations.json'), JSON.stringify(out, null, 2) + '\n');
console.log(cat.cards.length + ' cards -> ' + list.length + ' unique illustrations (' + out.reused + ' reuse another)');
const shared = list.filter(i => i.cards.length > 1);
console.log('shared illustrations:');
shared.forEach(i => console.log('  ' + i.art + '  <-  ' + i.cards.join(', ')));
