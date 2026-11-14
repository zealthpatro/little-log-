#!/usr/bin/env node
/* SetItemRow is the second code component (design/DESIGN-SYSTEM.md §4, docs/plans/2026-10-09-ADR-001-sdui.md).
 * The icon, title and subtitle row is the most repeated row in the app: app/index.html had 63 copies written
 * by hand (two more live in teach-ui.js and log-guide.js), most with their own onclick string and each with
 * its own idea of what to escape. The Settings and Data sheets moved onto setItem first, 23 rows in all. In that move the Guardians row stopped printing the names
 * members give themselves raw into the page, the export row stopped needing a caller to remember
 * escapeHtml, and every tap became a named action in UI_ACTIONS.
 * Nothing on screen changes when a row quietly starts printing a word raw, when a read-only row starts to
 * look tappable, when the teaching dot loses its place after the title, or when someone hand-writes a
 * sixty-fourth row with an onclick in it. It just waits for the first odd name.
 *
 * So this states the row's contract in its own words and holds setItem to it:
 *   - title, sub and value are escaped, and the only tags in a row are the component's own (plus the
 *     teaching module's dot, which is its markup, not ours)
 *   - a 0 prints as 0; a missing value prints nothing, never "undefined"
 *   - a row with an act carries data-act (data-args only for real args) and a pointer; a row without one
 *     carries neither and a default cursor; no row carries an inline handler
 *   - the icon box: a key of I on its soft fill, a solid fill with a white icon, or a glyph, each exactly;
 *     a bad colour token falls back to 'line', and icons come only from I's own keys
 *   - danger colours the title and nothing else; a value is one span before the chevron; the chevron is I.chev
 *   - the teaching dot comes from CubbyTeachUI, else from CubbyGuide, else nowhere, and only when asked for
 *   - two rows match a pinned copy, the shape the .set-item CSS is written against
 *   - in the Settings and Data sheets: no hand-written row is left, and every act is a registry key
 *   - in the whole of app/index.html: no row is handed escapeHtml output or an entity, the hand-written rows
 *     only fall, and exactly the 23 call sites this migration made
 * The registry and the dispatcher belong to tools/alert_pill_check.js, which reads every component's
 * calls; this file only holds what setItem adds.
 *
 * Static: it lifts escapeHtml and the component block out of app/index.html and runs them in a vm with
 * stubs, no browser. The probes are plain text: tags, quotes, ampersands, backslashes, U+2028 and numbers.
 * No probe is a script.
 *
 *   node tools/set_item_check.js               check the tree
 *   node tools/set_item_check.js --self-test   first break the source many ways and require each break
 *                                              to turn its own numbered check red, then check the tree
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');

/* THE SPEC. Written here, not derived from the code it checks. */
// Twenty-three hand-written rows moved onto setItem in this migration: seventeen in openSettings (Appearance,
// home screen, Den, babies, archive, profile, family, Pro, share, feedback, reminders, what you log, mood
// note, blood pressure, recently deleted, data, log out) and six in openDataSheet (export twice, the
// guardian's and the read-only one, import, delete data, guardians, delete account). A row added or removed
// changes this on purpose: edit the number here in the same commit and name the row in the commit message.
// It is fixed so that a row cannot appear or vanish without someone deciding it did.
const EXPECTED_CALLS = 23;
// Hand-written class="set-item" rows in app/index.html outside function setItem. 63 before the SetItemRow
// migration, 40 after it (the 23 rows above). A ratchet, not a target: it may fall and may not rise. Lower
// it when a migration takes more, never raise it to make a run go green.
const HAND_CEILING = 40;
// The sheets this migration finished, and the one row in them that is meant to be read-only: export, for
// someone who is not a guardian. It says the door exists and whose it is; it opens nothing.
const SHEETS = ['openSettings', 'openDataSheet'];
const READ_ONLY = { openSettings: [], openDataSheet: ["title:'Export data'"] };
const DEFAULT_TOKEN = 'line';
const ICONS = { chev: '<svg data-i="chev"></svg>', moon: '<svg data-i="moon"></svg>',
  trash: '<svg data-i="trash"></svg>', note: '<svg data-i="note"></svg>' };
// What the stubbed teaching modules draw. The real dots are buttons too; their markup is theirs.
const TEACH_DOT = '<button class="lg-i">i</button>';
const GUIDE_DOT = '<button class="lg-i lg-guide">i</button>';
const OWN_TAGS = ['div', 'span', 'svg'];
const OWN_ATTRS = ['class', 'data-act', 'data-args', 'data-i', 'style'];
const VALUE_STYLE = 'font-weight:800;font-size:var(--fs-body);color:var(--ink-soft)';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const lineOf = (s, i) => s.slice(0, i).split('\n').length;

function slice(src, start, end, label) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`cannot find ${label} (${JSON.stringify(start)}) in app/index.html`);
  const j = src.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`cannot find the end of ${label} in app/index.html`);
  return src.slice(i, j + end.length);
}
// From start up to, not including, end: the component block ends on the line before the HOME banner.
function sliceBefore(src, start, end, label) {
  return slice(src, start, end, label).slice(0, -end.length);
}

/* escapeHtml plus the component block, in a fresh context each time, with the teaching modules loaded or
   not as a check asks. window is the context itself, as in a browser, so window.CubbyTeachUI and a bare
   CubbyTeachUI are the same thing. The stub dots record what they were asked for. */
function load(src, mods) {
  const m = mods || {};
  const esc = slice(src, 'function escapeHtml(s){', '\n', 'escapeHtml');
  const core = sliceBefore(src, 'const UI_ACTIONS=', '/* ---------- HOME ---------- */', 'the component block');
  const teach = [], guide = [];
  const ctx = { I: Object.assign({}, ICONS), document: { addEventListener: () => {} } };
  ctx.window = ctx;
  if (m.teach) ctx.CubbyTeachUI = { dot: function () { teach.push(Array.from(arguments)); return TEACH_DOT; } };
  if (m.guide) ctx.CubbyGuide = { info: function () { guide.push(Array.from(arguments)); return GUIDE_DOT; } };
  if (m.guideNoInfo) ctx.CubbyGuide = { settingsRow: () => '' };
  vm.createContext(ctx);
  vm.runInContext(esc + '\n' + core + '\nthis.api = { setItem, UI_ACTIONS };', ctx);
  return { api: ctx.api, teach, guide, ctx };
}

