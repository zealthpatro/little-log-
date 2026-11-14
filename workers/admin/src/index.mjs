/* Cubby Ops: the admin Worker, `cubby-admin`, at admin.little-cubby.com. Phase 1: read-only.
 *
 * Spec docs/superpowers/specs/2026-11-13-admin-dashboard-design.md. In order, for EVERY request:
 *   1. configuration, fail closed: 503 to everyone unless the four secrets are well formed and
 *      ADMIN_PEOPLE holds exactly one person (S3, S4);
 *   2. the Host must be admin.little-cubby.com (S5);
 *   3. the Cloudflare Access JWT, re-verified here whatever Access did (S1, S2) — static files too (S6);
 *   4. state changes are POSTs from the admin's own origin with a JSON body (S7);
 *   5. a route that shows family data writes its access-log row FIRST; if that write fails it answers
 *      503 and shows nothing (S16);
 *   6. every response, errors included, leaves through secure() with the §4.8 headers (S8).
 *
 * There is no fixture branch, no debug switch and no way to skip a check in this file or anything it
 * imports. The local preview (workers/admin/dev/) passes a different host and its own test key from the
 * outside and refuses to start beside any production secret.
 */
import { readConfig, ADMIN_HOST } from './config.mjs';
import { createAccessVerifier } from './access.mjs';
import { secure, htmlResponse, jsonResponse } from './headers.mjs';
import { appendLog, recordDenied, tabChain, checkChain, actorId, brokenLine, MANUAL_REASONS, STAGE_FILTERS, SAVED_VIEWS, RANGES } from './log.mjs';
import { createTokenSource } from '../../shared/google-auth.mjs';
import { runTick, readHouseholdFresh } from './directory.mjs';
import { budgetState } from './meter.mjs';
import { directory, overviewNumbers, canaryCheck, remindersCheck, digestCheck, newsletterFor, visibleHousehold, visiblePerson, allRows } from './data.mjs';
import { overviewPage, householdPage, recordsPage, manualPage, messagePage, bands, peopleCells, householdCells, accessCells,
  PEOPLE_COLUMNS, HOUSEHOLD_COLUMNS, ACCESS_COLUMNS } from './views.mjs';
import { dayFromKey, href } from './html.mjs';
import { asset } from './assets.mjs';

const PAGE_SIZE = 50;
const FRESH_MS = 5 * 60 * 1000;
const code = (e) => String((e && (e.code || e.message)) || e).replace(/[^a-z0-9_:-]/gi, '_').slice(0, 60);

const forbidden = () => htmlResponse(messagePage('Not allowed', 'This page is private.', 403), 403);
const notConfigured = () => htmlResponse(messagePage('Not configured', 'The dashboard is not configured, so it shows nothing.', 503), 503);
/* The access log's tail no longer matches its head (log.mjs LogBroken): say which entries, show nothing. */
const BROKEN_NEXT = 'Nothing is shown until you have looked into it. docs/ADMIN-DEPLOY.md, "If the access log breaks", says what to check and how to carry on.';
const brokenSays = (e) => (e && e.code === 'log_broken' ? brokenLine(e) + ' ' + BROKEN_NEXT : null);
const logFailed = (e) => (brokenSays(e)
  ? htmlResponse(messagePage('Access log broken', brokenSays(e), 503), 503)
  : htmlResponse(messagePage('Not shown', 'The access log could not be written just now, so nothing is shown. Try again in a minute.', 503), 503));
const notFound = () => htmlResponse(messagePage('Not found', 'There is nothing here.', 404), 404);

/* A browser loading a page AHEAD of a click (Chrome's speculation rules send Sec-Purpose: prefetch or
   prefetch;prerender, older browsers Purpose: prefetch, Firefox X-Moz: prefetch, Safari X-Purpose: preview).
   Every route writes its access-log row first, so a look the founder never took would be logged, and in
   phase 3 would reach a family's own download. Refused before anything is written, with no row at all. */
const AHEAD = /(^|[\s,;])(prefetch|prerender|preview)([\s,;=]|$)/i;
function loadedAhead(request) {
  for (const h of ['sec-purpose', 'purpose', 'x-purpose', 'x-moz']) {
    const v = request.headers.get(h);
    if (v && AHEAD.test(v)) return true;
  }
  return false;
}

