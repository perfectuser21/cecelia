import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /ping happy path [BEHAVIOR]', () => {
  test('GET /ping → 200 + {pong: true}', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  test('GET /ping → .pong 字面布尔 true（不是字符串 "true"、不是数字 1）', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body.pong).toBe(true);
    expect(typeof res.body.pong).toBe('boolean');
    expect(res.body.pong).not.toBe('true');
    expect(res.body.pong).not.toBe(1);
    expect(res.body.pong).not.toBe('ok');
  });

  test('GET /ping → 顶层 keys 字面 ["pong"] 且 length=1（schema 完整性）', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['pong']);
    expect(Object.keys(res.body).length).toBe(1);
  });
});

describe('Workstream 1 — GET /ping 禁用字段反向断言 [BEHAVIOR]', () => {
  test('响应不含任一禁用字段名', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    const forbidden = [
      'ping', 'status', 'ok', 'alive', 'healthy', 'response', 'result',
      'message', 'pong_value', 'is_alive', 'is_ok',
      'data', 'payload', 'body', 'output', 'answer', 'value', 'meta', 'info',
      'sum', 'product', 'quotient', 'power', 'remainder', 'factorial',
      'negation', 'operation'
    ];
    for (const k of forbidden) {
      expect(res.body).not.toHaveProperty(k);
    }
  });

  test('响应不含 timestamp / uptime / request_id 时变字段（确定性）', async () => {
    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('timestamp');
    expect(res.body).not.toHaveProperty('uptime');
    expect(res.body).not.toHaveProperty('request_id');
    expect(res.body).not.toHaveProperty('version');
    expect(res.body).not.toHaveProperty('service');
  });
});

describe('Workstream 1 — GET /ping 反画蛇添足 query 忽略 [BEHAVIOR]', () => {
  test('GET /ping?x=1 → 200 + {pong: true}（带未定义 query 被静默忽略）', async () => {
    const res = await request(app).get('/ping').query({ x: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });

  test('GET /ping?pong=false → 200 + {pong: true}（同名 query 不影响响应）', async () => {
    const res = await request(app).get('/ping').query({ pong: 'false' });
    expect(res.status).toBe(200);
    expect(res.body.pong).toBe(true);
    expect(Object.keys(res.body).sort()).toEqual(['pong']);
  });

  test('GET /ping?garbage=xyz&foo=bar → 200 + {pong: true}', async () => {
    const res = await request(app).get('/ping').query({ garbage: 'xyz', foo: 'bar' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });
});

describe('Workstream 1 — GET /ping 确定性 [BEHAVIOR]', () => {
  test('连续 3 次 GET /ping body 字面相等', async () => {
    const r1 = await request(app).get('/ping');
    const r2 = await request(app).get('/ping');
    const r3 = await request(app).get('/ping');
    expect(r1.body).toEqual(r2.body);
    expect(r2.body).toEqual(r3.body);
    expect(r1.text).toBe(r2.text);
    expect(r2.text).toBe(r3.text);
  });
});

describe('Workstream 1 — 8 路由回归 [BEHAVIOR]', () => {
  test('GET /health → 200 + {ok: true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 → 200 + {sum: 5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });

  test('GET /multiply?a=7&b=5 → 200 + {product: 35}', async () => {
    const res = await request(app).get('/multiply').query({ a: '7', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(35);
  });

  test('GET /divide?a=10&b=2 → 200 + {quotient: 5}', async () => {
    const res = await request(app).get('/divide').query({ a: '10', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(5);
  });

  test('GET /power?a=2&b=10 → 200 + {power: 1024}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(1024);
  });

  test('GET /modulo?a=10&b=3 → 200 + {remainder: 1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.remainder).toBe(1);
  });

  test('GET /factorial?n=5 → 200 + {factorial: 120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });

  test('GET /increment?value=5 → 200 + {result: 6, operation: "increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(6);
    expect(res.body.operation).toBe('increment');
  });
});
