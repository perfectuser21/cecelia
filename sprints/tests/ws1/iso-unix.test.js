import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import timeRouter from '../../../packages/brain/src/routes/time.js';

const buildApp = () => {
  const app = express();
  app.use('/', timeRouter);
  return app;
};

describe('Workstream 1 — /iso endpoint [BEHAVIOR]', () => {
  it('GET /iso returns 200 with JSON containing an iso string field', async () => {
    const res = await request(buildApp()).get('/iso');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso.length).toBeGreaterThan(0);
  });

  it('GET /iso iso field is a round-trippable ISO-8601 timestamp with UTC Z suffix', async () => {
    const res = await request(buildApp()).get('/iso');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    // Must be UTC Z form with milliseconds (the toISOString() shape),
    // not +08:00 / -07:00 offset forms which would fail the round-trip equality below.
    expect(res.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const parsed = new Date(res.body.iso);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.toISOString()).toBe(res.body.iso);
  });

  it('GET /iso iso wall-clock lies within [requestStart-1s, responseEnd+1s]', async () => {
    // Hard threshold (Feature 1): body.iso 对应的墙钟时间必须落在
    // [请求发起时刻 − 1s, 响应接收时刻 + 1s] 区间内。
    // 1s buffer 吸收网络 / event-loop 抖动；任何 5s 级漂移都应被拒绝。
    const requestStart = Date.now();
    const res = await request(buildApp()).get('/iso');
    const responseEnd = Date.now();
    expect(res.status).toBe(200);
    const t = new Date(res.body.iso).getTime();
    expect(t).toBeGreaterThanOrEqual(requestStart - 1000);
    expect(t).toBeLessThanOrEqual(responseEnd + 1000);
  });
});

describe('Workstream 1 — /unix endpoint [BEHAVIOR]', () => {
  it('GET /unix returns 200 with JSON and an integer unix field', async () => {
    const res = await request(buildApp()).get('/unix');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThan(0);
  });

  it('GET /unix unix is a second-granularity timestamp (not milliseconds)', async () => {
    const res = await request(buildApp()).get('/unix');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(res.body.unix).toBeGreaterThanOrEqual(nowSec - 5);
    expect(res.body.unix).toBeLessThanOrEqual(nowSec + 5);
    // 2286 年之前的 Unix 秒都 < 1e10（year 2286 ≈ Unix sec 1e10）；
    // 毫秒早已 > 1e12。阈值 < 1e10 与注释数学自洽，
    // 任何"误返回 Date.now() 毫秒"的实现会以 ~1.77e12 直接被这条断言抓住。
    expect(res.body.unix).toBeLessThan(1e10);
  });
});
