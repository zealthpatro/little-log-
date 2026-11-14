/* Server-side HTML with every value escaped (S14). A value only reaches the page as markup if it was
 * itself built by html``, so a member's name, a relationship label or a search term is always text.
 * The CSP (script-src 'self', no inline) is the second wall: even an escaped-wrong value could not run.
 */
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => MAP[c]);

class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const render = (v) => {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
};
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}
/* For a constant this file controls (never for data). */
export const trusted = (s) => new Safe(String(s));

/* A URL from a fixed path and query values; every value is encoded. */
export function href(path, q) {
  const qs = Object.entries(q || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
  return path + (qs ? '?' + qs : '');
}

/* Dates and numbers, in plain words. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function dayLabel(ms, withYear) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + (withYear ? ' ' + d.getUTCFullYear() : '');
}
export function dayFromKey(key, withYear) { return key ? dayLabel(Date.parse(key + 'T00:00:00Z'), withYear) : ''; }
export function daysAgo(key, now) {
  if (!key) return '';
  const n = Math.round((Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z') - Date.parse(key + 'T00:00:00Z')) / 86400000);
  if (n <= 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return n + ' days ago';
}
export const num = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'));
export function hour12(h) {
  const n = Number(h);
  if (!Number.isInteger(n)) return '';
  return (n % 12 === 0 ? 12 : n % 12) + (n < 12 ? 'am' : 'pm');
}
