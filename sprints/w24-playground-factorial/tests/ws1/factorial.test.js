import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /factorial (int-only strict-schema + 上界 18 拒 + 跨调用递推不变量 oracle) [BEHAVIOR]', () => {
  // === Happy 中段 + 严 schema ===

  test('GET /factorial?n=5 → 200 + {factorial:120}（happy 中段）', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 120 });
    expect(typeof res.body.factorial).toBe('number');
  });

  test('GET /factorial?n=2 → 200 + {factorial:2}', async () => {
    const res = await request(app).get('/factorial').query({ n: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 2 });
  });

  test('GET /factorial?n=3 → 200 + {factorial:6}', async () => {
    const res = await request(app).get('/factorial').query({ n: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 6 });
  });

  test('GET /factorial?n=10 → 200 + {factorial:3628800}', async () => {
    const res = await request(app).get('/factorial').query({ n: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 3628800 });
  });

  test('GET /factorial?n=12 → 200 + {factorial:479001600}', async () => {
    const res = await request(app).get('/factorial').query({ n: '12' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 479001600 });
  });

  // === 数学定义边界 0!=1, 1!=1（防 off-by-one）===

  test('GET /factorial?n=0 → 200 + {factorial:1}（数学定义 0!=1，空积）', async () => {
    const res = await request(app).get('/factorial').query({ n: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 1 });
  });

  test('GET /factorial?n=1 → 200 + {factorial:1}（1!=1）', async () => {
    const res = await request(app).get('/factorial').query({ n: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 1 });
  });

  // === 精度上界 n=18 严等 6402373705728000 ===

  test('GET /factorial?n=18 → 200 + {factorial:6402373705728000}（精度上界，< MAX_SAFE_INTEGER）', async () => {
    const res = await request(app).get('/factorial').query({ n: '18' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 6402373705728000 });
    expect(res.body.factorial).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isInteger(res.body.factorial)).toBe(true);
  });

  // === oracle 值复算（独立 product 计算）===

  test('GET /factorial?n=6 → oracle 独立复算 720', async () => {
    const res = await request(app).get('/factorial').query({ n: '6' });
    expect(res.status).toBe(200);
    let oracle = 1;
    for (let i = 2; i <= 6; i++) oracle *= i;
    expect(res.body.factorial).toBe(oracle);
    expect(res.body.factorial).toBe(720);
  });

  test('GET /factorial?n=8 → oracle 独立复算 40320', async () => {
    const res = await request(app).get('/factorial').query({ n: '8' });
    expect(res.status).toBe(200);
    let oracle = 1;
    for (let i = 2; i <= 8; i++) oracle *= i;
    expect(res.body.factorial).toBe(oracle);
    expect(res.body.factorial).toBe(40320);
  });

  test('GET /factorial?n=18 → oracle 独立复算精度边界', async () => {
    const res = await request(app).get('/factorial').query({ n: '18' });
    expect(res.status).toBe(200);
    let oracle = 1;
    for (let i = 2; i <= 18; i++) oracle *= i;
    expect(res.body.factorial).toBe(oracle);
    expect(res.body.factorial).toBe(6402373705728000);
  });

  // === W24 核心：跨调用递推不变量 f(n) === n * f(n-1) ===

  test('跨调用递推 oracle: f(5) === 5 * f(4) === 120（小数）', async () => {
    const res5 = await request(app).get('/factorial').query({ n: '5' });
    const res4 = await request(app).get('/factorial').query({ n: '4' });
    expect(res5.status).toBe(200);
    expect(res4.status).toBe(200);
    expect(res5.body.factorial).toBe(5 * res4.body.factorial);
    expect(res5.body.factorial).toBe(120);
    expect(res4.body.factorial).toBe(24);
  });

  test('跨调用递推 oracle: f(18) === 18 * f(17)（精度上界，Stirling/Lanczos 必断）', async () => {
    const res18 = await request(app).get('/factorial').query({ n: '18' });
    const res17 = await request(app).get('/factorial').query({ n: '17' });
    expect(res18.status).toBe(200);
    expect(res17.status).toBe(200);
    expect(res18.body.factorial).toBe(18 * res17.body.factorial);
    expect(res18.body.factorial).toBe(6402373705728000);
    expect(res17.body.factorial).toBe(355687428096000);
  });

  test('跨调用递推 oracle: f(1) === 1 * f(0) === 1（数学边界递推）', async () => {
    const res1 = await request(app).get('/factorial').query({ n: '1' });
    const res0 = await request(app).get('/factorial').query({ n: '0' });
    expect(res1.status).toBe(200);
    expect(res0.status).toBe(200);
    expect(res1.body.factorial).toBe(1 * res0.body.factorial);
    expect(res1.body.factorial).toBe(1);
    expect(res0.body.factorial).toBe(1);
  });

  test('跨调用递推 oracle: f(10) === 10 * f(9)（中段）', async () => {
    const res10 = await request(app).get('/factorial').query({ n: '10' });
    const res9 = await request(app).get('/factorial').query({ n: '9' });
    expect(res10.status).toBe(200);
    expect(res9.status).toBe(200);
    expect(res10.body.factorial).toBe(10 * res9.body.factorial);
    expect(res10.body.factorial).toBe(3628800);
  });

  // === 上界拒 n > 18 ===

  test('GET /factorial?n=19 → 400 + error 非空，body 不含 factorial（上界拒）', async () => {
    const res = await request(app).get('/factorial').query({ n: '19' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=20 → 400 + 不含 factorial', async () => {
    const res = await request(app).get('/factorial').query({ n: '20' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=100 → 400 + 不含 factorial', async () => {
    const res = await request(app).get('/factorial').query({ n: '100' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  // === strict-schema 拒（^\d+$ 白名单外全 400） ===

  test('GET /factorial?n=-1 → 400（负号不合 ^\\d+$）', async () => {
    const res = await request(app).get('/factorial').query({ n: '-1' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=-5 → 400（负号）', async () => {
    const res = await request(app).get('/factorial').query({ n: '-5' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=5.5 → 400（小数点）', async () => {
    const res = await request(app).get('/factorial').query({ n: '5.5' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=5.0 → 400（小数点，即使数值是整数也拒）', async () => {
    const res = await request(app).get('/factorial').query({ n: '5.0' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=+5 → 400（前导正号）', async () => {
    const res = await request(app).get('/factorial').query({ n: '+5' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=1e2 → 400（科学计数法）', async () => {
    const res = await request(app).get('/factorial').query({ n: '1e2' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=0xff → 400（十六进制）', async () => {
    const res = await request(app).get('/factorial').query({ n: '0xff' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=1,000 → 400（千分位）', async () => {
    const res = await request(app).get('/factorial').query({ n: '1,000' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n= → 400（空串）', async () => {
    const res = await request(app).get('/factorial').query({ n: '' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=abc → 400（字母串）', async () => {
    const res = await request(app).get('/factorial').query({ n: 'abc' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=Infinity → 400', async () => {
    const res = await request(app).get('/factorial').query({ n: 'Infinity' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=NaN → 400', async () => {
    const res = await request(app).get('/factorial').query({ n: 'NaN' });
    expect(res.status).toBe(400);
  });

  // === 缺参 ===

  test('GET /factorial (无 query) → 400 + error', async () => {
    const res = await request(app).get('/factorial');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('factorial');
  });

  // === 前导 0 strict 通过且等价 ===

  test('GET /factorial?n=05 → 200 + {factorial:120}（前导 0，^\\d+$ 允许）', async () => {
    const res = await request(app).get('/factorial').query({ n: '05' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 120 });
  });

  // === schema 完整性 oracle ===

  test('成功响应 schema 完整性: Object.keys 严等 ["factorial"]', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['factorial']);
  });

  test('错误响应 schema 完整性: Object.keys 严等 ["error"]', async () => {
    const res = await request(app).get('/factorial').query({ n: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });

  // === 禁用字段反向断言 ===

  test('成功响应禁用同义字段（result/value/product/fact/answer/data/payload/output/sum/quotient/power/remainder 全不存在）', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    for (const k of ['result', 'value', 'product', 'fact', 'answer', 'data', 'payload', 'output', 'out', 'sum', 'quotient', 'power', 'remainder', 'operation']) {
      expect(res.body).not.toHaveProperty(k);
    }
  });

  // === query 别名锁死 ===

  test('query 别名锁死: value=5 → 400 不含 factorial', async () => {
    const res = await request(app).get('/factorial').query({ value: '5' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('query 别名锁死: num=5 → 400', async () => {
    const res = await request(app).get('/factorial').query({ num: '5' });
    expect(res.status).toBe(400);
  });

  test('query 别名锁死: x=5 → 400', async () => {
    const res = await request(app).get('/factorial').query({ x: '5' });
    expect(res.status).toBe(400);
  });

  test('query 别名锁死: input=5 → 400', async () => {
    const res = await request(app).get('/factorial').query({ input: '5' });
    expect(res.status).toBe(400);
  });

  // === 回归（W19~W23 + bootstrap，不能破坏）===

  test('回归 /health → 200 {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('回归 W19 /sum?a=2&b=3 → 200 + {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
  });

  test('回归 W20 /multiply?a=2&b=3 → 200 + {product:6}', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
  });

  test('回归 W21 /divide?a=6&b=2 → 200 + {quotient:3}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 3 });
  });

  test('回归 W22 /power?a=2&b=10 → 200 + {power:1024}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1024 });
  });

  test('回归 W23 /modulo?a=10&b=3 → 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1 });
  });
});
