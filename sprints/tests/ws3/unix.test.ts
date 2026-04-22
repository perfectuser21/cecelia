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

describe('Workstream 3 — /unix 端点 [BEHAVIOR]', () => {
  it('GET /unix 返回 200 且 unix 字段为正整数', async () => {
    const res = await fetch(`${baseUrl}/unix`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unix: number };
    expect(typeof body.unix).toBe('number');
    expect(Number.isInteger(body.unix)).toBe(true);
    expect(body.unix).toBeGreaterThan(0);
  });

  it('GET /unix 的 unix 字段与当前秒级时间戳相差不超过 5 秒', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await fetch(`${baseUrl}/unix`);
    const after = Math.floor(Date.now() / 1000);
    const body = (await res.json()) as { unix: number };
    expect(body.unix).toBeGreaterThanOrEqual(before - 5);
    expect(body.unix).toBeLessThanOrEqual(after + 5);
  });

  it('GET /unix 的 Content-Type 为 application/json', async () => {
    const res = await fetch(`${baseUrl}/unix`);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct.toLowerCase()).toContain('application/json');
  });
});
