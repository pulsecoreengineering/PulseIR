/**
 * Minimal static server for the web editor.
 *
 * The editor is a plain page with no backend, so this only exists for
 * convenience - opening web/index.html directly from the filesystem works
 * just as well.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const port = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

http.createServer((req, res) => {
  const requested = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const target = path.join(webRoot, relative);

  // Never serve outside web/, whatever the request path claims.
  if (!target.startsWith(webRoot + path.sep) && target !== path.join(webRoot, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`PulseIR editor: http://localhost:${port}`);
  console.log('(web/index.html also opens directly from the filesystem)');
});
