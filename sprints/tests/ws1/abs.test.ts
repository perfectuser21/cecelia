import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import app from '../../../playground/server.js';

// TDD Red 阶段：/abs 端点尚未实现，以下所有 test 应 FAIL
// Generator 实现 /abs 后变 Green

const PORT = 3087;
let server: ReturnType<typeof createServer>;

async function get(path: string) {
  const res = await fetch(`http://localhost:${PORT}${path}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

beforeAll(() => new Promise<void>((resolve) => {
  server = createServer(app).listen(PORT, resolve);
}));

afterAll(() => new Promise<void>((resolve) => {
  server.close(resolve);
}));

describe('Workstream 1 — GET /abs [BEHAVIOR]', () => {
  it('GET /abs?n=-5 返回 {result:5, operation:"abs"}', async () => {
    const { status, body } = await get('/abs?n=-5');
    expect(status).toBe(200);
    expect(body.result).toBe(5);
    expect(body.operation).toBe('abs');
  });

  it('GET /abs?n=0 返回 {result:0, operation:"abs"}', async () => {
    const { status, body } = await get('/abs?n=0');
    expect(status).toBe(200);
    expect(body.result).toBe(0);
    expect(body.operation).toBe('abs');
  });

  it('GET /abs?n=3 返回 {result:3, operation:"abs"}', async () => {
    const { status, body } = await get('/abs?n=3');
    expect(status).toBe(200);
    expect(body.result).toBe(3);
    expect(body.operation).toBe('abs');
  });

  it('result 类型为 number，不为 string', async () => {
    const { body } = await get('/abs?n=-5');
    expect(typeof body.result).toBe('number');
  });

  it('schema keys 恰好为 ["operation","result"]，无多余字段', async () => {
    const { body } = await get('/abs?n=-5');
    expect(Object.keys(body).sort()).toEqual(['operation', 'result']);
  });

  it('禁用字段 value/answer/data 均不存在于 response', async () => {
    const { body } = await get('/abs?n=-5');
    expect(body).not.toHaveProperty('value');
    expect(body).not.toHaveProperty('answer');
    expect(body).not.toHaveProperty('data');
  });

  it('GET /abs?n=foo（非数字）→ HTTP 400', async () => {
    const { status, body } = await get('/abs?n=foo');
    expect(status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('GET /abs（缺少 n 参数）→ HTTP 400', async () => {
    const { status, body } = await get('/abs');
    expect(status).toBe(400);
    expect(body).toHaveProperty('error');
  });
});
