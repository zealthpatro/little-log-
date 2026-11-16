/* The phase-1 screens, server-rendered from the approved canvas (Main, Household and Explorer boards),
 * in Cubby's own tokens and fonts. Every value goes through html`` and is escaped. No inline style and
 * no inline script anywhere: the CSP forbids both, and the page needs neither.
 *
 * Phase 1 shows who is in each family and the record-based numbers. Phase 2 fills the usage panels from
 * cubby-usage (usage.mjs), our own accounts only: a panel with nothing it may show says "Waiting for usage
 * events" rather than a zero, and nothing per-person about a family's activity is shown before families have
 * been told (spec §17). Buttons for later phases (Draft a nudge, Export, Delete) are not rendered at all.
 *
 * Every usage label comes from a fixed map below, keyed by an allowlisted value. A stored string never
 * becomes a label: a key the map does not know reads "Something else".
 */
import { html, trusted, href, dayLabel, dayFromKey, daysAgo, num, hour12, localWhen, localDay, duration, agoWords } from './html.mjs';
import { MANUAL_REASONS } from './log.mjs';
import { place, cameFrom, signsInWith } from './data.mjs';
import { USAGE_TABS } from './usage.mjs';

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
const OWN_ONLY = 'Our own accounts only, until families are told what our team can see.';
const HIDDEN_LINE = 'Before families are told what our team can see, only our own accounts are measured, and they are hidden here.';
const UNREADABLE = 'Usage events could not be read just now.';
/* Pregnancy and trying tools are stored as daily totals with no person in them (§8.4), so their uses cannot
   be limited to our own accounts the way every other row here is. The note says so, beside the rows. */
export const JOURNEY_NOTE = '* Pregnancy and trying tools are kept only as daily totals with no person in them, so their uses count everyone the server stored, not only our own accounts. Their households and people count our own accounts over the last 30 days, whatever the range.';
const ELSE = 'Something else';

export const PLATFORM_LABEL = { ios_app: 'iPhone app', home_screen: 'Home-screen app', android_app: 'Android app', browser: 'Browser tab' };
const PLATFORM_LONG = { ios_app: 'iPhone app', home_screen: 'Home-screen app (installed from Safari)', android_app: 'Android app', browser: 'In a browser tab' };
export const FEATURE_LABEL = { feed: 'Feeds', sleep: 'Sleep', nappy: 'Nappies', pump: 'Pumping', growth: 'Growth', medicine: 'Medicine and doses',
  health_log: 'Health log', note: 'Notes', timeline: 'Reading the timeline', pregnancy_week: 'Pregnancy week view', kicks: 'Kick counts',
  contractions: 'Contraction timer', cycle: 'Cycle and observations', appointments: 'Appointments', vaccines: 'Vaccines', invite: 'Invite someone',
  moments: 'Moments', photos: 'Photos', report: 'Doctor report', voice: 'Voice logging', reminders: 'Reminders to calendar', export: 'Export',
  games: 'Games', pro: 'Pro', theme: 'Theme' };
const FEATURE_NOUN = { feed: 'a feed', sleep: 'sleep', nappy: 'a nappy', pump: 'a pump', growth: 'growth', medicine: 'a dose', health_log: 'a health entry',
  note: 'a note', timeline: 'the timeline', appointments: 'an appointment', vaccines: 'a vaccine', invite: 'an invite', moments: 'a moment',
  photos: 'a photo', report: 'the doctor report', voice: 'voice logging', reminders: 'reminders', export: 'an export', games: 'a game', pro: 'Pro', theme: 'the theme' };
export const SCREEN_LABEL = { signin: 'Sign-in', landing: 'Landing', home: 'Home', timeline: 'Timeline', log_feed: 'Log a feed', log_sleep: 'Log sleep',
  log_nappy: 'Log a nappy', log_pump: 'Log pumping', log_growth: 'Log growth', log_medicine: 'Log medicine', log_health: 'Log health',
  log_note: 'Write a note', pregnancy_week: 'Pregnancy week', kicks: 'Kick counts', contractions: 'Contractions', cycle: 'Cycle',
  appointments: 'Appointments', vaccines: 'Vaccines', photos: 'Photos', moments: 'Moments', circle: 'Circle', invite: 'Invite', settings: 'Settings',
  privacy: 'Privacy', reminders: 'Reminders', report: 'Doctor report', guide: 'Guide', games: 'Games', pro: 'Pro', health: 'Health', den: 'Den',
  onboarding: 'Getting started' };