/* A strict reader for the markup one row returns: quoted attributes only, no stray < or >, every tag
   closed by its own name. Anything else throws, so an attribute an unescaped quote broke out of is a
   red check, not a quietly different tree. (The reader tools/alert_pill_check.js uses, copied.) */
function parse(html) {
  const root = { tag: '#root', attrs: {}, kids: [], parent: null };
  let cur = root, i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const text = html.slice(i, lt < 0 ? html.length : lt);
    if (text) {
      if (text.includes('>')) throw new Error('raw > in text ' + JSON.stringify(text));
      cur.kids.push({ text });
    }
    if (lt < 0) break;
    const rest = html.slice(lt);
    const close = /^<\/([a-z][a-z0-9]*)>/.exec(rest);
    if (close) {
      if (cur.tag !== close[1]) throw new Error(`</${close[1]}> closes <${cur.tag}>`);
      cur = cur.parent; i = lt + close[0].length; continue;
    }
    const open = /^<([a-z][a-z0-9]*)/.exec(rest);
    if (!open) throw new Error('stray < at ' + JSON.stringify(rest.slice(0, 30)));
    let j = lt + open[0].length; const attrs = {};
    for (;;) {
      const m = /^\s+([a-z][a-z0-9-]*)(?:="([^"]*)")?/.exec(html.slice(j));
      if (m) {
        if (own(attrs, m[1])) throw new Error('duplicate attribute ' + m[1]);
        attrs[m[1]] = m[2] === undefined ? '' : m[2]; j += m[0].length; continue;
      }
      if (html[j] === '>') { j++; break; }
      throw new Error('malformed tag ' + JSON.stringify(html.slice(lt, j + 24)));
    }
    const el = { tag: open[1], attrs, kids: [], parent: cur };
    cur.kids.push(el); cur = el; i = j;
  }
  if (cur !== root) throw new Error('unclosed <' + cur.tag + '>');
  return root;
}
const walk = (n, out = []) => { n.kids.forEach((k) => { if (k.tag) { out.push(k); walk(k, out); } }); return out; };
const byClass = (root, c) => walk(root).filter((e) => (e.attrs.class || '').split(' ').includes(c));
const one = (root, c) => { const l = byClass(root, c); if (l.length !== 1) throw new Error(`${l.length} .${c}`); return l[0]; };
const raw = (e) => e.kids.map((k) => (k.tag ? raw(k) : k.text)).join('');
// The markup inside an element, written back out the way the reader read it (attributes in order, quoted).
const inner = (e) => e.kids.map((k) => (k.tag ? `<${k.tag}${Object.keys(k.attrs).map((a) => ` ${a}="${k.attrs[a]}"`).join('')}>${inner(k)}</${k.tag}>` : k.text)).join('');
const textOf = (e) => e.kids.filter((k) => !k.tag).map((k) => k.text).join('');   // its own text, not its children's
const tags = (root, t) => walk(root).filter((e) => e.tag === t);
const elKids = (e) => e.kids.filter((k) => k.tag);
// The five entities escapeHtml writes, &amp; last so "&amp;quot;" comes back as "&quot;", as a browser does.
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// The row itself: the one top-level element. Anything beside it is a red check.
function rowOf(html) {
  const root = parse(html);
  const top = elKids(root);
  if (top.length !== 1 || root.kids.some((k) => !k.tag && k.text.trim())) throw new Error('a row is not exactly one element');
  return { root, row: top[0] };
}
const valueSpans = (root) => tags(root, 'span').filter((s) => s.attrs.class !== 'chev');
const icoOf = (html) => { const { root } = rowOf(html); const b = one(root, 'si-ico'); return { style: b.attrs.style, inner: inner(b), box: b }; };

/* Every setItem( call in a text, with its argument text, found by a scanner that knows strings, templates
   and comments, so a ')' inside a subtitle never ends the call early. localStorage.setItem( is not one. */
