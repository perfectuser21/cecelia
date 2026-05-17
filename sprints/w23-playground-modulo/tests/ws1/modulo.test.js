import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /modulo (strict-schema + 除零拒 + 符号不变量 oracle) [BEHAVIOR]', () => {
  // === Happy + 边界 ===

  test('GET /modulo?a=5&b=3 → 200 + {remainder:2} (正正整数 happy)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 2 });
    expect(typeof res.body.remainder).toBe('number');
  });

  test('GET /modulo?a=10&b=3 → 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1 });
  });

  test('GET /modulo?a=7&b=2 → 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '7', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1 });
  });

  test('GET /modulo?a=6&b=2 → 200 + {remainder:0} (整除)', async () => {
    const res = await request(app).get('/modulo').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 0 });
  });

  test('GET /modulo?a=5.5&b=2 → 200 + {remainder:1.5} (浮点)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5.5', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1.5 });
  });

  test('GET /modulo?a=0&b=5 → 200 + {remainder:0} (被除数 0)', async () => {
    const res = await request(app).get('/modulo').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 0 });
  });

  test('GET /modulo?a=0&b=-5 → 200 + {remainder:0} (被除数 0 + 负除数)', async () => {
    const res = await request(app).get('/modulo').query({ a: '0', b: '-5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 0 });
  });

  // === 值复算 oracle（沿用 W19~W22 范式）===

  test('GET /modulo?a=1&b=3 → oracle 严格相等 (值复算 #1)', async () => {
    const res = await request(app).get('/modulo').query({ a: '1', b: '3' });
    expect(res.status).toBe(200);
    expect(typeof res.body.remainder).toBe('number');
    expect(res.body.remainder).toBe(Number('1') % Number('3'));
  });

  test('GET /modulo?a=-7&b=2 → oracle 严格相等 (值复算 #2，覆盖负被除数)', async () => {
    const res = await request(app).get('/modulo').query({ a: '-7', b: '2' });
    expect(res.status).toBe(200);
    expect(typeof res.body.remainder).toBe('number');
    expect(res.body.remainder).toBe(Number('-7') % Number('2'));
  });

  // === W23 核心：符号不变量 oracle（JS truncated vs floored mod 区分探针）===

  test('GET /modulo?a=-5&b=3 → 200 + {remainder:-2} (符号跟随被除数 -5，floored mod 实现必挂)', async () => {
    const res = await request(app).get('/modulo').query({ a: '-5', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: -2 });
  });

  test('GET /modulo?a=-5&b=3 → Math.sign(remainder) === -1 (符号不变量探针 #1，负被除数)', async () => {
    const res = await request(app).get('/modulo').query({ a: '-5', b: '3' });
    expect(res.status).toBe(200);
    expect(Math.sign(res.body.remainder)).toBe(Math.sign(Number('-5')));
    expect(Math.sign(res.body.remainder)).toBe(-1);
  });

  test('GET /modulo?a=5&b=-3 → 200 + {remainder:2} (符号跟随被除数 5)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '-3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 2 });
  });

  test('GET /modulo?a=5&b=-3 → Math.sign(remainder) === 1 (符号不变量探针 #2，正被除数 + 负除数)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '-3' });
    expect(res.status).toBe(200);
    expect(Math.sign(res.body.remainder)).toBe(Math.sign(Number('5')));
    expect(Math.sign(res.body.remainder)).toBe(1);
  });

  test('GET /modulo?a=-5&b=-3 → 200 + {remainder:-2} (符号跟随被除数 -5，双负)', async () => {
    const res = await request(app).get('/modulo').query({ a: '-5', b: '-3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: -2 });
  });

  // === Schema oracle (顶层 keys 严格等于 ['remainder']) ===

  test('GET /modulo?a=5&b=3 响应顶层 keys 严格等于 ["remainder"] (schema oracle)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '3' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['remainder']);
  });

  test('GET /modulo?a=5&b=3 成功响应不含禁用同义字段 (反向 schema 完整性探针)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '3' });
    expect(res.status).toBe(200);
    for (const forbidden of [
      'result', 'value', 'answer', 'mod', 'modulo', 'rem', 'rest', 'residue',
      'out', 'output', 'data', 'payload', 'response',
      'sum', 'product', 'quotient', 'power',
      'operation', 'a', 'b', 'input', 'dividend', 'divisor', 'numerator', 'denominator',
    ]) {
      expect(res.body).not.toHaveProperty(forbidden);
    }
  });

  // === 除零拒（W23 唯一 rule-based 拒绝路径，复用 W21 范式）===

  test('GET /modulo?a=5&b=0 → 400 + 非空 error + body 不含 remainder (除零兜底)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=0&b=0 → 400 + 非空 error + body 不含 remainder (0%0 也归此分支)', async () => {
    const res = await request(app).get('/modulo').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=-5&b=0 → 400 + 非空 error + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: '-5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=5&b=0.0 → 400 + body 不含 remainder (b=0.0 也算零)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '0.0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  // === 缺参 ===

  test('GET /modulo?a=5 (缺 b) → 400 + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: '5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?b=3 (缺 a) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // === strict-schema 拒绝 ===

  test('GET /modulo?a=1e3&b=2 (科学计数法) → 400 + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=Infinity&b=2 → 400 + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: 'Infinity', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=2&b=NaN → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '2', b: 'NaN' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=+2&b=3 (前导正号) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '+2', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=.5&b=2 (缺整数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '.5', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=2.&b=3 (缺小数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '2.', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=0xff&b=2 (十六进制) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '0xff', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=1,000&b=2 (千分位) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '1,000', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=&b=3 (空字符串) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=abc&b=3 (非数字) → 400 + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  // === 错误响应 schema 严格（顶层 keys 严格等于 ['error']）===

  test('GET /modulo?a=foo&b=3 错误响应顶层 keys 严格等于 ["error"]', async () => {
    const res = await request(app).get('/modulo').query({ a: 'foo', b: '3' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    for (const forbidden of ['message', 'msg', 'reason', 'detail', 'details', 'description', 'info', 'remainder']) {
      expect(res.body).not.toHaveProperty(forbidden);
    }
  });

  // === 回归（不破坏现有 endpoint）===

  test('REG /health → 200 + {ok:true} (bootstrap 回归)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('REG /sum?a=2&b=3 → 200 + {sum:5} (W19 回归)', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
  });

  test('REG /multiply?a=2&b=3 → 200 + {product:6} (W20 回归)', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
  });

  test('REG /divide?a=6&b=2 → 200 + {quotient:3} (W21 回归)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 3 });
  });

  test('REG /divide?a=5&b=0 → 400 (W21 除零兜底回归)', async () => {
    const res = await request(app).get('/divide').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
  });

  test('REG /power?a=2&b=10 → 200 + {power:1024} (W22 回归)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1024 });
  });

  test('REG /power?a=0&b=0 → 400 (W22 0^0 拒回归)', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
  });
});
