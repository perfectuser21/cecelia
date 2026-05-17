import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /power (strict-schema + 0^0 拒 + 结果有限性兜底 + oracle) [BEHAVIOR]', () => {
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

  test('GET /power?a=5&b=0 → 200 + {power:1} (任意非零^0=1，不能误拒)', async () => {
    const res = await request(app).get('/power').query({ a: '5', b: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1 });
  });

  test('GET /power?a=0&b=5 → 200 + {power:0} (0^正=0，不能误拒)', async () => {
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

  test('GET /power?a=2&b=10 响应顶层 keys 严格等于 ["power"] (schema oracle, 主探针 #3)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['power']);
  });

  test('GET /power?a=2&b=10 成功体不含同义替代字段 (反向 schema oracle)', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('value');
    expect(res.body).not.toHaveProperty('answer');
    expect(res.body).not.toHaveProperty('exp');
    expect(res.body).not.toHaveProperty('exponent');
    expect(res.body).not.toHaveProperty('pow');
    expect(res.body).not.toHaveProperty('output');
    expect(res.body).not.toHaveProperty('product');
    expect(res.body).not.toHaveProperty('sum');
    expect(res.body).not.toHaveProperty('quotient');
    expect(res.body).not.toHaveProperty('operation');
    expect(res.body).not.toHaveProperty('a');
    expect(res.body).not.toHaveProperty('b');
  });

  // === 0^0 不定式拒（W22 主探针 #1）===

  test('GET /power?a=0&b=0 → 400 + 不含 power (0^0 不定式拒，主探针 #1，不允许 JS 0**0===1 滑过)', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  // === 结果非有限拒（W22 主探针 #2 — Number.isFinite 一步覆盖 NaN/Infinity/-Infinity）===

  test('GET /power?a=0&b=-1 → 400 + 不含 power (0^负=Infinity 拒，结果非有限)', async () => {
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

  test('GET /power?a=-2&b=0.5 → 400 + 不含 power (负^分=NaN 拒，主探针 #2)', async () => {
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

  // === strict-schema 拒绝（防 W20/W21 strict 被打回）===

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

  // === 回归（不破坏现有 endpoint）===

  test('GET /health 仍返回 200 + {ok:true} (回归 bootstrap)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('GET /sum?a=2&b=3 仍返回 200 + {sum:5} (回归 W19)', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
  });

  test('GET /multiply?a=2&b=3 仍返回 200 + {product:6} (回归 W20)', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
  });

  test('GET /multiply?a=1e3&b=2 仍返回 400 (W20 strict 不被打回)', async () => {
    const res = await request(app).get('/multiply').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /divide?a=6&b=2 仍返回 200 + {quotient:3} (回归 W21)', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 3 });
  });

  test('GET /divide?a=5&b=0 仍返回 400 (W21 除零兜底不被打回)', async () => {
    const res = await request(app).get('/divide').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('quotient');
  });
});
