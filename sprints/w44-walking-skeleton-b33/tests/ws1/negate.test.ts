import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('GET /negate [BEHAVIOR]', () => {
  it('value=5 → 200 + {result:-5, operation:"negate"}', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(-5);
    expect(res.body.operation).toBe('negate');
  });

  it('response keys 完全等于 ["operation","result"]', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  it('response 不含禁用字段 negated/negative/inverted', async () => {
    const res = await request(app).get('/negate').query({ value: '5' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('negated');
    expect(res.body).not.toHaveProperty('negative');
    expect(res.body).not.toHaveProperty('inverted');
  });

  it('value=abc → 400 + {error: <非空 string>}', async () => {
    const res = await request(app).get('/negate').query({ value: 'abc' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('禁用 query 名 n=5 → 400', async () => {
    const res = await request(app).get('/negate').query({ n: '5' });
    expect(res.status).toBe(400);
  });

  it('value=-5 → 200 + {result:5, operation:"negate"}（负数取反）', async () => {
    const res = await request(app).get('/negate').query({ value: '-5' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe(5);
    expect(res.body.operation).toBe('negate');
  });
});
