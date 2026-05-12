/**
 * WS1 Red phase — proposer 起草测试，generator 实现前必失败。
 * 覆盖：路由存在、值复算、off-by-one、上下界精度 happy、上下界拒、
 * strict-schema 拒、错 query 名、缺参、前导 0、禁用字段反向、operation 字面字符串、
 * 错误体 schema 完整性、8 路由回归。
 */
import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('GET /decrement — happy 值复算 + schema 完整性 [BEHAVIOR]', () => {
  test('value=5 → 200 + {result:4, operation:"decrement"}', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(4);
    expect(res.body.operation).toBe('decrement');
  });

  test('顶层 keys 字面 sort == ["operation","result"]（schema 完整性）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('value=-5 → 200 + {result:-6}（负侧）', async () => {
    const res = await request(app).get('/decrement').query({ value: '-5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-6);
    expect(res.body.operation).toBe('decrement');
  });

  test('value=100 → 200 + {result:99}', async () => {
    const res = await request(app).get('/decrement').query({ value: '100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(99);
  });

  test('value=-100 → 200 + {result:-101}', async () => {
    const res = await request(app).get('/decrement').query({ value: '-100' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-101);
  });
});

describe('GET /decrement — off-by-one 防盲抄 W26 increment [BEHAVIOR]', () => {
  test('value=0 → 200 + {result:-1}（防 generator 抄 W26 +1）', async () => {
    const res = await request(app).get('/decrement').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-1);
    expect(res.body.operation).toBe('decrement');
  });

  test('value=1 → 200 + {result:0}（off-by-one 关键断言）', async () => {
    const res = await request(app).get('/decrement').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
  });

  test('value=-1 → 200 + {result:-2}（负侧 off-by-one）', async () => {
    const res = await request(app).get('/decrement').query({ value: '-1' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
  });
});

describe('GET /decrement — 精度上下界 happy [BEHAVIOR]', () => {
  test('value=9007199254740990 → 200 + {result:9007199254740989}（精度上界）', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(9007199254740989);
    expect(res.body.operation).toBe('decrement');
  });

  test('value=-9007199254740990 → 200 + {result:-9007199254740991}（精度下界，与 W26 increment 下界 -9007199254740989 不同）', async () => {
    const res = await request(app).get('/decrement').query({ value: '-9007199254740990' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-9007199254740991);
  });
});

describe('GET /decrement — 上下界拒 + 错误体 schema 完整性 [BEHAVIOR]', () => {
  test('value=9007199254740991 → 400（上界+1 拒）', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('value=-9007199254740991 → 400（下界-1 拒）', async () => {
    const res = await request(app).get('/decrement').query({ value: '-9007199254740991' });
    expect(res.status).toBe(400);
  });

  test('value=99999999999999999999 → 400（远超上界拒）', async () => {
    const res = await request(app).get('/decrement').query({ value: '99999999999999999999' });
    expect(res.status).toBe(400);
  });

  test('上界拒错误体顶层 keys == ["error"]，不含 result，不含 operation', async () => {
    const res = await request(app).get('/decrement').query({ value: '9007199254740991' });
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });
});

describe('GET /decrement — strict-schema 拒 [BEHAVIOR]', () => {
  const cases = [
    ['1.5', '小数'],
    ['1.0', '带小数点的整数'],
    ['+5', '前导 +'],
    ['--5', '双重负号'],
    ['5-', '尾部负号'],
    ['1e2', '科学计数法'],
    ['0xff', '十六进制'],
    ['1,000', '千分位'],
    ['1 000', '含空格'],
    ['', '空串'],
    ['abc', '字母'],
    ['Infinity', 'Infinity 字面'],
    ['NaN', 'NaN 字面'],
    ['-', '仅负号无数字'],
  ];

  for (const [v, label] of cases) {
    test(`value=${JSON.stringify(v)} (${label}) → 400`, async () => {
      const res = await request(app).get('/decrement').query({ value: v });
      expect(res.status).toBe(400);
    });
  }

  test('strict 拒错误体顶层 keys == ["error"]', async () => {
    const res = await request(app).get('/decrement').query({ value: '1.5' });
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });
});

describe('GET /decrement — 错 query 名 + 缺参 [BEHAVIOR]', () => {
  test('缺 value 参数（无 query）→ 400', async () => {
    const res = await request(app).get('/decrement');
    expect(res.status).toBe(400);
  });

  test('错 query 名 n=5 → 400', async () => {
    const res = await request(app).get('/decrement').query({ n: '5' });
    expect(res.status).toBe(400);
  });

  test('错 query 名 a=5 → 400', async () => {
    const res = await request(app).get('/decrement').query({ a: '5' });
    expect(res.status).toBe(400);
  });

  test('错 query 名 x=5 → 400', async () => {
    const res = await request(app).get('/decrement').query({ x: '5' });
    expect(res.status).toBe(400);
  });

  test('多余 query 字段 value=5&extra=1 → 400（query keys 必须恰好 [value]）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5', extra: '1' });
    expect(res.status).toBe(400);
  });
});

describe('GET /decrement — 前导 0 happy（十进制归一化，非八进制） [BEHAVIOR]', () => {
  test('value=01 → 200 + {result:0}', async () => {
    const res = await request(app).get('/decrement').query({ value: '01' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(res.body.operation).toBe('decrement');
  });

  test('value=-01 → 200 + {result:-2}', async () => {
    const res = await request(app).get('/decrement').query({ value: '-01' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-2);
  });

  test('value=007 → 200 + {result:6}（不许错用八进制解析为 7）', async () => {
    const res = await request(app).get('/decrement').query({ value: '007' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(6);
  });
});

describe('GET /decrement — 禁用字段名反向断言（PR-G 死规则黑名单） [BEHAVIOR]', () => {
  test('response 不含任一禁用字段名（PRD SSOT 并集去重 35 项）', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    // PRD「禁用响应字段名」段完整 SSOT：首要禁用 11 + 泛 generic 9 + 复用其他 endpoint 7 + 错误时禁用替代名 8 = 35
    const forbidden = [
      // 首要禁用 (11)
      'decremented', 'previous', 'prev', 'predecessor',
      'n_minus_one', 'minus_one', 'pred', 'dec', 'decr',
      'decrementation', 'subtraction',
      // 泛 generic (9)
      'value', 'input', 'output', 'data', 'payload',
      'response', 'answer', 'out', 'meta',
      // 复用其他 endpoint 字段名 (7)
      'sum', 'product', 'quotient', 'power', 'remainder',
      'factorial', 'negation',
      // 错误时禁用替代名 (8)
      'message', 'msg', 'reason', 'detail',
      'details', 'description', 'info', 'code',
    ];
    expect(forbidden.length).toBe(35);
    for (const k of forbidden) {
      expect(res.body, `禁用字段 ${k} 不应出现`).not.toHaveProperty(k);
    }
  });

  test('operation 字面字符串严格相等 "decrement"，禁用变体', async () => {
    const res = await request(app).get('/decrement').query({ value: '5' });
    expect(res.body.operation).toBe('decrement');
    const variants = [
      'dec', 'decr', 'decremented', 'decrementation',
      'minus_one', 'sub_one', 'subtract_one',
      'pred', 'predecessor', 'prev', 'previous',
    ];
    for (const v of variants) {
      expect(res.body.operation, `operation 不应是变体 ${v}`).not.toBe(v);
    }
  });
});

describe('GET /decrement — 8 路由回归 [BEHAVIOR]', () => {
  test('/health 仍 200 + {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('/sum?a=3&b=4 仍 200 + {sum:7}', async () => {
    const res = await request(app).get('/sum').query({ a: '3', b: '4' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(7);
  });

  test('/multiply?a=3&b=4 仍 200 + {product:12}', async () => {
    const res = await request(app).get('/multiply').query({ a: '3', b: '4' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(12);
  });

  test('/divide?a=12&b=4 仍 200 + {quotient:3}', async () => {
    const res = await request(app).get('/divide').query({ a: '12', b: '4' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(3);
  });

  test('/power?a=2&b=10 仍 200 + {power:1024}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(1024);
  });

  test('/modulo?a=10&b=3 仍 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.remainder).toBe(1);
  });

  test('/factorial?n=5 仍 200 + {factorial:120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });

  test('/increment?value=5 仍 200 + {result:6, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(6);
    expect(res.body.operation).toBe('increment');
  });
});
