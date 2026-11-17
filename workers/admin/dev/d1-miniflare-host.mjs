/* The other half of workers/admin/dev/d1-miniflare.mjs: a worker THREAD that owns one Miniflare, so the
 * test's own thread can wait for each answer synchronously (Atomics.wait) while this thread's event loop
 * talks to workerd. Tests only; never deployed (workers/admin/dev/ is outside every Worker's entry graph,
 * and `workers` is fenced by .assetsignore).
 *
 * Every statement runs INSIDE workerd, on a real D1 binding, through the same calls production code makes:
 * env.DB.prepare(sql).bind(...params).run() / .all() / .first(), env.DB.batch([...]), env.DB.exec(sql).
 * Nothing here is a stand-in for D1: the binding, its parameter conversion, its limits and its meta
 * (rows_read, rows_written, changes) are workerd's own.
 *
 * OFFLINE, AND CHECKED. Given no `cf` option, Miniflare fetches https://workers.cloudflare.com/cf.json when it
 * starts (this machine's colo, ASN, city, postcode, latitude and longitude, for request.cf) and caches it for
 * 30 days in node_modules/.mf or .wrangler/cache under the working directory: in the checkout. `cf: false`
 * below turns that off. So that a regression is seen and never leaks, this thread also:
 *   - refuses every socket it would open to anything but loopback, before DNS, and records it; `stats`
 *     answers the record, and test/usage-d1-engine.test.js fails on any entry (its own and each suite's);
 *   - points MINIFLARE_CACHE_DIR at a fresh path in the temp dir, so no cached cf.json can hide a fetch and
 *     nothing Miniflare caches lands in the checkout.
 */
import { workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const { port, flag: sab } = workerData;
const flag = new Int32Array(sab);
let mf = null;

const outbound = [];
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\]|::ffff:127(\.\d{1,3}){3})$/i;
/* Where a Socket#connect call goes: net.connect hands it [options, cb], tls.connect an options object, a
   caller of its own (port, host). A path is a pipe or a unix socket: local. */
function target(args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0];
  if (a && typeof a === 'object') return a.path ? null : { host: String(a.host || 'localhost'), port: a.port };
  if (typeof a === 'number' || /^\d+$/.test(String(a))) return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: a };
  return null;
}
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const t = target(args);
  if (t && !LOOPBACK.test(t.host)) {
    outbound.push(t.host + ':' + t.port);
    const err = Object.assign(new Error('usage-d1 runs offline: refused a connection to ' + t.host + ':' + t.port), { code: 'ECONNREFUSED' });
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return realConnect.apply(this, args);
};
process.env.MINIFLARE_CACHE_DIR = path.join(os.tmpdir(), 'cubby-d1-nocache-' + process.pid + '-' + crypto.randomBytes(6).toString('hex'));

/* The Worker that holds the bindings. A bound `undefined` arrives as {$u:1} (JSON has no undefined) and is
   restored before bind(), so D1 refuses it exactly as it refuses one in production. */
const INNER = `
const revive = (ps) => (ps || []).map((p) => (p && typeof p === 'object' && p.$u === 1 ? undefined : p));
const msg = (e) => { const m = String((e && e.message) || e); const c = e && e.cause && e.cause.message; return c && c !== m && !m.includes(c) ? m + ' | ' + c : m; };
export default {
  async fetch(req, env) {
    const m = await req.json();
    const D = env[m.db];
    if (!D) return Response.json({ ok: false, error: 'no D1 binding ' + m.db });
    try {
      if (m.op === 'batch') return Response.json({ ok: true, r: await D.batch(m.list.map((s) => D.prepare(s.sql).bind(...revive(s.params)))) });
      if (m.op === 'exec') return Response.json({ ok: true, r: await D.exec(m.sql) });
      const st = D.prepare(m.sql).bind(...revive(m.params));
      if (m.op === 'run') return Response.json({ ok: true, r: await st.run() });
      if (m.op === 'all') return Response.json({ ok: true, r: await st.all() });
      if (m.op === 'first') return Response.json({ ok: true, r: { row: m.col ? await st.first(m.col) : await st.first() } });
      return Response.json({ ok: false, error: 'unknown op ' + m.op });
    } catch (e) {
      return Response.json({ ok: false, error: msg(e) });
    }
  },
};`;

function reply(v) {
  port.postMessage(v);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

async function handle(m) {
  if (m.op === 'init') {
    const req = createRequire(import.meta.url);
    const { Miniflare } = req(m.miniflarePath);
    const env = {};
    for (let i = 0; i < m.pool; i++) env['DB' + i] = { type: 'd1', id: 'cubby-d1-' + i };
    mf = new Miniflare({
      host: '127.0.0.1', port: m.port, cf: false,
      workers: [{ config: { name: 'cubby-d1-engine', compatibilityDate: m.compatibilityDate,
        manifest: { mainModule: 'inner.mjs', modules: { 'inner.mjs': { type: 'esm', contents: INNER } } }, env } }],
    });
    await mf.ready;
    return { ok: true, r: { port: m.port } };
  }
  if (m.op === 'stats') return { ok: true, r: { outbound: outbound.slice() } };
  if (m.op === 'dispose') {
    if (mf) { const x = mf; mf = null; await x.dispose(); }
    return { ok: true, r: null };
  }
  if (!mf) return { ok: false, error: 'the D1 engine is not started' };
  const res = await mf.dispatchFetch('http://cubby-d1.invalid/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
  return await res.json();
}

port.on('message', (m) => {
  handle(m).then(reply, (e) => reply({ ok: false, error: 'engine: ' + String((e && e.stack) || e) }));
});
