const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../../playground/server.js').default;

describe('GET /kernel-ping2 [BEHAVIOR]', () => {
  test('返回严格 200 且 result 为 ok2', async () => {
    const res = await request(app).get('/kernel-ping2');
    assert.equal(res.status, 200);
    assert.equal(res.body.result, 'ok2');
  });

  test('仅含 result 字段', async () => {
    const res = await request(app).get('/kernel-ping2');
    assert.deepEqual(Object.keys(res.body), ['result']);
  });

  test('POST 不成功', async () => {
    const res = await request(app).post('/kernel-ping2');
    assert.notEqual(res.status, 200);
  });

  test('既有 health 不回退', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});
