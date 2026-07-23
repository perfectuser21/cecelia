/**
 * Contract Tests — GET /negate
 * Sprint: 07231722-relay-17d5b58d
 * Task ID: 17d5b58d-29b8-4dbd-977a-82d44427cebf
 *
 * 这些测试是合同断言，实现完成后必须全部通过。
 * 对应 DoD 条目见 contract-dod.md。
 */
import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../playground/server.js';

describe('GET /negate — schema 铁律 [DOD-1][DOD-2][DOD-3]', () => {
  test('[DOD-1] 成功体 keys 严格等于 ["operation","result"]', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('[DOD-2] operation 字面值严格等于 "negate"（禁 negation/neg/negative）', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('negate');
    // 反向确认禁用变体
    expect(res.body.operation).not.toBe('negation');
    expect(res.body.operation).not.toBe('neg');
    expect(res.body.operation).not.toBe('negative');
  });

  test('[DOD-3] result 键名存在，禁用替代键名 negated/value/output/answer/data', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(true);
    for (const k of ['negated', 'value', 'output', 'answer', 'data']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });
});

describe('GET /negate — 运算正确性 [DOD-4][DOD-5][DOD-6]', () => {
  test('[DOD-4] value=5 → result=-5（正数取反）', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-5);
    expect(res.body.operation).toBe('negate');
  });

  test('[DOD-5] value=-5 → result=5（负数取反）', async () => {
    const res = await request(app).get('/negate').query({ value: '-5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(5);
    expect(res.body.operation).toBe('negate');
  });

  test('[DOD-6] value=0 → result=0，且不是 -0（-0 规范化）', async () => {
    const res = await request(app).get('/negate').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(Object.is(res.body.result, -0)).toBe(false);
    expect(res.body.operation).toBe('negate');
  });
});

describe('GET /negate — 精度上界 [DOD-7][DOD-8][DOD-9][DOD-10]', () => {
  test('[DOD-7] value=9007199254740990（上界最大合法值）→ 200 + result=-9007199254740990', async () => {
    const res = await request(app).get('/negate').query({ value: '9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-9007199254740990);
    expect(res.body.operation).toBe('negate');
  });

  test('[DOD-8] value=-9007199254740990（下界最小合法值）→ 200 + result=9007199254740990', async () => {
    const res = await request(app).get('/negate').query({ value: '-9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(9007199254740990);
    expect(res.body.operation).toBe('negate');
  });

  test('[DOD-9] value=9007199254740991（超上界）→ 400', async () => {
    const res = await request(app).get('/negate').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[DOD-10] value=-9007199254740991（超下界）→ 400', async () => {
    const res = await request(app).get('/negate').query({ value: '-9007199254740991' });
    expect(res.status).toBe(400);
  });
});

describe('GET /negate — 错误路径 [DOD-11][DOD-12]', () => {
  test('[DOD-11] value 缺失 → 400 + error 非空字符串', async () => {
    const res = await request(app).get('/negate');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('[DOD-12] 非法格式全部 400（小数/科学计数法/字母/前导+/空串/16进制/Infinity/NaN）', async () => {
    const badInputs = ['1.5', '1e2', 'abc', '+5', '', '0x10', 'Infinity', 'NaN'];
    for (const bad of badInputs) {
      const res = await request(app).get('/negate').query({ value: bad });
      expect(res.status).toBe(400);
    }
  });
});

describe('GET /negate — 错误 query 名 [DOD-13]', () => {
  test('[DOD-13] 错误 query 名全部 400（n/x/a/b/num/number/input/v/val）', async () => {
    const wrongKeys = ['n', 'x', 'a', 'b', 'num', 'number', 'input', 'v', 'val'];
    for (const q of wrongKeys) {
      const res = await request(app).get('/negate').query({ [q]: '5' });
      expect(res.status).toBe(400);
    }
  });
});

describe('GET /negate — 错误体 schema 铁律 [DOD-14]', () => {
  test('[DOD-14] 400 响应 keys 严格等于 ["error"]，不含禁用字段', async () => {
    const res = await request(app).get('/negate').query({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    // 反向确认禁用字段
    for (const k of ['message', 'msg', 'reason', 'detail', 'result', 'operation']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });
});

describe('GET /negate — 现有路由无回退 [DOD-15]', () => {
  test('[DOD-15] /health 不受影响', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('[DOD-15] /increment?value=1 不受影响', async () => {
    const res = await request(app).get('/increment').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(2);
    expect(res.body.operation).toBe('increment');
  });

  test('[DOD-15] /decrement?value=1 不受影响', async () => {
    const res = await request(app).get('/decrement').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('decrement');
  });
});

describe('GET /negate — 前导零不按八进制解析', () => {
  test('value=01 → 200 + result=-1（不按八进制，十进制 1 取反）', async () => {
    const res = await request(app).get('/negate').query({ value: '01' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
    expect(res.body.operation).toBe('negate');
  });

  test('value=-01 → 200 + result=1', async () => {
    const res = await request(app).get('/negate').query({ value: '-01' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
    expect(res.body.operation).toBe('negate');
  });
});
