/**
 * Workstream 1 — 时间查询端点 [BEHAVIOR] 集成测试（Round 2）
 *
 * 被测 SUT: packages/brain/src/routes/time.js （Round 2 Red 阶段 — 该文件尚未创建）
 * 覆盖合同场景: PRD 场景 1–6 及 contract-draft.md Feature 1–4 的 BEHAVIOR 覆盖列表
 *
 * Round 2 相对 Round 1 的新增 / 收紧:
 *   + GET /iso: 严格 ISO 8601 UTC 正则（含 .mmm 毫秒段）
 *   + GET /timezone 合法: 严格 ISO 8601 偏移正则（含 .mmm、以 ±HH:MM 结尾、禁止 Z）
 *   + GET /timezone?tz=UTC / Etc/UTC: body.iso 以 +00:00 结尾（非 Z），body.tz 原样回显
 *   + GET /timezone?tz=America/New_York: 2026-04-23 处 DST 窗口内，必须 -04:00（删 -05:00 两可）
 *   + GET /timezone?tz=asia/shanghai: 大小写敏感，400
 *
 * 导入路径: sprints/tests/ws1/*.test.ts → ../../../packages/brain/src/routes/time.js
 * （sprints/tests/ws1/ 上溯 3 层到 /workspace/，再进 packages/brain/...）
 *
 * CI 复制体位置（由 ARTIFACT 强制）: packages/brain/src/__tests__/routes/time-routes.test.ts
 *   Generator 在 commit 1 原样复制，只允许调整 import 路径为 '../../routes/time.js'
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

// 严格 ISO 8601 正则（毫秒段必选）
const ISO_UTC_STRICT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISO_OFFSET_STRICT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

// ---------- /iso ----------
describe('GET /api/brain/time/iso [BEHAVIOR]', () => {
  it('GET /iso returns HTTP 200', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.status).toBe(200);
  });

  it('GET /iso body.iso is a non-empty string', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso.length).toBeGreaterThan(0);
  });

  it('GET /iso body.iso matches strict ISO 8601 UTC format with .sss ms precision', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(ISO_UTC_STRICT);
    expect(res.body.iso.length).toBe(24); // YYYY-MM-DDTHH:MM:SS.sssZ = 24 字符
  });

  it('GET /iso body.iso is parseable by Date.parse to a finite number', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    const parsed = Date.parse(res.body.iso);
    expect(Number.isFinite(parsed)).toBe(true);
  });

  it('GET /iso body.iso is within 10 seconds of current server time', async () => {
    const app = await getApp();
    const before = Date.now();
    const res = await request(app).get('/api/brain/time/iso');
    const after = Date.now();
    const parsed = Date.parse(res.body.iso);
    expect(parsed).toBeGreaterThanOrEqual(before - 10_000);
    expect(parsed).toBeLessThanOrEqual(after + 10_000);
  });

  it('GET /iso body.iso ends with Z (UTC marker)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.body.iso.endsWith('Z')).toBe(true);
  });
});

// ---------- /unix ----------
describe('GET /api/brain/time/unix [BEHAVIOR]', () => {
  it('GET /unix returns HTTP 200', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/unix');
    expect(res.status).toBe(200);
  });

  it('GET /unix body.unix is a number', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/unix');
    expect(typeof res.body.unix).toBe('number');
  });

  it('GET /unix body.unix is an integer (Number.isInteger true)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/unix');
    expect(Number.isInteger(res.body.unix)).toBe(true);
  });

  it('GET /unix body.unix is within 5 seconds of current server Unix time', async () => {
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
  it('GET /timezone?tz=Asia/Shanghai returns HTTP 200', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai');
    expect(res.status).toBe(200);
  });

  it('GET /timezone?tz=Asia/Shanghai body.tz equals Asia/Shanghai', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai');
    expect(res.body.tz).toBe('Asia/Shanghai');
  });

  it('GET /timezone?tz=Asia/Shanghai body.iso matches strict ISO with +08:00 offset and .sss ms', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(ISO_OFFSET_STRICT);
    expect(res.body.iso.endsWith('+08:00')).toBe(true);
  });

  it('GET /timezone?tz=Asia/Shanghai body.iso is parseable and within 10 seconds of server time', async () => {
    const app = await getApp();
    const before = Date.now();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai');
    const after = Date.now();
    const parsed = Date.parse(res.body.iso);
    expect(Number.isFinite(parsed)).toBe(true);
    expect(parsed).toBeGreaterThanOrEqual(before - 10_000);
    expect(parsed).toBeLessThanOrEqual(after + 10_000);
  });

  it('GET /timezone?tz=America/New_York body.iso ends with -04:00 (DST active on 2026-04-23)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=America/New_York');
    expect(res.status).toBe(200);
    expect(res.body.tz).toBe('America/New_York');
    const iso: string = res.body.iso;
    expect(iso).toMatch(ISO_OFFSET_STRICT);
    expect(iso.endsWith('-04:00')).toBe(true);
  });

  it('GET /timezone?tz=UTC body.iso ends with +00:00 (not Z)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=UTC');
    expect(res.status).toBe(200);
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(ISO_OFFSET_STRICT);
    expect(res.body.iso.endsWith('+00:00')).toBe(true);
    expect(res.body.iso.endsWith('Z')).toBe(false);
  });

  it('GET /timezone?tz=UTC body.tz equals UTC', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=UTC');
    expect(res.status).toBe(200);
    expect(res.body.tz).toBe('UTC');
  });

  it('GET /timezone?tz=Etc/UTC body.iso ends with +00:00 (not Z)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Etc/UTC');
    expect(res.status).toBe(200);
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(ISO_OFFSET_STRICT);
    expect(res.body.iso.endsWith('+00:00')).toBe(true);
    expect(res.body.iso.endsWith('Z')).toBe(false);
  });
});

// ---------- /timezone 错误处理 ----------
describe('GET /api/brain/time/timezone (error handling) [BEHAVIOR]', () => {
  it('GET /timezone?tz=Mars/Olympus returns HTTP 400', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Mars/Olympus');
    expect(res.status).toBe(400);
  });

  it('GET /timezone?tz=Mars/Olympus body.error is a non-empty string', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Mars/Olympus');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('GET /timezone with no tz query returns HTTP 400', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone');
    expect(res.status).toBe(400);
  });

  it('GET /timezone with no tz body.error mentions tz (case-insensitive)', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.toLowerCase()).toContain('tz');
  });

  it('GET /timezone?tz=asia/shanghai (lowercase) returns HTTP 400 — tz match is case-sensitive', async () => {
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=asia/shanghai');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('invalid tz request does not crash server — subsequent /iso still returns 200', async () => {
    const app = await getApp();
    await request(app).get('/api/brain/time/timezone?tz=Mars/Olympus');
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.status).toBe(200);
    expect(typeof res.body.iso).toBe('string');
  });
});
