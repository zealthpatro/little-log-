/* The phase-1 screens, server-rendered from the approved canvas (Main, Household and Explorer boards),
 * in Cubby's own tokens and fonts. Every value goes through html`` and is escaped. No inline style and
 * no inline script anywhere: the CSP forbids both, and the page needs neither.
 *
 * Phase 1 shows who is in each family and the record-based numbers. Every usage panel says "Waiting for
 * usage events" rather than a zero, and nothing per-person about activity is shown before families have
 * been told (spec §17). Buttons for later phases (Draft a nudge, Export, Delete) are not rendered at all.
 */
import { html, trusted, href, dayLabel, dayFromKey, daysAgo, num, hour12 } from './html.mjs';
import { MANUAL_REASONS } from './log.mjs';
import { place, cameFrom, signsInWith } from './data.mjs';

const ACTION_LABEL = {
  view_overview: 'Opened the overview', view_household: 'Opened a household', view_records: 'Looked at a list',
  export_csv: 'Exported a list (CSV)', manual_access: 'Recorded a manual access', denied: 'Refused a request',
  view_shared_entry: 'Opened a shared entry', export_request: 'Exported a data request', nudge_intent: 'Started a note',
  nudge_outcome: 'Sent a note', erase_dry_run: 'Checked an erasure', erase_intent: 'Started an erasure', erase_outcome: 'Erased an account',
};
const TAB_LABEL = { people: 'People', households: 'Households', visits: 'Visits', events: 'Usage events', signins: 'Sign-ins', devices: 'Devices', access: 'Access log' };
const STAGE_LABEL = { any: 'Any', pregnant: 'Pregnant', baby: 'Baby', none: 'No stage shared' };
const VIEW_LABEL = { no_first_entry: 'No first entry after 2 days', one_logging: 'Only one person logging', invite_waiting: 'Invite sent, never joined' };
const DENY_LABEL = { not_listed: 'an address that is not on the list', no_jwt: 'no Access sign-in', expired: 'an expired sign-in',
  bad_signature: 'a forged sign-in', bad_aud: 'a sign-in for another application', bad_iss: 'a sign-in from another team',
  host: 'the wrong hostname', origin: 'a change from another page', method: 'a method the dashboard does not take',
  not_configured: 'the dashboard not being configured', service_token: 'a service token' };
export const WAITING = 'Waiting for usage events';

export function page(title, body, opts) {
  opts = opts || {};
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="stylesheet" href="/static/admin.css">
<script src="/static/admin.js" defer></script>
</head>
<body>
<main class="wrap">
${opts.bands || ''}
${body}
</main>
</body>
</html>`;
}

const isoOf = (ms) => new Date(ms).toISOString();
const utcHm = (ms) => isoOf(ms).slice(11, 16) + ' UTC';
/* A time, shown in the reader's own time zone by admin.js; UTC without it. */
export const timeTag = (ms, mode) => html`<time datetime="${isoOf(ms)}" data-local="${mode || 'hm'}">${mode === 'dayhm' ? dayLabel(ms) + ', ' + utcHm(ms) : utcHm(ms)}</time>`;

export function bands(state, cfg, now) {
  const out = [];
  if (!cfg.internal.size) out.push(html`<div class="band band-warn" role="status">Your own accounts are not tagged, so every number here includes you.</div>`);
  if (state.paused) {
    out.push(html`<div class="band band-warn" role="status">Numbers from ${state.lastRefreshAt ? timeTag(state.lastRefreshAt) : 'earlier today'}. Paused to protect families' quota.</div>`);
  }
  if (!state.lastFullPassAt) out.push(html`<div class="band" role="status">The first full refresh has not finished yet, so some numbers are still filling in.</div>`);
  if (state.unrefreshed > 0) out.push(html`<div class="band band-warn" role="status">${num(state.unrefreshed)} ${state.unrefreshed === 1 ? 'household' : 'households'} could not be refreshed.</div>`);
  return out;
}

const pct = (n, of) => (of > 0 ? Math.max(0, Math.min(100, Math.round((n / of) * 100))) : 0);
const bar = (n, of, cls) => html`<span class="bar" aria-hidden="true"><span class="fill ${cls} w-${pct(n, of)}"></span></span>`;
const waitingCard = (title, lead, id) => html`<section class="card" aria-labelledby="${id}">
<div><h2 id="${id}">${title}</h2>${lead ? html`<p class="lead">${lead}</p>` : ''}</div>
<p class="waiting">${WAITING}</p>
</section>`;
const check = (title, c) => html`<div class="check check-${c.state}">
<span class="dot" aria-hidden="true"></span>
<div><div class="check-title">${title}</div><div class="check-line">${c.line}</div></div>
</div>`;

