#!/usr/bin/env node
/* AlertPill is the first code component (design/DESIGN-SYSTEM.md §4, docs/plans/2026-10-09-ADR-001-sdui.md).
 * Thirteen hand-written pills became one function, and their onclick strings became named actions in
 * UI_ACTIONS, run by one listener on the document. That move exists because two injection holes reached
 * production in October: an id a member of the circle chose was interpolated raw into an onclick
 * attribute, and a dose typed as free text was printed raw into the page. A component closes both doors
 * at once (ids travel as data, words are escaped), but only if it keeps closing them.
 * Nothing on screen changes when the escaping quietly loosens, when a token check loses its anchor, or
 * when someone hand-writes a fourteenth pill with an onclick in it. It just waits for the first odd id.
 *
 * So this states the contract in its own words and holds the component to it:
 *   - every word a pill prints is escaped, and the only tags in a pill are the component's own
 *   - a 0 prints as 0; a missing value prints nothing, never "undefined"
 *   - an action's arguments travel as a JSON array in data-args and come back exactly, whatever the id
 *   - colour tokens are lower-case words or they fall back to 'line'; icons come only from I's own keys
 *   - the countdown span is numeric, the layout stacks at two actions, the markup matches a pinned copy
 *   - the dispatcher runs own UI_ACTIONS entries only, synchronously, with an array of plain values,
 *     and each entry does exactly what the inline handler it replaced did (written out below, not read
 *     from the code it checks)
 *   - the registry is shared: setItem rows (tools/set_item_check.js holds the row itself) act through the
 *     same UI_ACTIONS, so the registry checks below read every component's calls, not only alertPill's
 *   - in the whole of app/index.html: no hand-written pill, no act a call names that the registry lacks,
 *     no dead entry, no escapeHtml passed in, no element with both data-act and an inline handler, and
 *     exactly the thirteen call sites this migration made
 *   - a crafted non-finite due still reaches the medicine ledger under the key the pill was drawn with
 *   - and a ratchet the decision record asked for: hand-written inline handlers (onclick, oninput,
 *     onchange, onkeydown...) that interpolate a value may only fall, as components take them over
 *
 * Static: it lifts escapeHtml, UI_ACTIONS, the dispatcher and alertPill out of app/index.html and runs
 * them in a vm with stub handlers, no browser. The probes are plain text: tags, quotes, ampersands,
 * backslashes, U+2028 and numbers. No probe is a script.
 *
 *   node tools/alert_pill_check.js               check the tree
 *   node tools/alert_pill_check.js --self-test   first break the source many ways and require each break
 *                                                to turn its own numbered check red, then check the tree
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SELF_TEST = process.argv.includes('--self-test');

/* THE SPEC. Written here, not derived from the code it checks. */
// Thirteen hand-written pills moved onto alertPill in this migration: renderHome's dose, vaccine, illness,
// fever, visit, month, poster and child, the four consentBanners, and pregWeeksLeftAlert. A pill added or
// removed changes this on purpose: edit the number here in the same commit and name the pill in the
// commit message. It is fixed so that a pill cannot appear or vanish without someone deciding it did.
const EXPECTED_CALLS = 13;
const DEFAULT_TOKEN = 'line';
// Hand-written inline handlers in app/index.html (on[a-z]+="...", so onclick, oninput, onchange and
// onkeydown alike) whose text interpolates a value with ${...}. 284 before the AlertPill migration, 276
// after it (onclick 276 -> 268; the dose, month and consent buttons carried ids that members write).
// A ratchet, not a target: it may fall and may not rise. Lower it when a migration takes more, never
// raise it to make a run go green. Counted the same way every time, so it is comparable.
const HANDLER_CEILING = 276;
// What each old inline handler passed, by position. A pass-through entry must hand on exactly these.
const PASS_THROUGH = {
  logDose: 1, snoozeMedAlert: 2, dismissMedAlert: 2, openTemp: 0, openFeverSafetyNet: 0, openVisitSummary: 0,
  openPosterOffer: 0, dismissPosterOffer: 0, ackChild: 0, openWeeksTakeBack: 0,
  openConsentReview: 1, downloadExport: 1, ackDecline: 1,
  // 27 Nov 2026 UX review: vaccine visits, the Health hub, the first-run step and the Home prompts
  openVisitDone: 1, markVisit: 1, healthRowGo: 1, obLogNappy: 1, pickColor: 1, promptAct: 2,
  // setItem rows in the Settings and Data sheets
  openAppearance: 0, addToHomeScreen: 1, openBabySheet: 0, openPregArchive: 0, openBabyProfile: 0, shareCubby: 0,
  openReminders: 0, openQuickSettings: 0, openMoodNote: 0, openLogBP: 0, openTrash: 0, openDataSheet: 0,
  confirmLogout: 0, requestExport: 0, openImport: 0, openDeleteRequest: 0, openGuardians: 0, openDeleteAccount: 0
};
// The entries that did more than one thing inline, or guarded a late-loading global; check 13 spells
// out each step and its order.
const COMPOSITE = ['openMonthCard', 'openVaccines', 'openDen', 'openFamily', 'openProSettings', 'openFeedback'];
// Every handler a UI_ACTIONS entry may reach. Each is stubbed as a recorder.
const HANDLERS = ['logDose', 'snoozeMedAlert', 'dismissMedAlert', 'go', 'render', 'openTemp', 'openFeverSafetyNet',
  'openVisitSummary', 'openMemoryCard', 'dismissTip', 'openPosterOffer', 'dismissPosterOffer', 'ackChild',
  'openWeeksTakeBack', 'openConsentReview', 'downloadExport', 'ackDecline',
  'openAppearance', 'addToHomeScreen', 'closeSheet', 'goDen', 'openBabySheet', 'openPregArchive', 'openBabyProfile',
  'openPro', 'shareCubby', 'openReminders', 'openQuickSettings', 'openMoodNote', 'openLogBP', 'openTrash',
  'openDataSheet', 'confirmLogout', 'requestExport', 'openImport', 'openDeleteRequest', 'openGuardians', 'openDeleteAccount',
  'openVisitDone', 'markVisit', 'healthRowGo', 'obLogNappy', 'pickColor', 'promptAct'];
// Attached to window by store-firebase.js, which can load after the inline script.
const WINDOW_HANDLERS = ['openFamily', 'openFeedback'];
const NOW = 1800000000000;   // pinned; fmtDue and now are stubs, so no check reads the real clock
const ICONS = { pill: '<svg data-i="pill"></svg>', syringe: '<svg data-i="syringe"></svg>',
  stetho: '<svg data-i="stetho"></svg>', snow: '<svg data-i="snow"></svg>' };