function callArgs(s, start) {
  const stack = [{ t: 'code', b: 0 }]; let depth = 1;
  for (let i = start; i < s.length; i++) {
    const f = stack[stack.length - 1], c = s[i];
    if (f.t === 'code') {
      if (c === "'" || c === '"') stack.push({ t: 'str', q: c });
      else if (c === '`') stack.push({ t: 'tpl' });
      else if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; }
      else if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 1; }
      else if (c === '{') f.b++;
      else if (c === '}') { if (f.b === 0 && stack.length > 1) stack.pop(); else f.b--; }
      else if (stack.length === 1 && c === '(') depth++;
      else if (stack.length === 1 && c === ')' && --depth === 0) return s.slice(start, i);
    } else if (f.t === 'str') {
      if (c === '\\') i++; else if (c === f.q) stack.pop();
    } else if (c === '\\') i++;
    else if (c === '`') stack.pop();
    else if (c === '$' && s[i + 1] === '{') { stack.push({ t: 'code', b: 0 }); i++; }
  }
  throw new Error('unterminated setItem( call at line ' + lineOf(s, start));
}
function calls(s, base) {
  const out = []; const re = /(?<![\w$.])setItem\(/g; let m;
  while ((m = re.exec(s))) {
    if (s.slice(Math.max(0, m.index - 9), m.index) === 'function ') continue;
    out.push({ line: base ? base(m.index) : lineOf(s, m.index), args: callArgs(s, m.index + m[0].length) });
  }
  return out;
}
/* The body of one top-level function, found by the same scanner counting braces, so a '}' inside a
   template or a comment never ends it early. */
function bodyOf(src, name) {
  const head = `function ${name}(){`;
  const i = src.indexOf(head);
  if (i < 0) throw new Error(`cannot find ${head} in app/index.html`);
  if (src.indexOf(head, i + 1) >= 0) throw new Error(`${head} appears twice`);
  const start = i + head.length;
  const stack = [{ t: 'code', b: 0 }];
  for (let k = start; k < src.length; k++) {
    const f = stack[stack.length - 1], c = src[k];
    if (f.t === 'code') {
      if (c === "'" || c === '"') stack.push({ t: 'str', q: c });
      else if (c === '`') stack.push({ t: 'tpl' });
      else if (c === '/' && src[k + 1] === '/') { const e = src.indexOf('\n', k); k = e < 0 ? src.length : e; }
      else if (c === '/' && src[k + 1] === '*') { const e = src.indexOf('*/', k + 2); k = e < 0 ? src.length : e + 1; }
      else if (c === '{') f.b++;
      else if (c === '}') {
        if (f.b > 0) f.b--;
        else if (stack.length > 1) stack.pop();
        else return { a: start, b: k, body: src.slice(start, k) };
      }
    } else if (f.t === 'str') {
      if (c === '\\') k++; else if (c === f.q) stack.pop();
    } else if (c === '\\') k++;
    else if (c === '`') stack.pop();
    else if (c === '$' && src[k + 1] === '{') { stack.push({ t: 'code', b: 0 }); k++; }
  }
  throw new Error(`function ${name} never closes`);
}
// function setItem up to the HOME banner: where the component's own class="set-item" lives.
function itemFn(src) {
  const a = src.indexOf('function setItem(p){');
  const b = src.indexOf('/* ---------- HOME ---------- */', a);
  if (a < 0 || b < 0) throw new Error('cannot find function setItem before the HOME banner');
  return { a, b };
}
// A hand-written row: class="set-item" (or className, or classList.add) as a whole token, any quote.
const HAND_RE = () => /class(?:Name)?\s*=\s*\\?["'`][^"'`]*(?<![\w-])set-item(?![\w-])|classList\.add\([^)]*(?<![\w-])set-item(?![\w-])/g;
function handRows(s) { const out = []; const re = HAND_RE(); let m; while ((m = re.exec(s))) out.push(m.index); return out; }
// The act a call names: the quoted name after a top-level act:, or a note that it is not one.
function actsIn(args) {
  const out = []; const re = /(?<![\w$.])act\s*:\s*/g; let m;
  while ((m = re.exec(args))) {
    const lit = /^(['"])([A-Za-z_$][\w$]*)\1/.exec(args.slice(m.index + m[0].length));
    out.push(lit ? lit[2] : null);
  }
  return out;
}

const PROBE = `<i>x</i> "dbl" 'sgl' & co \\   9`;
const PROBE_ESC = `&lt;i&gt;x&lt;/i&gt; &quot;dbl&quot; &#39;sgl&#39; &amp; co \\   9`;

/* The pinned markup (check 8). The CSS at .set-item, .set-item .si-ico, .si-body .a and .b, and .chev is
   written against exactly this shape. Change it here only together with that CSS. */
const APPEARANCE_PROPS = { act: 'openAppearance', tint: 'sleep', icon: 'moon', title: 'Appearance',
  sub: 'Light, night, or follow your phone', value: 'Night', chev: true };
const APPEARANCE_GOLDEN = '<div class="set-item" data-act="openAppearance" style="cursor:pointer">\n'
  + '      <div class="si-ico" style="background:var(--sleep-soft);color:var(--sleep)"><svg data-i="moon"></svg></div>\n'
  + '      <div class="si-body"><div class="a">Appearance</div><div class="b">Light, night, or follow your phone</div></div>\n'
  + '      <span style="font-weight:800;font-size:var(--fs-body);color:var(--ink-soft)">Night</span>\n'
  + '      <span class="chev"><svg data-i="chev"></svg></span>\n'
  + '    </div>';
const DELETE_PROPS = { act: 'openDeleteAccount', tint: 'danger', solid: true, icon: 'trash', danger: true,
  title: 'Delete my account', sub: 'Your account and your private records, on your own' };
const DELETE_GOLDEN = '<div class="set-item" data-act="openDeleteAccount" style="cursor:pointer">\n'
  + '      <div class="si-ico" style="background:var(--danger);color:#fff"><svg data-i="trash"></svg></div>\n'
  + '      <div class="si-body"><div class="a" style="color:var(--danger-ink)">Delete my account</div><div class="b">Your account and your private records, on your own</div></div>\n'
  + '    </div>';
const FAMILY_PROPS = { act: 'openFamily', tint: 'feed', glyph: '👨‍👩‍👧', title: 'Your profile & family',
  teach: { id: 'openFamily', label: 'your circle', guide: 'sharing' }, sub: 'Your name & relationship, invite people, your bear' };

const CHECKS = [
  ['title, sub and value are escaped, and the only tags in a row are the component\'s own (and the teaching dot)', (src) => {
    const wrong = [];
    [[{}, { act: 'openAppearance', tint: 'sleep', icon: 'moon', title: PROBE, sub: PROBE, value: PROBE, chev: true }],
      [{}, { tint: 'note', icon: 'note', title: PROBE, sub: PROBE }],
      [{}, { act: 'openDeleteRequest', tint: 'danger', solid: true, icon: 'trash', danger: true, title: PROBE, sub: PROBE, value: PROBE }],
      [{ teach: true }, { act: 'openFamily', tint: 'feed', glyph: '🛡️', small: true, title: PROBE, sub: PROBE, value: PROBE,
        teach: { id: 'openFamily', label: PROBE, guide: 'sharing' } }]].forEach(([mods, p], n) => {
      const { api } = load(src, mods);
      const html = api.setItem(p);
      let root;
      try { root = rowOf(html).root; } catch (e) { wrong.push(`row ${n}: ${e.message}`); return; }
      const els = walk(root);
      const allowed = OWN_TAGS.concat(p.teach ? ['button'] : []);
      const bad = els.filter((e) => allowed.indexOf(e.tag) < 0).map((e) => '<' + e.tag + '>');
      if (bad.length) wrong.push(`row ${n}: foreign tags ${bad.join(' ')}`);
      els.filter((e) => e.tag !== 'button').forEach((e) => Object.keys(e.attrs).forEach((k) => {
        if (OWN_ATTRS.indexOf(k) < 0) wrong.push(`row ${n}: foreign attribute ${k} on <${e.tag}>`);
      }));
      if (p.teach && (tags(root, 'button').length !== 1 || !html.includes(TEACH_DOT))) wrong.push(`row ${n}: the teaching dot is not the module's one button`);
      if (html.includes('<i>')) wrong.push(`row ${n}: a raw <i> reached the markup`);
      const a = one(root, 'a'), b = one(root, 'b');
      if (textOf(a) !== PROBE_ESC) wrong.push(`row ${n}: .a printed ${JSON.stringify(textOf(a))}`);
      if (raw(b) !== PROBE_ESC) wrong.push(`row ${n}: .b printed ${JSON.stringify(raw(b))}`);
      if (p.value != null) {
        const v = valueSpans(root);
        if (v.length !== 1 || raw(v[0]) !== PROBE_ESC) wrong.push(`row ${n}: the value printed ${JSON.stringify(v.map(raw))}`);
      }
      if (decode(textOf(a)) !== PROBE) wrong.push(`row ${n}: the title does not read back as typed`);
    });
    return wrong.length ? wrong : true;
  }],

  ['a 0 title, sub or value prints "0", and null or undefined prints nothing, never "undefined"', (src) => {
    const { api } = load(src);
    const wrong = [];
    const z = rowOf(api.setItem({ act: 'openAppearance', tint: 'sleep', icon: 'moon', title: 0, sub: 0, value: 0 })).root;
    if (raw(one(z, 'a')) !== '0') wrong.push('a title of 0 printed ' + JSON.stringify(raw(one(z, 'a'))));
    if (raw(one(z, 'b')) !== '0') wrong.push('a sub of 0 printed ' + JSON.stringify(raw(one(z, 'b'))));
    const v = valueSpans(z);
    if (v.length !== 1 || raw(v[0]) !== '0') wrong.push('a value of 0 printed ' + JSON.stringify(v.map(raw)));
    const count = 0;
    const c = rowOf(api.setItem({ act: 'openBabySheet', tint: 'diaper', icon: 'note', title: 'Manage babies', sub: `${count} added` })).root;
    if (raw(one(c, 'b')) !== '0 added') wrong.push('"0 added" printed ' + JSON.stringify(raw(one(c, 'b'))));
    [{}, { title: null, sub: undefined, value: undefined }, { title: undefined, sub: null, value: null }].forEach((extra) => {
      const html = api.setItem(Object.assign({ tint: 'note', icon: 'note' }, extra));
      const r = rowOf(html).root;
      ['a', 'b'].forEach((k) => { if (raw(one(r, k)) !== '') wrong.push(`${JSON.stringify(extra)}: .${k} printed ${JSON.stringify(raw(one(r, k)))}`); });
      if (valueSpans(r).length) wrong.push(`${JSON.stringify(extra)}: a value span was drawn`);
      if (/undefined|null|NaN/.test(html)) wrong.push(`${JSON.stringify(extra)}: the markup says undefined, null or NaN`);
    });
    return wrong.length ? wrong : true;
  }],

  ['a row with an act carries data-act (data-args only for real args) and a pointer; without one, neither and cursor:default; never an inline handler', (src) => {
    const { api } = load(src);
    const wrong = [];
    const base = { tint: 'note', icon: 'note', title: 't', sub: 's' };
    [[{ act: 'openAppearance' }, ['class', 'data-act', 'style'], 'cursor:pointer', 'openAppearance', null],
      [{ act: 'addToHomeScreen', args: ['llSetInstallMsg'] }, ['class', 'data-act', 'data-args', 'style'], 'cursor:pointer', 'addToHomeScreen', ['llSetInstallMsg']],
      [{ act: 'openAppearance', args: [] }, ['class', 'data-act', 'style'], 'cursor:pointer', 'openAppearance', null],
      [{ act: 'openAppearance', args: undefined }, ['class', 'data-act', 'style'], 'cursor:pointer', 'openAppearance', null],
      [{ act: 'addToHomeScreen', args: ['a"b', 0, 'x\\y'] }, ['class', 'data-act', 'data-args', 'style'], 'cursor:pointer', 'addToHomeScreen', ['a"b', 0, 'x\\y']],
      [{}, ['class', 'style'], 'cursor:default', null, null],
      [{ act: '' }, ['class', 'style'], 'cursor:default', null, null],
      [{ act: null, args: ['x'] }, ['class', 'style'], 'cursor:default', null, null],
      [{ args: ['x'] }, ['class', 'style'], 'cursor:default', null, null]].forEach(([extra, keys, cursor, act, args]) => {
      const tag = JSON.stringify(extra);
      let r;
      try { r = rowOf(api.setItem(Object.assign({}, base, extra))); } catch (e) { wrong.push(`${tag}: ${e.message}`); return; }
      const row = r.row;
      if (row.tag !== 'div' || row.attrs.class !== 'set-item') wrong.push(`${tag}: the row is <${row.tag} class="${row.attrs.class}">`);
      if (!same(Object.keys(row.attrs), keys)) wrong.push(`${tag}: row attributes ${Object.keys(row.attrs).join(',')}, want ${keys.join(',')}`);
      if (row.attrs.style !== cursor) wrong.push(`${tag}: row style ${JSON.stringify(row.attrs.style)}, want ${cursor}`);
      if (act !== null && row.attrs['data-act'] !== act) wrong.push(`${tag}: data-act ${JSON.stringify(row.attrs['data-act'])}`);
      if (args !== null) {
        let back;
        try { back = JSON.parse(decode(row.attrs['data-args'] || '')); } catch (e) { wrong.push(`${tag}: data-args is not JSON`); }
        if (back !== undefined && !same(back, args)) wrong.push(`${tag}: data-args came back as ${JSON.stringify(back)}`);
      }
      const carriers = walk(r.root).filter((e) => own(e.attrs, 'data-act') || own(e.attrs, 'data-args'));
      if (carriers.some((e) => e !== row)) wrong.push(`${tag}: an action rides on something other than the row`);
      walk(r.root).forEach((e) => Object.keys(e.attrs).forEach((k) => { if (/^on/i.test(k)) wrong.push(`${tag}: <${e.tag}> carries ${k}`); }));
    });
    return wrong.length ? wrong : true;
  }],

  [`the icon box: a key of I on its soft fill, solid, or a glyph, exactly; bad tints fall back to '${DEFAULT_TOKEN}', unknown icons draw nothing`, (src) => {
    const { api } = load(src);
    const wrong = [];
    const D = DEFAULT_TOKEN;
    const ico = (p) => icoOf(api.setItem(Object.assign({ act: 'openAppearance', title: 't', sub: 's' }, p)));
    [[{ tint: 'sleep', icon: 'moon' }, 'background:var(--sleep-soft);color:var(--sleep)', ICONS.moon],
      [{ tint: 'danger', solid: true, icon: 'trash' }, 'background:var(--danger);color:#fff', ICONS.trash],
      [{ tint: 'feed', glyph: '📲' }, 'background:var(--feed-soft);color:var(--feed);font-size:var(--fs-title)', '📲'],
      [{ tint: 'sleep', glyph: '👋', small: true }, 'background:var(--sleep-soft);color:var(--sleep);font-size:17px', '👋'],
      [{ tint: 'star', glyph: '🎉', ink: false }, 'background:var(--star-soft);font-size:var(--fs-title)', '🎉'],
      [{ tint: 'star', glyph: '🛡️', ink: false, small: true }, 'background:var(--star-soft);font-size:17px', '🛡️'],
      [{ tint: 'note', glyph: '💬', ink: 0 }, 'background:var(--note-soft);color:var(--note);font-size:var(--fs-title)', '💬'],
      [{ tint: 'note', icon: 'note', ink: false, small: true }, 'background:var(--note-soft);color:var(--note)', ICONS.note]].forEach(([p, style, inner]) => {
      const got = ico(p);
      if (got.style !== style) wrong.push(`${JSON.stringify(p)}: style ${JSON.stringify(got.style)}`);
      if (got.inner !== inner) wrong.push(`${JSON.stringify(p)}: drew ${JSON.stringify(got.inner)}`);
      if (got.box.parent.attrs.class !== 'set-item' || elKids(got.box.parent)[0] !== got.box) wrong.push(`${JSON.stringify(p)}: the box is not the row's first child`);
    });
    ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', '<b>x</b>', 'nope', 'Moon', undefined, null, ''].forEach((k) => {
      [false, true].forEach((solid) => {
        const got = ico({ tint: 'sleep', icon: k, solid });
        if (got.inner !== '') wrong.push(`icon ${JSON.stringify(k)}${solid ? ' (solid)' : ''} drew ${JSON.stringify(got.inner)}`);
      });
    });
    ['sleep;background:red', 'sleep)', 'Sleep', '', 'sleep soft', '-sleep', 'sleep\n', '9sleep', 'sleep_x', 7, {}, undefined, null].forEach((bad) => {
      const html = api.setItem({ act: 'openAppearance', tint: bad, icon: 'moon', title: 't', sub: 's' });
      const soft = icoOf(html).style;
      const solid = ico({ tint: bad, icon: 'trash', solid: true }).style;
      const glyph = ico({ tint: bad, glyph: '📲' }).style;
      if (soft !== `background:var(--${D}-soft);color:var(--${D})`) wrong.push(`tint ${JSON.stringify(bad)} gave ${JSON.stringify(soft)}`);
      if (solid !== `background:var(--${D});color:#fff`) wrong.push(`tint ${JSON.stringify(bad)}, solid, gave ${JSON.stringify(solid)}`);
      if (glyph !== `background:var(--${D}-soft);color:var(--${D});font-size:var(--fs-title)`) wrong.push(`tint ${JSON.stringify(bad)}, glyph, gave ${JSON.stringify(glyph)}`);
      if (typeof bad === 'string' && bad && html.includes(bad)) wrong.push(`tint ${JSON.stringify(bad)} reached the markup`);
    });
    ['sleep', 'feed', 'star', 'note', 'pump', 'preg', 'diaper', 'danger'].forEach((t) => {
      const got = ico({ tint: t, icon: 'moon' }).style;
      if (got !== `background:var(--${t}-soft);color:var(--${t})`) wrong.push(`good tint ${t} gave ${JSON.stringify(got)}`);
    });
    return wrong.length ? wrong : true;
  }],

  ['danger:true puts style="color:var(--danger-ink)" on .a and changes nothing else; without it .a has no style', (src) => {
    const { api } = load(src);
    const wrong = [];
    const ON = '<div class="a" style="color:var(--danger-ink)">', OFF = '<div class="a">';
    [{ act: 'openDeleteAccount', tint: 'danger', solid: true, icon: 'trash', title: 'Delete my account', sub: 's' },
      { act: 'openAppearance', tint: 'sleep', icon: 'moon', title: 'Appearance', sub: 's', value: 'Night', chev: true },
      { tint: 'note', glyph: '💬', title: 'Read only', sub: 's', teach: { id: 'x', label: 'y', guide: 'z' } }].forEach((p, n) => {
      const plain = api.setItem(p), loud = api.setItem(Object.assign({}, p, { danger: true }));
      if (plain.split(OFF).length !== 2) wrong.push(`row ${n}: without danger, .a is not exactly ${OFF}`);
      else if (loud !== plain.replace(OFF, ON)) wrong.push(`row ${n}: danger changed more than .a: ${JSON.stringify(loud)}`);
      const a = one(rowOf(loud).root, 'a');
      if (!same(a.attrs, { class: 'a', style: 'color:var(--danger-ink)' })) wrong.push(`row ${n}: danger .a attributes ${JSON.stringify(a.attrs)}`);
      [false, 0, '', null, undefined].forEach((d) => {
        const h = api.setItem(Object.assign({}, p, { danger: d }));
        if (h !== plain) wrong.push(`row ${n}: danger ${JSON.stringify(d)} changed the row`);
        if (!same(one(rowOf(h).root, 'a').attrs, { class: 'a' })) wrong.push(`row ${n}: danger ${JSON.stringify(d)} styled .a`);
      });
      if (/danger-ink/.test(plain)) wrong.push(`row ${n}: --danger-ink without danger`);
    });
    return wrong.length ? wrong : true;
  }],

  ['a value is one trailing span in the value style, before the chevron; chev:true ends the row with <span class="chev"> and I.chev', (src) => {
    const { api } = load(src);
    const wrong = [];
    const base = { act: 'openAppearance', tint: 'sleep', icon: 'moon', title: 'Appearance', sub: 's' };
    const shape = (r) => elKids(r.row).map((e) => (e.tag === 'span' ? (e.attrs.class === 'chev' ? 'chev' : 'value') : e.attrs.class));
    [[{ value: 'Night', chev: true }, ['si-ico', 'si-body', 'value', 'chev']],
      [{ value: 'Night' }, ['si-ico', 'si-body', 'value']],
      [{ value: 'Night', chev: false }, ['si-ico', 'si-body', 'value']],
      [{ chev: true }, ['si-ico', 'si-body', 'chev']],
      [{ chev: true, value: null }, ['si-ico', 'si-body', 'chev']],
      [{}, ['si-ico', 'si-body']],
      [{ value: undefined, chev: 0 }, ['si-ico', 'si-body']]].forEach(([extra, want]) => {
      const tag = JSON.stringify(extra);
      let r;
      try { r = rowOf(api.setItem(Object.assign({}, base, extra))); } catch (e) { wrong.push(`${tag}: ${e.message}`); return; }
      if (!same(shape(r), want)) wrong.push(`${tag}: the row is ${JSON.stringify(shape(r))}, want ${JSON.stringify(want)}`);
      const spans = tags(r.root, 'span');
      if (spans.length !== want.filter((w) => w === 'value' || w === 'chev').length) wrong.push(`${tag}: ${spans.length} spans`);
      spans.forEach((s) => {
        if (s.parent !== r.row) wrong.push(`${tag}: a span is not a direct child of the row`);
        if (s.attrs.class === 'chev') {
          if (!same(s.attrs, { class: 'chev' })) wrong.push(`${tag}: chev attributes ${JSON.stringify(s.attrs)}`);
          if (inner(s) !== ICONS.chev) wrong.push(`${tag}: the chevron drew ${JSON.stringify(inner(s))}`);
        } else {
          if (!same(s.attrs, { style: VALUE_STYLE })) wrong.push(`${tag}: value attributes ${JSON.stringify(s.attrs)}`);
          if (raw(s) !== 'Night') wrong.push(`${tag}: the value printed ${JSON.stringify(raw(s))}`);
        }
      });
    });
    return wrong.length ? wrong : true;
  }],

  ['teach: CubbyTeachUI.dot(id, label) after the escaped title, else CubbyGuide.info(guide), else nothing; no teach, no module is asked', (src) => {
    const wrong = [];
    const A = '<div class="a">Your profile &amp; family';
    const NO_TEACH = Object.assign({}, FAMILY_PROPS); delete NO_TEACH.teach;
    [['both modules', { teach: true, guide: true }, FAMILY_PROPS, A + TEACH_DOT + '</div>', [['openFamily', 'your circle']], []],
      ['the teaching module only', { teach: true }, FAMILY_PROPS, A + TEACH_DOT + '</div>', [['openFamily', 'your circle']], []],
      ['the guide only', { guide: true }, FAMILY_PROPS, A + GUIDE_DOT + '</div>', [], [['sharing']]],
      ['a guide without info', { guideNoInfo: true }, FAMILY_PROPS, A + '</div>', [], []],
      ['neither module', {}, FAMILY_PROPS, A + '</div>', [], []],
      ['no teach, both modules', { teach: true, guide: true }, NO_TEACH, A + '</div>', [], []],
      ['no teach, the guide', { guide: true }, NO_TEACH, A + '</div>', [], []],
      // the label and id go to the module as typed: the module escapes its own markup, as the real dot does
      ['a label as typed', { teach: true }, Object.assign({}, FAMILY_PROPS, { teach: { id: 'x"y', label: PROBE, guide: 'g' } }), A + TEACH_DOT + '</div>', [['x"y', PROBE]], []]
    ].forEach(([label, mods, p, wantA, wantTeach, wantGuide]) => {
      let L, html;
      try { L = load(src, mods); html = L.api.setItem(p); } catch (e) { wrong.push(`${label}: threw ${e.message}`); return; }
      if (!html.includes(wantA)) wrong.push(`${label}: .a is not ${JSON.stringify(wantA)} in ${JSON.stringify(html)}`);
      if (!same(L.teach, wantTeach)) wrong.push(`${label}: CubbyTeachUI.dot got ${JSON.stringify(L.teach)}`);
      if (!same(L.guide, wantGuide)) wrong.push(`${label}: CubbyGuide.info got ${JSON.stringify(L.guide)}`);
      let r;
      try { r = rowOf(html); } catch (e) { wrong.push(`${label}: ${e.message}`); return; }
      const bs = tags(r.root, 'button');
      const want = wantTeach.length + wantGuide.length;
      if (bs.length !== want) wrong.push(`${label}: ${bs.length} dots`);
      bs.forEach((b) => {
        const a = one(r.root, 'a');
        if (b.parent !== a || elKids(a)[elKids(a).length - 1] !== b || a.kids[a.kids.length - 1] !== b) wrong.push(`${label}: the dot is not the last thing in .a`);
      });
      if (!html.includes('<div class="b">Your name &amp; relationship, invite people, your bear</div>')) wrong.push(`${label}: .b changed`);
    });
    return wrong.length ? wrong : true;
  }],

  ['golden: an Appearance row and a Delete-account row render exactly the pinned markup', (src) => {
    const { api } = load(src);
    const wrong = [];
    const a = api.setItem(APPEARANCE_PROPS), d = api.setItem(DELETE_PROPS);
    if (a !== APPEARANCE_GOLDEN) wrong.push({ appearance: a });
    if (d !== DELETE_GOLDEN) wrong.push({ deleteAccount: d });
    return wrong.length ? wrong : true;
  }],

  [`in ${SHEETS.join(' and ')}: no hand-written row is left, and every act is a UI_ACTIONS key (no act only on the read-only export row)`, (src) => {
    const { api } = load(src);
    const wrong = [];
    const { a, b } = itemFn(src);
    const mine = handRows(src).filter((i) => i > a && i < b);
    if (mine.length !== 1) wrong.push(`the matcher found ${mine.length} set-item classes inside setItem, want its own 1`);
    SHEETS.forEach((name) => {
      let body;
      try { body = bodyOf(src, name); } catch (e) { wrong.push(e.message); return; }
      const at = (i) => lineOf(src, body.a + i);
      handRows(body.body).forEach((i) => wrong.push(`${name}, line ${at(i)}: a hand-written row ${JSON.stringify(body.body.slice(i, i + 60))}`));
      const list = calls(body.body, at);
      if (!list.length) { wrong.push(`${name}: the matcher found no setItem call`); return; }
      const readOnly = [];
      list.forEach(({ line, args }) => {
        if (!/^\s*\{/.test(args)) wrong.push(`${name}, line ${line}: setItem is not handed an object literal`);
        const acts = actsIn(args);
        if (acts.length > 1) wrong.push(`${name}, line ${line}: ${acts.length} acts in one row`);
        if (!acts.length) { readOnly.push(args); return; }
        if (acts[0] === null) wrong.push(`${name}, line ${line}: an act that is not a quoted name`);
        else if (!own(api.UI_ACTIONS, acts[0])) wrong.push(`${name}, line ${line}: act '${acts[0]}' is not an own UI_ACTIONS key`);
      });
      const spec = READ_ONLY[name];
      if (readOnly.length !== spec.length || !spec.every((t, i) => readOnly[i].includes(t))) {
        wrong.push(`${name}: rows with no act ${JSON.stringify(readOnly.map((s) => s.slice(0, 50)))}, the spec allows ${JSON.stringify(spec)}`);
      }
    });
    if (!bodyOf(src, 'openDataSheet').body.includes('<h2>Your data</h2>')) wrong.push('openDataSheet is no longer the Your data sheet; find it and update SHEETS');
    return wrong.length ? wrong : true;
  }],

  ['no setItem call is handed escapeHtml output or an HTML entity (it would show on screen)', (src) => {
    const list = calls(src);
    const wrong = [];
    list.forEach(({ line, args }) => {
      if (args.includes('escapeHtml(')) wrong.push(`line ${line}: setItem is handed escapeHtml(...); pass the raw value`);
      const ent = /&(?:amp|lt|gt|quot|apos|nbsp|middot|hellip|mdash|ndash|#\d+|#x[0-9a-f]+);/i.exec(args);
      if (ent) wrong.push(`line ${line}: setItem is handed ${JSON.stringify(ent[0])}; pass the character, setItem escapes it`);
    });
    if (!list.length) wrong.push('the matcher found no setItem call');
    return wrong.length ? wrong : true;
  }],

  [`hand-written set-item rows outside setItem can only fall (ceiling ${HAND_CEILING})`, (src) => {
    const { a, b } = itemFn(src);
    const all = handRows(src);
    const inside = all.filter((i) => i > a && i < b), outside = all.filter((i) => !(i > a && i < b));
    if (inside.length !== 1) return [`the matcher found ${inside.length} set-item classes inside setItem, want its own 1; the scan is broken`];
    if (!outside.length) return ['the matcher found no hand-written row; either the migration is finished (then retire this check) or the scan is broken'];
    const tally = `${outside.length} hand-written set-item rows, ceiling ${HAND_CEILING}`;
    if (outside.length > HAND_CEILING) {
      return [`${tally}. Build the new row with setItem and a UI_ACTIONS entry instead.`,
        'rows at lines: ' + outside.map((i) => lineOf(src, i)).join(', ')];
    }
    return { note: tally + (outside.length < HAND_CEILING ? ': lower the ceiling to ' + outside.length : '') };
  }],

  [`exactly ${EXPECTED_CALLS} setItem( call sites (localStorage.setItem( is not one)`, (src) => {
    const staged = "localStorage.setItem('k','v'); sessionStorage.setItem('a',\"b\"); x.setItem(1); function setItem(p){} setItem({title:'a)b'});";
    const s = calls(staged);
    if (s.length !== 1 || s[0].args !== "{title:'a)b'}") return ['the scanner miscounts a staged line: ' + JSON.stringify(s)];
    const list = calls(src);
    const note = `setItem( call sites: ${list.length} (lines ${list.map((c) => c.line).join(', ')})`;
    return list.length === EXPECTED_CALLS ? { note } : [`found ${list.length}, the spec says ${EXPECTED_CALLS}. If a row was added or removed on purpose, edit EXPECTED_CALLS in tools/set_item_check.js in the same commit and name the row in the commit message.`, note];
  }]
];

// A check returns true, or { note } to pass and say something, or a list of what is wrong.
function run(src) {
  return CHECKS.map(([name, fn], i) => {
    let r;
    try { r = fn(src); } catch (e) { r = ['threw: ' + e.message]; }
    const ok = r === true || (!!r && !Array.isArray(r) && typeof r.note === 'string');
    return { n: i + 1, name, ok, note: ok && r !== true ? r.note : null, detail: ok ? null : r };
  });
}

/* Each break names the numbered check it must turn red. A break whose search text is not in the file
   exactly once is itself a failure: the source moved, and a self-test that mutates nothing proves nothing. */
const swap = (from, to) => (s) => (s.split(from).length === 2 ? s.replace(from, () => to) : s);
const ROW_HEAD = "<div class=\"set-item\"${p.act?uiAct(p.act,p.args):''}";
const CURSOR = "style=\"cursor:${p.act?'pointer':'default'}\">";
const ICO = "${uiIco('si-ico',p,uiTok(p.tint))}";
const DANGER = "${p.danger?' style=\"color:var(--danger-ink)\"':''}";
const TAIL_VALUE = '${p.value!=null?`\n      <span style="' + VALUE_STYLE + '">${uiTxt(p.value)}</span>`:\'\'}';
const TAIL_CHEV = '${p.chev?`\n      <span class="chev">${I.chev}</span>`:\'\'}';
const LOGOUT = "${setItem({act:'confirmLogout', tint:'sleep', glyph:'👋', small:true, title:'Log out', sub:'Sign out · your data stays safely synced'})}";
const EXPORT = "setItem({act:'requestExport', tint:'note', icon:'note', title:'Export data', sub:'Download everything as a JSON file, yours whenever you want it'})";
const MUTATIONS = [
  ['the title printed raw', 1, swap('>${uiTxt(p.title)}${dot}</div>', '>${p.title}${dot}</div>')],
  ['the subtitle printed raw', 1, swap('<div class="b">${uiTxt(p.sub)}</div>', '<div class="b">${p.sub}</div>')],
  ['the value printed raw', 1, swap('">${uiTxt(p.value)}</span>', '">${p.value}</span>')],
  ['the value goes straight to escapeHtml, which drops 0', 2, swap('${uiTxt(p.value)}</span>', '${escapeHtml(p.value)}</span>')],
  ['the title goes straight to escapeHtml, which drops 0', 2, swap('>${uiTxt(p.title)}${dot}', '>${escapeHtml(p.title)}${dot}')],
  ['a value of 0 draws no span', 2, swap('${p.value!=null?`', '${p.value?`')],
  ['a read-only row still carries data-act', 3, swap(ROW_HEAD, '<div class="set-item"${uiAct(p.act,p.args)}')],
  ['every row looks tappable', 3, swap(CURSOR, 'style="cursor:pointer">')],
  ['the row drops its args', 3, swap('${p.act?uiAct(p.act,p.args):\'\'}', '${p.act?uiAct(p.act):\'\'}')],
  ['the row builds an onclick string again', 3, swap(ROW_HEAD, '<div class="set-item"${p.act?` onclick="${uiTxt(p.act)}()"`:\'\'}')],
  ['the row skips the token check', 4, swap(ICO, "${uiIco('si-ico',p,p.tint||'line')}")],
  ['the row\'s box takes the pill\'s class', 4, swap(ICO, "${uiIco('ap-ico',p,uiTok(p.tint))}")],
  ['a solid box keeps the soft fill', 4, swap('${p.solid?`background:var(--${tint});color:#fff`', '${p.solid?`background:var(--${tint}-soft);color:#fff`')],
  ['icons read through the prototype', 4, swap("${Object.prototype.hasOwnProperty.call(I,p.icon)?I[p.icon]:''}", "${I[p.icon]||''}")],
  ['small glyphs lose 17px', 4, swap("${p.small?';font-size:17px':';font-size:var(--fs-title)'}", ';font-size:var(--fs-title)')],
  ['a glyph loses its ink unless ink is set', 4, swap("${p.ink===false?'':`;color:var(--${tint})`}", "${!p.ink?'':`;color:var(--${tint})`}")],
  ['danger in the wrong colour', 5, swap(DANGER, "${p.danger?' style=\"color:var(--danger)\"':''}")],
  ['danger colours the subtitle instead', 5, swap('<div class="a"' + DANGER + '>${uiTxt(p.title)}${dot}</div><div class="b">',
    '<div class="a">${uiTxt(p.title)}${dot}</div><div class="b"' + DANGER + '>')],
  ['danger also tints the icon box', 5, swap(ICO, "${uiIco('si-ico',p,uiTok(p.danger?'danger':p.tint))}")],
  ['danger:false still colours the title', 5, swap("${p.danger?' style=", "${p.danger!=null?' style=")],
  ['the value back at 13px', 6, swap('<span style="' + VALUE_STYLE + '">${uiTxt(p.value)}', '<span style="font-weight:800;font-size:13px;color:var(--ink-soft)">${uiTxt(p.value)}')],
  ['the chevron before the value', 6, swap(TAIL_VALUE + TAIL_CHEV, TAIL_CHEV + TAIL_VALUE)],
  ['the chevron draws another icon', 6, swap('${p.chev?`\n      <span class="chev">${I.chev}</span>', '${p.chev?`\n      <span class="chev">${I.moon}</span>')],
  ['every row gets a chevron', 6, swap('${p.chev?`', '${true?`')],
  ['the dot is escaped', 7, swap('${uiTxt(p.title)}${dot}</div>', '${uiTxt(p.title)}${uiTxt(dot)}</div>')],
  ['the dot before the title', 7, swap('${uiTxt(p.title)}${dot}</div>', '${dot}${uiTxt(p.title)}</div>')],
  ['the guide wins over the teaching module', 7, swap('(window.CubbyTeachUI?CubbyTeachUI.dot(', '(window.CubbyTeachUI&&!window.CubbyGuide?CubbyTeachUI.dot(')],
  ['the dot loses its label', 7, swap('CubbyTeachUI.dot(p.teach.id,p.teach.label)', 'CubbyTeachUI.dot(p.teach.id)')],
  ['the guide is asked for the label', 7, swap('CubbyGuide.info(p.teach.guide)', 'CubbyGuide.info(p.teach.label)')],
  ['every row asks for a dot', 7, swap("const dot=!p.teach?'':(", "const dot=!(p.teach=p.teach||{})?'':(")],
  ['the row loses its line breaks', 8, swap(CURSOR + '\n      ${uiIco(', CURSOR + '${uiIco(')],
  ['the body loses its class', 8, swap('<div class="si-body"><div class="a"${p.danger', '<div class="sib"><div class="a"${p.danger')],
  ['a Settings row hand-written again', 9, swap(LOGOUT,
    '<div class="set-item" data-act="confirmLogout" style="cursor:pointer">\n      <div class="si-ico" style="background:var(--sleep-soft);color:var(--sleep);font-size:17px">👋</div>\n      <div class="si-body"><div class="a">Log out</div><div class="b">Sign out</div></div>\n    </div>')],
  ['a Data row hand-written again', 9, swap(EXPORT,
    '`<div class="set-item" data-act="requestExport" style="cursor:pointer"><div class="si-ico" style="background:var(--note-soft);color:var(--note)">${I.note}</div><div class="si-body"><div class="a">Export data</div><div class="b">Download everything</div></div></div>`')],
  ['a row names an act the registry lacks', 9, swap("act:'openTrash'", "act:'openBin'")],
  ['a second read-only row', 9, swap("setItem({act:'openImport', ", 'setItem({')],
  ['a call passes escaped text', 10, swap('stays with ${gNames}. Ask them if you need one.`', 'stays with ${escapeHtml(gNames)}. Ask them if you need one.`')],
  ['a call passes &amp;', 10, swap("sub:'Birth details, food & allergies'", "sub:'Birth details, food &amp; allergies'")],
  ['a new hand-written row outside the sheets', 11, swap('<div class="set-item" onclick="openKickCounter()" style="cursor:pointer">',
    '<div class="set-item" style="cursor:default"><div class="si-body"><div class="a">x</div></div></div>\n    <div class="set-item" onclick="openKickCounter()" style="cursor:pointer">')],
  ['the component\'s own class hidden from the matcher', 11, swap(ROW_HEAD, "<div class=\"${'set-item'}\"${p.act?uiAct(p.act,p.args):''}")],
  ['a twenty-fourth call site', 12, swap('${recent?`<div class="set-label">Recent decisions</div>${recent}`',
    "${setItem({act:'openTrash', tint:'sleep', icon:'trash', title:'Recently deleted', sub:'Deleted things wait here for 30 days'})}\n    ${recent?`<div class=\"set-label\">Recent decisions</div>${recent}`")],
  ['a call site removed', 12, swap(LOGOUT, '')]
];

function selfTest(src) {
  let good = true;
  MUTATIONS.forEach(([label, target, mutate]) => {
    const bent = mutate(src);
    const applied = bent !== src;
    const red = applied ? run(bent).filter((r) => !r.ok).map((r) => r.n) : [];
    const pass = applied && red.includes(target);
    if (!pass) good = false;
    console.log(`  self-test ${pass ? 'ok ' : 'BAD'} ${String(target).padStart(2)} ${label}${!applied ? ' (mutation did not apply: the source moved)' : (pass ? '' : ' (check ' + target + ' stayed green)')}`);
  });
  return good;
}

const src = fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8');
if (SELF_TEST) {
  console.log('self-test: every break must turn its own check red');
  if (!selfTest(src)) {
    console.error('set-item: FAIL, self-test broken; a gate that cannot go red proves nothing');
    process.exit(1);
  }
}
const results = run(src);
results.forEach((r) => console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${String(r.n).padStart(2)} ${r.name}${r.note ? '\n          ' + r.note : ''}${r.ok ? '' : '\n         got: ' + JSON.stringify(r.detail)}`));
const failed = results.filter((r) => !r.ok).length;
if (failed) { console.error(`set-item: FAIL, ${failed} of ${results.length} checks`); process.exit(1); }
console.log(`set-item: PASS, ${results.length} checks${SELF_TEST ? `, ${MUTATIONS.length} breaks each went red` : ''}`);
