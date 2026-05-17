import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /increment happy path [BEHAVIOR]', () => {
  test('GET /increment?value=5 → 200 + {result:6, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(6);
    expect(res.body.operation).toBe('increment');
  });

  test('GET /increment?value=0 → 200 + {result:1, operation:"increment"} (off-by-one 正侧)', async () => {
    const res = await request(app).get('/increment').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(1);
    expect(res.body.operation).toBe('increment');
  });

  test('GET /increment?value=-1 → 200 + {result:0, operation:"increment"} (off-by-one 负侧)', async () => {
    const res = await request(app).get('/increment').query({ value: '-1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('increment');
  });

  test('GET /increment?value=1 → 200 + {result:2, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(2);
  });

  test('GET /increment?value=-5 → 200 + {result:-4, operation:"increment"} (负数合法)', async () => {
    const res = await request(app).get('/increment').query({ value: '-5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-4);
    expect(res.body.operation).toBe('increment');
  });

  test('GET /increment?value=100 → 200 + {result:101}', async () => {
    const res = await request(app).get('/increment').query({ value: '100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(101);
  });

  test('GET /increment?value=-100 → 200 + {result:-99}', async () => {
    const res = await request(app).get('/increment').query({ value: '-100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-99);
  });

  test('GET /increment?value=9007199254740990 → 200 + {result:9007199254740991} (精度上界 happy)', async () => {
    const res = await request(app).get('/increment').query({ value: '9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(9007199254740991);
    expect(res.body.result).toBe(Number.MAX_SAFE_INTEGER);
    expect(res.body.operation).toBe('increment');
  });

  test('GET /increment?value=-9007199254740990 → 200 + {result:-9007199254740989} (精度下界 happy)', async () => {
    const res = await request(app).get('/increment').query({ value: '-9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-9007199254740989);
  });
});

describe('Workstream 1 — GET /increment schema 完整性 [BEHAVIOR]', () => {
  test('成功响应顶层 keys 严格等于 ["operation","result"]', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('operation 字段字面值严格 === "increment"（不许变体）', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.body.operation).toBe('increment');
    // 严防变体污染
    expect(res.body.operation).not.toBe('inc');
    expect(res.body.operation).not.toBe('incr');
    expect(res.body.operation).not.toBe('incremented');
    expect(res.body.operation).not.toBe('plus_one');
    expect(res.body.operation).not.toBe('succ');
    expect(res.body.operation).not.toBe('next');
  });

  test('result 字段类型为 number', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(typeof res.body.result).toBe('number');
  });

  test('成功响应不含禁用字段 incremented/next/successor/n_plus_one/plus_one/succ/inc/incr/incrementation', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    for (const k of ['incremented', 'next', 'successor', 'n_plus_one', 'plus_one', 'succ', 'inc', 'incr', 'incrementation', 'addition']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('成功响应不含 generic 禁用字段 value/input/output/data/payload/answer/meta', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    for (const k of ['value', 'input', 'output', 'data', 'payload', 'response', 'answer', 'out', 'meta']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });

  test('成功响应不含其他 endpoint 字段名 sum/product/quotient/power/remainder/factorial/negation', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    for (const k of ['sum', 'product', 'quotient', 'power', 'remainder', 'factorial', 'negation']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(false);
    }
  });
});

describe('Workstream 1 — GET /increment 上界 / 下界拒 [BEHAVIOR]', () => {
  test('GET /increment?value=9007199254740991 → 400 (上界 +1 拒)', async () => {
    const res = await request(app).get('/increment').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /increment?value=-9007199254740991 → 400 (下界 -1 拒)', async () => {
    const res = await request(app).get('/increment').query({ value: '-9007199254740991' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('GET /increment?value=99999999999999999999 → 400 (远超上界拒)', async () => {
    const res = await request(app).get('/increment').query({ value: '99999999999999999999' });
    expect(res.status).toBe(400);
  });

  test('上界拒错误体顶层 keys 严格等于 ["error"]', async () => {
    const res = await request(app).get('/increment').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });

  test('上界拒错误体不含 result 字段', async () => {
    const res = await request(app).get('/increment').query({ value: '9007199254740991' });
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
  });

  test('上界拒错误体不含 operation 字段', async () => {
    const res = await request(app).get('/increment').query({ value: '9007199254740991' });
    expect(Object.prototype.hasOwnProperty.call(res.body, 'operation')).toBe(false);
  });
});

describe('Workstream 1 — GET /increment strict-schema 拒 [BEHAVIOR]', () => {
  test('GET /increment?value=1.5 → 400 (拒小数)', async () => {
    const res = await request(app).get('/increment').query({ value: '1.5' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=1.0 → 400 (拒带小数点的"整数")', async () => {
    const res = await request(app).get('/increment').query({ value: '1.0' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=1e2 → 400 (拒科学计数法)', async () => {
    const res = await request(app).get('/increment').query({ value: '1e2' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=0xff → 400 (拒十六进制)', async () => {
    const res = await request(app).get('/increment').query({ value: '0xff' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=+5 → 400 (拒前导 +)', async () => {
    const res = await request(app).get('/increment').query({ value: '+5' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=--5 → 400 (拒双重负号)', async () => {
    const res = await request(app).get('/increment').query({ value: '--5' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=5- → 400 (拒尾部负号)', async () => {
    const res = await request(app).get('/increment').query({ value: '5-' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=1,000 → 400 (拒千分位)', async () => {
    const res = await request(app).get('/increment').query({ value: '1,000' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=1 000 → 400 (拒含空格)', async () => {
    const res = await request(app).get('/increment').query({ value: '1 000' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value= → 400 (拒空串)', async () => {
    const res = await request(app).get('/increment').query({ value: '' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=abc → 400 (拒字母)', async () => {
    const res = await request(app).get('/increment').query({ value: 'abc' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=Infinity → 400 (拒 Infinity 字面)', async () => {
    const res = await request(app).get('/increment').query({ value: 'Infinity' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=NaN → 400 (拒 NaN 字面)', async () => {
    const res = await request(app).get('/increment').query({ value: 'NaN' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?value=- → 400 (拒仅负号无数字)', async () => {
    const res = await request(app).get('/increment').query({ value: '-' });
    expect(res.status).toBe(400);
  });

  test('strict 拒错误体不含 result 字段', async () => {
    const res = await request(app).get('/increment').query({ value: 'abc' });
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
  });

  test('strict 拒错误体顶层 keys 严格 = ["error"]', async () => {
    const res = await request(app).get('/increment').query({ value: 'abc' });
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });
});

describe('Workstream 1 — GET /increment 缺参 / 错 query 名 [BEHAVIOR]', () => {
  test('GET /increment（缺 value 参数） → 400', async () => {
    const res = await request(app).get('/increment');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('GET /increment?n=5（错 query 名 n） → 400', async () => {
    const res = await request(app).get('/increment').query({ n: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?x=5（错 query 名 x） → 400', async () => {
    const res = await request(app).get('/increment').query({ x: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?val=5（错 query 名 val） → 400', async () => {
    const res = await request(app).get('/increment').query({ val: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /increment?input=5（错 query 名 input） → 400', async () => {
    const res = await request(app).get('/increment').query({ input: '5' });
    expect(res.status).toBe(400);
  });
});

describe('Workstream 1 — GET /increment 前导 0 [BEHAVIOR]', () => {
  test('GET /increment?value=01 → 200 + {result:2}（不许错用八进制）', async () => {
    const res = await request(app).get('/increment').query({ value: '01' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(2);
    expect(res.body.operation).toBe('increment');
  });

  test('GET /increment?value=-01 → 200 + {result:0}', async () => {
    const res = await request(app).get('/increment').query({ value: '-01' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
  });
});

describe('Workstream 1 — 7 已有路由回归 [BEHAVIOR]', () => {
  test('GET /health → 200 {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 → 200 {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });

  test('GET /multiply?a=2&b=3 → 200 {product:6}', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(6);
  });

  test('GET /divide?a=6&b=3 → 200 {quotient:2}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(2);
  });

  test('GET /power?a=2&b=3 → 200 {power:8}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(8);
  });

  test('GET /modulo?a=7&b=3 → 200 {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '7', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.remainder).toBe(1);
  });

  test('GET /factorial?n=5 → 200 {factorial:120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });
});
