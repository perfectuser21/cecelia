import { describe, test, expect } from 'vitest';
import request from 'supertest';
// @ts-ignore — playground 是 JS 子项目，路径相对仓库根
import app from '../../../../playground/server.js';

describe('GET /uppercase — happy path (TDD red evidence)', () => {
  test('GET /uppercase?text=hello → 200 + {result:"HELLO", operation:"uppercase"}', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'HELLO', operation: 'uppercase' });
  });

  test('GET /uppercase?text=a → 200 + {result:"A", operation:"uppercase"}（单字符 happy）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'a' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'A', operation: 'uppercase' });
  });

  test('GET /uppercase?text=Z → 200 + {result:"Z", operation:"uppercase"}（单字符大写 happy）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'Z' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'Z', operation: 'uppercase' });
  });

  test('GET /uppercase?text=HELLO → 200 + {result:"HELLO", operation:"uppercase"}（已大写幂等）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'HELLO' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'HELLO', operation: 'uppercase' });
  });

  test('GET /uppercase?text=AbCdEf → 200 + {result:"ABCDEF", operation:"uppercase"}（混合大小写）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'AbCdEf' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 'ABCDEF', operation: 'uppercase' });
  });

  test('happy 响应 operation 严字面字符串 "uppercase"', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.operation).toBe('uppercase');
    expect(typeof res.body.result).toBe('string');
  });
});

describe('GET /uppercase — schema 完整性 oracle', () => {
  test('happy 响应顶层 keys 字面集合 == ["operation","result"]', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['operation', 'result']);
  });

  test('happy 响应不含禁用字段 uppercased / upper / transformed / mapped / output', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello' });
    expect(res.status).toBe(200);
    for (const bad of ['uppercased', 'upper', 'upper_text', 'transformed', 'transformed_text', 'mapped', 'output']) {
      expect(res.body).not.toHaveProperty(bad);
    }
  });

  test('happy 响应不含 generic 禁用字段 value / input / data / payload / response / answer / meta / original', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello' });
    expect(res.status).toBe(200);
    for (const bad of ['value', 'input', 'text', 'data', 'payload', 'response', 'answer', 'out', 'meta', 'original']) {
      expect(res.body).not.toHaveProperty(bad);
    }
  });

  test('happy 响应不含跨 endpoint 禁用字段 sum / product / quotient / power / remainder / factorial / negation', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello' });
    expect(res.status).toBe(200);
    for (const bad of ['sum', 'product', 'quotient', 'power', 'remainder', 'factorial', 'negation']) {
      expect(res.body).not.toHaveProperty(bad);
    }
  });
});

describe('GET /uppercase — strict-schema 拒（非法字符）', () => {
  test('GET /uppercase?text= → 400（空串）', async () => {
    const res = await request(app).get('/uppercase').query({ text: '' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  test('GET /uppercase?text=hello123 → 400（含数字）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello123' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  test('GET /uppercase?text=hello%20world → 400（含空格）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello world' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  test('GET /uppercase?text=hello-world → 400（含短横线）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello-world' });
    expect(res.status).toBe(400);
  });

  test('GET /uppercase?text=hello_world → 400（含下划线）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello_world' });
    expect(res.status).toBe(400);
  });

  test('GET /uppercase?text=hello! → 400（含标点）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello!' });
    expect(res.status).toBe(400);
  });

  test('GET /uppercase?text=café → 400（Unicode 字母 é）', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'café' });
    expect(res.status).toBe(400);
  });

  test('GET /uppercase?text=中文 → 400（CJK）', async () => {
    const res = await request(app).get('/uppercase').query({ text: '中文' });
    expect(res.status).toBe(400);
  });

  test('GET /uppercase?text=123 → 400（纯数字）', async () => {
    const res = await request(app).get('/uppercase').query({ text: '123' });
    expect(res.status).toBe(400);
  });
});

describe('GET /uppercase — 缺参 / 错 query 名 / 多 query 名', () => {
  test('GET /uppercase（无 query）→ 400', async () => {
    const res = await request(app).get('/uppercase');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('operation');
  });

  test('GET /uppercase?value=hello（错 query 名 value）→ 400', async () => {
    const res = await request(app).get('/uppercase').query({ value: 'hello' });
    expect(res.status).toBe(400);
  });

  test('GET /uppercase?input=hello（错 query 名 input）→ 400', async () => {
    const res = await request(app).get('/uppercase').query({ input: 'hello' });
    expect(res.status).toBe(400);
  });

  test('GET /uppercase?text=hello&text=world（多 text query）→ 400', async () => {
    const res = await request(app).get('/uppercase?text=hello&text=world');
    expect(res.status).toBe(400);
  });

  test('strict 拒错误体顶层 keys 字面集合 == ["error"]', async () => {
    const res = await request(app).get('/uppercase').query({ text: 'hello123' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body).sort()).toEqual(['error']);
  });
});

describe('GET /uppercase — 8 路由回归不破坏', () => {
  test('/health 仍返 {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  test('/sum?a=2&b=3 仍返 {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.sum).toBe(5);
  });

  test('/multiply?a=7&b=5 仍返 {product:35}', async () => {
    const res = await request(app).get('/multiply').query({ a: '7', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body.product).toBe(35);
  });

  test('/divide?a=10&b=2 仍返 {quotient:5}', async () => {
    const res = await request(app).get('/divide').query({ a: '10', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(5);
  });

  test('/factorial?n=5 仍返 {factorial:120}', async () => {
    const res = await request(app).get('/factorial').query({ n: '5' });
    expect(res.status).toBe(200);
    expect(res.body.factorial).toBe(120);
  });

  test('/increment?value=10 仍返 {result:11, operation:"increment"}', async () => {
    const res = await request(app).get('/increment').query({ value: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ result: 11, operation: 'increment' });
  });
});
