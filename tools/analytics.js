#!/usr/bin/env node
/* Cubby beta analytics: read-only usage report from Firestore.
   Runs on YOUR machine with a service account key. Sends nothing anywhere.
   Setup + usage: see ANALYTICS.md.  Run:  node tools/analytics.js  */

// firebase-admin 14 dropped the old admin.initializeApp()/admin.firestore() namespace API for
// these modular subpath imports - a fresh `npm install firebase-admin` pulls 14.x and breaks the
// namespace calls this file used to have (fixed 2026-08-05, same bug hit tools/rag/question_gaps.js).
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const { leakyBucket } = require('./funnel');
let sa;
try { sa = require(path.join(__dirname, 'serviceAccountKey.json')); }
catch (e) { console.error('\nMissing tools/serviceAccountKey.json. See ANALYTICS.md (Firebase console > Project settings > Service accounts > Generate new private key).\n'); process.exit(1); }

const app = initializeApp({ credential: cert(sa) });
const db = getFirestore(app);

const DAY = 86400000, now = Date.now();
const ms = (t) => (t && t.toMillis) ? t.toMillis() : (typeof t === 'number' ? t : 0);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const ageMonths = (birth) => birth ? Math.floor((now - birth) / (30.44 * DAY)) : null;
const pct = (n, d) => d ? Math.round((n / d) * 100) + '%' : '0%';
const bar = (n, max, w = 24) => '█'.repeat(Math.round((n / (max || 1)) * w)).padEnd(w, ' ');

