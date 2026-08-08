#!/usr/bin/env node
/* Cubby Ops — internal admin console (visibility, v1).
   Runs ON YOUR MACHINE, binds to 127.0.0.1 ONLY, reads Firestore with the admin service-account
   key, and renders a live dashboard. Sends nothing anywhere. Full PII visibility (you are the data
   controller); role-gating + DSAR/erasure + audit log come in v2 (see the design doc).

   Setup:  npm i firebase-admin   +   put the key at tools/serviceAccountKey.json
   Run:    node tools/ops.js            (real data)
           node tools/ops.js --demo     (synthetic data, no key — to preview the dashboard)
*/
const http = require('http');
const path = require('path');

const DEMO = process.argv.includes('--demo');
const PORT = 8787;
const DAY = 86400000;
const ms = (t) => (t && t.toMillis) ? t.toMillis() : (typeof t === 'number' ? t : 0);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const ageMonths = (birth) => birth ? Math.floor((Date.now() - birth) / (30.44 * DAY)) : null;

let db = null;
function initDb() {
  if (db || DEMO) return;
  const admin = require('firebase-admin');
  let sa;
  try { sa = require(path.join(__dirname, 'serviceAccountKey.json')); }
  catch (e) {
    console.error('\n  Missing tools/serviceAccountKey.json.');
    console.error('  Firebase console -> Project settings -> Service accounts -> Generate new private key,');
    console.error('  save it as tools/serviceAccountKey.json, then re-run. (Or: node tools/ops.js --demo)\n');
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  db = admin.firestore();
}

/* ---- read + compute the full ops dataset (real Firestore) ---- */
async function collect() {
  const { leakyBucket } = require('./funnel');
  const [usersSnap, hhSnap, fbSnap, wlSnap, evSnap, invSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('households').get(),
    db.collection('feedback').get().catch(() => ({ docs: [], size: 0 })),
    db.collection('waitlist').get().catch(() => ({ docs: [], size: 0 })),
    db.collectionGroup('events').get(),
    db.collection('invites').get().catch(() => ({ docs: [], size: 0 })),
  ]);
  const now = Date.now();
  const evByHh = {}; const typeTotals = {}; const authorSet = new Set();
  evSnap.docs.forEach(d => {
    const hh = d.ref.parent.parent ? d.ref.parent.parent.id : '?';
    const e = d.data();
    (evByHh[hh] = evByHh[hh] || []).push(e);
    const t = e.type || 'other'; typeTotals[t] = (typeTotals[t] || 0) + 1;
    if (e.authorId) authorSet.add(e.authorId);
  });
  const acqByUid = {}; usersSnap.docs.forEach(d => { const u = d.data() || {}; if (u.acq) acqByUid[d.id] = u.acq; });

  const households = hhSnap.docs.map(doc => {
    const h = doc.data(); const evs = evByHh[doc.id] || [];
    const times = evs.map(e => ms(e.time)).filter(Boolean);
    const last = times.length ? Math.max(...times) : (ms(h.updatedAt) || ms(h.createdAt));
    const days = new Set(times.map(dayKey));
    const babies = (h.app && h.app.babies) || [];
    const info = h.memberInfo || {};
    const members = Object.keys(h.members || {}).map(uid => ({
      uid, name: (info[uid] || {}).name || '', email: (info[uid] || {}).email || '',
      role: (h.members || {})[uid] || (info[uid] || {}).role || 'caregiver',
      relationship: (info[uid] || {}).relationship || ''
    }));
    const photos = evs.filter(e => e.photoId).length + (((h.app && h.app.photos) || []).length);
    return {
      id: doc.id, ownerId: h.ownerId || '', created: ms(h.createdAt), last,
      firstLog: times.length ? Math.min(...times) : 0, activeDays: days.size,
      members, memberCount: members.length,
      babies: babies.map(b => ({ name: b.name || '', ageMo: ageMonths(b.birth), country: b.country || '' })),
      events: evs.length, photos, pro: !!(h.pro && h.pro.active),
      acq: acqByUid[h.ownerId] || null,
    };
  });

  const active1 = households.filter(h => h.last > now - DAY).length;
  const active7 = households.filter(h => h.last > now - 7 * DAY).length;
  const proOwnerUids = new Set(wlSnap.docs.map(d => d.id));
  const invitedHhIds = new Set(invSnap.docs.map(d => (d.data() || {}).householdId).filter(Boolean));
  const lb = leakyBucket(households.map(h => ({ id: h.id, ownerId: h.ownerId, babies: h.babies, events: h.events, activeDays: h.activeDays, members: h.memberCount, created: h.created, firstLog: h.firstLog })), proOwnerUids, invitedHhIds);

  return {
    generatedAt: now, mode: 'live',
    headline: { users: usersSnap.size, households: hhSnap.size, active24h: active1, active7d: active7, totalEvents: evSnap.size, proWaitlist: wlSnap.size, multiCaregiver: households.filter(h => h.memberCount > 1).length, feedback: fbSnap.size },
    funnel: lb.funnel, activation: lb.activation, conversions: lb.conversions,
    eventTypes: Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ type, n })),
    households: households.sort((a, b) => b.last - a.last),
    feedback: fbSnap.docs.map(d => d.data()).sort((a, b) => ms(b.createdAt || b.at) - ms(a.createdAt || a.at)).slice(0, 50).map(f => ({ when: (f.createdAt || f.at) ? new Date(ms(f.createdAt || f.at)).toISOString().slice(0, 10) : '', text: String(f.text || '').replace(/\s+/g, ' ').slice(0, 300) })),
  };
}

