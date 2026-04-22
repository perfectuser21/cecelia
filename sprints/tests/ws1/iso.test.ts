import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server, AddressInfo } from 'net';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const mod = await import('../../../scripts/harness-dogfood/time-api.js');
  server = await mod.createServer(0);
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('Workstream 1 — /iso 端点 + 错误兜底 [BEHAVIOR]', () => {
  it('GET /iso 返回 200 且 iso 字段符合 ISO 8601 毫秒 Z 格式', async () => {
    const res = await fetch(`${baseUrl}/iso`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { iso: string };
    expect(typeof body.iso).toBe('string');
    expect(body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('GET /iso 的 Content-Type 为 application/json', async () => {
    const res = await fetch(`${baseUrl}/iso`);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct.toLowerCase()).toContain('application/json');
  });

  it('GET /iso 的 iso 字段对应时间与现在相差不超过 5 秒', async () => {
    const before = Date.now();
    const res = await fetch(`${baseUrl}/iso`);
    const after = Date.now();
    const body = (await res.json()) as { iso: string };
    const returnedMs = Date.parse(body.iso);
    expect(Number.isFinite(returnedMs)).toBe(true);
    expect(returnedMs).toBeGreaterThanOrEqual(before - 5000);
    expect(returnedMs).toBeLessThanOrEqual(after + 5000);
  });

  it('GET /unknown-xyz 返回 404 且 body 为 {error:not_found}', async () => {
    const res = await fetch(`${baseUrl}/unknown-xyz`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('POST /iso 返回 405 且 body 为 {error:method_not_allowed}', async () => {
    const res = await fetch(`${baseUrl}/iso`, { method: 'POST' });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('method_not_allowed');
  });

  it('createServer(0) 返回已监听的 server，address().port 为正整数', () => {
    const addr = server.address() as AddressInfo;
    expect(addr).not.toBeNull();
    expect(typeof addr.port).toBe('number');
    expect(Number.isInteger(addr.port)).toBe(true);
    expect(addr.port).toBeGreaterThan(0);
  });
});
