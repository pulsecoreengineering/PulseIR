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

/** `npm run serve -- --port 8081`, or PORT=8081, or the default. */
function requestedPort() {
  const flag = process.argv.indexOf('--port');
  const written = flag !== -1 ? process.argv[flag + 1] : process.env.PORT;
  if (written === undefined) return 8080;

  const value = Number(written);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    console.error(`Not a port number: "${written}"`);
    process.exit(1);
  }
  return value;
}

/** Ports to try before giving up, so a busy 8080 is an inconvenience not a stop. */
const PORT_ATTEMPTS = 10;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
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
});

const first = requestedPort();
let port = first;

/**
 * A port already in use is nearly always an earlier `npm run serve` still
 * running, which is not an error worth a stack trace: that server reads from
 * disk on every request, so it is already serving the bundle just rebuilt.
 * Step to the next free port and say what happened.
 */
server.on('error', error => {
  if (error.code !== 'EADDRINUSE') throw error;

  if (port - first + 1 >= PORT_ATTEMPTS) {
    console.error(`Ports ${first}-${port} are all in use. Pick one explicitly:`);
    console.error('  npm run serve -- --port 9000');
    process.exit(1);
  }

  if (port === first) {
    console.log(`Port ${first} is already in use.`);
    console.log(`If that is an earlier "npm run serve", it is serving this same folder -`);
    console.log(`  http://localhost:${first}  already has the rebuilt bundle; just reload the page.`);
    console.log('Starting a second one anyway:\n');
  }

  server.listen(++port);
});

server.listen(port, () => {
  console.log(`PulseIR editor: http://localhost:${port}`);
  console.log('(web/index.html also opens directly from the filesystem)');
});
