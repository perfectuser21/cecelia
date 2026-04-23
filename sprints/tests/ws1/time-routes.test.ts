/**
 * Workstream 1 — 时间查询端点 [BEHAVIOR] 集成测试（Round 3）
 *
 * 被测 SUT: packages/brain/src/routes/time.js （Round 3 Red 阶段 — 该文件尚未创建）
 * 覆盖合同场景: PRD 场景 1–6 + contract-draft.md Feature 1–4 BEHAVIOR 覆盖列表
 *
 * Round 3 相对 Round 2 的变更（处理 Reviewer 反馈）:
 *   + [风险 1 / 阻断] DST 硬编码 + 系统时间未冻结 → 现在用 vi.useFakeTimers 把
 *     系统时钟冻结到 FROZEN_NOW_UTC = 2026-04-23T10:00:00.000Z，这样：
 *       - America/New_York 永远落在 DST 窗口（2026-03-08 ~ 2026-11-01）内 → -04:00
 *       - "within N seconds of current server time" 语义转化为"服务器返回的时间
 *         必须基于 Date.now() 即冻结时间"（容差保留给 event-loop 抖动）
 *       - 半年后 CI 上跑仍然稳定红/绿，不受真实日历/DST 切换影响
 *     注意: toFake 只指定 ['Date']，不 fake setTimeout/setInterval/setImmediate，
 *     否则 supertest/express 异步管道会挂住。
 *   + [风险 2 / 阻断] ?tz=A&tz=B (duplicated tz) spec 未定义 → 现在要求 400 +
 *     body.error 提示 "tz must be a single string"，共新增 2 个 it。
 *
 * 合同 it 数量: 26（Round 2=24 + Round 3 新增 tz 数组 2 个）。
 *
 * 导入路径: sprints/tests/ws1/*.test.ts → ../../../packages/brain/src/routes/time.js
 * CI 复制体: packages/brain/src/__tests__/routes/time-routes.test.ts
 *   Generator 原样复制 + 只调整 import 路径为 '../../routes/time.js'。
 *
 * 每个 it 独立 getApp()，让 Red 阶段 26 个 it 各自独立 FAIL（而非 beforeAll 抛错
 * 合并成 1 个 failure）。
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Round 3: 冻结系统时间 → DST 状态 & 时间断言双稳定
const FROZEN_NOW_UTC = new Date('2026-04-23T10:00:00.000Z');

beforeAll(() => {
  // 只 fake Date，保留 setTimeout/setInterval 给 supertest/express 用
  vi.useFakeTimers({
    now: FROZEN_NOW_UTC,
    toFake: ['Date'],
  });
});

afterAll(() => {
  vi.useRealTimers();
});

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
    // Round 3: 系统时间冻结在 2026-04-23T10:00:00.000Z (in DST 窗口) → 永远 -04:00
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

  it('GET /timezone?tz=Asia/Shanghai&tz=UTC (duplicated tz) returns HTTP 400 — tz must be a single string', async () => {
    // Round 3 新增: 覆盖 express req.query.tz 被解析为数组 ['Asia/Shanghai','UTC'] 的场景
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai&tz=UTC');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('GET /timezone duplicated tz body.error explains tz must be a single string value', async () => {
    // Round 3 新增: error message 必须明确告知客户端原因（不是笼统的 "invalid tz"）
    const app = await getApp();
    const res = await request(app).get('/api/brain/time/timezone?tz=Asia/Shanghai&tz=UTC');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    const msg = res.body.error.toLowerCase();
    expect(msg).toContain('tz');
    // 错误信息必须提到 "single" 或 "one" 或 "string"，避免和非法 tz 错误信息无法区分
    expect(msg.match(/\b(single|one|string|array|multiple|duplicat)/)).not.toBeNull();
  });

  it('invalid tz request does not crash server — subsequent /iso still returns 200', async () => {
    const app = await getApp();
    await request(app).get('/api/brain/time/timezone?tz=Mars/Olympus');
    const res = await request(app).get('/api/brain/time/iso');
    expect(res.status).toBe(200);
    expect(typeof res.body.iso).toBe('string');
  });
});
