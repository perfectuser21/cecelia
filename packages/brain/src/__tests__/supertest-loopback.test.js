import { describe, it, expect } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import SupertestTest from 'supertest/lib/test.js';
import { installSupertestLoopback } from './helpers/supertest-loopback.js';

const listen = (server, port, host) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen({ port, host, ipv6Only: host === '::1' }, () => { server.removeListener('error', reject); resolve(); });
});
const close = server => new Promise(resolve => {
  if (!server.listening) return resolve();
  server.close(resolve); server.closeAllConnections();
});

describe('Supertest 测试地址族隔离回归', () => {
  it('IPv6绑定与IPv4已有服务同端口，原Supertest URL确实命中错误服务', async () => {
    const other = http.createServer((_req, res) => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"server":"other"}'); });
    const target = http.createServer((_req, res) => { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end('{"server":"target"}'); });
    try {
      await listen(other, 0, '127.0.0.1'); await listen(target, other.address().port, '::1');
      const response = await request(`http://127.0.0.1:${other.address().port}`).get('/');
      expect(target.address().family).toBe('IPv6');
      expect(response.status).toBe(401); expect(response.body).toEqual({ server: 'other' });
    } finally { await Promise.all([close(target), close(other)]); }
  });

  it('绑定IPv6时请求真实IPv6服务，不能命中同端口的IPv4401服务', async () => {
    const other = http.createServer((_req, res) => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"server":"other"}'); });
    const target = http.createServer((_req, res) => { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end('{"server":"target"}'); });
    try {
      await listen(other, 0, '127.0.0.1'); await listen(target, other.address().port, '::1');
      installSupertestLoopback(SupertestTest);
      const probe = request(target).get('/'); const response = await probe;
      expect(response.status).toBe(422); expect(response.body).toEqual({ server: 'target' });
      expect(probe.url).toContain('http://[::1]:');
    } finally { await Promise.all([close(target), close(other)]); }
  });
  it('自动起服保留原业务响应和自动关闭', async () => {
    const target = http.createServer((_req, res) => { res.writeHead(422); res.end(); });
    try {
      installSupertestLoopback(SupertestTest);
      const probe = request(target).get('/');
      const family = target.address().family;
      expect(probe.url).toContain(family === 'IPv6' ? '[::1]' : '127.0.0.1');
      expect((await probe).status).toBe(422); expect(target.listening).toBe(false);
    } finally { await close(target); }
  });
});
