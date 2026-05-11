import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /decrement happy + schema 完整性 [BEHAVIOR]', () => {
  test('GET /decrement?value=5 → 200 + {result:4, operation:"decrement"}', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 4, operation: 'decrement' });
    expect(typeof res.body.result).toBe('number');
    expect(typeof res.body.operation).toBe('string');
  });

  test('GET /decrement?value=5 顶层 keys 字面集合 == ["operation","result"]', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('GET /decrement?value=5 operation 字面字符串严格等于 "decrement"', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('decrement');
  });
});

describe('Workstream 1 — GET /decrement off-by-one 零边界 [BEHAVIOR]', () => {
  test('GET /decrement?value=0 → 200 + result=-1（防 generator 漂成 result=0）', async () => {
    const res = await request(app).get('/decrement').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -1, operation: 'decrement' });
  });

  test('GET /decrement?value=1 → 200 + result=0（防 generator 漂成 result=1）', async () => {
    const res = await request(app).get('/decrement').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 0, operation: 'decrement' });
  });

  test('GET /decrement?value=-1 → 200 + result=-2（负数 happy）', async () => {
    const res = await request(app).get('/decrement').query({ value: '-1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -2, operation: 'decrement' });
  });

  test('GET /decrement?value=100 → 200 + result=99', async () => {
    const res = await request(app).get('/decrement').query({ value: '100' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 99, operation: 'decrement' });
  });

  test('GET /decrement?value=-100 → 200 + result=-101', async () => {
    const res = await request(app).get('/decrement').query({ value: '-100' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -101, operation: 'decrement' });
  });
});

