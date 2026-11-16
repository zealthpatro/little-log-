/* The admin's own handful of files: one stylesheet, one script, two font families. Served by the Worker
 * from modules it imports, only AFTER the Access check (S6): the admin Worker has no [assets] directory,
 * so not one byte reaches anyone before the JWT is verified.
 *
 * Colours are Cubby's real tokens (app/index.html :root, DESIGN.md), named as the app names them. Fonts
 * are the app's own self-hosted Fraunces and Nunito Sans (app/fonts), never Google Fonts.
 */
import { FONTS } from './fonts.gen.mjs';
import { secure } from './headers.mjs';

const W = Array.from({ length: 101 }, (_, i) => '.w-' + i + '{width:' + i + '%}').join('');
/* Bar heights for "When people open Cubby, by local hour": classes, because the CSP forbids inline style. */
const H = Array.from({ length: 101 }, (_, i) => '.h-' + i + '{height:' + i + '%}').join('');
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const face = (family, file, weights, range) => "@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weights
  + ';font-display:swap;src:url(/static/fonts/' + file + ") format('woff2');unicode-range:" + range + '}';

export const CSS = [
  face('Fraunces', 'fraunces-latin-ext.woff2', '400 700', LATIN_EXT),
  face('Fraunces', 'fraunces-latin.woff2', '400 700', LATIN),
  face('Nunito Sans', 'nunitosans-latin-ext.woff2', '400 800', LATIN_EXT),
  face('Nunito Sans', 'nunitosans-latin.woff2', '400 800', LATIN),
  `:root{--bg:#F4EEE3;--ink:#2C2521;--ink-soft:#6E635B;--line:#E7DECF;--surface:#FFFFFF;--surface-2:#FBF7EF;
--sleep:#5E6AA8;--sleep-ink:#56629B;--sleep-soft:#E3E4F4;--diaper:#56A08E;--diaper-ink:#3C6F63;--danger:#D2654E;--danger-ink:#9F4C3B;
--feed:#E29A3B;--feed-soft:#FBEAD0;--feed-ink:#895D24;--pump:#C97FA0;--preg:#B06A9A;--note:#9A8C6E;--focus:#2C2521;
--shadow:0 5px 14px rgba(84,62,40,0.08);--r-card:26px;--r-mid:16px;--r-small:10px;
--serif:Fraunces,Georgia,serif;--sans:'Nunito Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:600 15px/1.45 var(--sans)}
a{color:var(--sleep-ink);font-weight:800}a:hover{color:var(--ink)}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
h1,h2{font-family:var(--serif);font-weight:600;margin:0}
h1{font-size:34px;letter-spacing:-0.01em;line-height:1.15;overflow-wrap:anywhere}
h2{font-size:22px}
.wrap{max-width:1360px;margin:0 auto;padding:32px 20px 64px;display:flex;flex-direction:column;gap:24px}
.lead{margin:4px 0 0;color:var(--ink-soft);font-size:14px;font-weight:600}
.head .lead{font-size:15px}
.note{margin:4px 0 0;font-size:13px;font-weight:700;color:var(--ink-soft)}
.sub{color:var(--ink-soft);font-size:13px;font-weight:600}
.strong{font-weight:800}
.good{color:var(--diaper-ink)}
.back{min-height:44px;display:inline-flex;align-items:center;align-self:flex-start;font-size:14px}
.head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px}
.head-text{display:flex;flex-direction:column;gap:6px;min-width:0;flex:1 1 420px}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.seg{display:flex;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-mid);padding:4px;gap:4px}
.seg a{min-height:44px;padding:0 14px;border-radius:12px;display:inline-flex;align-items:center;color:var(--ink);text-decoration:none;font-size:14px}
.seg a[aria-current]{background:var(--ink);color:#FFFFFF}
.own{display:flex;align-items:center;gap:8px}
.toggle{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-mid);padding:0 14px;min-height:44px;cursor:pointer}
.toggle input{width:18px;height:18px;accent-color:var(--sleep-ink);margin:0}
.btn{min-height:44px;padding:0 18px;border:0;border-radius:var(--r-mid);background:var(--sleep);color:#FFFFFF;font:800 14px var(--sans);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.btn:hover{color:#FFFFFF;background:var(--sleep-ink)}
.btn-quiet{background:var(--surface);color:var(--ink);border:1px solid var(--line)}
.btn-quiet:hover{background:var(--surface-2);color:var(--ink)}
.band{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-mid);padding:12px 16px;font-size:14px;font-weight:700}
.band-warn{background:var(--feed-soft);border-color:var(--feed-soft);color:var(--feed-ink)}
.checks{display:flex;flex-wrap:wrap;gap:12px}
.check{display:flex;align-items:center;gap:10px;background:var(--surface);border-radius:var(--r-mid);padding:12px 16px;box-shadow:var(--shadow);flex:1 1 240px;min-width:0}
.check .dot{width:10px;height:10px;border-radius:50%;background:var(--diaper);flex:none}
.check-title{font-weight:800;font-size:14px}
.check-line{color:var(--ink-soft);font-size:13px;font-weight:600}
.check-bad{outline:2px solid var(--danger);outline-offset:-2px}
.check-bad .dot{background:var(--danger)}
.check-bad .check-line{color:var(--danger-ink);font-weight:700}
.check-off .dot{background:var(--line)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:16px}
.tile{min-width:0;background:var(--surface);border-radius:var(--r-card);padding:20px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:6px}
.tile-label{font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-soft)}
.tile-value{font-family:var(--serif);font-weight:600;font-size:40px;line-height:1}
.tile-sub{font-size:13px;font-weight:700;color:var(--ink-soft)}
.tile-waiting .tile-value{color:var(--line)}
.row{display:flex;flex-wrap:wrap;gap:24px}
.row-top{align-items:flex-start}
.grow-1{flex:1 1 380px;min-width:0}.grow-2{flex:2 1 560px;min-width:0}.grow-3{flex:3 1 560px;min-width:0}
.grow-main{flex:999 1 640px;min-width:0;display:flex;flex-direction:column;gap:24px}
.grow-side{flex:1 1 340px;min-width:0;display:flex;flex-direction:column;gap:24px}
.card{background:var(--surface);border-radius:var(--r-card);padding:24px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:14px;min-width:0}
.card-table{padding:8px 20px 20px}
.card-not{background:var(--surface-2);border:2px dashed var(--line);box-shadow:none}
.card-not p{margin:0;font-size:14px;line-height:1.5}
.waiting{margin:0;padding:18px;border-radius:var(--r-mid);background:var(--surface-2);color:var(--ink-soft);font-size:14px;font-weight:700;text-align:center}
.barrow{display:flex;flex-direction:column;gap:6px}
.barrow-top{display:flex;justify-content:space-between;gap:12px;font-size:14px;font-weight:700}
.bar{display:block;height:12px;border-radius:10px;background:var(--surface-2);overflow:hidden}
.bar .fill{display:block;height:100%;border-radius:10px}
.fill-trying{background:var(--pump)}.fill-preg{background:var(--preg)}.fill-baby{background:var(--feed)}.fill-none{background:var(--note)}.fill-sleep{background:var(--sleep)}
.funnel{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr) 64px;align-items:center;gap:12px}
.funnel .bar{height:14px}
.funnel-label{font-size:14px;font-weight:700}
.funnel-n{font-size:14px;font-weight:800;text-align:right}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:var(--surface);border:1px solid var(--line);font-weight:700;font-size:13px;padding:6px 12px;border-radius:var(--r-small);overflow-wrap:anywhere}
.chip-stage{background:var(--feed-soft);border-color:var(--feed-soft);color:var(--feed-ink);font-weight:800}
.chip-warn{border-color:var(--danger);color:var(--danger-ink)}
.banner{display:flex;align-items:center;gap:10px;background:var(--sleep-soft);color:var(--sleep-ink);border-radius:var(--r-mid);padding:12px 16px;font-size:14px;font-weight:700}
.banner span{color:var(--ink)}
.banner svg{flex:none}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:760px}
th{text-align:left;color:var(--ink-soft);font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;padding:12px 8px;border-bottom:1px solid var(--line)}
td{padding:12px 8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:break-word}
td:first-child{overflow-wrap:anywhere}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:14px;font-weight:700;padding:8px 0;border-top:1px solid var(--line)}
.kv>span:first-child{min-width:0;overflow-wrap:anywhere}.kv span:last-child{text-align:right}
.tabs{display:flex;flex-wrap:wrap;gap:8px}
.tabs a{min-height:44px;padding:0 16px;border-radius:var(--r-mid);display:inline-flex;align-items:center;gap:6px;background:var(--surface);color:var(--ink);border:1px solid var(--line);text-decoration:none;font-size:14px}
.tabs a[aria-current]{background:var(--ink);color:#FFFFFF;border-color:var(--ink)}
.count{opacity:0.8}
.filters{flex-direction:row;flex-wrap:wrap;align-items:flex-end;gap:12px;padding:16px 20px}
.field{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-soft);min-width:0}
.field input,.field select{min-height:44px;border:1px solid var(--line);border-radius:var(--r-mid);padding:0 14px;font:600 15px var(--sans);color:var(--ink);background:var(--surface);text-transform:none;letter-spacing:0;width:100%}
.filters .grow-2{flex:2 1 220px}.filters .grow-1{flex:1 1 160px}
.saved{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.saved-label{font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-soft)}
.pill{min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:var(--r-small);background:var(--surface);color:var(--ink);font-size:13px;font-weight:700;display:inline-flex;align-items:center;text-decoration:none}
.pill[aria-current]{background:var(--ink);color:#FFFFFF;border-color:var(--ink)}
.pill-clear{color:var(--sleep-ink)}
.pager{display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:flex-end;padding-top:12px;font-size:14px;font-weight:700}
.chain{margin:12px 0 0;font-size:14px;font-weight:800;padding:10px 14px;border-radius:var(--r-mid)}
.chain-ok{background:var(--surface-2);color:var(--diaper-ink)}
.chain-bad{background:var(--feed-soft);color:var(--danger-ink);outline:2px solid var(--danger)}
.manual-start{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--line);margin-top:16px;padding-top:16px;max-width:520px}
.form{max-width:640px}
.empty{padding:48px 8px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center}
.empty-title{font-family:var(--serif);font-weight:600;font-size:22px}
.nav-line{margin:0}
.foot{font-size:13px;font-weight:600;color:var(--ink-soft)}
.message{max-width:640px}
.h3{font-family:var(--sans);font-size:13px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--ink-soft);margin:8px 0 10px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;font-weight:600}
table.table-narrow{min-width:520px}
.grid td,.grid th{text-align:center}.grid td:first-child,.grid th:first-child{text-align:left}
.heat-0{color:var(--ink-soft)}.heat-1{background:#F1F2FA}.heat-2{background:var(--sleep-soft)}.heat-3{background:#C9CCEA}.heat-4{background:#AEB3DF;font-weight:800}
.hours{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:3px;height:96px;align-items:end}
.hour{display:flex;align-items:flex-end;height:100%;min-width:0}
.hb{display:block;width:100%;background:var(--sleep);border-radius:4px 4px 0 0;min-height:2px}
.hours-axis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));font-size:12px;font-weight:700;color:var(--ink-soft);margin-top:6px}
.visits{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.visits li{padding:10px 0;border-top:1px solid var(--line);font-size:14px;font-weight:600;overflow-wrap:anywhere}
@media (max-width:600px){h1{font-size:28px}.wrap{padding:24px 16px 48px;gap:20px}.card{padding:20px}.funnel{grid-template-columns:minmax(0,1fr) 48px}.funnel .bar{grid-column:1 / -1;grid-row:2}.tiles{gap:12px}.tile{padding:16px}.tile-value{font-size:32px}}`,
  W,
  H,
].join('\n');

