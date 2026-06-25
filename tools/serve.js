/* Minimal static file server for local preview (no deps). */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = '/Users/sauravpatro/Downloads/little-log-pwa';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  let fp = path.join(ROOT, p);
  try { if (fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html'); } catch (e) {}
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8080, () => console.log('serving', ROOT, 'on http://localhost:8080'));
