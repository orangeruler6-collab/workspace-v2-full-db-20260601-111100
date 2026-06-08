const http = require('node:http');

const listenHost = process.env.CONTENT_BOARD_PROXY_HOST || '0.0.0.0';
const listenPort = Number(process.env.CONTENT_BOARD_PROXY_PORT || 80);
const targetHost = process.env.CONTENT_BOARD_TARGET_HOST || '127.0.0.1';
const targetPort = Number(process.env.CONTENT_BOARD_TARGET_PORT || 3000);

const server = http.createServer((clientReq, clientRes) => {
  let closed = false;
  const markClosed = () => {
    closed = true;
  };
  clientReq.on('aborted', markClosed);
  clientReq.on('error', (error) => {
    if (error.code !== 'ECONNRESET') console.error(new Date().toISOString(), 'client request', error.message);
  });
  clientRes.on('error', (error) => {
    if (error.code !== 'ECONNRESET') console.error(new Date().toISOString(), 'client response', error.message);
  });

  const headers = { ...clientReq.headers };
  headers.host = clientReq.headers.host || 'content-board.changwankeji.com';
  headers['x-forwarded-host'] = clientReq.headers.host || '';
  headers['x-forwarded-proto'] = 'http';
  headers['x-forwarded-for'] = [
    clientReq.socket.remoteAddress,
    clientReq.headers['x-forwarded-for']
  ].filter(Boolean).join(', ');

  const proxyReq = http.request({
    host: targetHost,
    port: targetPort,
    method: clientReq.method,
    path: clientReq.url,
    headers
  }, (proxyRes) => {
    proxyRes.on('error', (error) => {
      if (error.code !== 'ECONNRESET') console.error(new Date().toISOString(), 'proxy response', error.message);
      clientRes.destroy();
    });
    if (closed || clientRes.destroyed) {
      proxyRes.destroy();
      return;
    }
    clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (error) => {
    if (error.code !== 'ECONNRESET') console.error(new Date().toISOString(), 'proxy request', error.message);
    if (!closed && !clientRes.destroyed && !clientRes.headersSent) {
      clientRes.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      clientRes.end('Bad Gateway');
    } else if (!clientRes.destroyed) {
      clientRes.destroy();
    }
  });

  clientReq.pipe(proxyReq);
});

server.on('upgrade', (req, socket, head) => {
  socket.on('error', (error) => {
    if (error.code !== 'ECONNRESET') console.error(new Date().toISOString(), 'upgrade client', error.message);
  });
  const proxyReq = http.request({
    host: targetHost,
    port: targetPort,
    method: req.method,
    path: req.url,
    headers: req.headers
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    proxySocket.on('error', (error) => {
      if (error.code !== 'ECONNRESET') console.error(new Date().toISOString(), 'upgrade proxy', error.message);
      socket.destroy();
    });
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      ...Object.entries(proxyRes.headers).map(([key, value]) => `${key}: ${value}`),
      '',
      ''
    ].join('\r\n'));
    proxySocket.write(proxyHead);
    socket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', () => socket.destroy());
  proxyReq.end();
});

server.on('clientError', (error, socket) => {
  if (error.code !== 'ECONNRESET') console.error(new Date().toISOString(), 'client error', error.message);
  socket.destroy();
});

server.listen(listenPort, listenHost, () => {
  console.log(`content-board proxy listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`);
});
