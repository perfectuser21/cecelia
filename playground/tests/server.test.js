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
