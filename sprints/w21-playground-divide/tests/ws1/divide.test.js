import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /divide (strict-schema + 除零兜底 + oracle) [BEHAVIOR]', () => {
  // T1 happy 整除
  test('GET /divide?a=6&b=2 → 200 + {quotient:3}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 3 });
    expect(typeof res.body.quotient).toBe('number');
  });

  // T2 oracle：1/3 用同表达式独立复算严格相等（核心 oracle 探针）
  test('GET /divide?a=1&b=3 → 200 + body.quotient === Number("1")/Number("3") (oracle 严格相等)', async () => {
    const res = await request(app).get('/divide').query({ a: '1', b: '3' });
    expect(res.status).toBe(200);
    expect(typeof res.body.quotient).toBe('number');
    expect(res.body.quotient).toBe(Number('1') / Number('3'));
  });

  // T3 负被除数
  test('GET /divide?a=-6&b=2 → 200 + {quotient:-3} (负被除数合法)', async () => {
    const res = await request(app).get('/divide').query({ a: '-6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: -3 });
  });

  // T4 负除数
  test('GET /divide?a=6&b=-2 → 200 + {quotient:-3} (负除数合法)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '-2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: -3 });
  });

  // T5 a=0 合法（被除数为零必须返 200，不能误拒）
  test('GET /divide?a=0&b=5 → 200 + {quotient:0} (被除数为 0 合法)', async () => {
    const res = await request(app).get('/divide').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 0 });
  });

  // T6 标准小数 + oracle 独立复算
  test('GET /divide?a=1.5&b=0.5 → 200 + body.quotient === Number("1.5")/Number("0.5") (小数 + oracle)', async () => {
    const res = await request(app).get('/divide').query({ a: '1.5', b: '0.5' });
    expect(res.status).toBe(200);
    expect(typeof res.body.quotient).toBe('number');
    expect(res.body.quotient).toBe(Number('1.5') / Number('0.5'));
  });

  // T7 除零兜底（核心新增 — W21 主探针）
  test('GET /divide?a=5&b=0 → 400 + 非空 error，body 不含 quotient (除零兜底)', async () => {
    const res = await request(app).get('/divide').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T8 0/0 也必须拒（不能放过）
  test('GET /divide?a=0&b=0 → 400 + 非空 error，body 不含 quotient (0/0 也拒)', async () => {
    const res = await request(app).get('/divide').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T9 b=0.0 也算零（防误用 `b === '0'` 字符串比较漏掉 '0.0'）
  test('GET /divide?a=6&b=0.0 → 400 + 非空 error，body 不含 quotient (b=0.0 也算零)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '0.0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T10 缺 b → 400
  test('GET /divide?a=6 (缺 b) → 400 + 非空 error，body 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: '6' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T11 缺 a → 400
  test('GET /divide?b=2 (缺 a) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T12 双参数都缺 → 400
  test('GET /divide (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T13 strict 拒绝：科学计数法（核心 strict 探针 — 防 Number() 假绿）
  test('GET /divide?a=1e3&b=2 (科学计数法) → 400 + 非空 error，body 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T14 strict 拒绝：Infinity（防 Number.isFinite 路径滑过）
  test('GET /divide?a=Infinity&b=2 → 400 + 非空 error，body 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: 'Infinity', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T15 strict 拒绝：NaN 字符串
  test('GET /divide?a=6&b=NaN → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: 'NaN' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T16 strict 拒绝：前导正号
  test('GET /divide?a=+6&b=2 (前导正号) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '+6', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T17 strict 拒绝：.5 缺整数部分
  test('GET /divide?a=.5&b=2 (小数点缺整数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '.5', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T18 strict 拒绝：6. 缺小数部分
  test('GET /divide?a=6.&b=2 (小数点缺小数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '6.', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T19 strict 拒绝：0xff 十六进制
  test('GET /divide?a=0xff&b=2 (十六进制) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '0xff', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T20 strict 拒绝：千分位
  test('GET /divide?a=1,000&b=2 (千分位) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '1,000', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T21 strict 拒绝：空字符串
  test('GET /divide?a=&b=3 (空字符串) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T22 strict 拒绝：非数字字符串
  test('GET /divide?a=abc&b=3 (非数字) → 400 + error，body 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T23 回归 /health
  test('GET /health 仍 200 + {ok:true} (bootstrap 回归不破坏)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  // T24 回归 /sum (W19)
  test('GET /sum?a=2&b=3 仍 200 + {sum:5} (W19 回归不破坏)', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
  });

  // T25 回归 /multiply happy (W20)
  test('GET /multiply?a=2&b=3 仍 200 + {product:6} (W20 回归不破坏)', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
  });

  // T26 回归 /multiply strict (W20 strict 不被打回)
  test('GET /multiply?a=1e3&b=2 仍 400 (W20 strict-schema 不被打回)', async () => {
    const res = await request(app).get('/multiply').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });
});
