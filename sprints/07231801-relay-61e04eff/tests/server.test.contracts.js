/**
 * server.test.contracts.js — GET /square 路由合同测试
 *
 * sprint: 07231801-relay-61e04eff
 * task_id: 61e04eff-1fcd-4da8-b1c1-161f81026a76
 *
 * 测试顺序设计：先红后绿
 * - 路由实现前：所有 /square 测试红（404 或 wrong body）
 * - 路由实现后：全绿
 * - 回归块永远绿（/health /sum /increment 不受影响）
 */

import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../playground/server.js';

// ──────────────────────────────────────────────────────────
// BEHAVIOR-1, BEHAVIOR-9, BEHAVIOR-10: 基础成功场景
// ──────────────────────────────────────────────────────────
describe('GET /square 基础成功场景', () => {
  test('value=5 → HTTP 200 + {result:25, operation:"square"}', async () => {
    const res = await request(app).get('/square').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(25);
    expect(res.body.operation).toBe('square');
    expect(typeof res.body.result).toBe('number');
    expect(typeof res.body.operation).toBe('string');
  });

  test('value=-3 → HTTP 200 + {result:9, operation:"square"}（负数）', async () => {
    const res = await request(app).get('/square').query({ value: '-3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(9);
    expect(res.body.operation).toBe('square');
  });

  test('value=0 → HTTP 200 + {result:0, operation:"square"}（零值）', async () => {
    const res = await request(app).get('/square').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('square');
  });

  test('value=10 → HTTP 200 + {result:100}（正常正整数）', async () => {
    const res = await request(app).get('/square').query({ value: '10' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(100);
  });

  test('value=-10 → HTTP 200 + {result:100}（负数结果为正）', async () => {
    const res = await request(app).get('/square').query({ value: '-10' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(100);
  });
});

// ──────────────────────────────────────────────────────────
// BEHAVIOR-2, BEHAVIOR-3: 精度上界（94906265 边界）
// ──────────────────────────────────────────────────────────
describe('GET /square 精度上界', () => {
  test('value=94906265 → HTTP 200（最大合法正整数）', async () => {
    const res = await request(app).get('/square').query({ value: '94906265' });
    expect(res.status).toBe(200);
    expect(typeof res.body.result).toBe('number');
    expect(res.body.operation).toBe('square');
  });

  test('value=94906266 → HTTP 400（超过精度上界）', async () => {
    const res = await request(app).get('/square').query({ value: '94906266' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('value=-94906265 → HTTP 200（最大合法负整数）', async () => {
    const res = await request(app).get('/square').query({ value: '-94906265' });
    expect(res.status).toBe(200);
    expect(typeof res.body.result).toBe('number');
    expect(res.body.operation).toBe('square');
  });

  test('value=-94906266 → HTTP 400（负数超过精度上界）', async () => {
    const res = await request(app).get('/square').query({ value: '-94906266' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────
// BEHAVIOR-4, BEHAVIOR-5: strict-schema 拒绝
// ──────────────────────────────────────────────────────────
describe('GET /square strict-schema 拒绝', () => {
  test('value=1.5（小数）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ value: '1.5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('value=1e2（科学计数法）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ value: '1e2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('value=+5（前导加号）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ value: '+5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('value=abc（字母串）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('value=（空串）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ value: '' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('缺 value 参数 → HTTP 400', async () => {
    const res = await request(app).get('/square');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('value=Infinity → HTTP 400', async () => {
    const res = await request(app).get('/square').query({ value: 'Infinity' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('value=0x10（十六进制）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ value: '0x10' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────
// BEHAVIOR-6: query 名锁死（禁止别名）
// ──────────────────────────────────────────────────────────
describe('GET /square query 名锁死', () => {
  test('?n=5（n 别名）→ HTTP 400（识别为缺参）', async () => {
    const res = await request(app).get('/square').query({ n: '5' });
    expect(res.status).toBe(400);
  });

  test('?x=5（x 别名）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ x: '5' });
    expect(res.status).toBe(400);
  });

  test('?a=5（a 别名）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ a: '5' });
    expect(res.status).toBe(400);
  });

  test('?b=5（b 别名）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ b: '5' });
    expect(res.status).toBe(400);
  });

  test('?num=5（num 别名）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ num: '5' });
    expect(res.status).toBe(400);
  });

  test('?val=5（val 别名）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ val: '5' });
    expect(res.status).toBe(400);
  });

  test('?v=5（v 别名）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ v: '5' });
    expect(res.status).toBe(400);
  });

  test('?input=5（input 别名）→ HTTP 400', async () => {
    const res = await request(app).get('/square').query({ input: '5' });
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────
// BEHAVIOR-7, BEHAVIOR-8: 响应 schema 严格
// ──────────────────────────────────────────────────────────
describe('GET /square 响应 schema 严格', () => {
  test('成功响应 keys 字面集合 === ["operation","result"]（不多不少）', async () => {
    const res = await request(app).get('/square').query({ value: '5' });
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['operation', 'result']);
  });

  test('成功响应不含禁用字段名（sq/squared/pow2/power/sqr/value/input/output/data）', async () => {
    const res = await request(app).get('/square').query({ value: '5' });
    expect(res.status).toBe(200);
    const forbidden = ['sq', 'squared', 'pow2', 'power', 'sqr', 'value', 'input', 'output', 'data', 'payload', 'answer'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, key)).toBe(false);
    }
  });

  test('operation 字面值 === "square"（禁用变体 sq/squared/pow2/power/sqr）', async () => {
    const res = await request(app).get('/square').query({ value: '7' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('square');
    expect(res.body.operation).not.toBe('sq');
    expect(res.body.operation).not.toBe('squared');
    expect(res.body.operation).not.toBe('pow2');
    expect(res.body.operation).not.toBe('power');
    expect(res.body.operation).not.toBe('sqr');
  });

  test('错误响应 keys 字面集合 === ["error"]（禁用 message/msg/reason/detail）', async () => {
    const res = await request(app).get('/square').query({ value: '1.5' });
    expect(res.status).toBe(400);
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['error']);
  });

  test('错误响应不含禁用字段名（message/msg/reason/detail）', async () => {
    const res = await request(app).get('/square');
    expect(res.status).toBe(400);
    const forbidden = ['message', 'msg', 'reason', 'detail', 'details', 'description', 'info', 'code', 'result'];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, key)).toBe(false);
    }
  });
});

// ──────────────────────────────────────────────────────────
// I1 回归：/health /sum /increment 不受影响
// ──────────────────────────────────────────────────────────
describe('GET /square 回归 — 现有路由不受影响', () => {
  test('GET /health 回归 → 200 {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 回归 → 200 {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });

  test('GET /sum 缺参回归 → 400', async () => {
    const res = await request(app).get('/sum');
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=1 回归 → 200 {result:2, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(2);
    expect(res.body.operation).toBe('increment');
  });
});