/* ---- synthetic data so the dashboard can be previewed without the key ---- */
function demoData() {
  const now = Date.now();
  const names = [['Aanya', 'Priya Sharma', 'priya@example.com', 'Mama Bear'], ['Rohan', 'Imran Q.', 'imran@example.com', 'Papa Bear'], ['Zoya', 'Sara K.', 'sara@example.com', 'Mama Bear'], ['Vivaan', 'Deepa R.', 'deepa@example.com', 'Mama Bear'], ['Mira', 'Tom W.', 'tom@example.com', 'Papa Bear']];
  const hh = names.map((n, i) => ({
    id: 'demo' + i, ownerId: 'u' + i, created: now - (40 - i * 6) * DAY, last: now - (i * 9) * 3600000,
    firstLog: now - (38 - i * 6) * DAY, activeDays: [22, 14, 9, 3, 1][i],
    members: i < 2 ? [{ uid: 'u' + i, name: n[1], email: n[2], role: 'owner', relationship: n[3] }, { uid: 'c' + i, name: 'Nanny', email: 'nanny' + i + '@example.com', role: 'caregiver', relationship: 'Nanny' }] : [{ uid: 'u' + i, name: n[1], email: n[2], role: 'owner', relationship: n[3] }],
    memberCount: i < 2 ? 2 : 1, babies: [{ name: n[0], ageMo: [6, 3, 11, 1, 0][i], country: ['AE', 'IN', 'AE', 'GB', 'AE'][i] }],
    events: [410, 230, 120, 18, 4][i], photos: [22, 9, 14, 2, 0][i], pro: i === 0, acq: i < 3 ? { content: ['anxiety', 'multi-carer', 'privacy'][i], campaign: 'beta', source: 'meta' } : null,
  }));
  return {
    generatedAt: now, mode: 'demo',
    headline: { users: 7, households: 5, active24h: 3, active7d: 4, totalEvents: 782, proWaitlist: 2, multiCaregiver: 2, feedback: 3 },
    funnel: [{ label: 'Signed in (household created)', count: 5, pctTop: 100, drop: 0 }, { label: 'Added a baby', count: 5, pctTop: 100, drop: 0 }, { label: 'Logged something (activated)', count: 5, pctTop: 100, drop: 0 }, { label: 'Came back (day 2+)', count: 4, pctTop: 80, drop: 20 }, { label: 'Sticky (7+ active days)', count: 3, pctTop: 60, drop: 25 }],
    activation: { medianMins: 12, within1h: 4, within24h: 5, n: 5 },
    conversions: { invited: 2, joined: 2, inviteToJoin: 100, pro: 2 },
    eventTypes: [{ type: 'feed', n: 312 }, { type: 'sleep', n: 188 }, { type: 'diaper', n: 201 }, { type: 'pump', n: 41 }, { type: 'meds', n: 39 }],
    households: hh,
    feedback: [{ when: new Date(now - 2 * DAY).toISOString().slice(0, 10), text: 'Love the shared timeline with the nanny. Boot felt slow before, fast now.' }, { when: new Date(now - 5 * DAY).toISOString().slice(0, 10), text: 'Wish I could export a monthly summary for the doctor.' }, { when: new Date(now - 9 * DAY).toISOString().slice(0, 10), text: 'The bear art is adorable.' }],
  };
}

