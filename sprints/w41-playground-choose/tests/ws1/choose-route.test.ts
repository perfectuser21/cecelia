import { describe, it, expect } from 'vitest';
import request from 'supertest';
// @ts-ignore — JS module without types
import app from '../../../../playground/server.js';

describe('GET /choose — WS1 TDD Red（/choose 路由不存在时全部 fail）', () => {
  // ─── Happy path ───

  it('GET /choose?n=5&k=2 → 200 + {choose: 10}', async () => {
    const res = await request(app).get('/choose').query({ n: '5', k: '2' });
    expect(res.status).toBe(200);
    expect(res.body.choose).toBe(10);
    expect(typeof res.body.choose).toBe('number');
  });

  it('GET /choose?n=10&k=3 → 200 + {choose: 120}', async () => {
    const res = await request(app).get('/choose').query({ n: '10', k: '3' });
    expect(res.status).toBe(200);
    expect(res.body.choose).toBe(120);
  });

  it('GET /choose?n=20&k=10 → 200 + {choose: 184756}（精度上界）', async () => {
    const res = await request(app).get('/choose').query({ n: '20', k: '10' });
    expect(res.status).toBe(200);
    expect(res.body.choose).toBe(184756);
  });

  // ─── W41 核心 oracle：k=0 基底（round 1 预期失败点）───

  it('GET /choose?n=5&k=0 → 200 + {choose: 1}（C(5,0)=1，依赖 0!=1）', async () => {
    const res = await request(app).get('/choose').query({ n: '5', k: '0' });
    expect(res.status).toBe(200);
    expect(res.body.choose).toBe(1);
  });

  it('GET /choose?n=0&k=0 → 200 + {choose: 1}（C(0,0)=1，0! 基底最小边界）', async () => {
    const res = await request(app).get('/choose').query({ n: '0', k: '0' });
    expect(res.status).toBe(200);
    expect(res.body.choose).toBe(1);
  });

  it('GET /choose?n=20&k=0 → 200 + {choose: 1}（C(20,0)=1，0! 基底上界）', async () => {
    const res = await request(app).get('/choose').query({ n: '20', k: '0' });
    expect(res.status).toBe(200);
    expect(res.body.choose).toBe(1);
  });

  it('GET /choose?n=5&k=5 → 200 + {choose: 1}（k=n 对称，分母含 0!）', async () => {
    const res = await request(app).get('/choose').query({ n: '5', k: '5' });
    expect(res.status).toBe(200);
    expect(res.body.choose).toBe(1);
  });

  // ─── Schema 完整性 ───

  it('response keys 精确等于 ["choose"]，不允许多余字段', async () => {
    const res = await request(app).get('/choose').query({ n: '5', k: '2' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['choose']);
  });

  it('禁用字段 result 不存在于 response body', async () => {
    const res = await request(app).get('/choose').query({ n: '5', k: '2' });
    expect(Object.prototype.hasOwnProperty.call(res.body, 'result')).toBe(false);
  });

  it('禁用字段 answer 不存在于 response body', async () => {
    const res = await request(app).get('/choose').query({ n: '5', k: '2' });
    expect(Object.prototype.hasOwnProperty.call(res.body, 'answer')).toBe(false);
  });

  it('禁用字段 c/cnk/combination/binomial 不存在于 response body', async () => {
    const res = await request(app).get('/choose').query({ n: '5', k: '2' });
    for (const forbidden of ['c', 'cnk', 'combination', 'binomial', 'coeff', 'coefficient']) {
      expect(Object.prototype.hasOwnProperty.call(res.body, forbidden)).toBe(false);
    }
  });

  // ─── 缺参数（strict-schema：两个参数均必填）───

  it('缺 k → 400 + 非空 error', async () => {
    const res = await request(app).get('/choose').query({ n: '5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('缺 n → 400 + 非空 error', async () => {
    const res = await request(app).get('/choose').query({ k: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('n 和 k 都缺 → 400 + 非空 error', async () => {
    const res = await request(app).get('/choose');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  // ─── strict-schema 拒（^\d+$ — 仅非负整数）───

  it('n=-1（负号违反 ^\\d+$）→ 400', async () => {
    const res = await request(app).get('/choose').query({ n: '-1', k: '0' });
    expect(res.status).toBe(400);
  });

  it('k=1.5（小数违反 ^\\d+$）→ 400', async () => {
    const res = await request(app).get('/choose').query({ n: '5', k: '1.5' });
    expect(res.status).toBe(400);
  });

  it('n=1e2（科学计数法违反 ^\\d+$）→ 400', async () => {
    const res = await request(app).get('/choose').query({ n: '1e2', k: '0' });
    expect(res.status).toBe(400);
  });

  it('n=abc（非数字字符）→ 400', async () => {
    const res = await request(app).get('/choose').query({ n: 'abc', k: '0' });
    expect(res.status).toBe(400);
  });

  it('n=0x5（十六进制违反 ^\\d+$）→ 400', async () => {
    const res = await request(app).get('/choose').query({ n: '0x5', k: '0' });
    expect(res.status).toBe(400);
  });

  // ─── 范围拒（n>20 hard cap，k>n）───

  it('n=21（超 hard cap n=20）→ 400', async () => {
    const res = await request(app).get('/choose').query({ n: '21', k: '0' });
    expect(res.status).toBe(400);
  });

  it('n=100（远超上界）→ 400', async () => {
    const res = await request(app).get('/choose').query({ n: '100', k: '0' });
    expect(res.status).toBe(400);
  });

  it('k>n（k=5, n=3）→ 400（k>n 显式拒，不悄返 0）', async () => {
    const res = await request(app).get('/choose').query({ n: '3', k: '5' });
    expect(res.status).toBe(400);
  });

  it('k>n（k=1, n=0）→ 400', async () => {
    const res = await request(app).get('/choose').query({ n: '0', k: '1' });
    expect(res.status).toBe(400);
  });

  // ─── Error body schema ───

  it('error body keys 精确等于 ["error"]，不含 choose', async () => {
    const res = await request(app).get('/choose').query({ n: '21', k: '0' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'choose')).toBe(false);
  });

  // ─── 前导 0 兼容（^\d+$ 允许 "05"，Number("05")=5）───

  it('n=05（前导 0）→ 200 + {choose: 10}（等价 n=5）', async () => {
    const res = await request(app).get('/choose').query({ n: '05', k: '2' });
    expect(res.status).toBe(200);
    expect(res.body.choose).toBe(10);
  });

  // ─── 回归：已有路由不受影响 ───

  it('回归：GET /health → 200 {ok: true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('回归：GET /factorial?n=5 → 200 {factorial: 120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });
});
