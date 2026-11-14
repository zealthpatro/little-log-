/* THE masked Firestore reader. The only code under workers/admin/ or workers/shared/ that calls
 * firestore.googleapis.com.
 *
 * The admin Worker's service account holds Cloud Datastore Viewer, which Firestore applies to the whole
 * database: by IAM it could read a baby's name, a dose, a note. The promise "who and how, never what" is
 * therefore kept HERE, in code, before any byte is fetched:
 *
 *   - every call names a kind; the kind fixes the path shape, the operation and the fields it may ask
 *     for (the table below is the spec's §5.1, nothing more);
 *   - every request carries a mask (mask.fieldPaths, a structured-query select, or a batchGet mask), so
 *     Firestore itself never sends a field outside it;
 *   - a filter or an order may only name a field the kind may already read, so no query can learn about
 *     a field by asking where it is set;
 *   - document ids are plain ids (letters, digits, _ and -), so no path can walk somewhere else;
 *   - anything else throws BEFORE fetch is called.
 *
 * Every request first reserves its worst-case cost from the daily read meter (meter.mjs) and is refused
 * when the budget would be passed, so the families' quota is never the admin's to spend.
 */
import { rawField } from './fs-values.mjs';

export const FS_BASE = 'https://firestore.googleapis.com/v1';
const ID = '[A-Za-z0-9_-]{1,128}';
/* A document id this reader will ever read by path. Firestore allows far more ('.', '~', spaces, accents),
   and any signed-in person can create a household with such an id; callers skip those rather than ask. */
export const DOC_ID = new RegExp('^' + ID + '$');
export const HH_FIELDS = ['ownerId', 'members', 'memberInfo', 'createdAt', 'updatedAt', 'pro', 'deleteAfter',
  'pendingInvites', 'pendingLinks', 'app.babies'];

/* §5.1, the complete read allowlist. */
export const ALLOW = Object.freeze({
  household:  { path: new RegExp('^households/' + ID + '$'), ops: ['get'], fields: HH_FIELDS },
  households: { path: /^households$/, ops: ['list', 'query'], fields: HH_FIELDS },
  pregnancy:  { path: new RegExp('^households/' + ID + '/pregnancy$'), ops: ['list'],
                fields: ['ownerUid', 'sharedWith', 'data.stage', 'data.bornBabyId', 'data.birthAt'] },
  events:     { path: new RegExp('^households/' + ID + '/events$'), ops: ['query'], fields: ['time', 'authorId', 'type'] },
  tally:      { path: new RegExp('^households/' + ID + '/(events|photos)$'), ops: ['count'], fields: [] },
  user:       { path: new RegExp('^users/' + ID + '$'), ops: ['get', 'batch'],
                fields: ['householdId', 'acq', 'referredBy', 'push.enabled', 'push.allow', 'push.tz',
                  'push.quietStart', 'push.quietEnd', 'teamNotes', 'privacyNoticeSeen'] },
  pushLedger: { path: new RegExp('^pushLedger/' + ID + '$'), ops: ['get', 'batch'], fields: ['caps'] },
  waitlist:   { path: new RegExp('^waitlist/' + ID + '$'), ops: ['get', 'batch'], fields: ['uid'] },
});

/* The hold reader's capability. Module-private: only holdRead below can present it. */
const HOLD_KEY = Symbol('hold');
const HOLD_PATH = new RegExp('^households/' + ID + '$');

export class ReadRefused extends Error {
  constructor(code) { super('read_refused:' + code); this.code = code; }
}
export class BudgetPaused extends Error {
  constructor() { super('read_budget_paused'); this.code = 'budget'; }
}

function check(kind, path, op, fields) {
  if (kind === HOLD_KEY) {
    if (op !== 'get' || !HOLD_PATH.test(path) || fields.length !== 1 || !/^app\.[A-Za-z]+$/.test(fields[0])) throw new ReadRefused('hold_shape');
    return;
  }
  const rule = ALLOW[kind];
  if (!rule || !Object.prototype.hasOwnProperty.call(ALLOW, kind)) throw new ReadRefused('kind');
  if (!rule.ops.includes(op)) throw new ReadRefused('op');
  if (!rule.path.test(path)) throw new ReadRefused('path');
  if (op === 'count') { if (fields.length) throw new ReadRefused('fields'); return; }
  if (!fields.length) throw new ReadRefused('no_mask');
  for (const f of fields) if (!rule.fields.includes(f)) throw new ReadRefused('field');
}

