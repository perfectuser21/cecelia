import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import app from '../../../../playground/server.js';

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const addr = server.address() as { port: number };
  base = `http://localhost:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('GET /negate [BEHAVIOR]', () => {
  it('value=5 → 200 + {result:-5, operation:"negate"}', async () => {
    const res = await fetch(`${base}/negate?value=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe(-5);
    expect(body.operation).toBe('negate');
  });

  it('response keys 完全等于 ["operation","result"]', async () => {
    const res = await fetch(`${base}/negate?value=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['operation', 'result']);
  });

  it('response 不含禁用字段 negated/negative/inverted', async () => {
    const res = await fetch(`${base}/negate?value=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).not.toHaveProperty('negated');
    expect(body).not.toHaveProperty('negative');
    expect(body).not.toHaveProperty('inverted');
  });

  it('value=abc → 400 + {error: <非空 string>}', async () => {
    const res = await fetch(`${base}/negate?value=abc`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('禁用 query 名 n=5 → 400', async () => {
    const res = await fetch(`${base}/negate?n=5`);
    expect(res.status).toBe(400);
  });

  it('value=-5 → 200 + {result:5, operation:"negate"}（负数取反）', async () => {
    const res = await fetch(`${base}/negate?value=-5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe(5);
    expect(body.operation).toBe('negate');
  });
});
