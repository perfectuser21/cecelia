import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import request from 'supertest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — playground server is plain ESM JS
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /negate [BEHAVIOR]', () => {
  test('GET /negate?value=5 → 200 + {result:-5, operation:"negate"} 字面严等', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -5, operation: 'negate' });
  });

  test('GET /negate?value=-7 → 200 + {result:7, operation:"negate"}', async () => {
    const res = await request(app).get('/negate').query({ value: '-7' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 7, operation: 'negate' });
  });

  test('GET /negate?value=0 → 200 + result === 0 且 Object.is(result, -0) === false', async () => {
    const res = await request(app).get('/negate').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 0, operation: 'negate' });
    // JSON.parse 后 -0 会变 0，所以单独验原始 text
    expect(res.text.includes('"result":-0')).toBe(false);
  });

  test('GET /negate?value=-0 → 200 + result === 0 且 raw text 不含 "result":-0', async () => {
    const res = await request(app).get('/negate').query({ value: '-0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 0, operation: 'negate' });
    expect(res.text.includes('"result":-0')).toBe(false);
  });

  test('success 响应顶层 keys 严等 [operation, result]', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('success 响应反向不含 22 个 PRD 禁用响应字段名', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    const forbidden = [
      'negation', 'neg', 'negative', 'opposite', 'invert', 'inverted',
      'minus', 'flipped', 'incremented', 'decremented', 'sum', 'product',
      'quotient', 'power', 'remainder', 'factorial', 'value', 'input',
      'output', 'data', 'payload', 'answer', 'meta',
    ];
    for (const k of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('success 响应 operation 字面 "negate"，PRD 禁用 8 变体一律不等', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('negate');
    for (const v of ['negation', 'neg', 'negative', 'opposite', 'invert', 'flip', 'minus', 'unary_minus']) {
      expect(res.body.operation).not.toBe(v);
    }
  });

  test('精度上界 happy: value=9007199254740990 → result=-9007199254740990', async () => {
    const res = await request(app).get('/negate').query({ value: '9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -9007199254740990, operation: 'negate' });
  });

  test('精度下界 happy: value=-9007199254740990 → result=9007199254740990', async () => {
    const res = await request(app).get('/negate').query({ value: '-9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 9007199254740990, operation: 'negate' });
  });

  test('精度上界拒: value=9007199254740991 → 400', async () => {
    const res = await request(app).get('/negate').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
  });

  test('精度下界拒: value=-9007199254740991 → 400', async () => {
    const res = await request(app).get('/negate').query({ value: '-9007199254740991' });
    expect(res.status).toBe(400);
  });

  test('strict-schema 非法字面 (1.5 / 1e2 / abc / +5 / 空串 / 0x10 / Infinity / NaN) 全 400', async () => {
    for (const bad of ['1.5', '1e2', 'abc', '+5', '', '0x10', 'Infinity', 'NaN']) {
      const res = await request(app).get('/negate').query({ value: bad });
      expect(res.status).toBe(400);
    }
  });

  test('缺 query → 400', async () => {
    const res = await request(app).get('/negate');
    expect(res.status).toBe(400);
  });

  test('PRD 完整 11 个禁用 query 名 (n/x/a/b/num/number/input/v/val/neg/target) 全 400', async () => {
    for (const q of ['n', 'x', 'a', 'b', 'num', 'number', 'input', 'v', 'val', 'neg', 'target']) {
      const res = await request(app).get('/negate').query({ [q]: '5' });
      expect(res.status).toBe(400);
    }
  });

  test('scope 锁死 (r2): value 合法 + 任意额外 query 名（未知/已知/重复）一律 400', async () => {
    // value=5 + 未知名 extra
    const r1 = await request(app).get('/negate?value=5&extra=bar');
    expect(r1.status).toBe(400);
    // value=5 + 另一个未知名 foo
    const r2 = await request(app).get('/negate?value=5&foo=1');
    expect(r2.status).toBe(400);
    // value=5 + 禁用清单内 neg
    const r3 = await request(app).get('/negate?value=5&neg=9');
    expect(r3.status).toBe(400);
    // value=5 + value=10（唯一 query 名意味着不允许重复 key）
    const r4 = await request(app).get('/negate?value=5&value=10');
    expect(r4.status).toBe(400);
    // 错误 body 仍走严 schema：keys 严等 [error]
    expect(Object.keys(r1.body)).toEqual(['error']);
  });

  test('error 路径 value=foo → 400 + error body keys 严等 [error]', async () => {
    const res = await request(app).get('/negate').query({ value: 'foo' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('error body 反向不含 PRD 禁用 4 错误替代名 (message/msg/reason/detail)', async () => {
    const res = await request(app).get('/negate').query({ value: 'foo' });
    expect(res.status).toBe(400);
    for (const k of ['message', 'msg', 'reason', 'detail']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('R1 mitigation (r3): server.js 源码字面含 === "-0" 短路与 === 0 ? 0 : - 三元规范化', () => {
    const serverPath = resolve(__dirname, '../../../../playground/server.js');
    const src = readFileSync(serverPath, 'utf8');
    expect(src).toContain('=== "-0"');
    expect(src).toContain('=== 0 ? 0 : -');
  });
});