function clientMeta(request, t, throttle) {
  const cc = request.headers.get('cf-ipcountry') || (request.cf && request.cf.country) || '';
  const ray = request.headers.get('cf-ray') || '';
  return { now: t, throttle, country: /^[A-Z]{2}$/.test(cc) ? cc : null, ray: /^[0-9a-f]{16}(-[A-Z]{3})?$/i.test(ray) ? ray : null };
}

export function createHandler(deps) {
  deps = deps || {};
  const host = deps.host || ADMIN_HOST;
  const origin = deps.origin || 'https://' + host;
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const now = deps.now || (() => Date.now());
  const verifiers = new Map(), tokens = new Map(), throttle = new Map(), fresh = new Map();

  function verifierFor(cfg) {
    const k = cfg.team + '|' + cfg.aud + '|' + cfg.email;
    if (!verifiers.has(k)) verifiers.set(k, createAccessVerifier({ team: cfg.team, aud: cfg.aud, email: cfg.email, fetchImpl, now }));
    return verifiers.get(k);
  }
  function tokenFor(cfg) {
    const k = cfg.sa.client_email;
    if (!tokens.has(k)) tokens.set(k, createTokenSource(cfg.sa, { fetchImpl, now }));
    return tokens.get(k);
  }
  const tickDeps = (cfg) => ({ now, fetchImpl, getToken: tokenFor(cfg), firestoreBase: deps.firestoreBase, authBase: deps.authBase, limits: deps.limits });

  async function pageBands(cfg, t) {
    return bands(await budgetState(cfg.db, t), cfg, t);
  }

  async function logRow(cfg, req, t, action, fields, hids) {
    return appendLog(cfg.db, Object.assign({ at: t, actor: cfg.name, actor_id: await actorId(cfg.email), action }, clientMeta(req, t, throttle), fields), hids || []);
  }

  /* ---- / ---- */
  async function overview(cfg, req, url, t) {
    const range = RANGES.includes(url.searchParams.get('range')) ? url.searchParams.get('range') : '7';
    const hideInternal = url.searchParams.get('own') !== 'show';
    try { await logRow(cfg, req, t, 'view_overview', { detail: { range, own: hideInternal ? 'hidden' : 'shown' } }, []); }
    catch (e) { console.error('admin_log_fail', code(e)); return logFailed(e); }
    const dir = await directory(cfg);
    const numbers = overviewNumbers(dir, t, range, hideInternal);
    const [canary, reminders, digest] = await Promise.all([canaryCheck(cfg), remindersCheck(cfg, t), digestCheck(cfg, t, (d) => dayFromKey(d))]);
    return htmlResponse(overviewPage({ range, hideInternal, numbers, checks: { canary, reminders, digest }, bands: await pageBands(cfg, t) }));
  }

  /* ---- /household/<n> ---- */
  async function household(cfg, req, n, t) {
    const dir = await directory(cfg);
    const h = dir.households.find((x) => x.display_no === n);
    if (!h) return notFound();
    let row;
    try { row = await logRow(cfg, req, t, 'view_household', { target_hid: h.hid, detail: { page: 'household' } }, []); }
    catch (e) { console.error('admin_log_fail', code(e)); return logFailed(e); }
    const ym = new Date(t).toISOString().slice(0, 7);
    let f = fresh.get(h.hid);
    if (!f || t - f.at > FRESH_MS) {
      const data = await readHouseholdFresh(cfg, { now, fetchImpl, getToken: tokenFor(cfg), firestoreBase: deps.firestoreBase }, h.hid, ym);
      f = { at: t, data };
      if (!data.paused && !data.failed) fresh.set(h.hid, f);
    }
    const data = f.data;
    /* The live read wins for who is in the circle and what they called themselves; the Auth address and
       sign-up facts always come from the directory (the Auth listing), never from users/{uid}. */
    if (data.household) {
      const byUid = new Map(dir.people.map((p) => [p.uid, p]));
      /* Only people whose own users/{uid}.householdId names this household: an owner can write anyone
         into the members map, never into someone else's users document. */
      const agrees = (m) => { const u = data.users.get(m.uid); return !!u && u.householdId === h.hid; };
      h.members = data.household.members.filter((m) => byUid.has(m.uid) && agrees(m)).map((m) => Object.assign({}, byUid.get(m.uid),
        { name: m.name, relationship: m.relationship, role: m.role, joined_at: m.joinedAt || null }));
      h.invited = data.household.invited;
      h.owner_first_name = data.household.ownerFirstName || h.owner_first_name;
      h.deletion_pending = data.household.deletionPending ? 1 : 0;
      h.plan = data.household.plan;
    }
    const newsletter = new Map();
    for (const p of h.members) {
      if (p.email && p.email_verified) newsletter.set(p.uid, await newsletterFor(cfg, p.email));
    }
    return htmlResponse(householdPage({ h, fresh: data, newsletter, loggedAt: row.at, now: t, bands: await pageBands(cfg, t) }));
  }

  /* ---- /records and /records.csv ---- */
  function filtered(dir, tab, q, stage, view, hideInternal, t) {
    const needle = q.trim().toLowerCase();
    const hhNo = /^(household\s*)?(\d{1,6})$/.exec(needle);
    const stageOk = (h) => stage === 'any' || (h && (stage === 'none' ? (h.stage === 'none' || h.stage === 'trying') : h.stage === stage));
    const viewOk = (h) => {
      if (!view) return true;
      if (!h) return false;
      if (view === 'no_first_entry') return h.created_at && t - h.created_at >= 2 * 86400000 && !h.last_entry_day && !(h.entries_total > 0);
      if (view === 'one_logging') return (h.members.length >= 2 || h.invited.length > 0) && h.authors_7d === 1;
      if (view === 'invite_waiting') return h.invited.length > 0;
      return true;
    };
    if (tab === 'people') {
      return dir.people.filter((p) => visiblePerson(p, dir.byHid, hideInternal)).filter((p) => {
        const h = p.hid ? dir.byHid.get(p.hid) : null;
        if (!stageOk(h) || !viewOk(h)) return false;
        if (!needle) return true;
        if (hhNo) return !!h && h.display_no === Number(hhNo[2]);
        return String(p.name || '').toLowerCase().includes(needle) || String(p.email || '').toLowerCase().includes(needle);
      }).sort((a, b) => {
        const ha = a.hid ? dir.byHid.get(a.hid) : null, hb = b.hid ? dir.byHid.get(b.hid) : null;
        return ((ha ? ha.display_no : 1e9) - (hb ? hb.display_no : 1e9)) || ((a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1)) || String(a.name || '').localeCompare(String(b.name || ''));
      });
    }
    return dir.households.filter((h) => visibleHousehold(h, hideInternal) && stageOk(h) && viewOk(h)).filter((h) => {
      if (!needle) return true;
      if (hhNo) return h.display_no === Number(hhNo[2]);
      return String(h.owner_first_name || '').toLowerCase().includes(needle)
        || h.members.some((p) => String(p.name || '').toLowerCase().includes(needle) || String(p.email || '').toLowerCase().includes(needle));
    });
  }

  async function records(cfg, req, url, t, csv) {
    const tab = ['people', 'households', 'visits', 'events', 'signins', 'devices', 'access'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'people';
    if (csv && !['people', 'households', 'access'].includes(tab)) return notFound();
    const q = String(url.searchParams.get('q') || '').slice(0, 120);
    const stage = STAGE_FILTERS.includes(url.searchParams.get('stage')) ? url.searchParams.get('stage') : 'any';
    const view = SAVED_VIEWS.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : '';
    const hideInternal = url.searchParams.get('own') !== 'show';
    const pageNo = Math.max(1, Math.min(100000, parseInt(url.searchParams.get('page') || '1', 10) || 1));
    const dir = await directory(cfg);
    const detail = { tab, own: hideInternal ? 'hidden' : 'shown' };
    if (stage !== 'any') detail.stage = stage;
    if (view) detail.view = view;
    if (q.trim()) detail.searched = true;

    let all = [], rows = [], hids = [], total = 0, chain = null, accessTop = 0;
    if (tab === 'people' || tab === 'households') {
      all = filtered(dir, tab, q, stage, view, hideInternal, t);
      total = all.length;
    } else if (tab === 'access') {
      total = Number(((await cfg.db.prepare('SELECT COUNT(*) AS n FROM access_log').first()) || {}).n) || 0;
      if (csv) all = await allRows(cfg.db, 'SELECT * FROM access_log ORDER BY seq DESC');
      else {
        /* The page this look will show once its own row is written (that row lists no household): page 1
           is the new row plus the 49 before it, and every later page shifts by one. The households are
           taken from exactly those rows, then the page is read again after the write so the look that
           drew the tab heads it (spec §6.3: the log proves itself). */
        const head = Number(((await cfg.db.prepare('SELECT MAX(seq) AS n FROM access_log').first()) || {}).n) || 0;
        accessTop = head + 1 - (pageNo - 1) * PAGE_SIZE;
        all = await allRows(cfg.db, 'SELECT * FROM access_log WHERE seq <= ? ORDER BY seq DESC LIMIT ?', accessTop, pageNo === 1 ? PAGE_SIZE - 1 : PAGE_SIZE);
        total += 1;
      }
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const slice = csv || tab === 'access' ? all : all.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
    const byUid = new Map(dir.people.map((p) => [p.uid, p]));
    const accessRows = (list) => list.map((r) => {
      const h = r.target_hid ? dir.byHid.get(r.target_hid) : null;
      const p = r.target_uid ? byUid.get(r.target_uid) : null;
      const about = (r.target_hid ? (h ? 'Household ' + h.display_no : 'A household no longer here') : '') + (p ? ' · ' + (p.name || 'a person') : (r.target_uid ? ' · a person no longer here' : ''));
      return { cells: accessCells(r, about), link: h ? '/household/' + h.display_no : null, hid: h ? r.target_hid : null };
    });
    if (tab === 'people') {
      rows = slice.map((p) => { const h = p.hid ? dir.byHid.get(p.hid) : null; return { cells: peopleCells(p, h), link: h ? '/household/' + h.display_no : null, hid: p.hid }; });
    } else if (tab === 'households') {
      rows = slice.map((h) => ({ cells: householdCells(h, t), link: '/household/' + h.display_no, hid: h.hid }));
    } else if (tab === 'access') {
      rows = accessRows(slice);
    }
    hids = rows.map((r) => r.hid).filter(Boolean);

    if (csv) {
      detail.rows = rows.length;
      try { await logRow(cfg, req, t, 'export_csv', { detail }, hids); }
      catch (e) { console.error('admin_log_fail', code(e)); return logFailed(e); }
      const cols = tab === 'people' ? PEOPLE_COLUMNS : (tab === 'households' ? HOUSEHOLD_COLUMNS : ACCESS_COLUMNS);
      const body = [cols].concat(rows.map((r) => r.cells)).map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
      return secure(new Response(body, { headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="cubby-' + tab + '-' + new Date(t).toISOString().slice(0, 10) + '.csv"',
      } }));
    }
    detail.page_no = pageNo;
    try { await logRow(cfg, req, t, 'view_records', { detail }, hids); }
    catch (e) { console.error('admin_log_fail', code(e)); return logFailed(e); }
    if (tab === 'access') {
      rows = accessRows(await allRows(cfg.db, 'SELECT * FROM access_log WHERE seq <= ? ORDER BY seq DESC LIMIT ?', accessTop, PAGE_SIZE));
      chain = await tabChain(cfg.db, t);
    }
    const counts = {
      people: dir.people.filter((p) => visiblePerson(p, dir.byHid, hideInternal)).length,
      households: dir.households.filter((h) => visibleHousehold(h, hideInternal)).length,
      access: tab === 'access' ? total : Number(((await cfg.db.prepare('SELECT COUNT(*) AS n FROM access_log').first()) || {}).n) || 0,
    };
    return htmlResponse(recordsPage({ tab, q, stage, view, hideInternal, rows, total, pageNo, pages, counts, chain, bands: await pageBands(cfg, t) }));
  }

  /* ---- Record a manual access ---- */
  async function manualForm(cfg, req, url, t) {
    const n = parseInt(url.searchParams.get('household') || '', 10);
    const dir = await directory(cfg);
    const h = dir.households.find((x) => x.display_no === n);
    if (!h) return notFound();
    try { await logRow(cfg, req, t, 'view_household', { target_hid: h.hid, detail: { page: 'manual_access' } }, []); }
    catch (e) { console.error('admin_log_fail', code(e)); return logFailed(e); }
    return htmlResponse(manualPage({ h, bands: await pageBands(cfg, t) }));
  }

  async function manualPost(cfg, req, t) {
    let body;
    try {
      const raw = await req.text();
      if (raw.length > 2048) return jsonResponse({ message: 'That is too long.' }, 413);
      body = JSON.parse(raw);
    } catch (e) { return jsonResponse({ message: 'That could not be read.' }, 400); }
    if (!body || typeof body !== 'object') return jsonResponse({ message: 'That could not be read.' }, 400);
    const reason = body.reason;
    if (typeof reason !== 'string' || !Object.prototype.hasOwnProperty.call(MANUAL_REASONS, reason)) return jsonResponse({ message: 'Pick a reason from the list.' }, 400);
    const request = typeof body.request === 'string' ? body.request.trim() : '';
    if (request && !/^R-\d{4}$/.test(request)) return jsonResponse({ message: 'A request number looks like R-0001.' }, 400);
    const dir = await directory(cfg);
    const h = dir.households.find((x) => x.display_no === Number(body.household));
    if (!h) return jsonResponse({ message: 'There is no household with that number.' }, 404);
    const person = typeof body.person === 'string' ? body.person : '';
    if (person && !h.members.some((p) => p.uid === person)) return jsonResponse({ message: 'That person is not in this household.' }, 400);
    const detail = { reason };
    if (request) detail.request = request;
    try {
      const row = await logRow(cfg, req, t, 'manual_access', { target_hid: h.hid, target_uid: person || null, detail }, []);
      return jsonResponse({ ok: true, seq: row.seq });
    } catch (e) { console.error('admin_log_fail', code(e)); return jsonResponse({ message: brokenSays(e) || 'The access log could not be written just now.' }, 503); }
  }

  async function route(request, env) {
    const t = now();
    const url = new URL(request.url);
    const meta = clientMeta(request, t, throttle);
    const c = readConfig(env);
    if (!c.ok) {
      console.error('admin_not_configured', c.code);
      await recordDenied(env && env.ADMIN_DB, 'not_configured', meta);
      return notConfigured();
    }
    const cfg = c.cfg;
    if (url.host !== host) { await recordDenied(cfg.db, 'host', meta); return forbidden(); }
    const v = await verifierFor(cfg).verify(request.headers.get('cf-access-jwt-assertion'));
    if (!v.ok) { await recordDenied(cfg.db, v.code, meta); return forbidden(); }
    if (loadedAhead(request)) return forbidden();

    if (request.method === 'POST') {
      const ct = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (request.headers.get('origin') !== origin || ct !== 'application/json') { await recordDenied(cfg.db, 'origin', meta); return forbidden(); }
      if (url.pathname === '/api/manual-access') return manualPost(cfg, request, t);
      await recordDenied(cfg.db, 'method', meta);
      return forbidden();
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { await recordDenied(cfg.db, 'method', meta); return forbidden(); }

    if (url.pathname.startsWith('/static/')) return asset(url.pathname) || notFound();
    if (url.pathname === '/') return overview(cfg, request, url, t);
    const hm = /^\/household\/(\d{1,6})$/.exec(url.pathname);
    if (hm) return household(cfg, request, Number(hm[1]), t);
    if (url.pathname === '/records') return records(cfg, request, url, t, false);
    if (url.pathname === '/records.csv') return records(cfg, request, url, t, true);
    if (url.pathname === '/manual-access') return manualForm(cfg, request, url, t);
    return notFound();
  }

  return {
    async fetch(request, env) {
      try { return await route(request, env); }
      catch (e) {
        console.error('admin_error', code(e));
        return htmlResponse(messagePage('Something went wrong', 'Nothing was shown. Try again in a minute.', 500), 500);
      }
    },
    async scheduled(event, env, ctx) {
      const c = readConfig(env);
      if (!c.ok) { console.error('admin_tick_not_configured', c.code); return null; }
      const work = (async () => {
        /* The access log's chain check first, in its own bounded chunk (log.mjs checkChain), so a slow
           directory refresh can never starve it. */
        let chain = null;
        try { chain = await checkChain(c.cfg.db, now()); } catch (e) { console.error('admin_chain_fail', code(e)); }
        const r = await runTick(c.cfg, tickDeps(c.cfg));
        r.chain = chain ? { to: chain.tip ? chain.tip.seq : 0, broken: !!chain.broken } : null;
        console.log('admin_tick', JSON.stringify({ fetches: r.fetches, paused: r.paused, removed: r.auth && r.auth.removed,
          authError: r.auth && r.auth.error, incremental: r.incremental, daily: r.daily && r.daily.phase, chain: r.chain,
          errors: [r.incrementalError, r.dailyError].filter(Boolean) }));
        return r;
      })().catch((e) => { console.error('admin_tick_fail', code(e)); return null; });
      if (ctx && ctx.waitUntil) ctx.waitUntil(work);
      return work;
    },
  };
}

/* CSV cells: quoted, and formula-safe. A cell that begins with = + - @, a tab or a carriage return gets a
   leading apostrophe, so a spreadsheet never runs a name as a formula (spec §6.3). */
export function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

const handler = createHandler();
export default {
  fetch: (request, env, ctx) => handler.fetch(request, env, ctx),
  scheduled: (event, env, ctx) => handler.scheduled(event, env, ctx),
};
export { href };