/* The one script. It only ever writes textContent. */
export const JS = `(function () {
  'use strict';
  var fmt = function (d, mode) {
    var hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return mode === 'dayhm' ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + hm : hm;
  };
  var times = document.querySelectorAll('time[data-local]');
  for (var i = 0; i < times.length; i++) {
    var d = new Date(times[i].getAttribute('datetime'));
    if (!isNaN(d.getTime())) times[i].textContent = fmt(d, times[i].getAttribute('data-local'));
  }
  var own = document.getElementById('own-toggle');
  if (own && own.form) {
    var apply = document.getElementById('own-apply');
    if (apply) apply.hidden = true;
    own.addEventListener('change', function () { own.form.submit(); });
  }
  var f = document.getElementById('manual-form');
  if (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var out = document.getElementById('manual-result');
      var body = { household: Number(f.getAttribute('data-household')), person: f.elements.person.value || '',
        reason: f.elements.reason.value, request: f.elements.request.value.trim() };
      out.textContent = 'Recording...';
      fetch('/api/manual-access', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }, function () { return { ok: false, j: {} }; }); })
        .then(function (x) { out.textContent = x.ok ? 'Recorded as entry ' + x.j.seq + ' in the access log.' : 'Not recorded. ' + ((x.j && x.j.message) || 'Something went wrong.'); })
        .catch(function () { out.textContent = 'Not recorded. The dashboard could not be reached.'; });
    });
  }
})();
`;

let decoded = null;
function fontBytes(name) {
  if (!decoded) decoded = new Map();
  if (!decoded.has(name)) {
    const b64 = FONTS[name];
    if (!b64) return null;
    const raw = atob(b64);
    const u = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    decoded.set(name, u);
  }
  return decoded.get(name);
}

/* /static/<file>, after the check. null when there is no such file. */
export function asset(pathname) {
  if (pathname === '/static/admin.css') return secure(new Response(CSS, { headers: { 'content-type': 'text/css; charset=utf-8' } }));
  if (pathname === '/static/admin.js') return secure(new Response(JS, { headers: { 'content-type': 'text/javascript; charset=utf-8' } }));
  const m = /^\/static\/fonts\/([a-z-]+\.woff2)$/.exec(pathname);
  if (m && Object.prototype.hasOwnProperty.call(FONTS, m[1])) {
    return secure(new Response(fontBytes(m[1]), { headers: { 'content-type': 'font/woff2' } }));
  }
  return null;
}