const OWN_TAGS = ['button', 'div', 'span', 'svg'];
const OWN_ATTRS = ['class', 'data-act', 'data-args', 'data-due', 'data-i', 'style'];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => a.slice().sort();
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

/* escapeHtml plus the component block, in a fresh context each time: the recorders and the captured
   click listener are per load, so one check never sees another check's calls. */
function load(src) {
  const esc = slice(src, 'function escapeHtml(s){', '\n', 'escapeHtml');
  const core = sliceBefore(src, 'const UI_ACTIONS=', '/* ---------- HOME ---------- */', 'the action registry and alertPill');
  const calls = [], clicks = [], other = [];
  const ctx = {
    I: Object.assign({}, ICONS),
    healthTab: 'overview',
    now: () => NOW,
    fmtDue: (ms) => (ms <= 0 ? 'due now' : 'in ' + Math.round(ms / 60000) + ' min'),
    document: { addEventListener: (type, fn) => (type === 'click' ? clicks : other).push(fn) }
  };
  HANDLERS.forEach((h) => { ctx[h] = function () { calls.push([h, Array.from(arguments), ctx.healthTab]); }; });
  ctx.window = {};
  WINDOW_HANDLERS.forEach((h) => { ctx.window[h] = function () { calls.push(['window.' + h, Array.from(arguments), ctx.healthTab]); }; });
  vm.createContext(ctx);
  vm.runInContext(esc + '\n' + core + '\nthis.api = { UI_ACTIONS, alertPill, escapeHtml };', ctx);
  return { api: ctx.api, calls, clicks, other, ctx };
}

/* A strict reader for the markup one pill returns: quoted attributes only, no stray < or >, every tag
   closed by its own name. Anything else throws, so an attribute an unescaped quote broke out of is a
   red check, not a quietly different tree. */
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
const tags = (root, t) => walk(root).filter((e) => e.tag === t);
// The five entities escapeHtml writes, &amp; last so "&amp;quot;" comes back as "&quot;", as a browser does.
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const pill = (api, p) => parse(api.alertPill(p));
const icoInner = (html) => ((/<div class="ap-ico" style="[^"]*">([\s\S]*?)<\/div>/.exec(html)) || [])[1];

/* Fake DOM for the dispatcher: an element knows its attributes and its parent, and closest walks up. */
function el(attrs, parent) {
  return {
    parent: parent || null,
    getAttribute: (n) => (own(attrs, n) ? attrs[n] : null),
    hasAttribute: (n) => own(attrs, n),
    closest(sel) {
      const m = /^\[([a-z-]+)\]$/.exec(sel);
      if (!m) throw new Error('unexpected selector ' + sel);
      for (let n = this; n; n = n.parent) if (n.hasAttribute(m[1])) return n;
      return null;
    }
  };
}
function click(L, target) {
  try { L.clicks.forEach((fn) => fn({ type: 'click', target })); return null; } catch (e) { return e.message; }
}

/* Every alertPill( call in the file, with its argument text, found by a scanner that knows strings,
   templates and comments, so a ')' inside a title never ends the call early. */
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
  throw new Error('unterminated alertPill( call at line ' + lineOf(s, start));
}
// Every component call (alertPill or setItem), or one component's. localStorage.setItem( is not one.
function calls(src, only) {
  const out = []; const re = /(?<![\w$.])(alertPill|setItem)\(/g; let m;
  while ((m = re.exec(src))) {
    if (src.slice(Math.max(0, m.index - 9), m.index) === 'function ') continue;
    if (only && m[1] !== only) continue;
    out.push({ fn: m[1], line: lineOf(src, m.index), args: callArgs(src, m.index + m[0].length) });
  }
  return out;
}
// The component block: the shared parts, alertPill and setItem, up to the HOME banner.
function compFn(src) {
  const a = src.indexOf('const uiTxt=');
  const b = src.indexOf('/* ---------- HOME ---------- */', a);
  if (a < 0 || b < 0) throw new Error('cannot find the component block (const uiTxt= up to the HOME banner)');
  return src.slice(a, b);
}
function pillFn(src) {
  const a = src.indexOf('function alertPill(p){');
  const b = src.indexOf('/* ---------- HOME ---------- */', a);
  if (a < 0 || b < 0) throw new Error('cannot find function alertPill before the HOME banner');
  return { a, b, body: src.slice(a, b) };
}
// The whole tag around position pos: back to its '<', forward to the first '>' outside any ${...}.
function tagAt(s, pos) {
  const a = s.lastIndexOf('<', pos); let d = 0, i = pos;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '$' && s[i + 1] === '{') { d++; i++; } else if (c === '}' && d) d--; else if (c === '>' && !d) break;
  }
  return s.slice(a, i + 1);
}

const PROBE = `<i>x</i> "dbl" 'sgl' & co`;
const PROBE_ESC = '&lt;i&gt;x&lt;/i&gt; &quot;dbl&quot; &#39;sgl&#39; &amp; co';

/* The pinned markup (check 10). The CSS at .alert-pill, .ap-ico, .ap-body, .ap-t, .ap-s, .ap-acts and
   .ap-stack is written against exactly this shape. Change it here only together with that CSS. */
const DOSE_PROPS = { edge: 'med', icon: 'pill', title: 'Calpol due', sub: '2.5 ml · ', due: NOW + 300000,
  acts: [{ label: 'Log', act: 'logDose', args: ['m1'] },
    { label: 'In 15 min', act: 'snoozeMedAlert', args: ['m1', NOW], kind: 'soft' },
    { label: 'Not now', act: 'dismissMedAlert', args: ['m1', NOW], kind: 'quiet' }] };
const DOSE_GOLDEN = '<div class="alert-pill ap-stack" style="border-color:var(--med)">\n'
  + '    <div class="ap-ico" style="background:var(--med-soft);color:var(--med)"><svg data-i="pill"></svg></div>\n'
  + '    <div class="ap-body"><div class="ap-t">Calpol due</div><div class="ap-s">2.5 ml · <span data-due="1800000300000">in 5 min</span></div></div>\n'
  + '    <div class="ap-acts"><button data-act="logDose" data-args="[&quot;m1&quot;]">Log</button>\n'
  + '<button class="ap-soft" data-act="snoozeMedAlert" data-args="[&quot;m1&quot;,1800000000000]">In 15 min</button>\n'
  + '<button class="ap-quiet" data-act="dismissMedAlert" data-args="[&quot;m1&quot;,1800000000000]">Not now</button></div></div>';
