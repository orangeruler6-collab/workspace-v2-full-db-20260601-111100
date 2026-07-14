#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const target = new URL(process.env.REVERSE_PROXY_TARGET || 'http://127.0.0.1:3000');
const port = Number(process.env.REVERSE_PROXY_PORT || 80);
const webRoot = path.resolve(__dirname, '..', 'dist-web');
const staticMimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function isExpectedSocketError(err) {
  return ['ECONNRESET', 'ECONNABORTED', 'EPIPE'].includes(err && err.code);
}

function swallowExpectedSocketError(stream) {
  if (!stream || typeof stream.on !== 'function') return stream;
  stream.on('error', (err) => {
    if (isExpectedSocketError(err)) return;
    console.error('[reverse-proxy-80] socket error:', err);
  });
  return stream;
}

function isBlockedLocalFileProbe(value) {
  let decoded = String(value || '');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  const pathOnly = decoded.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  return /(?:^|\/)@fs(?:\/|[A-Za-z]:)/i.test(pathOnly) ||
    /(?:^|\/)\.(?!well-known(?:\/|$))[^/]+(?:\/|$)/i.test(pathOnly);
}

function normalizeViteModulePath(value) {
  const raw = String(value || '/');
  const queryIndex = raw.indexOf('?');
  const pathname = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  if (!pathname.startsWith('/src/') || queryIndex < 0) return raw;

  // Keep Vite's bare query flags (for example `vue` and `lang.css`) byte-for-byte.
  // URLSearchParams would serialize them as `vue=` and break plugin-vue routing.
  const query = raw.slice(queryIndex + 1);
  const normalizedQuery = query
    .split('&')
    .filter((part) => !/^t=\d+$/.test(part))
    .join('&');
  return normalizedQuery ? `${pathname}?${normalizedQuery}` : pathname;
}

function shouldProxyRequest(value) {
  const pathname = String(value || '').split('?', 1)[0];
  return /^\/(?:api|uploads|raw_bf|style-workbench)(?:\/|$)/.test(pathname);
}

function serveProductionFile(req, res) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://local').pathname);
  } catch {}

  if (pathname === '/src/main.js') {
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end("window.location.replace('/?production=20260713');");
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.resolve(webRoot, relativePath);
  if (!filePath.startsWith(webRoot + path.sep) && filePath !== webRoot) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {}
  if (!stat?.isFile() && !path.extname(relativePath)) {
    filePath = path.join(webRoot, 'index.html');
    try {
      stat = fs.statSync(filePath);
    } catch {}
  }
  if (!stat?.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Not found');
    return;
  }

  const isIndex = path.basename(filePath) === 'index.html';
  const headers = {
    'content-type': staticMimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': isIndex
      ? 'no-store, no-cache, must-revalidate, max-age=0'
      : 'public, max-age=31536000, immutable'
  };
  if (isIndex) headers['clear-site-data'] = '"cache"';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  swallowExpectedSocketError(req);
  swallowExpectedSocketError(res);

  if (isBlockedLocalFileProbe(req.url)) {
    res.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end('Not found');
    return;
  }

  if (!shouldProxyRequest(req.url)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }
    serveProductionFile(req, res);
    return;
  }

  const headers = Object.assign({}, req.headers, {
    host: target.host,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': 'http'
  });
  const upstreamPath = normalizeViteModulePath(req.url);

  const proxyReq = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    method: req.method,
    path: upstreamPath,
    headers
  }, (proxyRes) => {
    swallowExpectedSocketError(proxyRes);
    const responseHeaders = Object.assign({}, proxyRes.headers);
    const requestPath = String(req.url || '').split('?', 1)[0];
    if (requestPath === '/' || requestPath === '/index.html') {
      responseHeaders['cache-control'] = 'no-store, no-cache, must-revalidate, max-age=0';
      responseHeaders['clear-site-data'] = '"cache"';
      delete responseHeaders.etag;
    } else if (requestPath.startsWith('/src/') || requestPath === '/@vite/client') {
      responseHeaders['cache-control'] = 'no-store, no-cache, must-revalidate, max-age=0';
      delete responseHeaders.etag;
    }
    if ((proxyRes.statusCode || 0) >= 400) {
      console.warn(
        `[reverse-proxy-80] ${new Date().toISOString()} ${req.method} ${req.url} -> ${proxyRes.statusCode}`
      );
    }
    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Reverse proxy target unavailable: ' + (err.message || String(err)));
  });

  req.pipe(proxyReq);
});

server.on('upgrade', (req, socket, head) => {
  swallowExpectedSocketError(socket);

  if (isBlockedLocalFileProbe(req.url)) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    return;
  }

  const proxyReq = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    method: req.method,
    path: req.url,
    headers: Object.assign({}, req.headers, {
      host: target.host,
      'x-forwarded-host': req.headers.host || '',
      'x-forwarded-proto': 'http'
    })
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    swallowExpectedSocketError(proxySocket);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      Object.entries(proxyRes.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') +
      '\r\n\r\n'
    );
    if (proxyHead && proxyHead.length) socket.write(proxyHead);
    if (head && head.length) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', () => socket.destroy());
  proxyReq.end();
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[reverse-proxy-80] listening on ${port}, target ${target.origin}`);
});
