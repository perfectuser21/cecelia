import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

// Round 4 变更（Reviewer Round 3 风险 1）：删除 Round 2 引入的 IANA_TZ_RE 严格正则。
// 原正则 /^(UTC|[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?)$/ 会误杀合法 IANA 值：
//   - Etc/GMT+0 / Etc/GMT-1（含 + - 和数字）
//   - 单节点别名 GMT / CET / EST 等（无斜杠）
// Reviewer 明确提示"正则与 round-trip 测试 / PRD FR-003 三方冲突 — 放宽字符集或删正则"。
// 选择删除：round-trip 通过 `new Intl.DateTimeFormat(..., { timeZone })` 构造是 IANA 官方验证，
// 能挡住任意 "abc"/"1"/""（抛 RangeError），且无误杀风险。正则层面改为 typeof+非空 string 的结构锁。

// 懒加载：import 失败在每个 it 内单独报红（TDD Red 阶段实现尚未存在）
let app;
async function getApp() {
  if (app) return app;
  const mod = await import('../../../packages/brain/src/routes/time.js');
  const timeRoutes = mod.default;
  const a = express();
  a.use(express.json());
  a.use('/api/brain/time', timeRoutes);
  app = a;
  return app;
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('responds with HTTP 200 and application/json on GET /api/brain/time', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('response body has exactly three keys: iso, timezone, unix', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(Object.keys(res.body).sort()).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso is an ISO-8601 UTC millisecond string', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('timezone is a non-empty string', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('timezone round-trips through Intl.DateTimeFormat without throwing', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    // IANA validity 权威验证：Intl.DateTimeFormat 构造时若 timeZone 非法会抛 RangeError。
    // 能挡住 "abc" / "1" / "" / 任意非 IANA 字符串，且不会误杀 Etc/GMT+0 / GMT / CET 等合法别名。
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: res.body.timezone })).not.toThrow();
  });

  it('unix is an integer within 1 second of current wall clock', async () => {
    const a = await getApp();
    const before = Math.floor(Date.now() / 1000);
    const res = await request(a).get('/api/brain/time');
    const after = Math.floor(Date.now() / 1000);
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThanOrEqual(before - 1);
    expect(res.body.unix).toBeLessThanOrEqual(after + 1);
  });

  it('iso and unix represent the same moment within 1 second tolerance', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    const isoSeconds = Math.floor(new Date(res.body.iso).getTime() / 1000);
    expect(Number.isNaN(isoSeconds)).toBe(false);
    expect(Math.abs(isoSeconds - res.body.unix)).toBeLessThanOrEqual(1);
  });

  it('two consecutive calls spaced 1.1 seconds return different unix values', async () => {
    const a = await getApp();
    const r1 = await request(a).get('/api/brain/time');
    // Round 4：Reviewer Round 3 观察项 — sleep 从 1050ms 升到 1100ms。
    // 1050ms 理论上足够跨秒边界，但 CI 容器 timer throttling 极端情况下 libuv 可能提前返回 <1%；
    // 1100ms 留 100ms 缓冲，彻底消除 timer 抖动风险，CI 固定开销仅 +50ms 可接受。
    await new Promise((r) => setTimeout(r, 1100));
    const r2 = await request(a).get('/api/brain/time');
    expect(r2.body.unix).toBeGreaterThan(r1.body.unix);
  });
});
