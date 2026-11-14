/* A fake Google for the tree-tier tests and the local preview: the OAuth token endpoint, Firestore REST
 * (get, list, runQuery, batchGet, runAggregationQuery), Identity Toolkit accounts:batchGet, and a
 * Cloudflare Access certs endpoint. Every request is recorded, so a test proves what was FETCHED rather
 * than what the code appears to do.
 *
 * By default it IGNORES masks and returns whole documents: the worst case, so the reducers are proven to
 * drop content even if Firestore sent it. `honorMask: true` projects like the real service. The real
 * service's behaviour is proven separately against the emulator (test/admin-read-emulator.test.js).
 */
import { toFs, fromFs } from '../../shared/fs-values.mjs';

const FS = 'https://firestore.googleapis.com/v1/projects/';
const ITK = 'https://identitytoolkit.googleapis.com/v1/projects/';

const getPath = (obj, dotted) => {
  let cur = obj;
  for (const p of dotted.split('.')) { if (!cur || typeof cur !== 'object' || !(p in cur)) return undefined; cur = cur[p]; }
  return cur;
};
function project(fields, paths) {
  if (!paths) return fields;
  const out = {};
  for (const p of paths) {
    const v = getPath(fields, p);
    if (v === undefined) continue;
    const parts = p.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] && typeof cur[parts[i]] === 'object' ? cur[parts[i]] : {}; cur = cur[parts[i]]; }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}
const cmpVal = (v) => (v instanceof Date ? v.getTime() : v);
function compare(a, b) { a = cmpVal(a); b = cmpVal(b); return a < b ? -1 : (a > b ? 1 : 0); }
const json = (o, status, headers) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) });

