/* Firestore REST values as plain JS, and back. Pure: no I/O.
 *
 * Shared by the admin Worker (the masked reader decodes with it) and by the tests, which encode their
 * sample families with toFs(). Kept apart from worker.js's own fsPlain on purpose: worker.js is the
 * production main Worker and is not refactored for this build.
 */

export function fromFs(v) {
  if (!v || typeof v !== 'object') return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return String(v.stringValue);
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue) || 0;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromFs);
  if ('mapValue' in v) {
    const out = {}, f = (v.mapValue && v.mapValue.fields) || {};
    for (const k of Object.keys(f)) out[k] = fromFs(f[k]);
    return out;
  }
  return null;
}

/* The VALUES of a map field, never its keys. pendingInvites is keyed by the invitee's address and
   pendingLinks by a live invite token; the reducer reads them through this so no key is ever copied into
   a variable that outlives the call. */
export function mapValuesOnly(v) {
  if (!v || typeof v !== 'object' || !('mapValue' in v)) return [];
  const f = (v.mapValue && v.mapValue.fields) || {};
  const out = [];
  for (const k in f) out.push(fromFs(f[k]));
  return out;
}

/* A field by dotted path from a REST document, still in REST form. */
export function rawField(doc, dotted) {
  let cur = doc && doc.fields;
  const parts = String(dotted).split('.');
  for (let i = 0; i < parts.length; i++) {
    if (!cur || typeof cur !== 'object') return undefined;
    const v = cur[parts[i]];
    if (v === undefined) return undefined;
    if (i === parts.length - 1) return v;
    cur = v.mapValue && v.mapValue.fields;
  }
  return undefined;
}
export const field = (doc, dotted) => fromFs(rawField(doc, dotted));

/* The last path segment of a document name. */
export const docId = (doc) => String((doc && doc.name) || '').split('/').pop();

/* Plain JS -> REST value. Dates become timestamps; integers integerValue. */
export function toFs(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (x instanceof Date) return { timestampValue: x.toISOString() };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(toFs) } };
  if (typeof x === 'object') {
    const fields = {};
    for (const k of Object.keys(x)) fields[k] = toFs(x[k]);
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}
export const toFsFields = (obj) => toFs(obj).mapValue.fields;