/* ---------------- Overview, / ---------------- */
export function overviewPage(m) {
  const n = m.numbers;
  const ranges = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']];
  const since = n.coveredFrom ? ' (since ' + dayFromKey(n.coveredFrom) + ')' : '';
  const stageRows = [['trying', 'Trying', 'fill-trying'], ['pregnant', 'Pregnant', 'fill-preg'], ['baby', 'Baby', 'fill-baby'], ['none', 'No stage shared', 'fill-none']];
  const maxStage = Math.max(1, ...stageRows.map(([k]) => n.stages[k] || 0));
  const top = n.funnel[0][1];
  const per = n.households ? (n.people / n.households).toFixed(1) : '0';
  const body = html`
<header class="head">
<div class="head-text">
<h1>Cubby Ops</h1>
<p class="lead">Every family, every person, and how Cubby is really used. Updated every 15 minutes. Only you can open this.</p>
</div>
<div class="controls">
<nav class="seg" aria-label="Time range">
${ranges.map(([k, label]) => html`<a href="${href('/', { range: k, own: m.hideInternal ? null : 'show' })}" ${k === m.range ? trusted('aria-current="page"') : ''}>${label}${k === m.range && (k === '30' || k === '90') ? since : ''}</a>`)}
</nav>
<form class="own" method="get" action="/">
<input type="hidden" name="range" value="${m.range}">
<label class="toggle"><input type="checkbox" id="own-toggle" name="own" value="hide" ${m.hideInternal ? trusted('checked') : ''}> Hide our own accounts</label>
<button type="submit" id="own-apply" class="btn btn-quiet">Apply</button>
</form>
</div>
</header>

<section class="checks" aria-label="System checks">
${check('Saving and sync', { state: 'off', line: WAITING })}
${check('Sign-in codes', m.checks.canary)}
${check('Reminders sending', m.checks.reminders)}
${check('Weekly report email', m.checks.digest)}
</section>

<section class="tiles" aria-label="Headline numbers">
<div class="tile"><div class="tile-label">Households</div><div class="tile-value">${num(n.households)}</div><div class="tile-sub">+${num(n.newHouseholds)} in this range</div></div>
<div class="tile"><div class="tile-label">People</div><div class="tile-value">${num(n.people)}</div><div class="tile-sub">${per} per household</div></div>
<div class="tile tile-waiting"><div class="tile-label">Active today</div><div class="tile-value">–</div><div class="tile-sub">${WAITING}</div></div>
<div class="tile tile-waiting"><div class="tile-label">Active this week</div><div class="tile-value">–</div><div class="tile-sub">${WAITING}</div></div>
<div class="tile"><div class="tile-label">Two people logging</div><div class="tile-value">${num(n.twoLogging)}</div><div class="tile-sub">${pct(n.twoLogging, n.households)}% of households</div></div>
<div class="tile tile-waiting"><div class="tile-label">Went quiet</div><div class="tile-value">–</div><div class="tile-sub">${WAITING}</div></div>
</section>

<div class="row">
<section class="card grow-1" aria-labelledby="h-stage">
<div><h2 id="h-stage">Where families are</h2><p class="lead">Households by stage, right now</p></div>
${stageRows.map(([k, label, cls]) => html`<div class="barrow"><div class="barrow-top"><span>${label}</span><span>${num(n.stages[k] || 0)} ${(n.stages[k] || 0) === 1 ? 'household' : 'households'}</span></div>${bar(n.stages[k] || 0, maxStage, cls)}</div>`)}
</section>
<section class="card grow-2" aria-labelledby="h-funnel">
<div><h2 id="h-funnel">Getting started</h2><p class="lead">Everyone who signed up in this range, and how far they got. The last step is the one that matters most: two people logging on the same day.</p></div>
${n.funnel.map(([label, v]) => html`<div class="funnel"><span class="funnel-label">${label}</span>${bar(v, top, 'fill-sleep')}<span class="funnel-n">${num(v)}</span></div>`)}
<p class="note">First entry and coming back count the shared log only. The Monday digest also counts pregnancy and trying logs, so where the two differ, the digest is right.${n.coveredFrom ? ' Days before ' + dayFromKey(n.coveredFrom) + ' are not in the dashboard yet.' : ''}</p>
</section>
</div>

${waitingCard('What people use', 'Most used first. Counts what was used, never what was written.', 'h-features')}
<div class="row">
<div class="grow-3">${waitingCard('Time in Cubby', 'A visit starts when the app comes to the front and ends when it goes away, on every platform.', 'h-time')}</div>
<div class="grow-2">${waitingCard('Where they use it', 'Active people this range, by how they open Cubby', 'h-platform')}</div>
</div>
<section class="card" aria-labelledby="h-help">
<div><h2 id="h-help">Who to help next</h2><p class="lead">People who look stuck or ready for the next step, with a suggestion. You decide what gets sent; nothing goes out on its own.</p></div>
<p class="waiting">This list names people, so it switches on only after families have been told what our team can see.</p>
</section>
<p class="nav-line"><a class="btn" href="/records">Every record</a></p>
<footer class="foot">Built from Cubby's own records and its own usage events. No third-party trackers. Every time you open a household, it is written to the access log.</footer>`;
  return page('Cubby Ops', body, { bands: m.bands });
}