export function createFakeGoogle(opts) {
  const docs = opts.docs;                // Map path -> plain fields
  const accounts = opts.accounts || [];  // Identity Toolkit user objects
  const projectId = opts.projectId || 'cubby-sample';
  const seen = [];
  /* `billed`: what Firestore would charge, counted independently of the admin's own meter: one read per
     document returned (one for an empty answer), one per thousand counted for an aggregation. */
  const state = { honorMask: !!opts.honorMask, fault: null, authPageSize: opts.authPageSize || 1000, billed: 0 };
  const docOut = (path, fields, mask) => ({ name: 'projects/' + projectId + '/databases/(default)/documents/' + path,
    fields: toFs(project(fields, state.honorMask ? mask : null)).mapValue.fields || {} });
  const children = (coll) => [...docs.keys()].filter((k) => k.startsWith(coll + '/') && !k.slice(coll.length + 1).includes('/')).sort();

  function where(fields, f) {
    if (!f) return true;
    if (f.compositeFilter) return f.compositeFilter.filters.every((x) => where(fields, x));
    const ff = f.fieldFilter;
    const v = getPath(fields, ff.field.fieldPath);
    if (v === undefined) return false;
    const want = fromFs(ff.value);
    const c = compare(v instanceof Date ? v.getTime() : v, want);
    return { GREATER_THAN: c > 0, GREATER_THAN_OR_EQUAL: c >= 0, LESS_THAN: c < 0, LESS_THAN_OR_EQUAL: c <= 0, EQUAL: c === 0 }[ff.op];
  }

  async function fetchImpl(input, init) {
    const url = String(input && input.url ? input.url : input);
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const body = init && init.body ? String(init.body) : '';
    seen.push({ method, url, body });
    if (state.fault) { const r = await state.fault(url, method, body, init || {}); if (r) return r; }

    if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'fake-google-token', expires_in: 3600 });
    if (opts.certs && url === 'https://' + opts.certs.team + '/cdn-cgi/access/certs') {
      return json({ keys: opts.certs.keys() }, 200, { 'cache-control': 'max-age=' + (opts.certs.maxAge === undefined ? 300 : opts.certs.maxAge) });
    }
    if (url.startsWith(ITK + projectId + '/accounts:batchGet')) {
      const u = new URL(url);
      const start = Number(u.searchParams.get('nextPageToken') || 0);
      const page = accounts.slice(start, start + state.authPageSize);
      const next = start + state.authPageSize < accounts.length ? String(start + state.authPageSize) : undefined;
      return json(next ? { users: page, nextPageToken: next } : { users: page });
    }
    const base = FS + projectId + '/databases/(default)/documents';
    if (!url.startsWith(base)) return json({ error: 'unexpected ' + url }, 599);
    const rest = url.slice(base.length);
    if (method === 'POST' && rest === ':batchGet') {
      const b = JSON.parse(body);
      const mask = b.mask && b.mask.fieldPaths;
      state.billed += Math.max(1, b.documents.length);
      return json(b.documents.map((name) => {
        const p = name.split('/documents/')[1];
        return docs.has(p) ? { found: docOut(p, docs.get(p), mask) } : { missing: name };
      }));
    }
    const m = /^(?:\/(.*?))?:(runQuery|runAggregationQuery)$/.exec(rest);
    if (method === 'POST' && m) {
      const parent = m[1] || '';
      const b = JSON.parse(body);
      const sq = m[2] === 'runQuery' ? b.structuredQuery : b.structuredAggregationQuery.structuredQuery;
      const coll = (parent ? parent + '/' : '') + sq.from[0].collectionId;
      let rows = children(coll).map((p) => ({ p, f: docs.get(p) })).filter((r) => where(r.f, sq.where));
      if (sq.orderBy && sq.orderBy.length) {
        const o = sq.orderBy[0];
        rows = rows.filter((r) => getPath(r.f, o.field.fieldPath) !== undefined);
        rows.sort((a, b2) => compare(getPath(a.f, o.field.fieldPath), getPath(b2.f, o.field.fieldPath)) * (o.direction === 'DESCENDING' ? -1 : 1));
        if (sq.startAt) {
          const after = fromFs(sq.startAt.values[0]);
          rows = rows.filter((r) => { const c = compare(getPath(r.f, o.field.fieldPath), after) * (o.direction === 'DESCENDING' ? -1 : 1); return sq.startAt.before ? c >= 0 : c > 0; });
        }
      }
      if (m[2] === 'runAggregationQuery') state.billed += Math.max(1, Math.ceil(rows.length / 1000));
      if (m[2] === 'runAggregationQuery') return json([{ result: { aggregateFields: { n: { integerValue: String(rows.length) } } } }]);
      if (sq.limit) rows = rows.slice(0, sq.limit);
      state.billed += Math.max(1, rows.length);
      const mask = sq.select && sq.select.fields.map((x) => x.fieldPath);
      return json(rows.length ? rows.map((r) => ({ document: docOut(r.p, r.f, mask), readTime: 'x' })) : [{ readTime: 'x' }]);
    }
    if (method === 'GET') {
      const u = new URL(url);
      const path = decodeURIComponent(u.pathname.slice(new URL(base).pathname.length + 1));
      const mask = u.searchParams.getAll('mask.fieldPaths');
      if (docs.has(path)) { state.billed += 1; return json(docOut(path, docs.get(path), mask.length ? mask : null)); }
      const kids = children(path);
      if (kids.length || u.searchParams.has('pageSize')) {
        const size = Number(u.searchParams.get('pageSize') || 100);
        const start = Number(u.searchParams.get('pageToken') || 0);
        const page = kids.slice(start, start + size);
        state.billed += Math.max(1, page.length);
        const out = { documents: page.map((p) => docOut(p, docs.get(p), mask.length ? mask : null)) };
        if (start + size < kids.length) out.nextPageToken = String(start + size);
        return json(page.length ? out : {});
      }
      state.billed += 1;
      return json({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
    }
    return json({ error: 'unsupported ' + method + ' ' + url }, 599);
  }
  return { fetchImpl, seen, state, docs };
}
