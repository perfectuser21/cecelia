// W28 Workstream 1 — TDD red tests for /divide 响应形态切换
// 当前 playground/server.js /divide 仍返 {quotient: a/b}，本测试集合期望 {result, operation:"divide"} —
// 跑这个文件应该全 RED（≥ 15 条 expect 失败）。Implementation 阶段把 server.js / tests / README 改对后，
// 这些断言全部应转 GREEN。
//
// 不直接编辑 playground/tests/server.test.js（那是 generator 阶段的任务）；本文件是 contract-side TDD red 证据。

import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('W28 [BEHAVIOR] /divide 新响应形态 {result, operation:"divide"}', () => {
  test('GET /divide?a=6&b=2 → 200 + {result:3, operation:"divide"}, keys 集合严格相等', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(3);
    expect(typeof res.body.result).toBe('number');
    expect(res.body.operation).toBe('divide');
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('GET /divide?a=1&b=3 → 200 + oracle 复算 .result === Number("1")/Number("3")', async () => {
    const res = await request(app).get('/divide').query({ a: '1', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(Number('1') / Number('3'));
    expect(res.body.operation).toBe('divide');
  });

  test('GET /divide?a=10&b=3 → 200 + oracle 复算 .result === Number("10")/Number("3")（不能整除浮点）', async () => {
    const res = await request(app).get('/divide').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(Number('10') / Number('3'));
    expect(res.body.operation).toBe('divide');
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('GET /divide?a=1.5&b=0.5 → 200 + {result:3, operation:"divide"}', async () => {
    const res = await request(app).get('/divide').query({ a: '1.5', b: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(3);
    expect(res.body.operation).toBe('divide');
  });

  test('GET /divide?a=-6&b=2 → 200 + {result:-3, operation:"divide"}（负被除数）', async () => {
    const res = await request(app).get('/divide').query({ a: '-6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-3);
    expect(res.body.operation).toBe('divide');
  });

  test('GET /divide?a=6&b=-2 → 200 + {result:-3, operation:"divide"}（负除数）', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '-2' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-3);
    expect(res.body.operation).toBe('divide');
  });

  test('GET /divide?a=-6&b=-2 → 200 + {result:3, operation:"divide"}（双负）', async () => {
    const res = await request(app).get('/divide').query({ a: '-6', b: '-2' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(3);
    expect(res.body.operation).toBe('divide');
  });

  test('GET /divide?a=0&b=5 → 200 + {result:0, operation:"divide"}（被除数为 0 合法）', async () => {
    const res = await request(app).get('/divide').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('divide');
  });
});

describe('W28 [BEHAVIOR] /divide 禁用字段反向 — quotient 不许残留', () => {
  test('GET /divide?a=6&b=2 响应 body 不含 quotient（W21 历史字段消失）', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  test('GET /divide?a=6&b=2 响应 body 不含禁用同义字段 (division/divided/div/ratio/share/value/dividend/divisor)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    for (const k of ['division', 'divided', 'div', 'ratio', 'share', 'value', 'dividend', 'divisor']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('GET /divide?a=6&b=2 响应 body 不含跨端点字段名 (sum/product/power/remainder/factorial)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    for (const k of ['sum', 'product', 'power', 'remainder', 'factorial', 'answer', 'data', 'payload', 'output', 'meta']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });
});

describe('W28 [BEHAVIOR] /divide 错误响应 schema — 不含 result / operation', () => {
  test('GET /divide?a=5&b=0 → 400 + {error: 非空 string}，keys 集合严格 ["error"]，body 不含 result 不含 operation', async () => {
    const res = await request(app).get('/divide').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('GET /divide?a=0&b=0 → 400 + keys 集合严格 ["error"]，不含 result/operation', async () => {
    const res = await request(app).get('/divide').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('GET /divide?a=6&b=0.0 → 400 + keys 集合严格 ["error"]，不含 result/operation', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '0.0' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('GET /divide?a=1e3&b=2 (strict 拒 — 防 Number() 假绿) → 400，body 不含 result/operation', async () => {
    const res = await request(app).get('/divide').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('GET /divide?a=abc&b=3 (非数字) → 400，body 不含 result/operation', async () => {
    const res = await request(app).get('/divide').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });
});

describe('W28 [BEHAVIOR] 回归不破坏 — 其他 7 条端点字段名 / 值一字不变', () => {
  test('GET /health → 200 + {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 → 200 + {sum:5} (W19 形态)', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
  });

  test('GET /multiply?a=2&b=3 → 200 + {product:6} (W20 形态)', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
  });

  test('GET /power?a=2&b=3 → 200 + {power:8} (W22 形态)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 8 });
  });

  test('GET /modulo?a=7&b=3 → 200 + {remainder:1} (W23 形态)', async () => {
    const res = await request(app).get('/modulo').query({ a: '7', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1 });
  });

  test('GET /factorial?n=5 → 200 + {factorial:120} (W24 形态)', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 120 });
  });

  test('GET /increment?value=5 → 200 + {result:6, operation:"increment"} (W26 形态)', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 6, operation: 'increment' });
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });
});