/* ---------------- One household, /household/<n> ---------------- */
function quietLabel(q) {
  if (!q) return '';
  const [a, b] = q.split('-');
  return 'quiet ' + hour12(a) + ' to ' + hour12(b);
}
export function householdPage(m) {
  const h = m.h;
  const title = 'Household ' + h.display_no + (h.owner_first_name ? ' · ' + h.owner_first_name + "'s family" : '');
  const owner = h.members.find((p) => p.role === 'owner') || h.members[0] || {};
  /* No time zone chip until phase 3 (spec §6.2: "time zone from 3"); families are told first. */
  const plan = (h.plan === 'pro' ? 'Pro' : 'Free') + (h.waitlisted ? ' · on the Pro waitlist' : '');
  const from = owner.uid ? cameFrom(owner, h) : '';
  const notes = h.members.map((p) => ({ name: p.name || 'Someone', v: ((m.fresh.users.get(p.uid) || {}).teamNotes || p.team_notes || 'on') }));
  const allSame = notes.every((x) => x.v === (notes[0] || {}).v);
  const people = html`${h.members.map((p) => {
    const u = m.fresh.users.get(p.uid) || {};
    const pushOn = u.pushOn !== undefined ? u.pushOn : p.push_on;
    const quiet = u.quiet !== undefined ? u.quiet : p.quiet;
    return html`<tr>
<td><div class="strong">${p.name || 'No name yet'}</div><div class="sub">${p.relationship}</div></td>
<td class="strong">${p.role === 'owner' ? 'Owner' : 'Caregiver'}</td>
<td>${p.email || ''}${p.email && !p.email_verified ? html` <span class="sub">(not verified)</span>` : ''}</td>
<td>${p.joined_at ? dayLabel(p.joined_at, true) : 'Not recorded'}</td>
<td>${pushOn ? 'On' + (quiet ? ' · ' + quietLabel(quiet) : '') : 'Off'}</td>
</tr>`;
  })}${h.invited.map((i) => html`<tr>
<td><div class="strong">${i.kind === 'link' ? 'Invite link' : (i.relationship || 'Someone')}</div><div class="sub">${i.kind === 'link' ? 'Not used yet' : 'Invited'}</div></td>
<td class="strong">Invited</td>
<td class="sub">Not shown</td>
<td>${i.sentDay ? 'Invite sent ' + dayFromKey(i.sentDay) + ', not accepted' : 'Invite sent, not accepted'}</td>
<td class="sub">n/a</td>
</tr>`)}`;
  const counts = m.fresh.entries !== null && m.fresh.entries !== undefined
    ? num(m.fresh.entries) + ', plus ' + num(m.fresh.photos || 0) + ((m.fresh.photos || 0) === 1 ? ' photo' : ' photos')
    : (m.fresh.paused ? "Paused to protect families' quota" : (h.entries_total != null ? num(h.entries_total) + ' (from the last full refresh)' : 'Not read yet'));
  const choices = html`
${allSame ? html`<div class="kv"><span>Notes and nudges from the team</span><span class="${notes.length && notes[0].v === 'off' ? '' : 'good'}">${notes.length && notes[0].v === 'off' ? 'Off' : 'Allowed'}</span></div>`
    : notes.map((x) => html`<div class="kv"><span>Notes and nudges from the team (${x.name})</span><span class="${x.v === 'off' ? '' : 'good'}">${x.v === 'off' ? 'Off' : 'Allowed'}</span></div>`)}
${h.members.map((p) => {
    const u = m.fresh.users.get(p.uid) || {};
    const pushOn = u.pushOn !== undefined ? u.pushOn : p.push_on;
    const quiet = u.quiet !== undefined ? u.quiet : p.quiet;
    return html`<div class="kv"><span>Reminders (${p.name || 'Someone'})</span><span>${pushOn ? 'On' + (quiet ? ' · ' + quietLabel(quiet) : '') : 'Off'}</span></div>`;
  })}
${h.members.map((p) => {
    const nl = m.newsletter.get(p.uid);
    const stage = nl && nl.stage === 'expecting' ? 'pregnancy stage' : (nl && nl.stage === 'baby' ? 'baby stage' : '');
    return html`<div class="kv"><span>Newsletter (${p.name || 'Someone'})</span><span>${nl && nl.status === 'subscribed' ? 'Yes' + (stage ? ', ' + stage : '') : 'No'}</span></div>`;
  })}
${h.members.map((p) => {
    const c = m.fresh.caps.get(p.uid);
    return html`<div class="kv"><span>Push this month (${p.name || 'Someone'})</span><span>${c ? 'feature ' + c.feature + ' of 5, marketing ' + c.marketing + ' of 2' : (m.fresh.paused ? 'Paused' : 'Not read')}</span></div>`;
  })}`;
  const body = html`
<a class="back" href="/">Back to all households</a>
<header class="head">
<div class="head-text">
<h1>${title}</h1>
<div class="chips">
<span class="chip chip-stage">${h.stage_detail || 'No stage shared'}</span>
${h.created_at ? html`<span class="chip">Started ${dayLabel(h.created_at, true)}</span>` : ''}
<span class="chip">${plan}</span>
${from && from !== 'Not recorded' ? html`<span class="chip">Came from ${from}${owner.acq_content && owner.acq_content !== 'other' ? html` · “${owner.acq_content}”` : ''}</span>` : ''}
${h.deletion_pending ? html`<span class="chip chip-warn">Deletion pending</span>` : ''}
</div>
</div>
</header>

<div class="banner" role="status">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg>
<span>You opened this household at ${timeTag(m.loggedAt)} today. That is now in the access log, with your name.</span>
</div>
${m.fresh.paused ? html`<div class="band band-warn" role="status">Showing the last refresh: today's read budget is spent. Paused to protect families' quota.</div>` : ''}
${m.fresh.failed ? html`<div class="band band-warn" role="status">Showing the last refresh: the live read did not answer just now.</div>` : ''}

<section class="card" aria-labelledby="h-people">
<h2 id="h-people">People in this household</h2>
<div class="scroll"><table>
<thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Email</th><th scope="col">Joined</th><th scope="col">Reminders</th></tr></thead>
<tbody>${people}</tbody>
</table></div>
<p class="note">Last seen, devices, visits, time and entries per person switch on once families have been told what our team can see.</p>
</section>

<div class="row row-top">
<div class="grow-main">
${waitingCard('Who uses what, last 30 days', 'Number of times each person used each feature', 'h-grid')}
${waitingCard('Visits, last 48 hours', "What each person did, never what they wrote. Times are in the family's own time zone.", 'h-act')}
</div>
<aside class="grow-side">
<section class="card" aria-labelledby="h-consent"><h2 id="h-consent">Choices they made</h2>${choices}</section>
<section class="card" aria-labelledby="h-record"><h2 id="h-record">Health of their record</h2>
<div class="kv"><span>Last entry</span><span>${h.last_entry_day ? daysAgo(h.last_entry_day, m.now) : 'None yet'}</span></div>
<div class="kv"><span>Failed saves, 7 days</span><span class="sub">${WAITING}</span></div>
<div class="kv"><span>Sign-in problems, 7 days</span><span class="sub">${WAITING}</span></div>
<div class="kv"><span>Entries in total</span><span>${counts}</span></div>
</section>
<section class="card card-not" aria-labelledby="h-not"><h2 id="h-not">Not shown here, on purpose</h2>
<p>What anyone actually logged: amounts, times of each feed, doses, temperatures, symptoms, notes, photos, mood, and anything about a pregnancy loss. You can see that someone logs doses, not what the doses were.</p>
<p class="sub">If a family needs help with an entry, they can share it with you from the app. Then it shows here for 7 days.</p>
</section>
<p><a href="${href('/manual-access', { household: h.display_no })}">Record a manual access for this household</a></p>
</aside>
</div>`;
  return page(title, body, { bands: m.bands });
}