const ACTION_WORD = { logged: 'logged', edited: 'edited', deleted: 'deleted', shared: 'shared', opened: 'opened' };
const METHOD_LABEL = { google: 'Google', apple: 'Apple', email_link: 'Email link', email_code: 'Email code' };
const STEP_LABEL = { started: 'Started', provider_returned: 'Provider answered', verified: 'Verified', signed_in: 'Signed in' };
const OUTCOME_LABEL = { succeeded: 'Succeeded', failed: 'Failed', abandoned: 'Abandoned' };
const ERROR_LABEL = { popup_closed: 'Pop-up closed', popup_blocked: 'Pop-up blocked', network: 'Network', no_session: 'No session',
  invalid_link: 'Link not valid', expired_code: 'Code expired', wrong_code: 'Wrong code', too_many: 'Too many tries', cancelled: 'Cancelled',
  other: 'Other', none: '' };
const STORAGE_LABEL = { app: 'App storage', browser: 'Browser storage' };
const PUSH_LABEL = { granted: 'On', denied: 'Off', revoked: 'Off', asked: 'Asked' };
const word = (map, k) => (k != null && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : ELSE);

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
const waitingCard = (title, lead, id, line) => html`<section class="card" aria-labelledby="${id}">
<div><h2 id="${id}">${title}</h2>${lead ? html`<p class="lead">${lead}</p>` : ''}</div>
<p class="waiting">${line || WAITING}</p>
</section>`;
const check = (title, c) => html`<div class="check check-${c.state}">
<span class="dot" aria-hidden="true"></span>
<div><div class="check-title">${title}</div><div class="check-line">${c.line}</div></div>
</div>`;

/* ---------------- Overview usage (phase 2) ---------------- */
/* The four usage states usage.mjs reports: 'ok' has numbers; 'unbound', 'empty' and 'hidden' wait; 'error' says so. */
const usageWaits = (u) => !u || u.state !== 'ok';
const waitLine = (u) => (u && u.state === 'error' ? UNREADABLE : WAITING);
export function savingCheck(u, now) {
  if (!u || u.state === 'unbound' || u.state === 'empty' || u.state === 'hidden') return { state: 'off', line: WAITING };
  if (u.state === 'error') return { state: 'off', line: UNREADABLE };
  const s = u.saving;
  if (s.failedPeople >= 3) return { state: 'bad', line: 'Not working · saves failed for ' + s.failedPeople + ' people in the last hour' };
  /* F5: a time whose batch carried a visit that logged a dose or a health entry is left out, never rounded:
     "N minutes ago" would give that minute away. */
  if (s.lastFailedAt && (!s.lastSaveAt || s.lastFailedAt > s.lastSaveAt)) return { state: 'bad', line: 'Not working · the newest save failed' + (s.lastFailedUntimed ? '' : ', ' + agoWords(s.lastFailedAt, now)) };
  if (s.lastSaveAt) return { state: 'ok', line: s.lastSaveUntimed ? 'Working · the newest save went through' : 'Working · last write ' + agoWords(s.lastSaveAt, now) };
  return { state: 'off', line: 'No saves yet' };
}
const usageTile = (u, label, value, sub) => (usageWaits(u)
  ? html`<div class="tile tile-waiting"><div class="tile-label">${label}</div><div class="tile-value">–</div><div class="tile-sub">${waitLine(u)}</div></div>`
  : html`<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${num(value)}</div><div class="tile-sub">${sub}</div></div>`);