(async () => {
  const [usersSnap, hhSnap, fbSnap, wlSnap, evSnap, invSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('households').get(),
    db.collection('feedback').get().catch(() => ({ docs: [] })),
    db.collection('waitlist').get().catch(() => ({ docs: [] })),
    db.collectionGroup('events').get(),
    db.collection('invites').get().catch(() => ({ docs: [] })),
  ]);

  // group events by household
  const evByHh = {}; const typeTotals = {}; const authorSet = new Set();
  evSnap.docs.forEach(d => {
    const hh = d.ref.parent.parent ? d.ref.parent.parent.id : '?';
    const e = d.data();
    (evByHh[hh] = evByHh[hh] || []).push(e);
    const t = e.type || 'other'; typeTotals[t] = (typeTotals[t] || 0) + 1;
    if (e.authorId) authorSet.add(e.authorId);
  });

  const households = hhSnap.docs.map(doc => {
    const h = doc.data(); const evs = evByHh[doc.id] || [];
    const times = evs.map(e => ms(e.time)).filter(Boolean);
    const last = times.length ? Math.max(...times) : ms(h.updatedAt) || ms(h.createdAt);
    const days = new Set(times.map(dayKey));
    const babies = (h.app && h.app.babies) || [];
    const members = Object.keys(h.members || {});
    const byType = {}; evs.forEach(e => { const t = e.type || 'other'; byType[t] = (byType[t] || 0) + 1; });
    const photos = evs.filter(e => e.photoId).length + (((h.app && h.app.photos) || []).length);
    let vxGiven = 0; const vx = (h.app && h.app.vaccines) || {};
    Object.values(vx).forEach(list => (list || []).forEach(v => { if (v.given) vxGiven++; }));
    return {
      id: doc.id, ownerId: h.ownerId || '', created: ms(h.createdAt), last,
      firstLog: times.length ? Math.min(...times) : 0, activeDays: days.size,
      members: members.length, babies, events: evs.length, byType, photos, vxGiven,
      milestones: ((h.app && h.app.milestones) || []).length,
      countries: babies.map(b => b.country || '?'),
    };
  });

  const active7 = households.filter(h => h.last > now - 7 * DAY);
  const active1 = households.filter(h => h.last > now - DAY);
  const multi = households.filter(h => h.members > 1);
  const returned = households.filter(h => h.activeDays >= 2);
  const sticky = households.filter(h => h.activeDays >= 7);
  const totalEvents = evSnap.size;

  const line = (s = '') => console.log(s);
  line('\n══════════════════════  CUBBY BETA USAGE  ══════════════════════');
  line(`Generated ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}  (read-only, private)`);
  line('\n── Reach ──');
  line(`Signed-in users:        ${usersSnap.size}`);
  line(`Households:             ${hhSnap.size}`);
  line(`Active last 24h:        ${active1.length}  (${pct(active1.length, hhSnap.size)})`);
  line(`Active last 7 days:     ${active7.length}  (${pct(active7.length, hhSnap.size)})`);
  line(`Multi-caregiver:        ${multi.length}  (${pct(multi.length, hhSnap.size)})  <- key value prop`);
  line(`Returned (2+ days):     ${returned.length}  (${pct(returned.length, hhSnap.size)})`);
  line(`Sticky (7+ days):       ${sticky.length}`);
  line(`Pro waitlist:           ${wlSnap.size}`);

  // ── Activation funnel (the leaky bucket) — from data we already collect, no new tracking ──
  const proOwnerUids = new Set(wlSnap.docs.map(d => d.id));
  const invitedHhIds = new Set(invSnap.docs.map(d => (d.data() || {}).householdId).filter(Boolean));
  const lb = leakyBucket(households, proOwnerUids, invitedHhIds);
  const maxDrop = Math.max(0, ...lb.funnel.slice(1).map(r => r.drop));
  line('\n── Activation funnel (the leaky bucket) ──');
  lb.funnel.forEach((r, i) => {
    const leak = (i > 0 && r.drop === maxDrop && maxDrop > 0) ? '  <- biggest leak' : '';
    const drop = i === 0 ? '     ' : ('-' + r.drop + '%').padStart(5);
    line(`  ${r.label.padEnd(30)} ${String(r.count).padStart(4)}  ${bar(r.count, lb.n, 18)} ${String(r.pctTop + '%').padStart(4)}  ${drop}${leak}`);
  });
  if (lb.activation.n) {
    const med = lb.activation.medianMins, medStr = med >= 60 ? (Math.round(med / 6) / 10) + 'h' : med + 'm';
    line(`  Time to first log:      median ${medStr}  ·  within 1h: ${lb.activation.within1h}/${lb.activation.n}  ·  within 24h: ${lb.activation.within24h}/${lb.activation.n}`);
  }
  line('\n── Key conversions (share of signed-in) ──');
  line(`  Invited a caregiver:    ${lb.conversions.invited}  (${pct(lb.conversions.invited, lb.n)})`);
  line(`  Caregiver joined:       ${lb.conversions.joined}  (${pct(lb.conversions.joined, lb.n)})  <- the wedge  ·  invite->join: ${lb.conversions.inviteToJoin}%`);
  line(`  Registered for Pro:     ${lb.conversions.pro}  (${pct(lb.conversions.pro, lb.n)})`);

  // ── Acquisition (first-party UTM attribution; the paid-test scorecard) ──
  const acqOf = (snap) => snap.docs.map(d => d.data().acq).filter(a => a && (a.content || a.campaign || a.source));
  const acqUsers = acqOf(usersSnap);     // signups that arrived with a utm_* tag
  const acqWl = acqOf(wlSnap);           // Pro registrations that arrived with a utm_* tag
  const tally = (arr, key) => arr.reduce((m, a) => { const v = a[key] || '(none)'; m[v] = (m[v] || 0) + 1; return m; }, {});
  if (acqUsers.length || acqWl.length) {
    const signByAngle = tally(acqUsers, 'content');
    const proByAngle = tally(acqWl, 'content');
    line('\n── Acquisition (UTM, first-party) ──');
    line(`Signups w/ campaign:    ${acqUsers.length}   ·   Pro-registered w/ campaign: ${acqWl.length}`);
    line('  angle (utm_content)         signups   pro-reg');
    Array.from(new Set([...Object.keys(signByAngle), ...Object.keys(proByAngle)]))
      .sort((a, b) => (signByAngle[b] || 0) - (signByAngle[a] || 0))
      .forEach(a => line(`  ${String(a).padEnd(27)} ${String(signByAngle[a] || 0).padStart(5)}   ${String(proByAngle[a] || 0).padStart(5)}`));
    const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ');
    line('  by campaign:  ' + fmt(tally(acqUsers, 'campaign')));
    line('  by source:    ' + fmt(tally(acqUsers, 'source')));
    line('  (cost/signup per angle = Meta spend on that ad ÷ its signups — pull spend from Ads Manager)');
  }

  line('\n── Logging volume ──');
  line(`Total events logged:    ${totalEvents}`);
  line(`Avg / active(7d) hh:    ${active7.length ? Math.round(totalEvents / active7.length) : 0}`);
  line(`Distinct loggers:       ${authorSet.size}`);
  const maxT = Math.max(1, ...Object.values(typeTotals));
  Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).forEach(([t, n]) =>
    line(`  ${t.padEnd(10)} ${String(n).padStart(5)}  ${bar(n, maxT)}`));

  line('\n── Moments / keepsakes ──');
  line(`Photos saved/tagged:    ${households.reduce((a, h) => a + h.photos, 0)}`);
  line(`Vaccines marked given:  ${households.reduce((a, h) => a + h.vxGiven, 0)}`);
  line(`Milestones logged:      ${households.reduce((a, h) => a + h.milestones, 0)}`);

  line('\n── Countries (vaccine schedule) ──');
  const cc = {}; households.forEach(h => h.countries.forEach(c => cc[c] = (cc[c] || 0) + 1));
  Object.entries(cc).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => line(`  ${String(c).padEnd(6)} ${n}`));

  line('\n── Per household ──');
  line('  created   lastActive  days  ppl  events  photos  babies');
  households.sort((a, b) => b.last - a.last).forEach(h => {
    const created = h.created ? new Date(h.created).toISOString().slice(5, 10) : '  ?  ';
    const la = h.last ? new Date(h.last).toISOString().slice(5, 10) : '  ?  ';
    const babies = h.babies.map(b => `${b.name || '?'}${ageMonths(b.birth) != null ? '(' + ageMonths(b.birth) + 'mo,' + (b.country || '?') + ')' : ''}`).join(' ');
    line(`  ${created}     ${la}      ${String(h.activeDays).padStart(3)}  ${String(h.members).padStart(3)}  ${String(h.events).padStart(6)}  ${String(h.photos).padStart(6)}  ${babies}`);
  });

  line('\n── Feedback ──  (' + fbSnap.size + ')');
  fbSnap.docs.map(d => d.data()).sort((a, b) => ms(b.createdAt || b.at) - ms(a.createdAt || a.at)).forEach(f => {
    const when = f.createdAt ? new Date(ms(f.createdAt)).toISOString().slice(0, 10) : '';
    line(`  • [${when}] ${String(f.text || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  });

  line('\n════════════════════════════════════════════════════════════════\n');
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