/* ---------------- Every record, /records ---------------- */
function tabs(m) {
  const list = [['people', m.counts.people], ['households', m.counts.households], ['visits', null], ['events', null], ['signins', null], ['devices', null], ['access', m.counts.access]];
  return html`<nav class="tabs" aria-label="Record type">${list.map(([k, c]) => html`<a href="${href('/records', { tab: k, own: m.hideInternal ? null : 'show' })}" ${k === m.tab ? trusted('aria-current="page"') : ''}>${TAB_LABEL[k]} <span class="count">${c === null ? '–' : num(c)}</span></a>`)}</nav>`;
}
function filters(m) {
  if (m.tab !== 'people' && m.tab !== 'households') return '';
  return html`<form class="filters card" method="get" action="/records">
<input type="hidden" name="tab" value="${m.tab}">
${m.hideInternal ? '' : html`<input type="hidden" name="own" value="show">`}
<label class="field grow-2">Search<input type="search" name="q" value="${m.q}" placeholder="Name, email or household" autocomplete="off"></label>
<label class="field grow-1">Stage<select name="stage">${Object.keys(STAGE_LABEL).map((k) => html`<option value="${k}" ${k === m.stage ? trusted('selected') : ''}>${STAGE_LABEL[k]}</option>`)}</select></label>
<button class="btn" type="submit">Search</button>
</form>
<div class="saved"><span class="saved-label">Saved views</span>${Object.keys(VIEW_LABEL).map((k) => html`<a class="pill" href="${href('/records', { tab: 'households', view: k, own: m.hideInternal ? null : 'show' })}" ${k === m.view ? trusted('aria-current="page"') : ''}>${VIEW_LABEL[k]}</a>`)}${m.view ? html`<a class="pill pill-clear" href="${href('/records', { tab: m.tab, own: m.hideInternal ? null : 'show' })}">Clear</a>` : ''}</div>`;
}
function pager(m) {
  if (m.pages <= 1) return '';
  const q = { tab: m.tab, q: m.q || null, stage: m.stage !== 'any' ? m.stage : null, view: m.view || null, own: m.hideInternal ? null : 'show' };
  return html`<nav class="pager" aria-label="Pages">${m.pageNo > 1 ? html`<a class="btn btn-quiet" href="${href('/records', Object.assign({}, q, { page: m.pageNo - 1 }))}">Previous 50</a>` : ''}<span>Page ${m.pageNo} of ${m.pages}</span>${m.pageNo < m.pages ? html`<a class="btn btn-quiet" href="${href('/records', Object.assign({}, q, { page: m.pageNo + 1 }))}">Next 50</a>` : ''}</nav>`;
}
export const PEOPLE_COLUMNS = ['Person', 'Email', 'Household', 'Role', 'Stage', 'Signed up', 'Signs in with', 'Came from'];
export const HOUSEHOLD_COLUMNS = ['Household', 'Stage', 'Size', 'Created', 'Country', 'Plan', 'Last entry', 'People logging this week'];
export const ACCESS_COLUMNS = ['Entry', 'When (UTC)', 'Who', 'What', 'About', 'Details', 'Country'];

