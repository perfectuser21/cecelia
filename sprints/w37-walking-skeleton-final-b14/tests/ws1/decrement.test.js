import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /decrement [BEHAVIOR]', () => {
  test('value=5 → 200 + {result:4, operation:"decrement"} 严字面', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 4, operation: 'decrement' });
  });

  test('success 响应顶层 keys 严格等于 [operation, result]（schema 完整性）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('success 响应反向不含禁用字段名（PRD 完整 19 个）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    const forbidden = ['decremented','prev','predecessor','minus_one','sub_one','incremented','sum','product','quotient','power','remainder','factorial','negation','value','input','output','data','payload','answer','meta'];
    for (const k of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('success 响应 operation 字面 "decrement"，PRD 禁用 8 变体一律不等（Round-2）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('decrement');
    const variants = ['dec','decr','decremented','prev','previous','predecessor','minus_one','sub_one'];
    for (const v of variants) {
      expect(res.body.operation).not.toBe(v);
    }
  });

  test('错误路径 value=foo → 400 + 错误体 keys 严格等于 [error] 且不含 result/operation', async () => {
    const res = await request(app).get('/decrement').query({ value: 'foo' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('错误体反向不含 4 个 PRD 禁用替代错误名 message/msg/reason/detail（Round-2）', async () => {
    const res = await request(app).get('/decrement').query({ value: 'foo' });
    expect(res.status).toBe(400);
    for (const k of ['message','msg','reason','detail']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('精度上界 happy: value=9007199254740990 → 200 + {result:9007199254740989, operation:"decrement"}', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 9007199254740989, operation: 'decrement' });
  });

  test('精度下界 happy: value=-9007199254740990 → 200 + {result:-9007199254740991, operation:"decrement"}', async () => {
    const res = await request(app).get('/decrement').query({ value: '-9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -9007199254740991, operation: 'decrement' });
  });

  test('精度上界拒: value=9007199254740991 → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
  });

  test('精度下界拒: value=-9007199254740991 → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: '-9007199254740991' });
    expect(res.status).toBe(400);
  });

  test('strict-schema 拒小数: value=1.5 → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: '1.5' });
    expect(res.status).toBe(400);
  });

  test('strict-schema 拒科学计数法: value=1e2 → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: '1e2' });
    expect(res.status).toBe(400);
  });

  test('strict-schema 拒前导 +: value=+5 → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: '+5' });
    expect(res.status).toBe(400);
  });

  test('strict-schema 拒空串: value= → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: '' });
    expect(res.status).toBe(400);
  });

  test('strict-schema 拒非数字: value=abc → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: 'abc' });
    expect(res.status).toBe(400);
  });

  test('strict-schema 拒十六进制: value=0x10 → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: '0x10' });
    expect(res.status).toBe(400);
  });

  test('strict-schema 拒 Infinity: value=Infinity → 400', async () => {
    const res = await request(app).get('/decrement').query({ value: 'Infinity' });
    expect(res.status).toBe(400);
  });

  test('缺 value 参数 → 400', async () => {
    const res = await request(app).get('/decrement');
    expect(res.status).toBe(400);
  });

  test('PRD 完整 9 个禁用 query 名 → 全 400（Round-2 — Reviewer Issue 5）', async () => {
    const badQueries = ['n','x','a','b','num','number','input','v','val'];
    for (const q of badQueries) {
      const res = await request(app).get('/decrement').query({ [q]: '5' });
      expect(res.status).toBe(400);
    }
  });

  test('value=0 → 200 + {result:-1, operation:"decrement"}', async () => {
    const res = await request(app).get('/decrement').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -1, operation: 'decrement' });
  });
});

describe('Workstream 1 — 8 路由回归 happy', () => {
  test('GET /health → 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
  test('GET /sum?a=2&b=3 → 200 + {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.body.sum).toBe(5);
  });
  test('GET /multiply?a=7&b=5 → 200 + {product:35}', async () => {
    const res = await request(app).get('/multiply').query({ a: '7', b: '5' });
    expect(res.body.product).toBe(35);
  });
  test('GET /divide?a=10&b=2 → 200 + {quotient:5}', async () => {
    const res = await request(app).get('/divide').query({ a: '10', b: '2' });
    expect(res.body.quotient).toBe(5);
  });
  test('GET /power?a=2&b=10 → 200 + {power:1024}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.body.power).toBe(1024);
  });
  test('GET /modulo?a=10&b=3 → 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.body.remainder).toBe(1);
  });
  test('GET /increment?value=5 → 200 + {result:6, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.body).toEqual({ result: 6, operation: 'increment' });
  });
  test('GET /factorial?n=5 → 200 + {factorial:120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.body.factorial).toBe(120);
  });
});
