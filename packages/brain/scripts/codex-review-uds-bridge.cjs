'use strict';

const net = require('node:net');

const SOCKET_PATH = '/broker/proxy.sock';
const READY_PATH = '/tmp/codex-review-egress.ready';
const LISTEN_PORT = 3128;

const active = new Set();
const server = net.createServer((client) => {
  const upstream = net.createConnection({ path: SOCKET_PATH });
  active.add(client);
  active.add(upstream);
  const closeBoth = () => {
    client.destroy();
    upstream.destroy();
    active.delete(client);
    active.delete(upstream);
  };
  client.once('error', closeBoth);
  upstream.once('error', closeBoth);
  client.once('close', () => active.delete(client));
  upstream.once('close', () => active.delete(upstream));
  client.pipe(upstream);
  upstream.pipe(client);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  require('node:fs').writeFileSync(READY_PATH, 'ready', {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
});

const shutdown = () => {
  for (const socket of active) socket.destroy();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
