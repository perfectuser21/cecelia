import http from 'node:http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

function listen(server, options) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options, resolve);
  });
}

async function close(server) {
  if (server.listening) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function listenPair(desired, foreign, { portForAttempt = () => 0 } = {}) {
  await listen(desired, { host: '::1', port: portForAttempt(0), ipv6Only: true });
  await listen(foreign, { host: '127.0.0.1', port: desired.address().port });
}

describe('Supertest loopback matches the real listener family', () => {
  it('reaches IPv6 DB failure500 rather than a same-port IPv4 service401', async () => {
    let queryCalls = 0;
    let foreignCalls = 0;
    const desired = http.createServer((_req, res) => {
      queryCalls += 1;
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error' }));
    });
    const foreign = http.createServer((_req, res) => {
      foreignCalls += 1;
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'controlled_other_service' }));
    });
    try {
      await listenPair(desired, foreign);
      const probe = request(desired).get('/fixture');
      const res = await probe;
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'internal_error' });
      expect(queryCalls).toBe(1);
      expect(foreignCalls).toBe(0);
      expect(probe.url).toContain('://[::1]:');
    } finally {
      await close(foreign);
      await close(desired);
    }
  });

  it('reserves both address families after a real IPv4-only port collision', async () => {
    let blockerCalls = 0;
    const blocker = http.createServer((_req, res) => { blockerCalls += 1; res.end('existing-listener'); });
    const desired = http.createServer((_req, res) => res.end('desired'));
    const foreign = http.createServer((_req, res) => res.end('foreign'));
    try {
      await listen(blocker, { host: '127.0.0.1', port: 0 });
      const occupied = blocker.address().port;
      await listenPair(desired, foreign, { portForAttempt: (attempt) => attempt === 0 ? occupied : 0 });
      expect(desired.address().port).not.toBe(occupied);
      expect(foreign.address().port).toBe(desired.address().port);
      expect((await request(desired).get('/')).text).toBe('desired');
      expect((await request(foreign).get('/')).text).toBe('foreign');
      expect(blocker.listening).toBe(true);
      expect(blocker.address().port).toBe(occupied);
      expect(blockerCalls).toBe(0);
    } finally {
      await close(foreign);
      await close(desired);
      await close(blocker);
    }
  });

  it('bounds real occupied-port retries and releases its own listeners', async () => {
    const blocker = http.createServer();
    const desired = http.createServer();
    const foreign = http.createServer();
    let attempts = 0;
    try {
      await listen(blocker, { host: '127.0.0.1', port: 0 });
      const occupied = blocker.address().port;
      await expect(listenPair(desired, foreign, {
        maxAttempts: 3,
        portForAttempt: () => { attempts += 1; return occupied; },
      })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(attempts).toBe(3);
      expect(desired.listening).toBe(false);
      expect(foreign.listening).toBe(false);
      expect(blocker.listening).toBe(true);
      expect(blocker.address().port).toBe(occupied);
    } finally {
      await close(foreign);
      await close(desired);
      await close(blocker);
    }
  });

  it('implicit server500 still executes the handler and automatically closes', async () => {
    let queryCalls = 0;
    const probe = request((_req, res) => {
      queryCalls += 1;
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error' }));
    }).get('/fixture');
    const address = probe.app.address();
    const res = await probe;
    expect(probe.url).toContain(address.family === 'IPv6' ? '://[::1]:' : '://127.0.0.1:');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
    expect(queryCalls).toBe(1);
    expect(probe.app.listening).toBe(false);
  });

  it('explicit IPv4 listeners keep their target and caller-owned lifecycle', async () => {
    const server = http.createServer((_req, res) => res.end('ipv4'));
    try {
      await listen(server, { host: '127.0.0.1', port: 0 });
      const probe = request(server).get('/fixture');
      const res = await probe;
      expect(probe.url).toBe(`http://127.0.0.1:${server.address().port}/fixture`);
      expect(res.status).toBe(200);
      expect(res.text).toBe('ipv4');
      expect(server.listening).toBe(true);
    } finally {
      await close(server);
    }
  });

  it('explicit URL targets stay untouched', async () => {
    const server = http.createServer((_req, res) => res.end('url'));
    try {
      await listen(server, { host: '127.0.0.1', port: 0 });
      const target = `http://127.0.0.1:${server.address().port}`;
      const probe = request(target).get('/fixture');
      const res = await probe;
      expect(probe.url).toBe(`${target}/fixture`);
      expect(res.status).toBe(200);
      expect(res.text).toBe('url');
    } finally {
      await close(server);
    }
  });
});