describe('Workstream 1 — GET /decrement 精度上下界 happy [BEHAVIOR]', () => {
  test('GET /decrement?value=9007199254740990 → 200 + result=9007199254740989（上界 happy）', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(9007199254740989);
    expect(res.body.operation).toBe('decrement');
  });

  test('GET /decrement?value=-9007199254740990 → 200 + result===Number.MIN_SAFE_INTEGER（下界 happy）', async () => {
    const res = await request(app).get('/decrement').query({ value: '-9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-9007199254740991);
    expect(res.body.result).toBe(Number.MIN_SAFE_INTEGER);
    expect(res.body.operation).toBe('decrement');
  });
});

describe('Workstream 1 — GET /decrement 精度上下界拒 [BEHAVIOR]', () => {
  test('GET /decrement?value=9007199254740991 → 400（上界 +1 拒）', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /decrement?value=-9007199254740991 → 400（下界 -1 拒）', async () => {
    const res = await request(app).get('/decrement').query({ value: '-9007199254740991' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  test('GET /decrement?value=99999999999999999999 → 400（远超上界）', async () => {
    const res = await request(app).get('/decrement').query({ value: '99999999999999999999' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
  });
});

describe('Workstream 1 — GET /decrement strict-schema 拒 [BEHAVIOR]', () => {
  const invalidInputs = [
    { input: '1.5', why: '小数' },
    { input: '1.0', why: '带小数点的整数' },
    { input: '+5', why: '前导 +' },
    { input: '--5', why: '双重负号' },
    { input: '5-', why: '尾部负号' },
    { input: '1e2', why: '科学计数法' },
    { input: '0xff', why: '十六进制' },
    { input: '1,000', why: '千分位逗号' },
    { input: '1 000', why: '含空格' },
    { input: '', why: '空串' },
    { input: 'abc', why: '字母串' },
    { input: 'Infinity', why: 'Infinity 字面' },
    { input: 'NaN', why: 'NaN 字面' },
    { input: '-', why: '仅负号无数字' },
  ];

  for (const { input, why } of invalidInputs) {
    test(`GET /decrement?value=${input} → 400（strict 拒 ${why}）`, async () => {
      const res = await request(app).get('/decrement').query({ value: input });
      expect(res.status).toBe(400);
      expect(res.body).not.toHaveProperty('result');
      expect(res.body).not.toHaveProperty('operation');
    });
  }
});

describe('Workstream 1 — GET /decrement 缺参 / 错 query 名 / query 唯一性 [BEHAVIOR]', () => {
  test('GET /decrement（缺 value 参数） → 400', async () => {
    const res = await request(app).get('/decrement');
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
  });

  test('GET /decrement?n=5（错 query 名 n） → 400', async () => {
    const res = await request(app).get('/decrement').query({ n: '5' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
  });

  test('GET /decrement?a=5（错 query 名 a） → 400', async () => {
    const res = await request(app).get('/decrement').query({ a: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /decrement?value=5&extra=1（多余 query） → 400（query 唯一性）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5', extra: '1' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('result');
  });
});

describe('Workstream 1 — GET /decrement 前导 0 happy [BEHAVIOR]', () => {
  test('GET /decrement?value=01 → 200 + result=0（禁 generator 错用 parseInt(value, 8) 八进制）', async () => {
    const res = await request(app).get('/decrement').query({ value: '01' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 0, operation: 'decrement' });
  });

  test('GET /decrement?value=-01 → 200 + result=-2', async () => {
    const res = await request(app).get('/decrement').query({ value: '-01' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -2, operation: 'decrement' });
  });

  test('GET /decrement?value=-0 → 200 + result=-1（PRD ASSUMPTION 可选择项；round 3 风险 R12 spot check）', async () => {
    const res = await request(app).get('/decrement').query({ value: '-0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: -1, operation: 'decrement' });
  });
});

describe('Workstream 1 — GET /decrement 禁用字段反向（PR-G 死规则继承）[BEHAVIOR]', () => {
  const BANNED = [
    'decremented', 'predecessor', 'prev', 'previous', 'n_minus_one', 'minus_one',
    'pred', 'dec', 'decr', 'decrementation', 'subtraction', 'lower', 'lowered',
    'before', 'earlier', 'value', 'input', 'output', 'data', 'payload', 'answer',
    'meta', 'original', 'sum', 'product', 'quotient', 'power', 'remainder',
    'factorial', 'negation', 'incremented', 'increment',
  ];

  test('GET /decrement?value=5 响应不含任一禁用字段', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    for (const banned of BANNED) {
      expect(res.body).not.toHaveProperty(banned);
    }
  });
});

describe('Workstream 1 — GET /decrement 错误体 schema 完整性 [BEHAVIOR]', () => {
  test('GET /decrement?value=abc 错误体 keys 字面 ["error"]', async () => {
    const res = await request(app).get('/decrement').query({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('错误体不含 message/msg/reason/detail/code 等替代字段名', async () => {
    const res = await request(app).get('/decrement').query({ value: 'abc' });
    expect(res.status).toBe(400);
    for (const banned of ['message', 'msg', 'reason', 'detail', 'details', 'description', 'info', 'code']) {
      expect(res.body).not.toHaveProperty(banned);
    }
  });
});

describe('Workstream 1 — 已有 8 路由回归 [BEHAVIOR]', () => {
  test('GET /health → 200 + {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 → 200 + {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });

  test('GET /multiply?a=7&b=5 → 200 + {product:35}', async () => {
    const res = await request(app).get('/multiply').query({ a: '7', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(35);
  });

  test('GET /divide?a=10&b=2 → 200 + {quotient:5}', async () => {
    const res = await request(app).get('/divide').query({ a: '10', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(5);
  });

  test('GET /power?a=2&b=3 → 200 + {power:8}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(8);
  });

  test('GET /modulo?a=10&b=3 → 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.remainder).toBe(1);
  });

  test('GET /factorial?n=5 → 200 + {factorial:120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });

  test('GET /increment?value=5 → 200 + {result:6, operation:"increment"}（字段名不漂移）', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 6, operation: 'increment' });
  });
});