/* ---- tiny cache so auto-refresh doesn't re-read all of Firestore every tick ---- */
let cache = { at: 0, data: null };
async function getData() {
  if (DEMO) return demoData();
  if (cache.data && Date.now() - cache.at < 20000) return cache.data;
  initDb();
  cache = { at: Date.now(), data: await collect() };
  return cache.data;
}

function htmlPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cubby Ops</title>
<style>
:root{--ink:#2c2620;--soft:#7c7266;--line:#e7ddcf;--card:#fff;--bg:#faf6ef;--accent:#8a7659;--green:#6f8f5a;--pink:#c97f8c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,system-ui,sans-serif}
header{padding:16px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;background:var(--card);position:sticky;top:0;z-index:5}
header h1{font-size:17px;margin:0;font-weight:700}.badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:#eee3d2;color:#8a7659}
.badge.demo{background:#fde8c8;color:#9a6a13}.muted{color:var(--soft);font-size:12px}main{padding:18px 22px;max-width:1200px;margin:0 auto}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.kc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}.kc .n{font-size:26px;font-weight:800}.kc .l{font-size:12px;color:var(--soft);margin-top:2px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}@media(max-width:780px){.row{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}.panel h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--soft);margin:0 0 12px}
.fbar{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:13px}.fbar .lab{width:200px;flex:0 0 200px}.fbar .track{flex:1;height:16px;background:#f0e9dd;border-radius:8px;overflow:hidden}.fbar .fill{height:100%;background:var(--green)}.fbar .v{width:64px;text-align:right;color:var(--soft);font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;color:var(--soft);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:6px 8px;border-bottom:1px solid var(--line)}
td{padding:8px;border-bottom:1px solid #f1ebe0;vertical-align:top}tr.hh{cursor:pointer}tr.hh:hover{background:#fbf7ef}.pill{font-size:11px;padding:1px 7px;border-radius:10px;background:#eee3d2;color:#7c6b4f}.pill.pro{background:#dceccb;color:#4f6d2f}
.det{background:#fbf7ef}.det td{padding:10px 14px}.mem{display:inline-block;margin:0 14px 6px 0}.mem b{font-weight:700}.search{padding:8px 12px;border:1px solid var(--line);border-radius:10px;width:240px;font:13px system-ui}
.fb{border-left:3px solid var(--line);padding:4px 0 4px 12px;margin:0 0 10px;color:#5a5147}.fb .w{color:var(--soft);font-size:11px}.warn{font-size:12px;color:#9a6a13;margin-top:6px}
</style></head><body>
<header><h1>Cubby Ops</h1><span id="mode" class="badge">live</span><span id="gen" class="muted"></span><span style="flex:1"></span><input id="q" class="search" placeholder="Search name, email, baby…" oninput="render()"><span class="muted">auto-refresh 30s · localhost only</span></header>
<main>
<div class="cards" id="cards"></div>
<div class="row"><div class="panel"><h2>Activation funnel</h2><div id="funnel"></div><div id="act" class="muted" style="margin-top:8px"></div></div>
<div class="panel"><h2>What's being logged</h2><div id="types"></div><div id="conv" class="muted" style="margin-top:10px"></div></div></div>
<div class="panel" style="margin-bottom:20px"><h2>Households &amp; people <span class="muted" id="hhn"></span></h2>
<table><thead><tr><th>Owner</th><th>People</th><th>Babies</th><th>Created</th><th>Last active</th><th>Days</th><th>Events</th><th>Pro</th></tr></thead><tbody id="hh"></tbody></table>
<div class="warn" id="piiwarn">Full PII — internal, you are the data controller. v2 adds role-gating, audit log and DSAR export/erasure.</div></div>
<div class="panel"><h2>Recent feedback</h2><div id="fb"></div></div>
</main>
<script>
let DATA=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function load(){try{const r=await fetch('/api/data');DATA=await r.json();render();}catch(e){}}
function render(){
  if(!DATA)return;const d=DATA,q=(document.getElementById('q').value||'').toLowerCase();
  document.getElementById('mode').textContent=d.mode;document.getElementById('mode').className='badge'+(d.mode==='demo'?' demo':'');
  document.getElementById('gen').textContent='updated '+new Date(d.generatedAt).toLocaleTimeString();
  const h=d.headline;const cards=[['Users',h.users],['Households',h.households],['Active 24h',h.active24h],['Active 7d',h.active7d],['Total events',h.totalEvents],['Multi-carer',h.multiCaregiver],['Pro waitlist',h.proWaitlist],['Feedback',h.feedback]];
  document.getElementById('cards').innerHTML=cards.map(c=>'<div class="kc"><div class="n">'+c[1]+'</div><div class="l">'+c[0]+'</div></div>').join('');
  const top=d.funnel[0]?d.funnel[0].count:1;
  document.getElementById('funnel').innerHTML=d.funnel.map(f=>'<div class="fbar"><div class="lab">'+esc(f.label)+'</div><div class="track"><div class="fill" style="width:'+Math.round(f.count/(top||1)*100)+'%"></div></div><div class="v">'+f.count+' · '+f.pctTop+'%</div></div>').join('');
  if(d.activation&&d.activation.n){const m=d.activation;document.getElementById('act').textContent='Time to first log: median '+(m.medianMins>=60?(Math.round(m.medianMins/6)/10)+'h':m.medianMins+'m')+' · within 1h '+m.within1h+'/'+m.n+' · within 24h '+m.within24h+'/'+m.n;}
  const mt=Math.max(1,...d.eventTypes.map(t=>t.n));
  document.getElementById('types').innerHTML=d.eventTypes.map(t=>'<div class="fbar"><div class="lab" style="width:90px;flex:0 0 90px">'+esc(t.type)+'</div><div class="track"><div class="fill" style="background:#c9a36a;width:'+Math.round(t.n/mt*100)+'%"></div></div><div class="v">'+t.n+'</div></div>').join('');
  const cv=d.conversions;document.getElementById('conv').innerHTML='Invited a caregiver: <b>'+cv.invited+'</b> · joined (the wedge): <b>'+cv.joined+'</b> (invite→join '+cv.inviteToJoin+'%) · registered for Pro: <b>'+cv.pro+'</b>';
  const rows=d.households.filter(hh=>{if(!q)return true;const hay=(hh.members.map(m=>m.name+' '+m.email).join(' ')+' '+hh.babies.map(b=>b.name).join(' ')).toLowerCase();return hay.indexOf(q)>=0;});
  document.getElementById('hhn').textContent='('+rows.length+')';
  const dt=t=>t?new Date(t).toISOString().slice(5,10):'—';
  document.getElementById('hh').innerHTML=rows.map((hh,i)=>{
    const owner=hh.members.find(m=>m.role==='owner')||hh.members[0]||{};
    const babies=hh.babies.map(b=>esc(b.name)+(b.ageMo!=null?' ('+b.ageMo+'mo, '+esc(b.country)+')':'')).join(', ');
    const main='<tr class="hh" onclick="document.getElementById(\\'det'+i+'\\').style.display=document.getElementById(\\'det'+i+'\\').style.display===\\'table-row\\'?\\'none\\':\\'table-row\\'">'
      +'<td><b>'+esc(owner.name||'—')+'</b><div class="muted">'+esc(owner.email)+'</div></td>'
      +'<td>'+hh.memberCount+(hh.memberCount>1?' <span class="pill">multi</span>':'')+'</td><td>'+babies+'</td>'
      +'<td>'+dt(hh.created)+'</td><td>'+dt(hh.last)+'</td><td>'+hh.activeDays+'</td><td>'+hh.events+'</td><td>'+(hh.pro?'<span class="pill pro">Pro</span>':'')+'</td></tr>';
    const mem=hh.members.map(m=>'<span class="mem"><b>'+esc(m.name||'—')+'</b> · '+esc(m.email||'no email')+' · '+esc(m.role)+(m.relationship?' · '+esc(m.relationship):'')+'</span>').join('');
    const acq=hh.acq?(' · acquired via '+esc(hh.acq.content||hh.acq.campaign||hh.acq.source||'')):'';
    const det='<tr class="det" id="det'+i+'" style="display:none"><td colspan="8"><div><b>People</b><br>'+mem+'</div><div class="muted" style="margin-top:8px">household '+esc(hh.id)+' · '+hh.photos+' photos'+acq+'</div></td></tr>';
    return main+det;
  }).join('');
  document.getElementById('fb').innerHTML=d.feedback.length?d.feedback.map(f=>'<div class="fb"><div class="w">'+esc(f.when)+'</div>'+esc(f.text)+'</div>').join(''):'<div class="muted">No feedback yet.</div>';
}
load();setInterval(load,30000);
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/data')) {
      const data = await getData();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(htmlPage());
    }
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('\n  Cubby Ops ' + (DEMO ? '(DEMO data) ' : '') + 'running at  http://localhost:' + PORT + '\n  Localhost only. Ctrl-C to stop.\n');
});
