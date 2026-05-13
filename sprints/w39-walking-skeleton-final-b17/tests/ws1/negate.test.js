import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('GET /negate (strict-schema + 精度上下界 MAX_SAFE_INTEGER + query 名严字面 value) [BEHAVIOR]', () => {
  // ━━━ Happy path ━━━

  test('GET /negate?value=5 → 200 + {result:-5, operation:"negate"}（字段值字面）', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -5, operation: 'negate' });
  });

  test('GET /negate?value=0 → 200 + {result:0, operation:"negate"}（不漂 -0）', async () => {
    const res = await request(app).get('/negate').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 0, operation: 'negate' });
    // Object.is 区分 0 和 -0
    expect(Object.is(res.body.result, 0)).toBe(true);
    expect(Object.is(res.body.result, -0)).toBe(false);
    // raw body text 不能含 "-0"（防 JSON 序列化漂移）
    expect(res.text).not.toMatch(/"result":\s*-0\b/);
    expect(res.text).not.toMatch(/"result":\s*-?0\.0/);
  });

  test('GET /negate?value=-1 → 200 + {result:1, operation:"negate"}（反向 happy）', async () => {
    const res = await request(app).get('/negate').query({ value: '-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 1, operation: 'negate' });
  });

  test('GET /negate?value=9007199254740991 (MAX_SAFE) → 200 + {result:-9007199254740991, operation:"negate"}', async () => {
    const res = await request(app).get('/negate').query({ value: '9007199254740991' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -9007199254740991, operation: 'negate' });
  });

  test('GET /negate?value=-9007199254740991 (-MAX_SAFE) → 200 + {result:9007199254740991, operation:"negate"}', async () => {
    const res = await request(app).get('/negate').query({ value: '-9007199254740991' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 9007199254740991, operation: 'negate' });
  });

  // ━━━ Schema 完整性 ━━━

  test('success body 顶层 keys 严格等于 ["operation","result"]', async () => {
    const res = await request(app).get('/negate').query({ value: '7' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('success body 反向不含 PRD 完整 21 个禁用字段名', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    const forbidden = [
      'negation', 'negated', 'minus', 'opposite', 'flip', 'invert', 'inverse',
      'incremented', 'decremented', 'prev', 'predecessor',
      'sum', 'product', 'quotient', 'power', 'remainder', 'factorial',
      'value', 'input', 'output', 'data', 'payload', 'answer', 'meta',
    ];
    for (const f of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, f)).toBe(false);
    }
  });

  test('success body operation 字面字符串 "negate"，9 PRD 禁用变体一律不等', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('negate');
    const variants = ['neg', 'negation', 'negated', 'minus', 'opposite', 'flip', 'invert', 'inverse', 'unary_minus'];
    for (const v of variants) {
      expect(res.body.operation).not.toBe(v);
    }
  });

  // ━━━ 精度上下界拒 ━━━

  test('GET /negate?value=9007199254740992 (MAX_SAFE+1) → 400', async () => {
    const res = await request(app).get('/negate').query({ value: '9007199254740992' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /negate?value=-9007199254740992 (-MAX_SAFE-1) → 400', async () => {
    const res = await request(app).get('/negate').query({ value: '-9007199254740992' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  // ━━━ strict-schema 拒 ━━━

  test.each([
    ['value=1.5', { value: '1.5' }],
    ['value=1e2', { value: '1e2' }],
    ['value=abc', { value: 'abc' }],
    ['value=+5', { value: '+5' }],
    ['value=', { value: '' }],
    ['value=0x10', { value: '0x10' }],
    ['value=1,000', { value: '1,000' }],
    ['value=Infinity', { value: 'Infinity' }],
    ['value=NaN', { value: 'NaN' }],
  ])('strict-schema 拒：%s → 400 + body 不含 result/operation', async (_, q) => {
    const res = await request(app).get('/negate').query(q);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  test('GET /negate (缺 value) → 400 + body 不含 result/operation', async () => {
    const res = await request(app).get('/negate');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  // ━━━ PRD 禁用 query 名（9 个）一律 400 ━━━

  test.each([
    ['n=5', { n: '5' }],
    ['x=5', { x: '5' }],
    ['a=5', { a: '5' }],
    ['b=5', { b: '5' }],
    ['num=5', { num: '5' }],
    ['number=5', { number: '5' }],
    ['input=5', { input: '5' }],
    ['v=5', { v: '5' }],
    ['val=5', { val: '5' }],
  ])('PRD 禁用 query 名 %s → 400', async (_, q) => {
    const res = await request(app).get('/negate').query(q);
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
  });

  // ━━━ Error body 严 schema ━━━

  test('error body 顶层 keys 严格等于 ["error"]，且不含 4 PRD 禁用替代名', async () => {
    const res = await request(app).get('/negate').query({ value: 'foo' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    for (const k of ['message', 'msg', 'reason', 'detail']) {
      expect(res.body).not.toHaveProperty(k);
    }
  });
});

// ━━━ 8 路由回归 happy（防 /negate 改动撞坏其他路由）━━━
describe('8 路由回归 happy（/negate 上线后既有路由不退化）[BEHAVIOR]', () => {
  test('/health → 200 {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('/sum?a=2&b=3 → 200 {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });

  test('/multiply?a=7&b=5 → 200 {product:35}', async () => {
    const res = await request(app).get('/multiply').query({ a: '7', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(35);
  });

  test('/divide?a=10&b=2 → 200 {quotient:5}', async () => {
    const res = await request(app).get('/divide').query({ a: '10', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(5);
  });

  test('/power?a=2&b=10 → 200 {power:1024}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(1024);
  });

  test('/modulo?a=10&b=3 → 200 {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.remainder).toBe(1);
  });

  test('/increment?value=5 → 200 {result:6, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 6, operation: 'increment' });
  });

  test('/decrement?value=5 → 200 {result:4, operation:"decrement"}', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 4, operation: 'decrement' });
  });

  test('/factorial?n=5 → 200 {factorial:120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });
});