const change = (now, before) => {
  if (!before) return now ? 'New' : '';
  const d = Math.round(((now - before) / before) * 100);
  return d === 0 ? 'Same' : (d > 0 ? '+' + d + '%' : '−' + Math.abs(d) + '%');
};
function featuresCard(u, m) {
  if (usageWaits(u)) return waitingCard('What people use', 'Most used first. Counts what was used, never what was written.', 'h-features', waitLine(u));
  const journey = u.features.some((f) => f.journey);
  const rowsHtml = u.features.map((f) => html`<tr><td class="strong">${word(FEATURE_LABEL, f.key)}${f.journey ? ' *' : ''}</td><td>${num(f.households)}</td><td>${num(f.people)}</td><td>${num(f.uses)}</td><td>${change(f.uses, f.prev)}</td></tr>`);
  return html`<section class="card" aria-labelledby="h-features">
<div><h2 id="h-features">What people use</h2><p class="lead">Most used first. Counts what was used, never what was written.</p></div>
${u.features.length ? html`<div class="scroll"><table class="table-narrow">
<thead><tr><th scope="col">Feature</th><th scope="col">Households</th><th scope="col">People</th><th scope="col">Uses</th><th scope="col">Vs last range</th></tr></thead>
<tbody>${rowsHtml}</tbody></table></div>` : html`<p class="waiting">No tools used in this range.</p>`}
${journey ? html`<p class="note">${JOURNEY_NOTE}</p>` : ''}
<p class="note">${OWN_ONLY} <a href="${href('/records', { tab: 'events', own: m.hideInternal ? null : 'show' })}">See every event</a></p>
</section>`;
}
function timeCard(u) {
  if (usageWaits(u)) return waitingCard('Time in Cubby', 'A visit starts when the app comes to the front and ends when it goes away, on every platform.', 'h-time', waitLine(u));
  const t = u.time;
  const top = Math.max(1, ...t.hours);
  const peak = Math.max(...t.hours);
  /* Every hour that ties for the most visits, up to three, so a tie never reads as one busiest hour. */
  const tops = t.hours.map((v, i) => (v === peak ? hour12(i) : null)).filter(Boolean);
  const busiestLine = tops.length === 1 ? 'Busiest hour: ' + tops[0] : (tops.length <= 3 ? 'Busiest hours: ' + tops.slice(0, -1).join(', ') + ' and ' + tops[tops.length - 1] : null);
  return html`<section class="card" aria-labelledby="h-time">
<div><h2 id="h-time">Time in Cubby</h2><p class="lead">A visit starts when the app comes to the front and ends when it goes away, on every platform.</p></div>
<div class="kv"><span>Typical visit</span><span>${t.typical == null ? 'Not recorded yet' : duration(t.typical)}</span></div>
<div class="kv"><span>Visits a day, per active person</span><span>${t.visitsPerDay == null ? 'Not recorded yet' : t.visitsPerDay.toFixed(1)}</span></div>
<div class="kv"><span>Time a day, per active person</span><span>${t.secondsPerDay == null ? 'Not recorded yet' : duration(t.secondsPerDay)}</span></div>
<div><h3 class="h3">When people open Cubby, by local hour</h3>
<div class="hours" role="img" aria-label="${peak ? 'Visits by local hour.' + (busiestLine ? ' ' + busiestLine + '.' : '') : 'No visits started in this range.'}">${t.hours.map((v, i) => html`<span class="hour"><span class="hb h-${Math.round((v / top) * 100)}" title="${hour12(i) + ': ' + v + (v === 1 ? ' visit' : ' visits')}"></span></span>`)}</div>
<div class="hours-axis" aria-hidden="true"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span></div>
${peak && busiestLine ? html`<p class="note">${busiestLine}, in each person's own time zone.</p>` : ''}</div>
</section>`;
}
function platformCard(u) {
  if (usageWaits(u)) return waitingCard('Where they use it', 'Active people this range, by how they open Cubby', 'h-platform', waitLine(u));
  const keys = ['ios_app', 'home_screen', 'android_app', 'browser'];
  const v = u.versions;
  const most = Math.max(1, ...keys.map((k) => u.platforms[k] || 0));
  return html`<section class="card" aria-labelledby="h-platform">
<div><h2 id="h-platform">Where they use it</h2><p class="lead">Active people this range, by how they open Cubby</p></div>
${keys.map((k) => html`<div class="barrow"><div class="barrow-top"><span>${PLATFORM_LONG[k]}</span><span>${num(u.platforms[k] || 0)} ${(u.platforms[k] || 0) === 1 ? 'person' : 'people'}</span></div>${bar(u.platforms[k] || 0, most, 'fill-sleep')}</div>`)}
${v.devices && v.newest ? html`<p class="note">${pct(v.onNewest, v.devices)}% of the devices seen in this range are on the newest version (${v.newest}). ${v.older ? num(v.older) + (v.older === 1 ? ' device is' : ' devices are') + ' on an older one.' : 'None is on an older one.'}</p>` : ''}
</section>`;
}

/* ---------------- Overview, / ---------------- */
export function overviewPage(m) {
  const n = m.numbers;
  const u = m.usage || { state: 'unbound' };
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
${check('Saving and sync', savingCheck(u, m.now))}
${check('Sign-in codes', m.checks.canary)}
${check('Reminders sending', m.checks.reminders)}
${check('Weekly report email', m.checks.digest)}
</section>

<section class="tiles" aria-label="Headline numbers">
<div class="tile"><div class="tile-label">Households</div><div class="tile-value">${num(n.households)}</div><div class="tile-sub">+${num(n.newHouseholds)} in this range</div></div>
<div class="tile"><div class="tile-label">People</div><div class="tile-value">${num(n.people)}</div><div class="tile-sub">${per} per household</div></div>
${usageTile(u, 'Active today', u.tiles && u.tiles.activeToday, 'opened Cubby since midnight')}
${usageTile(u, 'Active this week', u.tiles && u.tiles.activeWeek, u.tiles ? pct(u.tiles.activeWeek, u.tiles.measured) + '% of households measured' : '')}
<div class="tile"><div class="tile-label">Two people logging</div><div class="tile-value">${num(n.twoLogging)}</div><div class="tile-sub">${pct(n.twoLogging, n.households)}% of households</div></div>
${usageTile(u, 'Went quiet', u.tiles && u.tiles.quiet, 'no visit in 7 days')}
</section>
${u.state === 'hidden' ? html`<p class="note">${HIDDEN_LINE} Untick “Hide our own accounts” to see them.</p>` : ''}

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

${featuresCard(u, m)}
<div class="row">
<div class="grow-3">${timeCard(u)}</div>
<div class="grow-2">${platformCard(u)}</div>
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
/* Household usage (phase 2: our own accounts only, usage.mjs usageScope). */
const nameOf = (h, uid) => { const p = h.members.find((x) => x.uid === uid); return p ? (p.name || 'No name yet') : 'An account no longer here'; };
const healthKv = (hu, label, n) => html`<div class="kv"><span>${label}</span>${hu && hu.state === 'ok'
  ? html`<span>${n ? num(n) : 'None'}</span>` : html`<span class="sub">${waitLine(hu)}</span>`}</div>`;
function gridCard(hu, h) {
  if (!hu || hu.state !== 'ok') return waitingCard('Who uses what, last 30 days', 'Number of times each person used each feature', 'h-grid', waitLine(hu));
  const totals = new Map();
  for (const c of hu.grid) totals.set(c.key, (totals.get(c.key) || 0) + c.n);
  const keys = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7).map(([k]) => k);
  const uids = [...new Set(hu.grid.map((c) => c.uid))].sort((a, b) => nameOf(h, a).localeCompare(nameOf(h, b)));
  const at = (uid, k) => (hu.grid.find((c) => c.uid === uid && c.key === k) || { n: 0 }).n;
  const colMax = new Map(keys.map((k) => [k, Math.max(1, ...uids.map((u) => at(u, k)))]));
  const heat = (n, k) => (n ? 1 + Math.min(3, Math.floor((n / colMax.get(k)) * 3.999)) : 0);
  return html`<section class="card" aria-labelledby="h-grid">
<div><h2 id="h-grid">Who uses what, last 30 days</h2><p class="lead">Number of times each person used each feature</p></div>
${keys.length ? html`<div class="scroll"><table class="table-narrow grid">
<thead><tr><th scope="col">Person</th>${keys.map((k) => html`<th scope="col">${word(FEATURE_LABEL, k)}</th>`)}</tr></thead>
<tbody>${uids.map((u) => html`<tr><td class="strong">${nameOf(h, u)}</td>${keys.map((k) => html`<td class="heat-${heat(at(u, k), k)}">${num(at(u, k))}</td>`)}</tr>`)}</tbody>
</table></div>` : html`<p class="waiting">No tools used in the last 30 days.</p>`}
<p class="note">${OWN_ONLY}</p>
</section>`;
}
/* "logged a feed, opened the timeline"; a visit that used no tool says where it looked: "looked at Photos, Settings". */
export function visitSummary(v) {
  const did = v.uses.map((x) => word(ACTION_WORD, x.action) + ' ' + (Object.prototype.hasOwnProperty.call(FEATURE_NOUN, x.feature) ? FEATURE_NOUN[x.feature] : 'something'));
  if (did.length) return did.join(', ');
  const saw = v.screens.map((k) => word(SCREEN_LABEL, k));
  return saw.length ? 'looked at ' + saw.slice(0, 4).join(', ') + (saw.length > 4 ? ' and ' + (saw.length - 4) + ' more' : '') : '';
}
function visitsCard(hu, h, now) {
  if (!hu || hu.state !== 'ok') return waitingCard('Visits, last 48 hours', "What each person did, never what they wrote. Times are in the family's own time zone.", 'h-act', waitLine(hu));
  return html`<section class="card" aria-labelledby="h-act">
<div><h2 id="h-act">Visits, last 48 hours</h2><p class="lead">What each person did, never what they wrote. Times are in the family's own time zone.</p></div>
${hu.visits.length ? html`<ul class="visits">${hu.visits.map((v) => html`<li><span class="strong">${localWhen(v.start, v.tz, v.hourOnly, now)}</span> · ${nameOf(h, v.uid)} · ${word(PLATFORM_LABEL, v.platform)}${visitSummary(v) ? ' · ' + visitSummary(v) : ''}${v.seconds != null ? ' · ' + duration(v.seconds) : ''}</li>`)}</ul>`
    : html`<p class="waiting">No visits in the last 48 hours.</p>`}
<p class="note">${OWN_ONLY} A visit that logged medicine or a health entry shows the hour only, listed after the visits with minutes in that hour.</p>
</section>`;
}

export function householdPage(m) {
  const h = m.h;
  const hu = m.usage || { state: 'unbound' };
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
${gridCard(hu, h)}
${visitsCard(hu, h, m.now)}
</div>
<aside class="grow-side">
<section class="card" aria-labelledby="h-consent"><h2 id="h-consent">Choices they made</h2>${choices}</section>
<section class="card" aria-labelledby="h-record"><h2 id="h-record">Health of their record</h2>
<div class="kv"><span>Last entry</span><span>${h.last_entry_day ? daysAgo(h.last_entry_day, m.now) : 'None yet'}</span></div>
${healthKv(hu, 'Failed saves, 7 days', hu.failedSaves)}
${healthKv(hu, 'Sign-in problems, 7 days', hu.signinProblems)}
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
  const c = (k) => (m.counts[k] == null ? null : m.counts[k]);
  const list = [['people', c('people')], ['households', c('households')], ['visits', c('visits')], ['events', c('events')], ['signins', c('signins')], ['devices', c('devices')], ['access', c('access')]];
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
export const VISIT_COLUMNS = ['Person', 'Household', 'Opens Cubby on', 'Version', 'Started (their time)', 'Length', 'Screens'];
export const EVENT_COLUMNS = ['When (their time)', 'Person', 'Event', 'Details kept', 'Opens Cubby on', 'Version', 'Visit'];
export const SIGNIN_COLUMNS = ['When (their time)', 'Person', 'Household', 'Method', 'Step', 'Outcome', 'Error', 'Attempt', 'Ran in', 'Opens Cubby on'];
export const DEVICE_COLUMNS = ['Person', 'Opens Cubby on', 'OS', 'Browser', 'Version', 'App build', 'Reminders', 'First seen', 'Last seen (their time)'];
export const USAGE_COLUMNS = { visits: VISIT_COLUMNS, events: EVENT_COLUMNS, signins: SIGNIN_COLUMNS, devices: DEVICE_COLUMNS };
/* Which column links to the person's household, and which is set in monospace. */
const USAGE_LINK_COL = { visits: 1, events: 1, signins: 2, devices: 0 };
const USAGE_MONO_COL = { events: 2 };

/* One usage row as cells. `who` resolves a uid to { name, h } from the directory; a household is shown as
   its number, never its id. Every word comes from a fixed map; every time is the family's own (F5 applied). */
export function usageCells(tab, r, who) {
  const w = who(r.uid);
  const person = w.name;
  const hh = (hid) => (hid ? (w.byHid(hid) ? 'Household ' + w.byHid(hid).display_no : 'A household no longer here') : (w.h ? 'Household ' + w.h.display_no : 'No household yet'));
  if (tab === 'visits') {
    return [person, hh(r.hid), word(PLATFORM_LABEL, r.platform), r.version || 'Unknown', localWhen(r.start, r.tz, r.hourOnly),
      r.seconds == null ? 'Not recorded' : duration(r.seconds), r.screens.map((k) => word(SCREEN_LABEL, k)).join(', ')];
  }
  if (tab === 'events') {
    return [localWhen(r.at, r.tz, r.hourOnly), person, r.name || 'Unknown event', r.props.map(([k, v]) => k + ': ' + v).join(' · '),
      word(PLATFORM_LABEL, r.platform), r.version || 'Unknown', r.visit || ''];
  }
  if (tab === 'signins') {
    const p = Object.fromEntries(r.props);
    return [localWhen(r.at, r.tz, r.hourOnly), person, hh(r.hid), word(METHOD_LABEL, p.method), word(STEP_LABEL, p.step), word(OUTCOME_LABEL, p.outcome),
      p.error === undefined ? '' : word(ERROR_LABEL, p.error), Number.isInteger(p.attempt) ? String(p.attempt) : '', word(STORAGE_LABEL, p.storage), word(PLATFORM_LABEL, r.platform)];
  }
  /* First and last seen: a visit's start as its own row shows it (F5 applied), or the day alone (usage.mjs). */
  const seen = (s) => (!s ? '' : (s.dayOnly ? localDay(s.at, s.tz) : localWhen(s.at, s.tz, s.hourOnly)));
  return [person, word(PLATFORM_LABEL, r.platform), r.os, r.browser, r.version || 'Unknown', r.native || '', r.push ? word(PUSH_LABEL, r.push) : 'Not recorded',
    seen(r.firstSeen), seen(r.lastSeen)];
}

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
  const tableOf = (cols, rows, linkCol, monoCol) => html`<div class="scroll"><table>
<thead><tr>${cols.map((c) => html`<th scope="col">${c}</th>`)}</tr></thead>
<tbody>${rows.map((r) => html`<tr>${r.cells.map((c, i) => html`<td${i === 0 ? trusted(' class="strong"') : (i === monoCol ? trusted(' class="mono"') : '')}>${i === linkCol && r.link ? html`<a href="${r.link}">${c}</a>` : c}</td>`)}</tr>`)}</tbody>
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
  } else if (USAGE_TABS.includes(m.tab) && m.usage && m.usage.state === 'ok') {
    const what = { visits: ['visit', 'visits'], events: ['event', 'events'], signins: ['sign-in attempt', 'sign-in attempts'], devices: ['device', 'devices'] }[m.tab];
    const SITS = ' A visit that logged medicine or a health entry shows the hour only, listed after the rows with minutes in that hour.';
    const kept = { visits: SITS,
      events: ' Usage events are kept for 90 days, then only the daily totals stay. Deleting an account removes its events too.' + SITS,
      signins: SITS,
      devices: ' First and last seen are when a visit started. A visit that logged medicine or a health entry shows the hour only, and one older than 90 days shows the day only.' }[m.tab];
    content = html`${tableOf(USAGE_COLUMNS[m.tab], m.rows, USAGE_LINK_COL[m.tab], USAGE_MONO_COL[m.tab])}<p class="note">Showing ${num(m.rows.length)} of ${num(m.total)} ${m.total === 1 ? what[0] : what[1]}. ${OWN_ONLY}${kept}</p>`;
  } else {
    const u = m.usage || {};
    content = html`<div class="empty"><div class="empty-title">${TAB_LABEL[m.tab]}</div><p class="waiting">${u.state === 'error' ? UNREADABLE : WAITING}</p>${u.state === 'hidden'
      ? html`<p class="note">${HIDDEN_LINE}</p><a class="btn btn-quiet" href="${href('/records', { tab: m.tab, own: 'show' })}">Show our own accounts</a>` : ''}</div>`;
  }
  const body = html`
<a class="back" href="/">Back to overview</a>
<header class="head">
<div class="head-text"><h1>Every record</h1><p class="lead">Search, filter and export anything Cubby keeps about people and how they use it.</p></div>
<a class="btn btn-quiet" href="${href('/records.csv', { tab: m.tab, q: m.q || null, stage: m.stage !== 'any' ? m.stage : null, view: m.view || null, own: m.hideInternal ? null : 'show' })}">Export this view (CSV)</a>
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
