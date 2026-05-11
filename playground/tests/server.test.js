import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../server.js';

describe('playground server', () => {
  test('GET /health → 200 {ok: true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('GET /sum', () => {
  test('GET /sum?a=2&b=3 → 200 + {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
    expect(typeof res.body.sum).toBe('number');
  });

  test('GET /sum?a=2 (b 缺失) → 400 + 非空 error', async () => {
    const res = await request(app).get('/sum').query({ a: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /sum (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/sum');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /sum?a=abc&b=3 (a 非数字) → 400 + error，body 不含 sum', async () => {
    const res = await request(app).get('/sum').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'sum')).toBe(false);
  });

  test('GET /sum?a=-1&b=1 → 200 + {sum:0} (负数合法)', async () => {
    const res = await request(app).get('/sum').query({ a: '-1', b: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 0 });
  });

  test('GET /sum?a=1.5&b=2.5 → 200 + {sum:4} (小数合法)', async () => {
    const res = await request(app).get('/sum').query({ a: '1.5', b: '2.5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 4 });
  });

  test('GET /sum?a=0&b=0 → 200 + {sum:0} (零合法)', async () => {
    const res = await request(app).get('/sum').query({ a: '0', b: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 0 });
  });
});

describe('GET /multiply (strict-schema)', () => {
  test('GET /multiply?a=2&b=3 → 200 + {product:6}', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
    expect(typeof res.body.product).toBe('number');
  });

  test('GET /multiply?a=0&b=5 → 200 + {product:0} (零合法)', async () => {
    const res = await request(app).get('/multiply').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 0 });
  });

  test('GET /multiply?a=-2&b=3 → 200 + {product:-6} (负数合法)', async () => {
    const res = await request(app).get('/multiply').query({ a: '-2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: -6 });
  });

  test('GET /multiply?a=1.5&b=2 → 200 + {product:3} (标准小数合法)', async () => {
    const res = await request(app).get('/multiply').query({ a: '1.5', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 3 });
  });

  test('GET /multiply?a=2 (缺 b) → 400 + 非空 error，body 不含 product', async () => {
    const res = await request(app).get('/multiply').query({ a: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'product')).toBe(false);
  });

  test('GET /multiply (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /multiply?a=1e3&b=2 (科学计数法) → 400 + 非空 error，body 不含 product', async () => {
    const res = await request(app).get('/multiply').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'product')).toBe(false);
  });

  test('GET /multiply?a=Infinity&b=2 → 400 + 非空 error，body 不含 product', async () => {
    const res = await request(app).get('/multiply').query({ a: 'Infinity', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'product')).toBe(false);
  });

  test('GET /multiply?a=NaN&b=2 → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: 'NaN', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /multiply?a=+2&b=3 (前导正号) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '+2', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /multiply?a=.5&b=2 (小数点缺整数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '.5', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /multiply?a=5.&b=2 (小数点缺小数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '5.', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /multiply?a=0xff&b=2 (十六进制) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '0xff', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /multiply?a=1,000&b=2 (千分位) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '1,000', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /multiply?a=&b=3 (空字符串) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /multiply?a=abc&b=3 (非数字) → 400 + error，body 不含 product', async () => {
    const res = await request(app).get('/multiply').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'product')).toBe(false);
  });
});

