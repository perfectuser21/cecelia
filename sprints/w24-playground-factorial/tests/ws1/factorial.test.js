import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /factorial (strict-schema ^\\d+$ + 上界 18 拒 + 跨调用递推 oracle) [BEHAVIOR]', () => {
  // === Happy + 边界 ===

  test('GET /factorial?n=5 → 200 + {factorial:120} (happy)', async () => {
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

  test('GET /factorial?n=0 → 200 + {factorial:1} (0! = 1 数学定义)', async () => {
    const res = await request(app).get('/factorial').query({ n: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 1 });
  });

  test('GET /factorial?n=1 → 200 + {factorial:1} (1! = 1)', async () => {
    const res = await request(app).get('/factorial').query({ n: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 1 });
  });

  test('GET /factorial?n=18 → 200 + {factorial:6402373705728000} (精度上界，<MAX_SAFE_INTEGER)', async () => {
    const res = await request(app).get('/factorial').query({ n: '18' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 6402373705728000 });
    expect(res.body.factorial).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  test('GET /factorial?n=17 → 200 + {factorial:355687428096000}', async () => {
    const res = await request(app).get('/factorial').query({ n: '17' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 355687428096000 });
  });

  test('GET /factorial?n=4 → 200 + {factorial:24}', async () => {
    const res = await request(app).get('/factorial').query({ n: '4' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 24 });
  });

  test('GET /factorial?n=9 → 200 + {factorial:362880}', async () => {
    const res = await request(app).get('/factorial').query({ n: '9' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 362880 });
  });

  test('GET /factorial?n=05 → 200 + {factorial:120} (前导 0 strict 通过，Number("05")===5)', async () => {
    const res = await request(app).get('/factorial').query({ n: '05' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ factorial: 120 });
  });

  // === 值复算 oracle（沿用 W19~W23 单调用范式）===

  test('GET /factorial?n=5 → body.factorial === 独立迭代复算 (oracle 探针 #1)', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    let expected = 1;
    for (let i = 2; i <= 5; i++) expected *= i;
    expect(res.body.factorial).toBe(expected);
  });

  test('GET /factorial?n=10 → body.factorial === 独立迭代复算 (oracle 探针 #2)', async () => {
    const res = await request(app).get('/factorial').query({ n: '10' });
    expect(res.status).toBe(200);
    let expected = 1;
    for (let i = 2; i <= 10; i++) expected *= i;
    expect(res.body.factorial).toBe(expected);
  });

  test('GET /factorial?n=18 → body.factorial === 独立迭代复算 (oracle 探针 #3，精度上界)', async () => {
    const res = await request(app).get('/factorial').query({ n: '18' });
    expect(res.status).toBe(200);
    let expected = 1;
    for (let i = 2; i <= 18; i++) expected *= i;
    expect(res.body.factorial).toBe(expected);
    expect(res.body.factorial).toBe(6402373705728000);
  });

  // === W24 核心：跨调用递推不变量 oracle (multi-call relation oracle) ===

  test('递推不变量 factorial(5) === 5 * factorial(4) (W24 核心 oracle #1)', async () => {
    const res5 = await request(app).get('/factorial').query({ n: '5' });
    const res4 = await request(app).get('/factorial').query({ n: '4' });
    expect(res5.status).toBe(200);
    expect(res4.status).toBe(200);
    expect(res5.body.factorial).toBe(5 * res4.body.factorial);
    expect(res5.body.factorial).toBe(120);
    expect(res4.body.factorial).toBe(24);
  });

  test('递推不变量 factorial(10) === 10 * factorial(9) (W24 oracle #2，中位数)', async () => {
    const res10 = await request(app).get('/factorial').query({ n: '10' });
    const res9 = await request(app).get('/factorial').query({ n: '9' });
    expect(res10.status).toBe(200);
    expect(res9.status).toBe(200);
    expect(res10.body.factorial).toBe(10 * res9.body.factorial);
  });

  test('递推不变量 factorial(18) === 18 * factorial(17) (W24 oracle #3，精度上界)', async () => {
    const res18 = await request(app).get('/factorial').query({ n: '18' });
    const res17 = await request(app).get('/factorial').query({ n: '17' });
    expect(res18.status).toBe(200);
    expect(res17.status).toBe(200);
    expect(res18.body.factorial).toBe(18 * res17.body.factorial);
    expect(res18.body.factorial).toBe(6402373705728000);
    expect(res17.body.factorial).toBe(355687428096000);
  });

  test('递推不变量 factorial(2) === 2 * factorial(1) (W24 oracle #4，小数边界)', async () => {
    const res2 = await request(app).get('/factorial').query({ n: '2' });
    const res1 = await request(app).get('/factorial').query({ n: '1' });
    expect(res2.status).toBe(200);
    expect(res1.status).toBe(200);
    expect(res2.body.factorial).toBe(2 * res1.body.factorial);
  });

  // === Schema oracle (顶层 keys 严格等于 ['factorial']) ===

  test('GET /factorial?n=5 响应顶层 keys 严格等于 ["factorial"] (schema oracle)', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['factorial']);
  });

  test('GET /factorial?n=5 成功响应不含禁用同义字段 (反向 schema 完整性探针)', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    for (const forbidden of [
      'result', 'value', 'answer', 'fact', 'f', 'output', 'out',
      'data', 'payload', 'response',
      'sum', 'product', 'quotient', 'power', 'remainder',
      'operation', 'n', 'input', 'arg',
    ]) {
      expect(res.body).not.toHaveProperty(forbidden);
    }
  });

  // === 上界拒（W24 唯一 rule-based 拒绝路径）===

  test('GET /factorial?n=19 → 400 + body 不含 factorial (上界拒 #1，> MAX_SAFE_INTEGER 起点)', async () => {
    const res = await request(app).get('/factorial').query({ n: '19' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=20 → 400 + body 不含 factorial (上界拒 #2)', async () => {
    const res = await request(app).get('/factorial').query({ n: '20' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=100 → 400 (上界拒 #3，远超上界)', async () => {
    const res = await request(app).get('/factorial').query({ n: '100' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  // === 缺参 ===

  test('GET /factorial (无 query) → 400 + body 不含 factorial', async () => {
    const res = await request(app).get('/factorial');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?value=5 → 400 (PRD 禁用 query 名反向探针，n 缺失走缺参分支)', async () => {
    const res = await request(app).get('/factorial').query({ value: '5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('GET /factorial?num=5 → 400 (PRD 禁用 query 名反向探针 #2)', async () => {
    const res = await request(app).get('/factorial').query({ num: '5' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?x=5 → 400 (PRD 禁用 query 名反向探针 #3)', async () => {
    const res = await request(app).get('/factorial').query({ x: '5' });
    expect(res.status).toBe(400);
  });

  // === strict-schema 拒绝 (^\d+$ 严格非负整数) ===

  test('GET /factorial?n=-1 → 400 (strict 拒负数)', async () => {
    const res = await request(app).get('/factorial').query({ n: '-1' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=-5 → 400 (strict 拒负数)', async () => {
    const res = await request(app).get('/factorial').query({ n: '-5' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=5.5 → 400 (strict 拒小数，防 W20 浮点 regex 复用假绿)', async () => {
    const res = await request(app).get('/factorial').query({ n: '5.5' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=5.0 → 400 (strict 拒浮点形整数)', async () => {
    const res = await request(app).get('/factorial').query({ n: '5.0' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=+5 → 400 (strict 拒前导正号)', async () => {
    const res = await request(app).get('/factorial').query({ n: '+5' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=1e2 → 400 (strict 拒科学计数法，防 Number("1e2")===100 假绿)', async () => {
    const res = await request(app).get('/factorial').query({ n: '1e2' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=0xff → 400 (strict 拒十六进制)', async () => {
    const res = await request(app).get('/factorial').query({ n: '0xff' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=1,000 → 400 (strict 拒千分位)', async () => {
    const res = await request(app).get('/factorial').query({ n: '1,000' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n= (空串) → 400', async () => {
    const res = await request(app).get('/factorial').query({ n: '' });
    expect(res.status).toBe(400);
  });

  test('GET /factorial?n=abc → 400 + body 不含 factorial', async () => {
    const res = await request(app).get('/factorial').query({ n: 'abc' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=Infinity → 400', async () => {
    const res = await request(app).get('/factorial').query({ n: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('factorial');
  });

  test('GET /factorial?n=NaN → 400', async () => {
    const res = await request(app).get('/factorial').query({ n: 'NaN' });
    expect(res.status).toBe(400);
  });

  // === 错误响应 schema 严格 (顶层 keys 严格等于 ['error']) ===

  test('GET /factorial?n=abc 错误响应顶层 keys 严格等于 ["error"]', async () => {
    const res = await request(app).get('/factorial').query({ n: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    for (const forbidden of ['message', 'msg', 'reason', 'detail', 'details', 'description', 'info', 'factorial']) {
      expect(res.body).not.toHaveProperty(forbidden);
    }
  });

  test('GET /factorial?n=19 上界拒错误响应顶层 keys 严格等于 ["error"]', async () => {
    const res = await request(app).get('/factorial').query({ n: '19' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(res.body).not.toHaveProperty('factorial');
  });

  // === 回归（不破坏现有 endpoint）===

  test('GET /health → 200 + {ok:true} (bootstrap 回归)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 → 200 + {sum:5} (W19 回归)', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
  });

  test('GET /multiply?a=2&b=3 → 200 + {product:6} (W20 回归)', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
  });

  test('GET /divide?a=6&b=2 → 200 + {quotient:3} (W21 回归)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 3 });
  });

  test('GET /power?a=2&b=10 → 200 + {power:1024} (W22 回归)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1024 });
  });

  test('GET /modulo?a=5&b=3 → 200 + {remainder:2} (W23 回归)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 2 });
  });

  test('GET /divide?a=5&b=0 → 400 (W21 除零兜底仍生效)', async () => {
    const res = await request(app).get('/divide').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
  });

  test('GET /power?a=0&b=0 → 400 (W22 0^0 拒仍生效)', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
  });
});
