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

describe('GET /factorial — int-only strict-schema + 上界 18 拒 + 跨调用递推不变量 oracle [BEHAVIOR]', () => {
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