export function peopleCells(p, h) {
  return [p.name || 'No name yet', p.email || '', h ? 'Household ' + h.display_no : 'No household yet',
    p.role === 'owner' ? 'Owner' : (p.role === 'caregiver' ? 'Caregiver' : ''), h ? (h.stage_detail || 'No stage shared') : '',
    p.signed_up_at ? dayLabel(p.signed_up_at, true) : '', signsInWith(p), cameFrom(p, h)];
}
export function householdCells(h, now) {
  const owner = h.members.find((p) => p.role === 'owner') || {};
  const pl = place(owner.tz);
  return ['Household ' + h.display_no + (h.owner_first_name ? ' · ' + h.owner_first_name : ''), h.stage_detail || 'No stage shared',
    String(h.members.length) + (h.invited.length ? ' + ' + h.invited.length + ' invited' : ''), h.created_at ? dayLabel(h.created_at, true) : '',
    pl ? (pl.country || pl.city) : '', (h.plan === 'pro' ? 'Pro' : 'Free') + (h.waitlisted ? ' · waitlist' : ''),
    h.last_entry_day ? daysAgo(h.last_entry_day, now) : 'None yet', h.authors_7d == null ? '' : String(h.authors_7d)];
}
export function detailWords(detail) {
  let d = {}; try { d = JSON.parse(detail || '{}'); } catch (e) {}
  const out = [];
  if (d.tab) out.push(TAB_LABEL[d.tab] || d.tab);
  if (d.range) out.push(d.range === 'today' ? 'today' : d.range + ' days');
  if (d.stage && d.stage !== 'any') out.push('stage: ' + (STAGE_LABEL[d.stage] || d.stage));
  if (d.view) out.push(VIEW_LABEL[d.view] || d.view);
  if (d.searched) out.push('a search');
  if (d.own) out.push(d.own === 'hidden' ? 'own accounts hidden' : 'own accounts shown');
  if (d.page_no) out.push('page ' + d.page_no);
  if (d.page === 'manual_access') out.push('the manual-access form');
  if (Number.isInteger(d.rows)) out.push(d.rows + ' rows');
  if (d.reason) out.push(MANUAL_REASONS[d.reason] || ('refused for ' + (DENY_LABEL[d.reason] || d.reason.replace(/_/g, ' '))));
  if (d.request) out.push(d.request);
  return out.join(' · ');
}
export function accessCells(r, about) {
  return [String(r.seq), isoOf(r.at).slice(0, 16).replace('T', ' '), r.actor, ACTION_LABEL[r.action] || r.action, about, detailWords(r.detail), r.country || ''];
}