const CONSENT_PROPS = { edge: 'danger', tint: 'med', glyph: '🛡️', ink: false, small: true, title: 'Not this time',
  sub: 'Export was declined, nothing changed', acts: [{ label: 'OK', act: 'ackDecline', args: ['c1'] }] };
const CONSENT_GOLDEN = '<div class="alert-pill" style="border-color:var(--danger)">\n'
  + '    <div class="ap-ico" style="background:var(--med-soft);font-size:17px">🛡️</div>\n'
  + '    <div class="ap-body"><div class="ap-t">Not this time</div><div class="ap-s">Export was declined, nothing changed</div></div>\n'
  + '    <button data-act="ackDecline" data-args="[&quot;c1&quot;]">OK</button></div>';

const CHECKS = [
  ['text props (title, sub, label, glyph) are escaped, and the only tags are the component\'s own', (src) => {
    const { api } = load(src);
    const wrong = [];
    [{ edge: 'med', glyph: PROBE, title: PROBE, sub: PROBE, acts: [{ label: PROBE, act: 'logDose', args: ['m1'] }] },
      { edge: 'med', icon: 'pill', title: PROBE, sub: PROBE,
        acts: [{ label: PROBE, act: 'logDose' }, { label: PROBE, act: 'ackChild', kind: 'quiet' }] }].forEach((p, n) => {
      const html = api.alertPill(p);
      const root = parse(html);
      const els = walk(root);
      const bad = els.filter((e) => OWN_TAGS.indexOf(e.tag) < 0).map((e) => '<' + e.tag + '>');
      if (bad.length) wrong.push(`pill ${n}: foreign tags ${bad.join(' ')}`);
      els.forEach((e) => Object.keys(e.attrs).forEach((k) => { if (OWN_ATTRS.indexOf(k) < 0) wrong.push(`pill ${n}: foreign attribute ${k} on <${e.tag}>`); }));
      if (html.includes('<i>')) wrong.push(`pill ${n}: a raw <i> reached the markup`);
      const want = { 'ap-t': PROBE_ESC, 'ap-s': PROBE_ESC };
      if (p.glyph != null) want['ap-ico'] = PROBE_ESC;
      Object.keys(want).forEach((c) => { const got = raw(one(root, c)); if (got !== want[c]) wrong.push(`pill ${n}: .${c} printed ${JSON.stringify(got)}`); });
      tags(root, 'button').forEach((b) => { if (raw(b) !== PROBE_ESC) wrong.push(`pill ${n}: a label printed ${JSON.stringify(raw(b))}`); });
      if (decode(raw(one(root, 'ap-t'))) !== PROBE) wrong.push(`pill ${n}: the title does not read back as typed`);
    });
    return wrong.length ? wrong : true;
  }],

  ['a 0 prints as "0", and a missing value prints nothing, never "undefined"', (src) => {
    const { api } = load(src);
    const wrong = [];
    const z = pill(api, { edge: 'med', glyph: 0, title: 0, sub: 0, acts: [{ label: 0, act: 'ackChild' }] });
    [['ap-t', '0'], ['ap-s', '0'], ['ap-ico', '0']].forEach(([c, v]) => { if (raw(one(z, c)) !== v) wrong.push(`.${c} for 0 printed ${JSON.stringify(raw(one(z, c)))}`); });
    if (raw(tags(z, 'button')[0]) !== '0') wrong.push('a label of 0 printed ' + JSON.stringify(raw(tags(z, 'button')[0])));
    const dose = 0;
    const d = pill(api, { edge: 'med', icon: 'pill', title: 'Calpol due', sub: `${dose} ml · `, acts: [] });
    if (raw(one(d, 'ap-s')) !== '0 ml · ') wrong.push('a dose of 0 printed ' + JSON.stringify(raw(one(d, 'ap-s'))));
    [{}, { title: null, sub: undefined }].forEach((extra) => {
      const m = pill(api, Object.assign({ edge: 'med', icon: 'pill', acts: [{ act: 'ackChild' }] }, extra));
      ['ap-t', 'ap-s'].forEach((c) => { if (raw(one(m, c)) !== '') wrong.push(`a missing ${c} printed ${JSON.stringify(raw(one(m, c)))}`); });
      if (raw(tags(m, 'button')[0]) !== '') wrong.push('a missing label printed ' + JSON.stringify(raw(tags(m, 'button')[0])));
    });
    return wrong.length ? wrong : true;
  }],

  ['data-args round-trips through the attribute for any id, and the dispatcher hands back the same values', (src) => {
    const L = load(src);
    const wrong = [];
    const IDS = ['a"b', "a'b", 'a\\b', '</div>', 'a\u2028b', 42, 'a&amp;b', `x"'\\</div>\u2028&<i>x</i>`];
    IDS.forEach((id) => {
      [[id], [id, NOW]].forEach((args) => {
        const act = args.length === 1 ? 'logDose' : 'snoozeMedAlert';
        const tag = JSON.stringify(args);
        let root;
        try { root = pill(L.api, { edge: 'med', icon: 'pill', title: 't', acts: [{ label: 'Go', act, args }] }); }
        catch (e) { wrong.push(`${tag}: ${e.message}`); return; }
        const b = tags(root, 'button')[0];
        const v = b && b.attrs['data-args'];
        if (v === undefined) { wrong.push(`${tag}: no data-args`); return; }
        if (/["'<>]/.test(v)) wrong.push(`${tag}: raw quote or bracket in data-args ${JSON.stringify(v)}`);
        if (/&(?!amp;|lt;|gt;|quot;|#39;)/.test(v)) wrong.push(`${tag}: a bare & in data-args`);
        let back;
        try { back = JSON.parse(decode(v)); } catch (e) { wrong.push(`${tag}: data-args is not JSON (${e.message})`); return; }
        if (!same(back, args)) wrong.push(`${tag}: came back as ${JSON.stringify(back)}`);
        L.calls.length = 0;
        const err = click(L, el({ 'data-act': decode(b.attrs['data-act']), 'data-args': decode(v) }));
        if (err) wrong.push(`${tag}: the dispatcher threw ${err}`);
        else if (!same(L.calls.map((c) => [c[0], c[1]]), [[act, args]])) wrong.push(`${tag}: the handler got ${JSON.stringify(L.calls)}`);
      });
    });
    return wrong.length ? wrong : true;
  }],

  ['an action with no args emits no data-args attribute', (src) => {
    const { api } = load(src);
    const wrong = [];
    [undefined, []].forEach((args) => {
      const html = api.alertPill({ edge: 'sleep', icon: 'syringe', title: 'Vaccine overdue', acts: [{ label: 'Open', act: 'openVaccines', args }] });
      const b = tags(parse(html), 'button')[0];
      if (!same(Object.keys(b.attrs), ['data-act'])) wrong.push(`args ${JSON.stringify(args)} gave attributes ${Object.keys(b.attrs).join(',')}`);
      if (html.includes('data-args')) wrong.push(`args ${JSON.stringify(args)} printed data-args`);
    });
    const two = tags(pill(api, { edge: 'med', icon: 'pill', acts: [{ label: 'A', act: 'logDose', args: ['m1'] }, { label: 'B', act: 'openTemp' }] }), 'button');
    if (!('data-args' in two[0].attrs) || 'data-args' in two[1].attrs) wrong.push('mixed actions: data-args on the wrong button');
    return wrong.length ? wrong : true;
  }],

  [`edge and tint tokens are validated, and a bad one falls back to '${DEFAULT_TOKEN}' and never reaches the markup`, (src) => {
    const { api } = load(src);
    const wrong = [];
    const styles = (p) => { const r = pill(api, p); return [walk(r)[0].attrs.style, one(r, 'ap-ico').attrs.style]; };
    const D = DEFAULT_TOKEN;
    ['med;background:red', 'med)', 'Med', '', 'med soft', '-med', 'med\n', '9med', 'med_x', 7, {}].forEach((bad) => {
      const p = { edge: bad, icon: 'pill', title: 't', acts: [] };
      const html = api.alertPill(p);
      const got = styles(p);
      if (!same(got, [`border-color:var(--${D})`, `background:var(--${D}-soft);color:var(--${D})`])) wrong.push(`edge ${JSON.stringify(bad)} gave ${JSON.stringify(got)}`);
      if (typeof bad === 'string' && bad && html.includes(bad)) wrong.push(`edge ${JSON.stringify(bad)} reached the markup`);
    });
    ['med;background:red', 'med)', 'Med', 'med soft', '9med', 7].forEach((bad) => {
      const got = styles({ edge: 'med', tint: bad, icon: 'pill', title: 't', acts: [] });
      if (!same(got, ['border-color:var(--med)', `background:var(--${D}-soft);color:var(--${D})`])) wrong.push(`tint ${JSON.stringify(bad)} gave ${JSON.stringify(got)}`);
    });
    ['med', 'sleep', 'star', 'pump', 'note', 'diaper', 'preg', 'ink-soft'].forEach((t) => {
      const got = styles({ edge: t, icon: 'pill', acts: [] });
      if (!same(got, [`border-color:var(--${t})`, `background:var(--${t}-soft);color:var(--${t})`])) wrong.push(`good token ${t} gave ${JSON.stringify(got)}`);
    });
    return wrong.length ? wrong : true;
  }],

  ['an icon comes only from I\'s own keys; anything else is an empty box', (src) => {
    const { api } = load(src);
    const wrong = [];
    ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', '<b>x</b>', 'nope', undefined, null, ''].forEach((k) => {
      const html = api.alertPill({ edge: 'med', icon: k, title: 't', acts: [] });
      const inner = icoInner(html);
      if (inner !== '') wrong.push(`icon ${JSON.stringify(k)} drew ${JSON.stringify(inner)}`);
    });
    Object.keys(ICONS).forEach((k) => {
      const inner = icoInner(api.alertPill({ edge: 'med', icon: k, title: 't', acts: [] }));
      if (inner !== ICONS[k]) wrong.push(`icon ${k} drew ${JSON.stringify(inner)}`);
    });
    return wrong.length ? wrong : true;
  }],

  ['due renders exactly one numeric <span data-due>, and no due renders none', (src) => {
    const { api } = load(src);
    const wrong = [];
    [[NOW + 300000, String(NOW + 300000), 'in 5 min'], [0, '0', null], [String(NOW), String(NOW), null], ['5" x="y', null, null]].forEach(([due, want, text]) => {
      let root;
      try { root = pill(api, { edge: 'med', icon: 'pill', title: 't', sub: 's · ', due, acts: [] }); }
      catch (e) { wrong.push(`due ${JSON.stringify(due)}: ${e.message}`); return; }
      const spans = tags(root, 'span');
      if (spans.length !== 1) { wrong.push(`due ${JSON.stringify(due)}: ${spans.length} spans`); return; }
      const s = spans[0];
      if (!same(Object.keys(s.attrs), ['data-due'])) wrong.push(`due ${JSON.stringify(due)}: span attributes ${Object.keys(s.attrs).join(',')}`);
      const v = s.attrs['data-due'];
      if (String(Number(v)) !== v) wrong.push(`due ${JSON.stringify(due)}: data-due="${v}" is not a number`);
      if (want !== null && v !== want) wrong.push(`due ${JSON.stringify(due)}: data-due="${v}", want ${want}`);
      if (text !== null && raw(s) !== text) wrong.push(`due ${JSON.stringify(due)}: countdown ${JSON.stringify(raw(s))}`);
      if (s.parent.attrs.class !== 'ap-s') wrong.push(`due ${JSON.stringify(due)}: the span is not inside .ap-s`);
    });
    [{}, { due: null }, { due: undefined }].forEach((extra) => {
      const html = api.alertPill(Object.assign({ edge: 'med', icon: 'pill', title: 't', acts: [] }, extra));
      if (html.includes('data-due')) wrong.push(`${JSON.stringify(extra)} printed a data-due span`);
    });
    return wrong.length ? wrong : true;
  }],

  ['one action sits beside the text, two or more stack; kind maps to ap-soft or ap-quiet, nothing else', (src) => {
    const { api } = load(src);
    const wrong = [];
    const acts = (n) => Array.from({ length: n }, (_, i) => ({ label: 'a' + i, act: 'ackChild' }));
    [0, 1, 2, 3].forEach((n) => {
      const r = pill(api, { edge: 'med', icon: 'pill', title: 't', acts: acts(n) });
      const top = walk(r)[0];
      const stack = n > 1;
      if (top.attrs.class !== (stack ? 'alert-pill ap-stack' : 'alert-pill')) wrong.push(`${n} acts: class ${JSON.stringify(top.attrs.class)}`);
      const wrap = byClass(r, 'ap-acts');
      if (wrap.length !== (stack ? 1 : 0)) wrong.push(`${n} acts: ${wrap.length} .ap-acts`);
      const bs = tags(r, 'button');
      if (bs.length !== n) wrong.push(`${n} acts: ${bs.length} buttons`);
      bs.forEach((b) => { if (b.parent !== (stack ? wrap[0] : top)) wrong.push(`${n} acts: a button outside its place`); });
    });
    [['soft', 'ap-soft'], ['quiet', 'ap-quiet'], ['loud', null], ['Soft', null], ['', null], [undefined, null],
      ['soft quiet', null], ['constructor', null]].forEach(([kind, cls]) => {
      const b = tags(pill(api, { edge: 'med', icon: 'pill', acts: [{ label: 'x', act: 'ackChild', kind }] }), 'button')[0];
      if ((b.attrs.class === undefined ? null : b.attrs.class) !== cls) wrong.push(`kind ${JSON.stringify(kind)} gave class ${JSON.stringify(b.attrs.class)}`);
    });
    return wrong.length ? wrong : true;
  }],

  ['the icon box style: ink:false drops the colour, small:true is 17px, a glyph is otherwise var(--fs-title)', (src) => {
    const { api } = load(src);
    const wrong = [];
    const ico = (p) => one(pill(api, Object.assign({ edge: 'star', title: 't', acts: [] }, p)), 'ap-ico').attrs.style;
    [[{ glyph: '🎉' }, 'background:var(--star-soft);color:var(--star);font-size:var(--fs-title)'],
      [{ glyph: '📅', ink: false }, 'background:var(--star-soft);font-size:var(--fs-title)'],
      [{ glyph: '🛡️', ink: false, small: true }, 'background:var(--star-soft);font-size:17px'],
      [{ glyph: '🛡️', small: true }, 'background:var(--star-soft);color:var(--star);font-size:17px'],
      [{ glyph: '🎉', ink: 0 }, 'background:var(--star-soft);color:var(--star);font-size:var(--fs-title)'],
      [{ icon: 'snow' }, 'background:var(--star-soft);color:var(--star)'],
      [{ icon: 'snow', ink: false, small: true }, 'background:var(--star-soft);color:var(--star)'],
      [{ edge: 'danger', tint: 'med', icon: 'stetho' }, 'background:var(--med-soft);color:var(--med)']].forEach(([p, want]) => {
      const got = ico(p);
      if (got !== want) wrong.push(`${JSON.stringify(p)} gave ${JSON.stringify(got)}`);
    });
    return wrong.length ? wrong : true;
  }],

  ['golden: a dose pill and a consent pill render exactly the pinned markup', (src) => {
    const { api } = load(src);
    const wrong = [];
    const d = api.alertPill(DOSE_PROPS), c = api.alertPill(CONSENT_PROPS);
    if (d !== DOSE_GOLDEN) wrong.push({ dose: d });
    if (c !== CONSENT_GOLDEN) wrong.push({ consent: c });
    return wrong.length ? wrong : true;
  }],

  ['the dispatcher calls a known action synchronously with exactly its args, from the button or a child of it', (src) => {
    const L = load(src);
    const wrong = [];
    if (L.clicks.length !== 1 || L.other.length) wrong.push(`${L.clicks.length} click listeners, ${L.other.length} others`);
    const got = () => L.calls.map((c) => [c[0], c[1]]);
    const btn = el({ 'data-act': 'logDose', 'data-args': '["m1"]' }, el({ class: 'alert-pill' }));
    const cases = [
      ['the button', btn, [['logDose', ['m1']]]],
      ['a child of the button', el({}, el({}, btn)), [['logDose', ['m1']]]],
      ['two args', el({ 'data-act': 'snoozeMedAlert', 'data-args': `["m1",${NOW}]` }), [['snoozeMedAlert', ['m1', NOW]]]],
      ['no data-args', el({ 'data-act': 'openTemp' }), [['openTemp', []]]],
      ['an element with no data-act', el({ class: 'ap-body' }, el({ class: 'alert-pill' })), []],
      ['a target without closest', {}, []],
      ['no target', null, []]
    ];
    cases.forEach(([label, target, want]) => {
      L.calls.length = 0;
      const err = click(L, target);
      if (err) wrong.push(`${label}: threw ${err}`);
      else if (!same(got(), want)) wrong.push(`${label}: right after the click the calls were ${JSON.stringify(got())}`);
    });
    return wrong.length ? wrong : true;
  }],

  ['the dispatcher refuses unknown and inherited names, bad JSON and anything but an array, without throwing', (src) => {
    const L = load(src);
    const wrong = [];
    const names = ['nope', 'LogDose', 'logDose ', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf',
      'isPrototypeOf', '__defineGetter__'];
    const argsBad = ['[', "['m1']", 'undefined', '{"0":"m1","length":1}', '"m1"', '5', 'null', 'true', '{}'];
    const cases = names.map((n) => [{ 'data-act': n }, 'name ' + JSON.stringify(n)])
      .concat(names.map((n) => [{ 'data-act': n, 'data-args': '["m1"]' }, 'name ' + JSON.stringify(n) + ' with args']))
      .concat(argsBad.map((a) => [{ 'data-act': 'logDose', 'data-args': a }, 'args ' + a]));
    cases.forEach(([attrs, label]) => {
      L.calls.length = 0;
      const err = click(L, el(attrs));
      if (err) wrong.push(`${label}: threw ${err}`);
      else if (L.calls.length) wrong.push(`${label}: called ${JSON.stringify(L.calls)}`);
    });
    return wrong.length ? wrong : true;
  }],

  ['every UI_ACTIONS entry does exactly what its old inline handler did, in the same order', (src) => {
    const L = load(src);
    const wrong = [];
    const keys = sorted(Object.keys(L.api.UI_ACTIONS));
    const spec = sorted(Object.keys(PASS_THROUGH).concat(COMPOSITE));
    if (!same(keys, spec)) wrong.push({ registry: keys, spec, note: 'a new action needs its old behaviour written into PASS_THROUGH or COMPOSITE here' });
    Object.keys(PASS_THROUGH).forEach((name) => {
      if (!own(L.api.UI_ACTIONS, name)) return;
      const args = ['id"' + name, NOW].slice(0, PASS_THROUGH[name]);
      L.calls.length = 0;
      L.api.UI_ACTIONS[name].apply(null, args);
      const got = L.calls.map((c) => [c[0], c[1]]);
      if (!same(got, [[name, args]])) wrong.push(`${name}(${JSON.stringify(args).slice(1, -1)}) made ${JSON.stringify(got)}`);
    });
    if (own(L.api.UI_ACTIONS, 'openVaccines')) {
      L.calls.length = 0; L.ctx.healthTab = 'overview';
      L.api.UI_ACTIONS.openVaccines();
      const want = [['go', ['health'], 'overview'], ['render', [], 'vaccines']];
      if (!same(L.calls, want) || L.ctx.healthTab !== 'vaccines') wrong.push(`openVaccines made ${JSON.stringify(L.calls)} (healthTab after: ${L.ctx.healthTab})`);
    }
    if (own(L.api.UI_ACTIONS, 'openMonthCard')) {
      L.calls.length = 0;
      L.api.UI_ACTIONS.openMonthCard(3, 'p1');
      const got = L.calls.map((c) => [c[0], c[1]]);
      if (!same(got, [['openMemoryCard', [3, 'p1']], ['dismissTip', ['bday3']]])) wrong.push(`openMonthCard(3,'p1') made ${JSON.stringify(got)}`);
    }
    const steps = (name, want) => {
      if (!own(L.api.UI_ACTIONS, name)) return;
      L.calls.length = 0;
      L.api.UI_ACTIONS[name]();
      const got = L.calls.map((c) => [c[0], c[1]]);
      // same() goes through JSON, which writes undefined as null; here the difference is the point.
      const exact = (v) => JSON.stringify(v, (k, x) => (x === undefined ? '<undefined>' : x));
      if (exact(got) !== exact(want)) wrong.push(`${name}() made ${exact(got)}, want ${exact(want)}`);
    };
    steps('openDen', [['closeSheet', []], ['goDen', []]]);
    steps('openFamily', [['window.openFamily', []]]);
    steps('openFeedback', [['window.openFeedback', []]]);
    // undefined, not null: openPro reads its first argument as truthy, and JSON could never carry it
    steps('openProSettings', [['openPro', [undefined, undefined, 'settings']]]);
    // and a guarded global that has not loaded yet does nothing and throws nothing, as the inline && did
    WINDOW_HANDLERS.forEach((h) => {
      if (!own(L.api.UI_ACTIONS, h)) return;
      const keep = L.ctx.window[h]; delete L.ctx.window[h]; L.calls.length = 0;
      try { L.api.UI_ACTIONS[h](); if (L.calls.length) wrong.push(`${h} called something with no ${h} loaded`); }
      catch (e) { wrong.push(`${h} threw with no ${h} loaded: ${e.message}`); }
      L.ctx.window[h] = keep;
    });
    return wrong.length ? wrong : true;
  }],

  ['no hand-written alert-pill markup outside function alertPill (the matcher finds the component\'s own)', (src) => {
    const { a, b } = pillFn(src);
    const re = /class(?:Name)?\s*=\s*\\?["'`][^"'`]*\balert-pill\b|classList\.add\([^)]*alert-pill/g;
    const inside = [], outside = []; let m;
    while ((m = re.exec(src))) (m.index > a && m.index < b ? inside : outside).push(m.index);
    const wrong = outside.map((i) => `line ${lineOf(src, i)}: ${JSON.stringify(src.slice(i, i + 50))}`);
    if (inside.length !== 1) wrong.push(`the matcher found ${inside.length} alert-pill classes inside alertPill, want its own 1`);
    return wrong.length ? wrong : true;
  }],

  ['every act a call names is an own UI_ACTIONS key, and every key is used by a call', (src) => {
    const { api } = load(src);
    const keys = Object.keys(api.UI_ACTIONS);
    const used = {}; const wrong = [];
    calls(src).forEach(({ line, args }) => {
      const re = /\bact\s*:\s*/g; let m;
      while ((m = re.exec(args))) {
        const lit = /^(['"])([A-Za-z_$][\w$]*)\1/.exec(args.slice(m.index + m[0].length));
        if (!lit) { wrong.push(`line ${line}: an act that is not a quoted name`); continue; }
        used[lit[2]] = 1;
        if (!own(api.UI_ACTIONS, lit[2])) wrong.push(`line ${line}: act '${lit[2]}' is not in UI_ACTIONS`);
      }
    });
    /* A control can also name its action straight through uiAct('name', [args]), the helper alertPill and
       setItem use themselves. Same rules: a quoted name, and an own UI_ACTIONS key. */
    { const ur = /(?<![\w$.])uiAct\(\s*/g; let u;
      while ((u = ur.exec(src))) {
        const lit = /^(['"])([A-Za-z_$][\w$]*)\1/.exec(src.slice(u.index + u[0].length));
        if (!lit) continue;   // the helper's own definition and the components pass a variable through
        used[lit[2]] = 1;
        if (!own(api.UI_ACTIONS, lit[2])) wrong.push(`line ${lineOf(src, u.index)}: uiAct '${lit[2]}' is not in UI_ACTIONS`);
      } }
    keys.filter((k) => !used[k]).forEach((k) => wrong.push(`UI_ACTIONS.${k} is used by no call`));
    if (!Object.keys(used).length) wrong.push('the matcher found no act at all');
    return wrong.length ? wrong : true;
  }],

  ['no component call passes escapeHtml output (it would print its entities)', (src) => {
    const list = calls(src);
    const wrong = list.filter((c) => c.args.includes('escapeHtml(')).map((c) => `line ${c.line}: ${c.fn} passes escapeHtml(...)`);
    if (!list.some((c) => c.fn === 'alertPill') || !list.some((c) => c.fn === 'setItem')) wrong.push('the matcher missed alertPill or setItem calls');
    return wrong.length ? wrong : true;
  }],

  ['no element carries both data-act and an inline handler, and no component builds one', (src) => {
    const wrong = [];
    const re = /\sdata-act\s*=/g; let m, found = 0;
    while ((m = re.exec(src))) {
      found++;
      const tag = tagAt(src, m.index);
      if (/\son[a-z]+\s*=/i.test(tag)) wrong.push(`line ${lineOf(src, m.index)}: ${JSON.stringify(tag.slice(0, 90))}`);
    }
    if (!found) wrong.push('the matcher found no data-act attribute, not even the component\'s button');
    if (!/\sonclick\s*=/.test(src)) wrong.push('the matcher found no onclick anywhere; the scan is broken');
    if (/onclick|\son[a-z]+\s*=/i.test(compFn(src))) wrong.push('the component block builds an inline handler');
    return wrong.length ? wrong : true;
  }],

  [`hand-written inline handlers that interpolate a value can only fall (ceiling ${HANDLER_CEILING})`, (src) => {
    const all = src.match(/\son[a-z]+="[^"]*"/g) || [];
    const hit = all.filter((s) => s.includes('${'));
    const by = {}; hit.forEach((s) => { const k = s.trim().split('=')[0]; by[k] = (by[k] || 0) + 1; });
    if (!all.length) return ['the matcher found no inline handler at all; the scan is broken'];
    if (!hit.length) return ['the matcher found no interpolated handler; either the migration is finished (then retire this check) or the scan is broken'];
    const tally = `${hit.length} interpolated inline handlers ${JSON.stringify(by)}, ceiling ${HANDLER_CEILING}`;
    if (hit.length > HANDLER_CEILING) return [`${tally}. Build the new control with a component and a UI_ACTIONS entry instead of a handler string.`];
    return { note: tally + (hit.length < HANDLER_CEILING ? ': lower HANDLER_CEILING to ' + hit.length : '') };
  }],

  ['a crafted non-finite due still reaches the medicine ledger under the key the pill was drawn with', (src) => {
    // JSON.stringify turns -Infinity into null; +null is 0, so a snooze would key '@0' while render checks
    // '@-Infinity' and the pill could never be quieted. The dose call site must pass a non-finite due as text.
    const wrong = [];
    const dose = calls(src).filter((c) => /act\s*:\s*'snoozeMedAlert'/.test(c.args))[0];
    if (!dose) return ['the matcher found no dose pill call'];
    if (!/const dueArg\s*=\s*Number\.isFinite\(due\)\s*\?\s*due\s*:\s*String\(due\)/.test(src)) wrong.push('no finite guard: const dueArg = Number.isFinite(due) ? due : String(due)');
    ['snoozeMedAlert', 'dismissMedAlert'].forEach((a) => {
      if (!new RegExp(`act\\s*:\\s*'${a}'\\s*,\\s*args\\s*:\\s*\\[\\s*m\\.id\\s*,\\s*dueArg\\s*\\]`).test(dose.args)) wrong.push(`line ${dose.line}: ${a} does not pass dueArg`);
    });
    // And the value itself makes the trip: rendered, clicked, and keyed exactly as render keys it.
    for (const due of [-Infinity, Infinity, NOW]) {
      const L = load(src);
      const arg = Number.isFinite(due) ? due : String(due);
      const html = L.api.alertPill({ edge: 'med', icon: 'pill', title: 't', sub: 's', due: NOW,
        acts: [{ label: 'a', act: 'snoozeMedAlert', args: ['m1', arg] }, { label: 'b', act: 'dismissMedAlert', args: ['m1', arg] }] });
      const m = /data-act="snoozeMedAlert" data-args="([^"]*)"/.exec(html);
      if (!m) { wrong.push('no snooze button rendered'); continue; }
      L.calls.length = 0;
      const err = click(L, el({ 'data-act': 'snoozeMedAlert', 'data-args': decode(m[1]) }));
      if (err) { wrong.push(`due ${due}: the click threw ${err}`); continue; }
      const got = L.calls.filter((c) => c[0] === 'snoozeMedAlert')[0];
      const key = got ? 'm1@' + (+got[1][1]) : null;
      if (key !== 'm1@' + due) wrong.push(`due ${due} keyed as ${key}`);
    }
    return wrong.length ? wrong : true;
  }],

  [`exactly ${EXPECTED_CALLS} alertPill( call sites`, (src) => {
    const list = calls(src, 'alertPill');
    const note = `alertPill( call sites: ${list.length} (lines ${list.map((c) => c.line).join(', ')})`;
    return list.length === EXPECTED_CALLS ? { note } : [`found ${list.length}, the spec says ${EXPECTED_CALLS}. If a pill was added or removed on purpose, edit EXPECTED_CALLS in tools/alert_pill_check.js in the same commit and name the pill in the commit message.`, note];
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
const MUTATIONS = [
  ['text printed without escaping', 1, swap("const uiTxt=v=>escapeHtml(String(v==null?'':v));", "const uiTxt=v=>String(v==null?'':v);")],
  ['a uiAct names an action that is not registered', 15, swap("uiAct('obLogNappy',", "uiAct('obLogNappyGone',")],
  ['the button label printed raw', 1, swap('${uiAct(a.act,a.args)}>${uiTxt(a.label)}</button>', '${uiAct(a.act,a.args)}>${a.label}</button>')],
  ['the glyph printed raw', 1, swap('">${uiTxt(p.glyph)}</div>', '">${p.glyph}</div>')],
  ['text goes straight to escapeHtml, which drops 0', 2, swap("const uiTxt=v=>escapeHtml(String(v==null?'':v));", 'const uiTxt=v=>escapeHtml(v);')],
  ['a missing value is stringified', 2, swap("const uiTxt=v=>escapeHtml(String(v==null?'':v));", 'const uiTxt=v=>escapeHtml(String(v));')],
  ['data-args printed without escaping', 3, swap('data-args="${uiTxt(JSON.stringify(args))}"', 'data-args="${JSON.stringify(args)}"')],
  ['data-args joined instead of JSON', 3, swap('data-args="${uiTxt(JSON.stringify(args))}"', 'data-args="${uiTxt(args.join(\',\'))}"')],
  ['data-args printed for every action', 4, swap('${args&&args.length?` data-args=', '${true?` data-args=')],
  ['the token check is dropped', 5, swap("const uiTok=t=>/^[a-z][a-z-]*$/.test(t||'')?t:'line';", "const uiTok=t=>t||'line';")],
  ['the token check loses its end anchor', 5, swap("const uiTok=t=>/^[a-z][a-z-]*$/.test(t||'')?t:'line';", "const uiTok=t=>/^[a-z][a-z-]*/.test(t||'')?t:'line';")],
  ['the tint skips the token check', 5, swap('const tint=uiTok(p.tint||p.edge)', 'const tint=p.tint||uiTok(p.edge)')],
  ['icons read through the prototype', 6, swap("${Object.prototype.hasOwnProperty.call(I,p.icon)?I[p.icon]:''}", "${I[p.icon]||''}")],
  ['icons checked with in', 6, swap("${Object.prototype.hasOwnProperty.call(I,p.icon)?I[p.icon]:''}", "${(p.icon in I)?I[p.icon]:''}")],
  ['data-due printed as given', 7, swap('<span data-due="${+p.due}">', '<span data-due="${p.due}">')],
  ['a due of 0 is dropped', 7, swap('${p.due!=null?`<span data-due=', '${p.due?`<span data-due=')],
  ['one action already stacks', 8, swap('many=acts.length>1', 'many=acts.length>0')],
  ['any kind becomes a class', 8, swap("${a.kind==='soft'||a.kind==='quiet'?` class=", '${a.kind?` class=')],
  ['small glyphs lose 17px', 9, swap("${p.small?';font-size:17px':';font-size:var(--fs-title)'}", ';font-size:var(--fs-title)')],
  ['a glyph loses its ink unless ink is set', 9, swap("${p.ink===false?'':`;color:var(--${tint})`}", "${!p.ink?'':`;color:var(--${tint})`}")],
  ['stacked buttons lose their line breaks', 10, swap("acts.map(btn).join('\\n')", "acts.map(btn).join('')")],
  ['the dispatcher only looks at the target itself', 11, swap("const el=e.target&&e.target.closest?e.target.closest('[data-act]'):null;", "const el=e.target&&e.target.getAttribute&&e.target.getAttribute('data-act')?e.target:null;")],
  ['the dispatcher runs the action later', 11, swap('UI_ACTIONS[name].apply(null,args);', 'Promise.resolve().then(()=>UI_ACTIONS[name].apply(null,args));')],
  ['the dispatcher forgets a click with no data-act', 11, swap("e.target.closest('[data-act]'):null;\n  if(!el) return;", "e.target.closest('[data-act]'):null;")],
  ['inherited names count as actions', 12, swap('if(!Object.prototype.hasOwnProperty.call(UI_ACTIONS,name)) return;', 'if(!(name in UI_ACTIONS)) return;')],
  ['any JSON value is taken as args', 12, swap('if(!Array.isArray(args)) return;', 'if(args==null) return;')],
  ['bad JSON is not caught', 12, swap("try{ args=JSON.parse(el.getAttribute('data-args')||'[]'); }catch(_){ return; }", "args=JSON.parse(el.getAttribute('data-args')||'[]');")],
  ['openVaccines sets the tab before go', 13, swap("openVaccines:()=>{ go('health'); healthTab='vaccines'; render(); },", "openVaccines:()=>{ healthTab='vaccines'; go('health'); render(); },")],
  ['openMonthCard dismisses before it opens', 13, swap("{ openMemoryCard(month,photoId); dismissTip('bday'+month); }", "{ dismissTip('bday'+month); openMemoryCard(month,photoId); }")],
  ['snooze drops its due', 13, swap('snoozeMedAlert:(id,due)=>snoozeMedAlert(id,due),', 'snoozeMedAlert:(id,due)=>snoozeMedAlert(id),')],
  ['openFeedback loses its guard for a late-loading global', 13, swap('openFeedback:()=>{ window.openFeedback&&window.openFeedback(); },', 'openFeedback:()=>{ window.openFeedback(); },')],
  ['openFamily loses its guard for a late-loading global', 13, swap('openFamily:()=>{ window.openFamily&&window.openFamily(); },', 'openFamily:()=>{ window.openFamily(); },')],
  ['openPro gets null where the inline handler passed undefined', 13, swap("openProSettings:()=>openPro(undefined,undefined,'settings'),", "openProSettings:()=>openPro(null,null,'settings'),")],
  ['openDen opens the Den before closing the sheet', 13, swap('openDen:()=>{ closeSheet(); goDen(); },', 'openDen:()=>{ goDen(); closeSheet(); },')],
  ['ackDecline wired to the wrong handler', 13, swap('ackDecline:(id)=>ackDecline(id),', 'ackDecline:(id)=>ackChild(id),')],
  ['a pill hand-written again', 14, swap("return alertPill({edge:'preg', glyph:'📅', ink:false, title:t, sub:s, acts:[{label:'Take off', act:'openWeeksTakeBack'}]});",
    'return `<div class="alert-pill" style="border-color:var(--preg)">\n    <div class="ap-ico" style="background:var(--preg-soft);font-size:18px">📅</div>\n    <div class="ap-body"><div class="ap-t">${t}</div><div class="ap-s">${s}</div></div>\n    <button data-act="openWeeksTakeBack">Take off</button></div>`;')],
  ['a call names an action the registry lacks', 15, swap("act:'ackChild'", "act:'ackKid'")],
  ['the registry gains an entry no call uses', 15, swap('ackChild:()=>ackChild(),', 'ackChild:()=>ackChild(),\n  ackKid:()=>ackChild(),')],
  ['a call passes escaped text', 16, swap("title:`${_cab.name||''} is growing up`", 'title:`${escapeHtml(_cab.name)} is growing up`')],
  ['an element carries data-act and an onclick', 17, swap('<button class="pc-hide" onclick="event.stopPropagation();hideFertileCard()">Hide this</button>', '<button class="pc-hide" data-act="ackChild" onclick="event.stopPropagation();hideFertileCard()">Hide this</button>')],
  ['the button builds an onclick string again', 17, swap('data-act="${uiTxt(act)}"', 'onclick="${uiTxt(act)}()"')],
  ['a new onclick string interpolates a value', 18, swap('onclick="event.stopPropagation();hideFertileCard()"', 'onclick="event.stopPropagation();hideFertileCard(\'${b.id}\')"')],
  ['a new oninput string interpolates a value', 18, swap('oninput="askType(this.value)"', 'oninput="askType(this.value,\'${b.id}\')"')],
  ['the dose pill passes its due raw again', 19, swap("act:'snoozeMedAlert', args:[m.id,dueArg]", "act:'snoozeMedAlert', args:[m.id,due]")],
  ['the finite guard is dropped', 19, swap('const dueArg = Number.isFinite(due) ? due : String(due);', 'const dueArg = due;')],
  ['a fourteenth call site', 20, swap("  al['preg-weeks'] += pregWeeksLeftAlert();", "  al['preg-weeks'] += pregWeeksLeftAlert();\n  al.child += alertPill({edge:'star', glyph:'🌱', title:'x', sub:'', acts:[{label:'Lovely', act:'ackChild'}]});")]
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
    console.error('alert-pill: FAIL, self-test broken; a gate that cannot go red proves nothing');
    process.exit(1);
  }
}
const results = run(src);
results.forEach((r) => console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${String(r.n).padStart(2)} ${r.name}${r.note ? '\n          ' + r.note : ''}${r.ok ? '' : '\n         got: ' + JSON.stringify(r.detail)}`));
const failed = results.filter((r) => !r.ok).length;
if (failed) { console.error(`alert-pill: FAIL, ${failed} of ${results.length} checks`); process.exit(1); }
console.log(`alert-pill: PASS, ${results.length} checks${SELF_TEST ? `, ${MUTATIONS.length} breaks each went red` : ''}`);