describe('GET /divide (strict-schema + 除零兜底 + oracle)', () => {
  test('GET /divide?a=6&b=2 → 200 + {quotient:3}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 3 });
    expect(typeof res.body.quotient).toBe('number');
  });

  test('GET /divide?a=1&b=3 → 200 + body.quotient === Number("1")/Number("3") (oracle 严格相等)', async () => {
    const res = await request(app).get('/divide').query({ a: '1', b: '3' });
    expect(res.status).toBe(200);
    expect(typeof res.body.quotient).toBe('number');
    expect(res.body.quotient).toBe(Number('1') / Number('3'));
  });

  test('GET /divide?a=-6&b=2 → 200 + {quotient:-3} (负被除数合法)', async () => {
    const res = await request(app).get('/divide').query({ a: '-6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: -3 });
  });

  test('GET /divide?a=6&b=-2 → 200 + {quotient:-3} (负除数合法)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '-2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: -3 });
  });

  test('GET /divide?a=0&b=5 → 200 + {quotient:0} (被除数为 0 合法)', async () => {
    const res = await request(app).get('/divide').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 0 });
  });

  test('GET /divide?a=1.5&b=0.5 → 200 + body.quotient === Number("1.5")/Number("0.5") (小数 + oracle)', async () => {
    const res = await request(app).get('/divide').query({ a: '1.5', b: '0.5' });
    expect(res.status).toBe(200);
    expect(typeof res.body.quotient).toBe('number');
    expect(res.body.quotient).toBe(Number('1.5') / Number('0.5'));
  });

  test('GET /divide?a=5&b=0 → 400 + 非空 error，body 不含 quotient (除零兜底)', async () => {
    const res = await request(app).get('/divide').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  test('GET /divide?a=0&b=0 → 400 + 非空 error，body 不含 quotient (0/0 也拒)', async () => {
    const res = await request(app).get('/divide').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  test('GET /divide?a=6&b=0.0 → 400 + 非空 error，body 不含 quotient (b=0.0 也算零)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '0.0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  test('GET /divide?a=6 (缺 b) → 400 + 非空 error，body 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: '6' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  test('GET /divide?b=2 (缺 a) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /divide (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /divide?a=1e3&b=2 (科学计数法) → 400 + 非空 error，body 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  test('GET /divide?a=Infinity&b=2 → 400 + 非空 error，body 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: 'Infinity', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  test('GET /divide?a=6&b=NaN → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: 'NaN' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /divide?a=+6&b=2 (前导正号 → URL 编码后 %2B6) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '+6', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /divide?a=.5&b=2 (小数点缺整数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '.5', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /divide?a=0xff&b=2 (十六进制) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '0xff', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /divide?a=&b=3 (空字符串) → 400 + 非空 error', async () => {
    const res = await request(app).get('/divide').query({ a: '', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /divide?a=abc&b=3 (非数字) → 400 + error，body 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });
});

describe('GET /power (strict-schema + 0^0 拒 + 结果有限性兜底 + oracle)', () => {
  // === Happy + 边界 ===

  test('GET /power?a=2&b=10 → 200 + {power:1024} (整数指数 happy)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1024 });
    expect(typeof res.body.power).toBe('number');
  });

  test('GET /power?a=2&b=0.5 → oracle 严格相等 (开方语义, oracle 探针 #1)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '0.5' });
    expect(res.status).toBe(200);
    expect(typeof res.body.power).toBe('number');
    expect(res.body.power).toBe(Number('2') ** Number('0.5'));
  });

  test('GET /power?a=4&b=0.5 → 200 + {power:2} (整数开方结果)', async () => {
    const res = await request(app).get('/power').query({ a: '4', b: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 2 });
  });

  test('GET /power?a=2&b=-2 → oracle 严格相等 (负指数, oracle 探针 #2)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '-2' });
    expect(res.status).toBe(200);
    expect(typeof res.body.power).toBe('number');
    expect(res.body.power).toBe(Number('2') ** Number('-2'));
  });

  test('GET /power?a=-2&b=3 → 200 + {power:-8} (负底奇整指合法)', async () => {
    const res = await request(app).get('/power').query({ a: '-2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: -8 });
  });

  test('GET /power?a=-2&b=2 → 200 + {power:4} (负底偶整指合法)', async () => {
    const res = await request(app).get('/power').query({ a: '-2', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 4 });
  });

  test('GET /power?a=5&b=0 → 200 + {power:1} (任意非零^0=1)', async () => {
    const res = await request(app).get('/power').query({ a: '5', b: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1 });
  });

  test('GET /power?a=0&b=5 → 200 + {power:0} (0^正=0)', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 0 });
  });

  test('GET /power?a=1&b=99999 → 200 + {power:1} (1^N=1 不溢出)', async () => {
    const res = await request(app).get('/power').query({ a: '1', b: '99999' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1 });
  });

  // === Schema oracle ===

  test('GET /power?a=2&b=10 响应顶层 keys 严格等于 ["power"] (schema oracle)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['power']);
  });

  // === 0^0 不定式拒（W22 主探针 #1）===

  test('GET /power?a=0&b=0 → 400 + 不含 power (0^0 不定式拒，不允许 JS 0**0===1 滑过)', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  // === 结果非有限拒（W22 主探针 #2 — Number.isFinite 一步覆盖 NaN/Infinity/-Infinity）===

  test('GET /power?a=0&b=-1 → 400 + 不含 power (0^负=Infinity 拒)', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '-1' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  test('GET /power?a=0&b=-3 → 400 + 不含 power (0^负整=Infinity 拒)', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '-3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  test('GET /power?a=-2&b=0.5 → 400 + 不含 power (负^分=NaN 拒)', async () => {
    const res = await request(app).get('/power').query({ a: '-2', b: '0.5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  test('GET /power?a=-8&b=0.5 → 400 + 不含 power (负^分=NaN 拒)', async () => {
    const res = await request(app).get('/power').query({ a: '-8', b: '0.5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  test('GET /power?a=10&b=1000 → 400 + 不含 power (溢出=Infinity 拒)', async () => {
    const res = await request(app).get('/power').query({ a: '10', b: '1000' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  test('GET /power?a=2&b=10000 → 400 + 不含 power (溢出=Infinity 拒)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10000' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  // === 缺参 ===

  test('GET /power?a=2 (缺 b) → 400 + 非空 error，body 不含 power', async () => {
    const res = await request(app).get('/power').query({ a: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  test('GET /power?b=3 (缺 a) → 400 + 非空 error', async () => {
    const res = await request(app).get('/power').query({ b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /power (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/power');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // === strict-schema 拒绝 ===

  test('GET /power?a=1e3&b=2 (科学计数法) → 400 + 不含 power', async () => {
    const res = await request(app).get('/power').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  test('GET /power?a=Infinity&b=2 → 400 + 不含 power', async () => {
    const res = await request(app).get('/power').query({ a: 'Infinity', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  test('GET /power?a=2&b=NaN → 400 + 非空 error', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: 'NaN' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /power?a=+2&b=3 (前导正号) → 400 + 非空 error', async () => {
    const res = await request(app).get('/power').query({ a: '+2', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /power?a=.5&b=2 (小数点缺整数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/power').query({ a: '.5', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /power?a=2.&b=3 (小数点缺小数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/power').query({ a: '2.', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /power?a=0xff&b=2 (十六进制) → 400 + 非空 error', async () => {
    const res = await request(app).get('/power').query({ a: '0xff', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /power?a=1,000&b=2 (千分位) → 400 + 非空 error', async () => {
    const res = await request(app).get('/power').query({ a: '1,000', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /power?a=&b=3 (空字符串) → 400 + 非空 error', async () => {
    const res = await request(app).get('/power').query({ a: '', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /power?a=abc&b=3 (非数字) → 400 + error，body 不含 power', async () => {
    const res = await request(app).get('/power').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });
});

describe('GET /modulo (strict-schema + 除零拒 + 符号不变量 oracle)', () => {
  // === Happy + 边界 ===

  test('GET /modulo?a=5&b=3 → 200 + {remainder:2} (正正整数 happy)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 2 });
    expect(typeof res.body.remainder).toBe('number');
  });

  test('GET /modulo?a=10&b=3 → 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '10', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1 });
  });

  test('GET /modulo?a=7&b=2 → 200 + {remainder:1}', async () => {
    const res = await request(app).get('/modulo').query({ a: '7', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1 });
  });

  test('GET /modulo?a=6&b=2 → 200 + {remainder:0} (整除)', async () => {
    const res = await request(app).get('/modulo').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 0 });
  });

  test('GET /modulo?a=5.5&b=2 → 200 + {remainder:1.5} (浮点)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5.5', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 1.5 });
  });

  test('GET /modulo?a=0&b=5 → 200 + {remainder:0} (被除数 0)', async () => {
    const res = await request(app).get('/modulo').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 0 });
  });

  test('GET /modulo?a=0&b=-5 → 200 + {remainder:0} (被除数 0 + 负除数)', async () => {
    const res = await request(app).get('/modulo').query({ a: '0', b: '-5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 0 });
  });

  // === 值复算 oracle（沿用 W19~W22 范式）===

  test('GET /modulo?a=1&b=3 → oracle 严格相等 (值复算 #1)', async () => {
    const res = await request(app).get('/modulo').query({ a: '1', b: '3' });
    expect(res.status).toBe(200);
    expect(typeof res.body.remainder).toBe('number');
    expect(res.body.remainder).toBe(Number('1') % Number('3'));
  });

  test('GET /modulo?a=-7&b=2 → oracle 严格相等 (值复算 #2，覆盖负被除数)', async () => {
    const res = await request(app).get('/modulo').query({ a: '-7', b: '2' });
    expect(res.status).toBe(200);
    expect(typeof res.body.remainder).toBe('number');
    expect(res.body.remainder).toBe(Number('-7') % Number('2'));
  });

  // === W23 核心：符号不变量 oracle（JS truncated vs floored mod 区分探针）===

  test('GET /modulo?a=-5&b=3 → 200 + {remainder:-2} (符号跟随被除数 -5，floored mod 实现必挂)', async () => {
    const res = await request(app).get('/modulo').query({ a: '-5', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: -2 });
  });

  test('GET /modulo?a=-5&b=3 → Math.sign(remainder) === -1 (符号不变量探针 #1，负被除数)', async () => {
    const res = await request(app).get('/modulo').query({ a: '-5', b: '3' });
    expect(res.status).toBe(200);
    expect(Math.sign(res.body.remainder)).toBe(Math.sign(Number('-5')));
    expect(Math.sign(res.body.remainder)).toBe(-1);
  });

  test('GET /modulo?a=5&b=-3 → 200 + {remainder:2} (符号跟随被除数 5)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '-3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: 2 });
  });

  test('GET /modulo?a=5&b=-3 → Math.sign(remainder) === 1 (符号不变量探针 #2，正被除数 + 负除数)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '-3' });
    expect(res.status).toBe(200);
    expect(Math.sign(res.body.remainder)).toBe(Math.sign(Number('5')));
    expect(Math.sign(res.body.remainder)).toBe(1);
  });

  test('GET /modulo?a=-5&b=-3 → 200 + {remainder:-2} (符号跟随被除数 -5，双负)', async () => {
    const res = await request(app).get('/modulo').query({ a: '-5', b: '-3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ remainder: -2 });
  });

  // === Schema oracle (顶层 keys 严格等于 ['remainder']) ===

  test('GET /modulo?a=5&b=3 响应顶层 keys 严格等于 ["remainder"] (schema oracle)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '3' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['remainder']);
  });

  test('GET /modulo?a=5&b=3 成功响应不含禁用同义字段 (反向 schema 完整性探针)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '3' });
    expect(res.status).toBe(200);
    for (const forbidden of [
      'result', 'value', 'answer', 'mod', 'modulo', 'rem', 'rest', 'residue',
      'out', 'output', 'data', 'payload', 'response',
      'sum', 'product', 'quotient', 'power',
      'operation', 'a', 'b', 'input', 'dividend', 'divisor', 'numerator', 'denominator',
    ]) {
      expect(res.body).not.toHaveProperty(forbidden);
    }
  });

  // === 除零拒（W23 唯一 rule-based 拒绝路径，复用 W21 范式）===

  test('GET /modulo?a=5&b=0 → 400 + 非空 error + body 不含 remainder (除零兜底)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=0&b=0 → 400 + 非空 error + body 不含 remainder (0%0 也归此分支)', async () => {
    const res = await request(app).get('/modulo').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=-5&b=0 → 400 + 非空 error + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: '-5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=5&b=0.0 → 400 + body 不含 remainder (b=0.0 也算零)', async () => {
    const res = await request(app).get('/modulo').query({ a: '5', b: '0.0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  // === 缺参 ===

  test('GET /modulo?a=5 (缺 b) → 400 + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: '5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?b=3 (缺 a) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // === strict-schema 拒绝 ===

  test('GET /modulo?a=1e3&b=2 (科学计数法) → 400 + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=Infinity&b=2 → 400 + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: 'Infinity', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  test('GET /modulo?a=2&b=NaN → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '2', b: 'NaN' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=+2&b=3 (前导正号) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '+2', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=.5&b=2 (缺整数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '.5', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=2.&b=3 (缺小数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '2.', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=0xff&b=2 (十六进制) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '0xff', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=1,000&b=2 (千分位) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '1,000', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=&b=3 (空字符串) → 400 + 非空 error', async () => {
    const res = await request(app).get('/modulo').query({ a: '', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /modulo?a=abc&b=3 (非数字) → 400 + body 不含 remainder', async () => {
    const res = await request(app).get('/modulo').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('remainder');
  });

  // === 错误响应 schema 严格（顶层 keys 严格等于 ['error']）===

  test('GET /modulo?a=foo&b=3 错误响应顶层 keys 严格等于 ["error"]', async () => {
    const res = await request(app).get('/modulo').query({ a: 'foo', b: '3' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    for (const forbidden of ['message', 'msg', 'reason', 'detail', 'details', 'description', 'info', 'remainder']) {
      expect(res.body).not.toHaveProperty(forbidden);
    }
  });
});
