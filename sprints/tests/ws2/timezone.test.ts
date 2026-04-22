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

describe('Workstream 2 — /timezone 端点 [BEHAVIOR]', () => {
  it('GET /timezone 返回 200 且 timezone 字段为非空字符串', async () => {
    const res = await fetch(`${baseUrl}/timezone`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { timezone: string };
    expect(typeof body.timezone).toBe('string');
    expect(body.timezone.length).toBeGreaterThan(0);
  });

  it('GET /timezone 的 timezone 字段等于 Intl.DateTimeFormat().resolvedOptions().timeZone 或 UTC', async () => {
    const res = await fetch(`${baseUrl}/timezone`);
    const body = (await res.json()) as { timezone: string };
    const expected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    expect([expected, 'UTC']).toContain(body.timezone);
  });

  it('GET /timezone 的 Content-Type 为 application/json', async () => {
    const res = await fetch(`${baseUrl}/timezone`);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct.toLowerCase()).toContain('application/json');
  });
});
