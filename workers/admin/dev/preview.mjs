#!/usr/bin/env node
/* Local preview of the admin over SAMPLE families. Binds 127.0.0.1 only.
 *
 *   PORT=7721 node workers/admin/dev/preview.mjs            (ports 7701-7739 on this machine)
 *   PORT=7721 node workers/admin/dev/preview.mjs --hostile  (adds a household with a hostile name)
 *   PORT=7721 node workers/admin/dev/preview.mjs --no-usage (USAGE_DB unbound: every usage panel waits)
 *
 * By default cubby-usage holds the founder's own two weeks of sample usage (sample.mjs seedUsage), as phase
 * 2 runs. Untick "Hide our own accounts" on the overview to see it.
 *
 * Refuses to start if any production secret or binding is in the environment, or if asked to serve the
 * production hostname (fixture.mjs). Each request is signed with the fixture's own Access key on the way
 * in, so the real handler runs every one of its checks.
 */
import http from 'node:http';
import { buildFixture } from './fixture.mjs';

const PORT = Number(process.env.PORT || 7721);
const host = '127.0.0.1:' + PORT;
const fx = await buildFixture({ host, origin: 'http://' + host, scheme: 'http', processEnv: process.env, hostile: process.argv.includes('--hostile'),
  usage: process.argv.includes('--no-usage') ? undefined : 'sample' });
await fx.tickUntilDone();

http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k)) headers.set(k, v);
    headers.set('cf-access-jwt-assertion', fx.token());
    const r = await fx.handler.fetch(new Request('http://' + host + req.url, { method: req.method, headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), fx.env, {});
    const out = {};
    r.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end('preview error'); }
}).listen(PORT, '127.0.0.1', () => console.log('admin preview (sample data) at http://' + host + '/'));