/* The Access log tab's chain line (spec §6.3): "Chain verified to entry 208", or, in red, where it breaks.
   A gap the founder resumed past is never quiet: it is named, in red, every time (log.mjs verifyChain). */
const span = (a, b) => (a === b ? 'entry ' + a + ', which is missing' : 'entries ' + a + ' to ' + b + ', which are missing');
/* When the background check last went through the whole log from entry 1 (log.mjs checkChain), so a sweep
   that has stopped finishing shows as a date that stops moving. */
const sweptWords = (sw) => (sw && Number.isFinite(sw.at)
  ? ' A full check from entry 1 last finished on ' + dayLabel(sw.at) + ' at ' + utcHm(sw.at) + ', at entry ' + sw.to + '.'
  : ' No full check from entry 1 has finished yet.');
export function chainLine(ch) {
  if (!ch.ok) {
    const why = ch.why === 'missing'
      ? (ch.gapTo > ch.brokenAt ? 'entries ' + ch.brokenAt + ' to ' + ch.gapTo + ' are missing.' : 'that entry is missing.')
      : ({ edited: 'that entry was changed after it was written.', link: 'that entry does not follow the one before it.', head: 'the newest entry is missing or was replaced.' }[ch.why] || 'it does not verify.');
    return { bad: true, line: 'The chain breaks at entry ' + ch.brokenAt + ': ' + why + ' Verified to entry ' + Math.max(0, ch.verifiedTo) + '.'
      + (ch.foundAt ? ' Found by the background check at ' + utcHm(ch.foundAt) + '.' : '') + sweptWords(ch.swept) };
  }
  const gaps = ch.gaps || [];
  if (!ch.verifiedTo && !gaps.length) return { bad: false, line: 'Nothing in the log yet.' };
  let line = 'Chain verified to entry ' + ch.verifiedTo + (gaps.length ? ', except ' + gaps.map((g) => span(g.from, g.to)).join(', and ') : '') + '.';
  if (ch.done === false) line += ' Entries after it are checked in the background.';
  return { bad: gaps.length > 0, line: line + sweptWords(ch.swept) };
}

