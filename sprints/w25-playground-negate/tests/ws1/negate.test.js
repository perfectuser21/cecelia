import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /negate (浮点 strict-schema + 一元负号 + 跨调用自反不变量 oracle) [BEHAVIOR]', () => {
  // === Happy 正整数路径（Step 1 锚点）===

  test('GET /negate?n=5 → 200 + {negation:-5}（happy 正整数）', async () => {
    const res = await request(app).get('/negate').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: -5 });
    expect(typeof res.body.negation).toBe('number');
  });

  test('GET /negate?n=-5 → 200 + {negation:5}（负数路径，负的负是正）', async () => {
    const res = await request(app).get('/negate').query({ n: '-5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: 5 });
  });

  test('GET /negate?n=0 → 200 + {negation:0}（零退化为身份）', async () => {
    const res = await request(app).get('/negate').query({ n: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: 0 });
  });

  test('GET /negate?n=-0 → 200 + {negation:0}（JSON 下负零规范成 0）', async () => {
    const res = await request(app).get('/negate').query({ n: '-0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: 0 });
  });

  test('GET /negate?n=0.0 → 200 + {negation:0}（小数零）', async () => {
    const res = await request(app).get('/negate').query({ n: '0.0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: 0 });
  });

  test('GET /negate?n=-0.0 → 200 + {negation:0}（小数负零）', async () => {
    const res = await request(app).get('/negate').query({ n: '-0.0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: 0 });
  });

  test('GET /negate?n=3.14 → 200 + {negation:-3.14}（正小数；位运算实现必断）', async () => {
    const res = await request(app).get('/negate').query({ n: '3.14' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: -3.14 });
  });

  test('GET /negate?n=-3.14 → 200 + {negation:3.14}（负小数）', async () => {
    const res = await request(app).get('/negate').query({ n: '-3.14' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: 3.14 });
  });

  test('GET /negate?n=100 → 200 + {negation:-100}（大正整数）', async () => {
    const res = await request(app).get('/negate').query({ n: '100' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: -100 });
  });

  test('GET /negate?n=-100 → 200 + {negation:100}（大负整数）', async () => {
    const res = await request(app).get('/negate').query({ n: '-100' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: 100 });
  });

  test('GET /negate?n=1.5 → 200 + {negation:-1.5}（小数 IEEE 精确）', async () => {
    const res = await request(app).get('/negate').query({ n: '1.5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: -1.5 });
  });

  test('GET /negate?n=05 → 200 + {negation:-5}（前导 0 strict 通过且等价）', async () => {
    const res = await request(app).get('/negate').query({ n: '05' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ negation: -5 });
  });

  // === oracle 值复算（独立 -Number(n) 复算，覆盖正/负整数 + 正/负小数）===

  test('GET /negate?n=7 → oracle 独立复算 -7（正整数 oracle）', async () => {
    const res = await request(app).get('/negate').query({ n: '7' });
    expect(res.status).toBe(200);
    const oracle = -Number('7');
    expect(res.body.negation).toBe(oracle);
    expect(res.body.negation).toBe(-7);
  });

  test('GET /negate?n=-9 → oracle 独立复算 9（负整数 oracle）', async () => {
    const res = await request(app).get('/negate').query({ n: '-9' });
    expect(res.status).toBe(200);
    const oracle = -Number('-9');
    expect(res.body.negation).toBe(oracle);
    expect(res.body.negation).toBe(9);
  });

  test('GET /negate?n=2.5 → oracle 独立复算 -2.5（正小数 oracle）', async () => {
    const res = await request(app).get('/negate').query({ n: '2.5' });
    expect(res.status).toBe(200);
    const oracle = -Number('2.5');
    expect(res.body.negation).toBe(oracle);
    expect(res.body.negation).toBe(-2.5);
  });

  test('GET /negate?n=-7.5 → oracle 独立复算 7.5（负小数 oracle）', async () => {
    const res = await request(app).get('/negate').query({ n: '-7.5' });
    expect(res.status).toBe(200);
    const oracle = -Number('-7.5');
    expect(res.body.negation).toBe(oracle);
    expect(res.body.negation).toBe(7.5);
  });

  // === W25 核心：跨调用自反不变量 f(f(n)) === Number(n)（chained 双 supertest）===

  test('跨调用自反 oracle: f(f(5)) === 5（chained 两次 supertest，正整数闭环）', async () => {
    const r1 = await request(app).get('/negate').query({ n: '5' });
    expect(r1.status).toBe(200);
    expect(r1.body.negation).toBe(-5);
    const r2 = await request(app).get('/negate').query({ n: String(r1.body.negation) });
    expect(r2.status).toBe(200);
    expect(r2.body.negation).toBe(Number('5'));
    expect(r2.body.negation).toBe(5);
  });

  test('跨调用自反 oracle: f(f(-3.14)) === -3.14（chained 负小数闭环；位运算/绝对值实现必断）', async () => {
    const r1 = await request(app).get('/negate').query({ n: '-3.14' });
    expect(r1.status).toBe(200);
    expect(r1.body.negation).toBe(3.14);
    const r2 = await request(app).get('/negate').query({ n: String(r1.body.negation) });
    expect(r2.status).toBe(200);
    expect(r2.body.negation).toBe(Number('-3.14'));
    expect(r2.body.negation).toBe(-3.14);
  });

  test('跨调用自反 oracle: f(f(0)) === 0（零退化为身份；自反闭环仍成立）', async () => {
    const r1 = await request(app).get('/negate').query({ n: '0' });
    expect(r1.status).toBe(200);
    expect(r1.body.negation).toBe(0);
    const r2 = await request(app).get('/negate').query({ n: String(r1.body.negation) });
    expect(r2.status).toBe(200);
    expect(r2.body.negation).toBe(Number('0'));
    expect(r2.body.negation).toBe(0);
  });

  test('跨调用自反 oracle: f(f(100)) === 100（chained 大正整数闭环，额外覆盖）', async () => {
    const r1 = await request(app).get('/negate').query({ n: '100' });
    expect(r1.status).toBe(200);
    expect(r1.body.negation).toBe(-100);
    const r2 = await request(app).get('/negate').query({ n: String(r1.body.negation) });
    expect(r2.status).toBe(200);
    expect(r2.body.negation).toBe(Number('100'));
    expect(r2.body.negation).toBe(100);
  });

  // === strict-schema 拒（^-?\d+(\.\d+)?$ 白名单外全 400）===

  test('GET /negate (缺参) → 400 + 非空 error，body 不含 negation', async () => {
    const res = await request(app).get('/negate');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=+5 (前导 +) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '+5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=--5 (双负号) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '--5' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=5. (点后无数字) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '5.' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=.5 (点前无数字) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '.5' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=1e2 (科学计数法) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '1e2' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=0xff (十六进制) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '0xff' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=1,000 (千分位) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '1,000' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n= (空串) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=abc (字母串) → 400', async () => {
    const res = await request(app).get('/negate').query({ n: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=Infinity → 400', async () => {
    const res = await request(app).get('/negate').query({ n: 'Infinity' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?n=NaN → 400', async () => {
    const res = await request(app).get('/negate').query({ n: 'NaN' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  // === schema 完整性 oracle ===

  test('成功响应 schema 完整性: Object.keys 严等 ["negation"]', async () => {
    const res = await request(app).get('/negate').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['negation']);
  });

  test('错误响应 schema 完整性: Object.keys 严等 ["error"]', async () => {
    const res = await request(app).get('/negate').query({ n: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });

  test('错误响应 body 不含 negation 字段（防混合污染）', async () => {
    const res = await request(app).get('/negate').query({ n: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('negation');
  });

  // === query 别名锁死（PR-E 验收命门） ===

  test('GET /negate?value=5 (query 别名 value) → 400 + body 不含 negation', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?x=5 (query 别名 x) → 400 + body 不含 negation', async () => {
    const res = await request(app).get('/negate').query({ x: '5' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?num=5 (query 别名 num) → 400', async () => {
    const res = await request(app).get('/negate').query({ num: '5' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  test('GET /negate?input=5 (query 别名 input) → 400', async () => {
    const res = await request(app).get('/negate').query({ input: '5' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'negation')).toBe(false);
  });

  // === type 断言（防字符串型 "-5"） ===

  test('GET /negate?n=5 响应 negation 必须是 number 类型（非字符串 "-5"）', async () => {
    const res = await request(app).get('/negate').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(typeof res.body.negation).toBe('number');
  });

  test('GET /negate?n=-3.14 响应 negation 必须是 number 类型（非字符串 "3.14"）', async () => {
    const res = await request(app).get('/negate').query({ n: '-3.14' });
    expect(res.status).toBe(200);
    expect(typeof res.body.negation).toBe('number');
  });

  // === 旧 7 路由回归（防 cascade 假绿） ===

  test('回归 /health → 200 {ok: true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('回归 /sum?a=2&b=3 → 200 {sum: 5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
  });

  test('回归 /multiply?a=2&b=3 → 200 {product: 6}', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
  });

  test('回归 /divide?a=6&b=2 → 200 {quotient: 3}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 3 });
  });

  test('回归 /power?a=2&b=10 → 200 {power: 1024}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1024 });
  });

  test('回归 /modulo?a=10&b=3 → 200 {remainder: 1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1 });
  });

  test('回归 /factorial?n=5 → 200 {factorial: 120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 120 });
  });
});
