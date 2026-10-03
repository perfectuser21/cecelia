import { describe, it, expect } from 'vitest';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { harness, actualSource, actualOptions, createFactory, closeOwnedResources } from './proxy-fixture.js';

describe.each(['baseline', 'docker-baseline', 'candidate'] as const)('Dashboard actual HTTP proxy compatibility (%s)', mode => {
  it('preserves literal slash filtering for empty, star and malformed URLs without dispatch', async () => {
    for (const url of ['', '*', undefined, 'http://[']) {
      let passed = 0; let destroyed = 0;
      const proxy = createFactory(mode)({ target: 'http://127.0.0.1:1' });
      const req = { url, headers: {}, socket: {} } as never;
      await proxy(req, {} as never, () => { passed++; });
      proxy.upgrade(req, { destroy() { destroyed++; } } as never, Buffer.alloc(0));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(passed).toBe(1); expect(destroyed).toBe(0);
    }
  });

  it('keeps exact Docker5 versus canonical7 multipart status and error-body differences', async () => {
    const error = Object.assign(new Error('owned characterization'), { code: 'HPM_ERR_INVALID_MULTIPART_BOUNDARY' });
    const proxy = createFactory(mode)({ target: 'http://127.0.0.1:1', pathRewrite() { throw error; } });
    let status = 0; let body = '';
    const response = { headersSent: false, writeHead(value: number) { status = value; }, end(value: string) { body = value; } };
    proxy.upgrade({ url: '/failure<path>', headers: { host: 'fixture<host>' } } as never, response as never, Buffer.alloc(0));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(status).toBe(mode === 'docker-baseline' ? 500 : 400);
    expect(body).toBe(mode === 'docker-baseline' ? 'Error occurred while trying to proxy: fixture<host>/failure<path>' : 'Error occurred while trying to proxy: fixture%3Chost%3E/failure%3Cpath%3E');
  });

  it('keeps all seven original options, middleware order and mount-relative paths', async () => {
    expect(actualSource.indexOf("app.use('/api/orchestrator', orchestratorQueueRoutes)")).toBeLessThan(actualSource.indexOf("app.use('/api/orchestrator', orchestratorProxy)"));
    expect(actualSource.indexOf("app.use('/api/v1', n8nApiRoutes)")).toBeLessThan(actualSource.indexOf("app.use('/api/v1', createDashboardProxy"));
    expect(actualSource.indexOf("app.use('/n8n', createDashboardProxy")).toBeLessThan(actualSource.indexOf('app.use(express.json('));
    const f = await harness(undefined, '', mode);
    try {
      for (const [path, expected] of [['/api/quality/state?q=%2F', '/api/state?q=%2F'], ['/api/orchestrator/chat?q=1', '/api/brain/orchestrator/chat?q=1'], ['/api/autumnrice/run', '/api/brain/autumnrice/run'], ['/api/brain/health', '/api/brain/health'], ['/api/v1/foo', '/foo'], ['/api/v1/api/v1/foo', '/v1/foo'], ['/n8n/rest/workflows', '/rest/workflows']]) {
        expect((await f.call(path)).status).toBe(200);
        expect(f.seen.at(-1)?.url).toBe(expected);
        expect(f.seen.at(-1)?.host).toBe(new URL(f.target).host);
      }
      expect((await f.call('/api/orchestrator/queue')).body.toString()).toBe('local queue');
      expect((await f.call('/api/v1/vps-monitor/local')).body.toString()).toBe('local monitor');
      expect(f.seen).toHaveLength(7);
      expect(actualOptions(5, f.target)).toMatchObject({ timeout: 8000, proxyTimeout: 8000 });
      expect(actualOptions(4, f.target)).toMatchObject({ ws: true });
    } finally { await f.cleanup(); }
  });

  it('streams binary and JSON request bodies without the later body parser consuming them', async () => {
    const f = await harness(undefined, '', mode);
    try {
      for (const [body, type] of [[Buffer.from([0, 255, 1, 128]), 'application/octet-stream'], [Buffer.from('{"fixture":true}'), 'application/json']] as const) {
        const reply = await f.call('/api/brain/raw?q=1', body, { 'content-type': type });
        expect(reply.body.equals(body)).toBe(true);
        expect(f.seen.at(-1)?.body.equals(body)).toBe(true);
      }
    } finally { await f.cleanup(); }
  });

  it('passes status, cookies, location and target base path without normalizing the old rewrite', async () => {
    const f = await harness((req, res) => { res.writeHead(307, { 'set-cookie': ['one=1', 'two=2'], location: '/unchanged', 'x-upstream-path': req.url! }); res.end('redirect'); }, '/base', mode);
    try {
      const reply = await f.call('/api/quality/moved');
      expect(reply.status).toBe(307); expect(reply.headers['set-cookie']).toEqual(['one=1', 'two=2']);
      expect(reply.headers.location).toBe('/unchanged'); expect(reply.headers['x-upstream-path']).toBe('/base/api/moved');
    } finally { await f.cleanup(); }
  });

  it('keeps five HTTP default failures at 504 and the actual Autopilot failure at 502 JSON', async () => {
    const f = await harness(undefined, '', mode);
    await new Promise<void>((resolve, reject) => f.backend.close(e => e ? reject(e) : resolve()));
    try {
      for (const path of ['/api/quality/unavailable', '/api/orchestrator/unavailable', '/api/autumnrice/unavailable', '/api/brain/unavailable', '/n8n/unavailable']) {
        const reply = await f.call(path, undefined, { host: 'fixture<host>' });
        expect(reply.status).toBe(504); expect(reply.body.toString()).toContain(mode === 'docker-baseline' ? 'Error occurred while trying to proxy: fixture<host>' : 'Error occurred while trying to proxy: fixture%3Chost%3E');
      }
      const auto = await f.call('/api/v1/unavailable');
      expect(auto.status).toBe(502); expect(auto.headers['content-type']).toBe('application/json');
      expect(JSON.parse(auto.body.toString())).toEqual({ error: 'Autopilot backend unavailable' });
    } finally { await f.cleanup(); }
  });

  it('ends a malformed upstream chunk after headers without writing a second status line', async () => {
    const f = await harness(undefined, '', mode);
    f.backend.removeAllListeners('request');
    f.backend.on('connection', socket => socket.once('data', () => {
      socket.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n');
      f.later(() => socket.end('ZZ\r\n'), 30);
    }));
    try {
      await new Promise<void>((resolve, reject) => {
        const req = request(new URL('/api/brain/partial', f.origin), res => {
          expect(res.statusCode).toBe(200);
          let first = ''; res.on('data', b => { first += b.toString(); });
          let settled = false;
          const done = () => { if (settled) return; settled = true; expect(first).toContain('hello'); resolve(); };
          res.once('end', done); res.once('aborted', done);
        });
        req.on('socket', f.trackSocket);
        const deadline = f.later(() => req.destroy(new Error('partial response deadline')), 3000);
        req.on('close', () => clearTimeout(deadline)); req.on('error', reject); req.end();
      });
    } finally { await f.cleanup(); }
  });

  it('delivers the first SSE chunk before end and closes upstream after a client abort', async () => {
    let ended = false; let upstreamClosed!: () => void;
    const closed = new Promise<void>(resolve => { upstreamClosed = resolve; });
    const f = await harness((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); res.on('close', upstreamClosed); }, '', mode);
    try {
      await new Promise<void>((resolve, reject) => {
        const req = request(new URL('/api/brain/stream', f.origin), res => { res.once('data', chunk => { expect(chunk.toString()).toBe('data: first\n\n'); expect(ended).toBe(false); res.destroy(); resolve(); }); res.on('end', () => { ended = true; }); });
        req.on('socket', f.trackSocket);
        const deadline = f.later(() => req.destroy(new Error('SSE client deadline')), 3000);
        req.on('close', () => clearTimeout(deadline));
        req.on('error', reject); req.end();
      });
      await Promise.race([closed, new Promise<void>((_, reject) => f.later(() => reject(new Error('upstream close deadline')), 2000))]);
    } finally { await f.cleanup(); }
  });

  // Separate servers distinguish each original 8s timer without changing the product budget.
  for (const [label, timeout, proxyTimeout, upload] of [['upstream', undefined, 8000, false], ['incoming', 8000, undefined, true]] as const) {
    it(`enforces the original ${label} 8-second timeout independently`, async () => {
      const f = await harness(() => {}, '', mode);
      const proxy = createFactory(mode)({ ...actualOptions(5, f.target), timeout, proxyTimeout });
      const front = createServer((req, res) => proxy(req as never, res as never, () => {}));
      let incomingTimeouts = 0;
      const sockets = new Set<import('node:net').Socket>(); front.on('connection', s => { sockets.add(s); s.once('close', () => sockets.delete(s)); s.on('timeout', () => incomingTimeouts++); });
      front.listen(0, '127.0.0.1'); await once(front, 'listening'); const a = front.address();
      if (!a || typeof a === 'string') throw new Error('owned server missing');
      const start = Date.now();
      try {
        const result = await new Promise<{ kind: string; status?: number; code?: string }>((resolve, reject) => {
          const req = request({ host: '127.0.0.1', port: a.port, path: '/timeout', method: upload ? 'POST' : 'GET', headers: upload ? { 'content-length': '100' } : {} }, res => { res.resume(); res.on('end', () => resolve({ kind: 'response', status: res.statusCode })); });
          req.on('socket', f.trackSocket);
          req.on('error', (error: NodeJS.ErrnoException) => resolve({ kind: 'error', code: error.code }));
          const limit = f.later(() => { req.destroy(); reject(new Error('fixture deadline')); }, 12000);
          req.on('close', () => clearTimeout(limit));
          if (upload) req.write('x'); else req.end();
        });
        if (upload) { expect(result).toEqual({ kind: 'error', code: 'ECONNRESET' }); expect(incomingTimeouts).toBe(1); }
        else { expect(result).toEqual({ kind: 'response', status: 502 }); expect(incomingTimeouts).toBe(0); }
        expect(Date.now() - start).toBeGreaterThanOrEqual(7500); expect(Date.now() - start).toBeLessThan(11500);
      } finally {
        try {
          await closeOwnedResources([front], sockets);
          expect(sockets.size).toBe(0);
        } finally { await f.cleanup(); }
      }
    }, 15000);
  }
});
