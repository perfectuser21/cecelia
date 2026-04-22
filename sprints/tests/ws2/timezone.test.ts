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

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const mod = await loadModule();
  const server: Server = await mod.createServer(0);
  const addr = server.address() as AddressInfo | null;
  if (!addr || typeof addr.port !== 'number') {
    await closeServer(server);
    throw new Error('createServer(0) 未监听');
  }
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
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

describe('Workstream 2 — /timezone 端点 [BEHAVIOR]', () => {
  it('GET /timezone 返回 200 且 timezone 字段为非空字符串', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/timezone`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { timezone: string };
      expect(typeof body.timezone).toBe('string');
      expect(body.timezone.length).toBeGreaterThan(0);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /timezone 返回的 timezone 等于进程 Intl.DateTimeFormat 的 timeZone（UTC 兜底）', async () => {
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/timezone`);
      const body = (await res.json()) as { timezone: string };
      expect(body.timezone).toBe(expected);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /timezone 的 Content-Type 为 application/json', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/timezone`);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
    } finally {
      await closeServer(server);
    }
  });

  it('routes["/timezone"] 为 handler 函数（WS2 在 WS1 骨架上 append-only 追加）', async () => {
    const mod = await loadModule();
    expect(mod.routes).toBeDefined();
    expect(typeof mod.routes['/timezone']).toBe('function');
  });
});
