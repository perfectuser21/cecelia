import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

// IANA 时区硬阈值（Round 1 Reviewer 风险 2 回应）：
// 允许 UTC 或 Area/Location（Asia/Shanghai）或 Area/Region/Location（America/Argentina/Buenos_Aires）
const IANA_TZ_RE = /^(UTC|[A-Za-z_]+\/[A-Za-z_]+(\/[A-Za-z_]+)?)$/;

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

  it('timezone is a valid IANA zone matching UTC or Area/Location(/Sub)', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
    expect(res.body.timezone).toMatch(IANA_TZ_RE);
  });

  it('timezone round-trips through Intl.DateTimeFormat without throwing', async () => {
    const a = await getApp();
    const res = await request(a).get('/api/brain/time');
    // IANA validity: Intl.DateTimeFormat 构造时若 timeZone 非法会抛 RangeError
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

  it('two consecutive calls spaced 1.05 seconds return different unix values', async () => {
    const a = await getApp();
    const r1 = await request(a).get('/api/brain/time');
    // 1050ms：既能跨越一个秒边界（Date.now() 取整到秒，只要 wall clock 秒变化就能触发 unix 递增），
    // 又比 Round 2 的 1100ms 省 50ms CI 固定开销（Round 2 Reviewer 非阻塞观察）
    await new Promise((r) => setTimeout(r, 1050));
    const r2 = await request(a).get('/api/brain/time');
    expect(r2.body.unix).toBeGreaterThan(r1.body.unix);
  });
});

// Round 2 曾额外引入一组 BEHAVIOR-STATIC describe（readFileSync(server.js) 做静态正则检查，
// 覆盖笔误 /api/brain/times、import 行、app.use 注册、零缩进顶层）。
// Round 2 Reviewer 非阻塞观察：配合 DoD 里"生产侧测试 import server.js default export + supertest"
// 的 ARTIFACT 强制条款，静态四 it 属于冗余兜底；保留反而给 Generator 合法风格强加约束
// （多行 app.use、IIFE 等都会误杀）。Round 3 采用 Reviewer 推荐路径：
//   - 功能行为在这里用 supertest 覆盖（上方 8 个 it）
//   - 挂载点完整性交给 DoD ARTIFACT 的静态检查（放宽正则，但保留字面量/零缩进/防笔误核心）
//   - "从 server.js 入口真实可达" 由 DoD 强制的生产侧 supertest（packages/brain/tests/time.test.js
//     import server.js default export）锁到 Green commit
// 因此 Round 3 删除 BEHAVIOR-STATIC describe，预期红证据从 12 降到 8。
