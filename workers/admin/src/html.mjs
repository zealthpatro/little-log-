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

/* A moment in a family's own time zone: "13 Nov, 3:12am", or "13 Nov, 3am" when only the hour may show
   (F5: a visit that logged medicine or a health entry). With `now`, "Today 3:12am" and "Yesterday, 3am". */
function zoned(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: p.minute };
}
export function clockWords(ms, tz, hourOnly) {
  const z = zoned(ms, tz);
  return (z.h % 12 === 0 ? 12 : z.h % 12) + (hourOnly ? '' : ':' + z.min) + (z.h < 12 ? 'am' : 'pm');
}
export function localWhen(ms, tz, hourOnly, now) {
  if (!Number.isFinite(ms)) return '';
  const z = zoned(ms, tz);
  const clock = clockWords(ms, tz, hourOnly);
  if (now !== undefined) {
    const t = zoned(now, tz);
    const days = Math.round((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(z.y, z.m - 1, z.d)) / 86400000);
    if (days === 0) return 'Today ' + clock;
    if (days === 1) return 'Yesterday, ' + clock;
  }
  return z.d + ' ' + MONTHS[z.m - 1] + ', ' + clock;
}
/* The day alone, in a family's own time zone: "13 Nov". */
export function localDay(ms, tz) {
  if (!Number.isFinite(ms)) return '';
  const z = zoned(ms, tz);
  return z.d + ' ' + MONTHS[z.m - 1];
}
/* 70 -> "1m 10s"; 45 -> "45s"; 3900 -> "1h 5m". */
export function duration(s) {
  if (!Number.isFinite(s) || s < 0) return '';
  s = Math.round(s);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '');
  return Math.floor(s / 3600) + 'h' + (Math.floor((s % 3600) / 60) ? ' ' + Math.floor((s % 3600) / 60) + 'm' : '');
}
/* How long ago, in plain words: "40 seconds ago", "6 minutes ago", "3 hours ago", "2 days ago". */
export function agoWords(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  const unit = (n, w) => n + ' ' + w + (n === 1 ? '' : 's') + ' ago';
  if (s < 60) return unit(s, 'second');
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86400) return unit(Math.floor(s / 3600), 'hour');
  return unit(Math.floor(s / 86400), 'day');
}
