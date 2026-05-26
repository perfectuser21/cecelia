import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import app from '../../../playground/server.js';

// TDD Red 阶段：/subtract 端点尚未实现，以下所有 test 应 FAIL（404）
// Generator 实现 playground/server.js GET /subtract 后变 Green

const PORT = 3490;
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

describe('Workstream 1 — GET /subtract [BEHAVIOR]', () => {
  it('GET /subtract?a=10&b=3 → 200 + {result:7, operation:"subtract"}（schema 字段值）', async () => {
    const { status, body } = await get('/subtract?a=10&b=3');
    expect(status).toBe(200);
    expect(body.result).toBe(7);
    expect(body.operation).toBe('subtract');
    expect(typeof body.result).toBe('number');
  });

  it('GET /subtract?a=10&b=3 → keys 完全等于 ["operation","result"]（schema 完整性）', async () => {
    const { status, body } = await get('/subtract?a=10&b=3');
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['operation', 'result']);
  });

  it('GET /subtract?a=10&b=3 → 响应不含禁用字段 difference/diff/value/answer/data', async () => {
    const { body } = await get('/subtract?a=10&b=3');
    for (const k of ['difference', 'diff', 'value', 'answer', 'data']) {
      expect(body).not.toHaveProperty(k);
    }
  });

  it('GET /subtract（缺 a）→ 400 + error 字段为字符串（缺参 error path）', async () => {
    const { status, body } = await get('/subtract?b=3');
    expect(status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('GET /subtract（缺 b）→ 400', async () => {
    const { status } = await get('/subtract?a=10');
    expect(status).toBe(400);
  });

  it('GET /subtract?a=1e5&b=3 → 400（非法格式 error path）', async () => {
    const { status } = await get('/subtract?a=1e5&b=3');
    expect(status).toBe(400);
  });

  it('GET /subtract?a=3&b=10 → 200 + {result:-7, operation:"subtract"}（负数结果）', async () => {
    const { status, body } = await get('/subtract?a=3&b=10');
    expect(status).toBe(200);
    expect(body.result).toBe(-7);
    expect(body.operation).toBe('subtract');
  });

  it('GET /subtract?a=5&b=5 → 200 + {result:0, operation:"subtract"}（零结果边界）', async () => {
    const { status, body } = await get('/subtract?a=5&b=5');
    expect(status).toBe(200);
    expect(body.result).toBe(0);
    expect(typeof body.result).toBe('number');
  });
});
