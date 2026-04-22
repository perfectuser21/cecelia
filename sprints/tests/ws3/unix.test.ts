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

describe('Workstream 3 — /unix 端点 [BEHAVIOR]', () => {
  it('GET /unix 返回 200 且 unix 字段为正整数', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/unix`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { unix: number };
      expect(typeof body.unix).toBe('number');
      expect(Number.isInteger(body.unix)).toBe(true);
      expect(body.unix).toBeGreaterThan(0);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /unix 的 unix 字段与当前秒级时间戳相差不超过 5 秒', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const before = Math.floor(Date.now() / 1000);
      const res = await fetch(`${baseUrl}/unix`);
      const after = Math.floor(Date.now() / 1000);
      const body = (await res.json()) as { unix: number };
      expect(body.unix).toBeGreaterThanOrEqual(before - 5);
      expect(body.unix).toBeLessThanOrEqual(after + 5);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /unix 的 unix 字段不是毫秒级（不应比当前秒时间戳大三位数以上）', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/unix`);
      const body = (await res.json()) as { unix: number };
      const nowSec = Math.floor(Date.now() / 1000);
      expect(body.unix).toBeLessThan(nowSec * 100);
    } finally {
      await closeServer(server);
    }
  });

  it('GET /unix 的 Content-Type 为 application/json', async () => {
    const { server, baseUrl } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/unix`);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct.toLowerCase()).toContain('application/json');
    } finally {
      await closeServer(server);
    }
  });

  it('routes["/unix"] 为 handler 函数（WS3 在 WS1 骨架上 append-only 追加）', async () => {
    const mod = await loadModule();
    expect(mod.routes).toBeDefined();
    expect(typeof mod.routes['/unix']).toBe('function');
  });
});
