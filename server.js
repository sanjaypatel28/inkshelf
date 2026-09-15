'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const api = require('./lib/api');
const { sweepSessions } = require('./lib/auth');
const { UPLOAD_DIR } = require('./lib/db');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Resolve a URL path inside a root directory, refusing anything that escapes it. */
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/\0/g, '');
  const full = path.resolve(root, '.' + path.posix.normalize('/' + decoded));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return full === root || full.startsWith(rootWithSep) ? full : null;
}

async function sendFile(res, filePath, { immutable = false, sandbox = false } = {}) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'X-Content-Type-Options': 'nosniff',
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  };
  // Uploaded files are user content: never let one execute as a document.
  if (sandbox) headers['Content-Security-Policy'] = "sandbox; default-src 'none'";

  res.writeHead(200, headers);
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');

  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await api.handle(req, res, url);
      if (!handled && !res.headersSent) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No such endpoint.' }));
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end();
      return;
    }

    if (url.pathname.startsWith('/uploads/')) {
      const target = safeJoin(UPLOAD_DIR, url.pathname.slice('/uploads'.length));
      if (target && (await sendFile(res, target, { immutable: true, sandbox: true }))) return;
      res.writeHead(404).end();
      return;
    }

    const asset = safeJoin(PUBLIC_DIR, url.pathname);
    if (asset && url.pathname !== '/' && (await sendFile(res, asset))) return;

    // Everything else is a client-side route.
    if (await sendFile(res, path.join(PUBLIC_DIR, 'index.html'))) return;
    res.writeHead(404).end('Not found');
  } catch (err) {
    console.error('[server]', req.method, url.pathname, err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

setInterval(sweepSessions, 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`\n  Inkshelf is running at http://${HOST}:${PORT}\n`);
});
