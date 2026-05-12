// W34 WS1 — playground GET /subtract Red-state test
// generator TDD red-green 用；evaluator 不读 vitest 输出，只跑 contract-dod-ws1.md 的 manual:bash 命令
import { describe, test, expect } from 'vitest';
import request from 'supertest';
// @ts-expect-error JS module 无 .d.ts，已知 .default 形态
import app from '../../../../playground/server.js';

describe('GET /subtract [BEHAVIOR] — happy path 严 schema + 值复算', () => {
  test('a=5,b=3 → 200 + {result:2, operation:"subtract"}（严等）', async () => {
    const res = await request(app).get('/subtract').query({ a: '5', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(2);
    expect(res.body.operation).toBe('subtract');
    expect(typeof res.body.result).toBe('number');
  });

  test('a=3,b=5 → result === -2（负结果）', async () => {
    const res = await request(app).get('/subtract').query({ a: '3', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
    expect(res.body.operation).toBe('subtract');
  });

  test('a=0,b=0 → result === 0（零边界）', async () => {
    const res = await request(app).get('/subtract').query({ a: '0', b: '0' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('subtract');
  });

  test('a=10,b=10 → result === 0（a===b）', async () => {
    const res = await request(app).get('/subtract').query({ a: '10', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
  });

  test('a=-5,b=3 → result === -8（负被减数）', async () => {
    const res = await request(app).get('/subtract').query({ a: '-5', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-8);
  });

  test('a=5,b=-3 → result === 8（负减数）', async () => {
    const res = await request(app).get('/subtract').query({ a: '5', b: '-3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(8);
  });

  test('a=-5,b=-3 → result === -2（双负）', async () => {
    const res = await request(app).get('/subtract').query({ a: '-5', b: '-3' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
  });

  test('a=1.5,b=0.5 → result === 1（小数合法）', async () => {
    const res = await request(app).get('/subtract').query({ a: '1.5', b: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
  });

  test('a=100.5,b=0.5 → result === 100', async () => {
    const res = await request(app).get('/subtract').query({ a: '100.5', b: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(100);
  });
});

describe('GET /subtract [BEHAVIOR] — 浮点精度严等（禁容差）', () => {
  test('a=0.3,b=0.1 → result === 0.19999999999999998（IEEE 754 损失原样返回）', async () => {
    const res = await request(app).get('/subtract').query({ a: '0.3', b: '0.1' });
    expect(res.status).toBe(200);
    // 独立复算 — toBe 严等，禁 toBeCloseTo
    expect(res.body.result).toBe(Number('0.3') - Number('0.1'));
    expect(res.body.result).toBe(0.19999999999999998);
  });
});

describe('GET /subtract [BEHAVIOR] — schema 完整性 oracle', () => {
  test('成功响应顶层 keys 字面集合等于 ["operation","result"]', async () => {
    const res = await request(app).get('/subtract').query({ a: '7', b: '4' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('operation 字面字符串 "subtract"（严等，不是 contains/startsWith）', async () => {
    const res = await request(app).get('/subtract').query({ a: '8', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('subtract');
  });

  test('result 类型必须是 number', async () => {
    const res = await request(app).get('/subtract').query({ a: '6', b: '4' });
    expect(res.status).toBe(200);
    expect(typeof res.body.result).toBe('number');
  });
});

describe('GET /subtract [BEHAVIOR] — 禁用字段反向不存在', () => {
  const FORBIDDEN = [
    'difference', 'diff', 'minus', 'subtraction', 'sub', 'subtracted', 'delta', 'gap',
    'value', 'input', 'output', 'data', 'payload', 'response', 'answer', 'out', 'meta',
    'sum', 'product', 'quotient', 'power', 'remainder', 'factorial', 'negation', 'incremented', 'next', 'successor',
    'a', 'b',
  ];
  test('成功响应不含 PRD 禁用清单中任一字段名', async () => {
    const res = await request(app).get('/subtract').query({ a: '9', b: '2' });
    expect(res.status).toBe(200);
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(res.body, key)).toBe(false);
    }
  });
});

describe('GET /subtract [BEHAVIOR] — error path 缺参', () => {
  test('GET /subtract（无 query）→ 400 + keys=["error"] + 非空 error 字符串', async () => {
    const res = await request(app).get('/subtract');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('GET /subtract?a=5 (缺 b) → 400 + 错误体规范', async () => {
    const res = await request(app).get('/subtract').query({ a: '5' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });

  test('GET /subtract?b=3 (缺 a) → 400 + 错误体规范', async () => {
    const res = await request(app).get('/subtract').query({ b: '3' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });
});

describe('GET /subtract [BEHAVIOR] — strict-schema 拒非法输入', () => {
  const BAD: Array<{ a: string; b: string; desc: string }> = [
    { a: '1e3', b: '2', desc: '科学计数法' },
    { a: 'Infinity', b: '2', desc: 'Infinity' },
    { a: '2', b: 'NaN', desc: 'NaN' },
    { a: '+5', b: '3', desc: '前导 +' },
    { a: '.5', b: '2', desc: '缺整数部分' },
    { a: '5.', b: '3', desc: '缺小数部分' },
    { a: '0xff', b: '2', desc: '十六进制' },
    { a: '1,000', b: '2', desc: '千分位' },
    { a: '', b: '3', desc: '空串' },
    { a: 'abc', b: '3', desc: '字母串' },
    { a: '--5', b: '3', desc: '双重负号' },
    { a: ' 5 ', b: '3', desc: '空格' },
  ];
  for (const { a, b, desc } of BAD) {
    test(`a="${a}", b="${b}" (${desc}) → 400 + keys=["error"]`, async () => {
      const res = await request(app).get('/subtract').query({ a, b });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body).sort()).toEqual(['error']);
      expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
    });
  }
});

describe('GET /subtract [BEHAVIOR] — 错 query 名拒', () => {
  test('GET /subtract?x=5&y=3 → 400（按缺 a/b 分支）', async () => {
    const res = await request(app).get('/subtract').query({ x: '5', y: '3' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });

  test('GET /subtract?value1=5&value2=3 → 400', async () => {
    const res = await request(app).get('/subtract').query({ value1: '5', value2: '3' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });
});

describe('8 路由回归 — 不动既有 endpoint', () => {
  test('GET /health 仍 → {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  test('GET /sum?a=2&b=3 仍 → {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });
  test('GET /multiply?a=2&b=3 仍 → {product:6}', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(6);
  });
  test('GET /divide?a=6&b=2 仍 → {quotient:3}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(3);
  });
  test('GET /power?a=2&b=3 仍 → {power:8}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(8);
  });
  test('GET /modulo?a=10&b=3 仍 → {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.remainder).toBe(1);
  });
  test('GET /factorial?n=5 仍 → {factorial:120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });
  test('GET /increment?value=5 仍 → {result:6, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(6);
    expect(res.body.operation).toBe('increment');
  });
});
