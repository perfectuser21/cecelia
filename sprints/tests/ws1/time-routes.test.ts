/**
 * Workstream 1 — 时间查询端点 [BEHAVIOR] 集成测试
 *
 * 被测 SUT: packages/brain/src/routes/time.js （Round 1 Red 阶段 — 该文件尚未创建）
 * 覆盖合同场景: PRD 场景 1–6 及 contract-draft.md Feature 1–4 的 BEHAVIOR 覆盖列表
 *
 * 导入路径约定: 测试从 sprints/tests/ws1/ 上溯 3 层到 /workspace，再进入 packages/brain
 *   sprints/tests/ws1/*.test.ts  →  ../../../packages/brain/src/routes/time.js
 *
 * 为了让每个 it() 独立产出 Red（而非 beforeAll 抛错整文件只记 1 failure），
 * 每个 it 都通过 getApp() 懒惰地 dynamic import，失败时只污染当前 it。
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

async function getApp(): Promise<ReturnType<typeof express>> {
  const mod = await import('../../../packages/brain/src/routes/time.js');
  const router = (mod as { default: express.Router }).default;
  const app = express();
  app.use('/api/brain/time', router);
  return app;
}

// ---------- /iso ----------
describe('GET /api/brain/time/iso [BEHAVIOR]', () => {
  it('returns HTTP 200', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.status).toBe(200);
  });

  it('body.iso is a non-empty string', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso.length).toBeGreaterThan(0);
  });

  it('body.iso is parseable by Date.parse to a finite number', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    const parsed = Date.parse(res.body.iso);
    expect(Number.isFinite(parsed)).toBe(true);
  });

  it('body.iso is within 10 seconds of current server time', async () => {
    const app = await getApp();
    const before = Date.now();
    const res = await request(app).get('/api/brain/time/iso');
    const after = Date.now();
    const parsed = Date.parse(res.body.iso);
    expect(parsed).toBeGreaterThanOrEqual(before - 10_000);
    expect(parsed).toBeLessThanOrEqual(after + 10_000);
  });

  it('body.iso ends with Z (UTC marker)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.body.iso.endsWith('Z')).toBe(true);
  });
});

// ---------- /unix ----------
describe('GET /api/brain/time/unix [BEHAVIOR]', () => {
  it('returns HTTP 200', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/unix');
    expect(res.status).toBe(200);
  });

  it('body.unix is a number', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/unix');
    expect(typeof res.body.unix).toBe('number');
  });

  it('body.unix is an integer (Number.isInteger true)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/unix');
    expect(Number.isInteger(res.body.unix)).toBe(true);
  });

  it('body.unix is within 5 seconds of current server Unix time', async () => {
    const app = await getApp();
    const before = Math.floor(Date.now() / 1000);
    const res = await request(app).get('/api/brain/time/unix');
    const after = Math.floor(Date.now() / 1000);
    expect(res.body.unix).toBeGreaterThanOrEqual(before - 5);
    expect(res.body.unix).toBeLessThanOrEqual(after + 5);
  });
});

// ---------- /timezone 合法输入 ----------
describe('GET /api/brain/time/timezone (valid tz) [BEHAVIOR]', () => {
  it('returns HTTP 200 for tz=Asia/Shanghai', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai');
    expect(res.status).toBe(200);
  });

  it('body.tz equals Asia/Shanghai', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai');
    expect(res.body.tz).toBe('Asia/Shanghai');
  });

  it('body.iso ends with +08:00 for Asia/Shanghai', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso.endsWith('+08:00')).toBe(true);
  });

  it('body.iso for Asia/Shanghai is parseable and within 10 seconds of server time', async () => {
    const app = await getApp();
    const before = Date.now();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai');
    const after = Date.now();
    const parsed = Date.parse(res.body.iso);
    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(before - 10_000);
    expect(parsed).toBeLessThanOrEqual(after + 10_000);
  });

  it('body.iso for America/New_York ends with -04:00 or -05:00 (DST-aware)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=America/New_York');
    expect(res.status).toBe(200);
    expect(res.body.tz).toBe('America/New_York');
    const iso: string = res.body.iso;
    const endsWithValidOffset = iso.endsWith('-04:00') || iso.endsWith('-05:00');
    expect(endsWithValidOffset).toBe(true);
  });
});

// ---------- /timezone 错误处理 ----------
describe('GET /api/brain/time/timezone (error handling) [BEHAVIOR]', () => {
  it('returns HTTP 400 for invalid tz=Mars/Olympus', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Mars/Olympus');
    expect(res.status).toBe(400);
  });

  it('invalid tz body.error is a non-empty string', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Mars/Olympus');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('returns HTTP 400 when tz query is missing', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone');
    expect(res.status).toBe(400);
  });

  it('missing tz body.error mentions tz (case-insensitive)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.toLowerCase()).toContain('tz');
  });

  it('invalid tz request does not crash server — subsequent /iso still returns 200', async () => {
    const app = await getApp();
    await request(app).get('/api/brain/time/timezone?tz=Mars/Olympus');
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.status).toBe(200);
    expect(typeof res.body.iso).toBe('string');
  });
});