export function createReader(opts) {
  const projectId = opts.projectId;
  if (!/^[a-z0-9-]{4,40}$/.test(String(projectId || ''))) throw new ReadRefused('project');
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const base = (opts.base || FS_BASE) + '/projects/' + projectId + '/databases/(default)/documents';
  const getToken = opts.getToken;
  const meter = opts.meter || null;
  const timeoutMs = opts.timeoutMs || 10000;

  async function spend(max) {
    if (meter && !(await meter.reserve(max))) throw new BudgetPaused();
  }
  /* A page that may shrink to fit what is left of today's budget. Returns the size granted. */
  async function spendUpTo(want) {
    if (!meter) return want;
    const g = await meter.reserveUpTo(want);
    if (!g) throw new BudgetPaused();
    return g;
  }
  async function settle(reserved, actual) { if (meter) await meter.settle(reserved, actual); }

  async function call(url, init) {
    const token = await getToken();
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      return await fetchImpl(url, Object.assign({}, init, {
        headers: Object.assign({ authorization: 'Bearer ' + token }, (init && init.headers) || {}),
        signal: ctl ? ctl.signal : undefined,
      }));
    } finally { if (t) clearTimeout(t); }
  }
  const maskQs = (fields) => fields.map((f) => 'mask.fieldPaths=' + encodeURIComponent(f)).join('&');

  /* One document. null on 404; throws on anything else that is not a 200. */
  async function getDoc(kind, path, fields) {
    check(kind, path, 'get', fields);
    await spend(1);
    const r = await call(base + '/' + path + '?' + maskQs(fields), { method: 'GET' });
    await settle(1, 1);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('fs_get_' + r.status);
    return r.json();
  }

  /* Many documents of one kind, one mask, one request. Map path -> doc or null. */
  async function batchGet(kind, paths, fields) {
    const out = new Map();
    if (!paths.length) return out;
    if (paths.length > 100) throw new ReadRefused('batch_size');
    for (const p of paths) check(kind, p, 'batch', fields);
    await spend(paths.length);
    const prefix = base.replace(/^https?:\/\/[^/]+\/v1\//, '');
    const r = await call(base + ':batchGet', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documents: paths.map((p) => prefix + '/' + p), mask: { fieldPaths: fields } }),
    });
    await settle(paths.length, paths.length);
    if (!r.ok) throw new Error('fs_batch_' + r.status);
    const rows = await r.json();
    for (const p of paths) out.set(p, null);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row && row.found && row.found.name) {
        const rel = row.found.name.split('/documents/')[1];
        if (out.has(rel)) out.set(rel, row.found);
      }
    }
    return out;
  }

  /* A page of a collection. */
  async function list(kind, path, fields, page) {
    check(kind, path, 'list', fields);
    const size = await spendUpTo(Math.min(100, Math.max(1, (page && page.pageSize) || 50)));
    const r = await call(base + '/' + path + '?pageSize=' + size + '&' + maskQs(fields)
      + (page && page.pageToken ? '&pageToken=' + encodeURIComponent(page.pageToken) : ''), { method: 'GET' });
    if (r.status === 404) { await settle(size, 1); return { docs: [], nextPageToken: '' }; }
    if (!r.ok) { await settle(size, 1); throw new Error('fs_list_' + r.status); }
    const j = await r.json();
    const docs = (j && j.documents) || [];
    await settle(size, Math.max(1, docs.length));
    return { docs, nextPageToken: (j && j.nextPageToken) || '' };
  }

  /* A structured query over one collection. `q.where` is [{field, op, value(REST)}], ANDed; `q.orderBy`
     is [{field, direction}]. Both may only name fields this kind may read. */
  async function query(kind, path, fields, q) {
    check(kind, path, 'query', fields);
    q = q || {};
    const rule = ALLOW[kind];
    const where = q.where || [], orderBy = q.orderBy || [];
    const OPS = ['GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'EQUAL'];
    for (const w of where) if (!rule.fields.includes(w.field) || !OPS.includes(w.op)) throw new ReadRefused('where');
    for (const o of orderBy) if (!rule.fields.includes(o.field) || !['ASCENDING', 'DESCENDING'].includes(o.direction)) throw new ReadRefused('order');
    let limit = Math.min(300, Math.max(1, q.limit || 100));
    const slash = path.lastIndexOf('/');
    const parent = slash < 0 ? '' : path.slice(0, slash);
    const collectionId = path.slice(slash + 1);
    const sq = {
      from: [{ collectionId }],
      select: { fields: fields.map((f) => ({ fieldPath: f })) },
      limit,
    };
    const filters = where.map((w) => ({ fieldFilter: { field: { fieldPath: w.field }, op: w.op, value: w.value } }));
    if (filters.length === 1) sq.where = filters[0];
    else if (filters.length > 1) sq.where = { compositeFilter: { op: 'AND', filters } };
    if (orderBy.length) sq.orderBy = orderBy.map((o) => ({ field: { fieldPath: o.field }, direction: o.direction }));
    if (q.startAfter) sq.startAt = { values: q.startAfter, before: false };
    limit = await spendUpTo(limit);
    sq.limit = limit;
    const r = await call(base + (parent ? '/' + parent : '') + ':runQuery', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ structuredQuery: sq }),
    });
    if (!r.ok) { await settle(limit, 1); throw new Error('fs_query_' + r.status); }
    const rows = await r.json();
    const docs = (Array.isArray(rows) ? rows : []).map((x) => x && x.document).filter(Boolean);
    await settle(limit, Math.max(1, docs.length));
    /* The page size actually granted, so a caller pages on (fewer than `limit` back means the end). */
    docs.limit = limit;
    return docs;
  }

  /* COUNT aggregation: one read per thousand entries. Reserved generously, settled to the real cost. */
  async function count(kind, path) {
    check(kind, path, 'count', []);
    const RESERVE = 100;
    await spend(RESERVE);
    const slash = path.lastIndexOf('/');
    const r = await call(base + '/' + path.slice(0, slash) + ':runAggregationQuery', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: path.slice(slash + 1) }] },
        aggregations: [{ alias: 'n', count: {} }],
      } }),
    });
    if (!r.ok) { await settle(RESERVE, 1); throw new Error('fs_count_' + r.status); }
    const rows = await r.json();
    const v = Array.isArray(rows) && rows[0] && rows[0].result && rows[0].result.aggregateFields && rows[0].result.aggregateFields.n;
    const n = Number((v && (v.integerValue || v.doubleValue)) || 0);
    await settle(RESERVE, Math.max(1, Math.ceil(n / 1000)));
    return n;
  }

  /* For holdRead only: the private capability gets one field of one household, nothing else. */
  async function holdGet(cap, path, fieldPath) {
    if (cap !== HOLD_KEY) throw new ReadRefused('hold_cap');
    check(HOLD_KEY, path, 'get', [fieldPath]);
    await spend(1);
    const r = await call(base + '/' + path + '?' + maskQs([fieldPath]), { method: 'GET' });
    await settle(1, 1);
    return r;
  }

  return { getDoc, batchGet, list, query, count, holdGet };
}

/* THE HOLD READER. The single place the loss-hold field is named in admin code.
 *
 * Returns true ("held: send nothing, suggest nothing") unless the read succeeded AND the field is present
 * with a shape known to be empty. A missing field, a moved field, a value of another type, an unknown
 * shape, a 404, an error or a timeout all read as held (spec §5.1, S12). The result is a boolean that lives
 * for one request: it is never stored, logged, rendered or given as a reason. */
export async function holdRead(reader, hid) {
  const FIELD = 'app.lossHolding';
  try {
    const r = await reader.holdGet(HOLD_KEY, 'households/' + hid, FIELD);
    if (!r || r.status !== 200) return true;
    const v = rawField(await r.json(), FIELD);
    if (!v || typeof v !== 'object') return true;
    if ('nullValue' in v) return false;
    if ('mapValue' in v) {
      const f = (v.mapValue && v.mapValue.fields) || {};
      return Object.keys(f).length !== 0;
    }
    return true;
  } catch (e) {
    return true;
  }
}
