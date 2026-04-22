import { describe, it, expect } from 'vitest';
import type { Server, AddressInfo } from 'net';

const TIME_API_SPEC = '../../../scripts/harness-dogfood/time-api.js';

async function loadModule(): Promise<any> {
  const mod = await import(TIME_API_SPEC);
  if (!mod || typeof mod.createServer !== 'function') {
    throw new Error('time-api.js 未导出 createServer 函数');
  }
  return mod;
}

async function startServer(): Promise<{ server: Server; baseUrl: string; port: number }> {
  const mod = await loadModule();
  const server: Server = await mod.createServer(0);
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr.port !== 'number' || addr.port <= 0) {
    await closeServer(server);
    throw new Error('createServer(0) 返回的 server 未监听或端口非法');
  }
  return { server, baseUrl: `http://127.0.0.1:${addr.port}`, port: addr.port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

describe('Workstream 1 — /iso + 404/405 骨架 [BEHAVIOR]', () => {
  it('GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/iso`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { iso: string };
      expect(typeof body.iso).toBe('string');
      expect(body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /iso 的 Content-Type 为 application/json', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/iso`);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
    } finally {
      await closeServer(server);
    }
  });

  it('GET /iso 的 iso 字段对应时间与当前时间相差不超过 5 秒', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const before = Date.now();
      const res = await fetch(`${baseUrl}/iso`);
      const after = Date.now();
      const body = (await res.json()) as { iso: string };
      const returnedMs = Date.parse(body.iso);
      expect(Number.isFinite(returnedMs)).toBe(true);
      expect(returnedMs).toBeGreaterThanOrEqual(before - 5000);
      expect(returnedMs).toBeLessThanOrEqual(after + 5000);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /unknown-xyz 返回 404 且 body 为 {error:"not_found"}', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/unknown-xyz`);
      expect(res.status).toBe(404);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('not_found');
    } finally {
      await closeServer(server);
    }
  });

  it('POST /iso 返回 405 且 body 为 {error:"method_not_allowed"}', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/iso`, { method: 'POST' });
      expect(res.status).toBe(405);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('method_not_allowed');
    } finally {
      await closeServer(server);
    }
  });

  it('createServer(0) 返回已监听的 server，address().port 为正整数', async () => {
    const { server, port } = await startServer();
    try {
      expect(Number.isInteger(port)).toBe(true);
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
    } finally {
      await closeServer(server);
    }
  });

  it('routes 对象导出：WS2/3/4 的 append-only 锚点契约（WS1 阶段只有 /iso）', async () => {
    const mod = await loadModule();
    expect(mod.routes).toBeDefined();
    expect(typeof mod.routes).toBe('object');
    expect(typeof mod.routes['/iso']).toBe('function');
  });
});
