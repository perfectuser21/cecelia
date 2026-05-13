import { describe, it, expect } from 'vitest';
import request from 'supertest';
// @ts-ignore — ESM default export
import app from '../../../../playground/server.js';

describe('GET /negate [BEHAVIOR]', () => {
  it('value=5 → 200 + {result:-5, operation:"negate"} strict schema', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-5);
    expect(res.body.operation).toBe('negate');
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  it('response keys 完整性 — 顶层 keys 恰好为 ["operation","result"]', async () => {
    const res = await request(app).get('/negate').query({ value: '10' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  it('禁用字段反向 — negated/negative/value/answer 不存在于 success response', async () => {
    const res = await request(app).get('/negate').query({ value: '3' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('negated');
    expect(res.body).not.toHaveProperty('negative');
    expect(res.body).not.toHaveProperty('value');
    expect(res.body).not.toHaveProperty('answer');
    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('payload');
    expect(res.body).not.toHaveProperty('output');
    expect(res.body).not.toHaveProperty('result_value');
  });

  it('error path — value=foo → 400 + {error: <非空 string>}', async () => {
    const res = await request(app).get('/negate').query({ value: 'foo' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('error response keys 完整性 — 顶层 keys 恰好为 ["error"]', async () => {
    const res = await request(app).get('/negate').query({ value: 'bad' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
  });

  it('error 禁用字段 — message/msg/reason 不存在于 error response', async () => {
    const res = await request(app).get('/negate').query({ value: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('message');
    expect(res.body).not.toHaveProperty('msg');
    expect(res.body).not.toHaveProperty('reason');
    expect(res.body).not.toHaveProperty('detail');
    expect(res.body).not.toHaveProperty('description');
  });

  it('value=0 → result=0（正零，不得返回 -0）', async () => {
    const res = await request(app).get('/negate').query({ value: '0' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(0);
    expect(Object.is(res.body.result, -0)).toBe(false);
    expect(String(res.body.result)).toBe('0');
  });

  it('负数取反 — value=-7 → result=7', async () => {
    const res = await request(app).get('/negate').query({ value: '-7' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(7);
    expect(res.body.operation).toBe('negate');
  });

  it('value 缺失 → 400', async () => {
    const res = await request(app).get('/negate');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('value=1.5（小数）→ 400（strict ^-?\\d+$ 校验）', async () => {
    const res = await request(app).get('/negate').query({ value: '1.5' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('value 为空字符串 → 400', async () => {
    const res = await request(app).get('/negate').query({ value: '' });
    expect(res.status).toBe(400);
  });

  it('|value| > 9007199254740990 → 400（上界超限）', async () => {
    const res = await request(app).get('/negate').query({ value: '9007199254740991' });
    expect(res.status).toBe(400);
  });

  it('operation 字面量严格 — 禁止 neg/negation/negative 等变体', async () => {
    const res = await request(app).get('/negate').query({ value: '1' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('negate');
    expect(res.body.operation).not.toBe('neg');
    expect(res.body.operation).not.toBe('negation');
    expect(res.body.operation).not.toBe('negative');
  });
});