export function recordsPage(m) {
  const tableOf = (cols, rows, linkCol) => html`<div class="scroll"><table>
<thead><tr>${cols.map((c) => html`<th scope="col">${c}</th>`)}</tr></thead>
<tbody>${rows.map((r) => html`<tr>${r.cells.map((c, i) => html`<td${i === 0 ? trusted(' class="strong"') : ''}>${i === linkCol && r.link ? html`<a href="${r.link}">${c}</a>` : c}</td>`)}</tr>`)}</tbody>
</table></div>`;
  let content;
  if (m.tab === 'people') {
    content = html`${tableOf(PEOPLE_COLUMNS, m.rows, 2)}<p class="note">Showing ${num(m.rows.length)} of ${num(m.total)} people.${m.hideInternal ? ' Our own accounts are hidden.' : ''} Last seen, devices, visits and top features switch on once families have been told what our team can see.</p>`;
  } else if (m.tab === 'households') {
    content = html`${tableOf(HOUSEHOLD_COLUMNS, m.rows, 0)}<p class="note">Showing ${num(m.rows.length)} of ${num(m.total)} ${m.total === 1 ? 'household' : 'households'}.${m.hideInternal ? ' Our own accounts are hidden.' : ''}</p>`;
  } else if (m.tab === 'access') {
    const c = chainLine(m.chain);
    content = html`<p class="${c.bad ? 'chain chain-bad' : 'chain chain-ok'}" role="status">${c.line}</p>
<p class="lead">Every time anyone on the team opened a household, exported data or deleted something. It cannot be edited.</p>
${tableOf(ACCESS_COLUMNS, m.rows, 4)}
<form class="manual-start" method="get" action="/manual-access">
<h2>Record a manual access</h2>
<p class="lead">If you ever look at a family's records outside this dashboard, at their request, write it down here. It goes into the access log and into their own download.</p>
<label class="field">Household number<input type="number" name="household" min="1" max="999999" inputmode="numeric" required></label>
<button class="btn" type="submit">Continue</button>
</form>`;
  } else {
    content = html`<div class="empty"><div class="empty-title">${TAB_LABEL[m.tab]}</div><p class="waiting">${WAITING}</p></div>`;
  }
  const body = html`
<a class="back" href="/">Back to overview</a>
<header class="head">
<div class="head-text"><h1>Every record</h1><p class="lead">Search, filter and export anything Cubby keeps about people and how they use it.</p></div>
${['people', 'households', 'access'].includes(m.tab) ? html`<a class="btn btn-quiet" href="${href('/records.csv', { tab: m.tab, q: m.q || null, stage: m.stage !== 'any' ? m.stage : null, view: m.view || null, own: m.hideInternal ? null : 'show' })}">Export this view (CSV)</a>` : ''}
</header>
${tabs(m)}
${filters(m)}
<section class="card card-table" aria-label="${TAB_LABEL[m.tab]}">${content}${pager(m)}</section>`;
  return page('Every record · Cubby Ops', body, { bands: m.bands });
}

/* ---------------- Record a manual access ---------------- */
export function manualPage(m) {
  const h = m.h;
  const body = html`
<a class="back" href="${href('/records', { tab: 'access' })}">Back to the access log</a>
<header class="head"><div class="head-text"><h1>Record a manual access</h1>
<p class="lead">Use this when you looked at a family's records outside this dashboard, at their request. It goes into the access log, and into the family's own download. Reason codes only, and an optional request number you match to your own notes.</p></div></header>
<form id="manual-form" class="card form" data-household="${h.display_no}">
<div class="kv"><span>Household</span><span class="strong">Household ${h.display_no}${h.owner_first_name ? ' · ' + h.owner_first_name + "'s family" : ''}</span></div>
<label class="field">The person it concerns<select name="person"><option value="">The whole household</option>${h.members.map((p) => html`<option value="${p.uid}">${p.name || 'No name yet'}${p.relationship ? ' · ' + p.relationship : ''}</option>`)}</select></label>
<label class="field">Reason<select name="reason" required><option value="">Pick a reason</option>${Object.entries(MANUAL_REASONS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
<label class="field">Request number (optional)<input type="text" name="request" pattern="R-[0-9]{4}" placeholder="R-0001" maxlength="6" autocomplete="off"></label>
<button class="btn" type="submit">Record it</button>
<p id="manual-result" class="note" role="status" aria-live="polite"></p>
</form>`;
  return page('Record a manual access · Cubby Ops', body, { bands: m.bands });
}

export function messagePage(title, line, status) {
  return page(title + ' · Cubby Ops', html`<section class="card message"><h1>${title}</h1><p class="lead">${line}</p>${status === 404 ? html`<p><a href="/">Back to the overview</a></p>` : ''}</section>`);
}
