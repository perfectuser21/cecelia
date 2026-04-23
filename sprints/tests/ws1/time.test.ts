import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
// @ts-expect-error — module does not exist yet (TDD Red phase); will be created by Generator
import timeRouter from '../../../packages/brain/src/routes/time.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', timeRouter as any);
  return app;
}

// 严格 ISO 8601 instant，Round 3 立场：iso 锁死为 UTC Z 后缀（Date.prototype.toISOString() 产物）
// 不再允许 ±HH:MM 后缀，彻底消除 "iso 偏移 vs timezone 字段" 的语义歧义
const ISO_8601_UTC_Z =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

// ==========================================================================
// 主 describe — Round 7 = 12 条 `it()`
// --------------------------------------------------------------------------
// Round 6 结构：曾把 it(11)（模块顶层 Intl 缓存 mutation probe）抽到同文件末尾的
// 独立 describe 块 + `afterAll(vi.restoreAllMocks)` 兜底。
//
// Round 7（Reviewer Round 6 Risk 3）：
//   Reviewer 指出"同文件独立 describe 块 + afterAll"的隔离方案依赖未明文约束的假设
//   （afterAll 若自身抛错，或 describe 块的执行顺序被后续修改打乱，仍可能让 Intl
//   spy 溢出到同文件其它 describe 块）。Reviewer 推荐路线 (b)：把 it(11) 搬到
//   **独立测试文件** `time-intl-caching.test.ts`。vitest 默认每个 test file 跑在
//   独立 worker（OS 进程级）里，进程级隔离从根上杜绝任何 spy/模块缓存的文件间溢出。
//
// 本文件只保留"不依赖 Intl spy 切换"的 12 条 behavior it()（含 it(10) 用 mockImplementation
// 但 afterEach 已逐条兜底 + 单次调用，不涉及跨请求切换）。
// ==========================================================================
describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/brain/time responds with HTTP 200 and application/json content type', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('response body contains exactly the three keys iso, timezone, unix — no others', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(Object.keys(res.body).sort()).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso is a string parseable as a Date within 2 seconds of request time', async () => {
    const before = Date.now();
    const res = await request(makeApp()).get('/api/brain/time');
    const after = Date.now();
    expect(typeof res.body.iso).toBe('string');
    const parsedMs = new Date(res.body.iso).getTime();
    expect(Number.isFinite(parsedMs)).toBe(true);
    expect(parsedMs).toBeGreaterThanOrEqual(before - 2000);
    expect(parsedMs).toBeLessThanOrEqual(after + 2000);
  });

  it('iso matches strict ISO 8601 UTC instant format (Z suffix only, no ±HH:MM)', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(typeof res.body.iso).toBe('string');
    // Round 3 立场：iso 必须是 UTC Z 后缀（Date.prototype.toISOString() 产物）
    // 不允许本地偏移后缀，timezone 字段独立承载服务器时区元信息
    expect(res.body.iso).toMatch(ISO_8601_UTC_Z);
    expect(res.body.iso.endsWith('Z')).toBe(true);
    // 反向：下列各类假 iso 必须被拒
    expect('Wed Apr 23 2026 05:00:00 GMT+0800').not.toMatch(ISO_8601_UTC_Z);
    expect('2024-01-01T00:00:00').not.toMatch(ISO_8601_UTC_Z);
    expect('2024/01/01 00:00:00').not.toMatch(ISO_8601_UTC_Z);
    // Round 3 新增反例：带 ±HH:MM 偏移的 ISO 8601 也必须被拒（Z-only 立场）
    expect('2026-04-23T12:00:00+08:00').not.toMatch(ISO_8601_UTC_Z);
    expect('2026-04-23T12:00:00-05:30').not.toMatch(ISO_8601_UTC_Z);
  });

  it('unix is a positive integer in seconds (at most 10 digits), not milliseconds', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThan(0);
    expect(String(res.body.unix).length).toBeLessThanOrEqual(10);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Math.abs(res.body.unix - nowSec)).toBeLessThanOrEqual(2);
  });

  it('timezone is a non-empty string', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('timezone is a valid IANA zone name (accepted by Intl.DateTimeFormat constructor)', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    // 有效 IANA 名字传进 Intl.DateTimeFormat 不抛；否则抛 RangeError
    // Round 7（Reviewer Round 6 Risk 3）：it(11) 已搬到独立文件 time-intl-caching.test.ts —
    // 即便该文件的 Intl spy 出问题，也因 vitest 默认 file-per-worker 进程隔离不会污染本文件
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: res.body.timezone })).not.toThrow();
    // 反向：保证这条断言对假 IANA 真的会失败
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: 'Not/A/Zone' })).toThrow();
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: 'hello' })).toThrow();
  });

  it('new Date(iso).getTime() and unix * 1000 agree within 2000ms', async () => {
    const res = await request(makeApp()).get('/api/brain/time');
    const isoMs = new Date(res.body.iso).getTime();
    const unixMs = res.body.unix * 1000;
    expect(Math.abs(isoMs - unixMs)).toBeLessThanOrEqual(2000);
  });

  it('ignores query parameters and returns server-side current time (cannot be poisoned by ?iso=evil etc.)', async () => {
    const before = Date.now();
    const res = await request(makeApp())
      .get('/api/brain/time')
      .query({ iso: 'evil', unix: '1', timezone: 'Fake/Zone' });
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.body.iso).not.toBe('evil');
    expect(res.body.unix).not.toBe(1);
    expect(res.body.timezone).not.toBe('Fake/Zone');
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    const isoMs = new Date(res.body.iso).getTime();
    expect(isoMs).toBeGreaterThanOrEqual(before - 2000);
    expect(isoMs).toBeLessThanOrEqual(after + 2000);
  });

  it('timezone falls back to "UTC" when Intl.DateTimeFormat resolves timeZone to empty/undefined', async () => {
    // 模拟 Intl.DateTimeFormat().resolvedOptions().timeZone 返回空字符串的容器/运行时环境
    // 单次 mock + 本 it 结束即 mockRestore + afterEach 兜底 restoreAllMocks；
    // 不涉及"两次调用之间切 mock"场景（那种跨请求切换的 it 已搬到独立文件）
    const spy = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        () =>
          ({
            resolvedOptions: () => ({ timeZone: '' as unknown as string }) as Intl.ResolvedDateTimeFormatOptions,
          }) as unknown as Intl.DateTimeFormat,
      );
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('UTC');
    spy.mockRestore();
  });

  // ===== Round 3 新增 / Round 4 收紧 — Reviewer Round 3 问题 3：机械化 status + raw-text 断言 =====

  it('non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys', async () => {
    // Round 4 立场（Reviewer Round 3 问题 3）：端点仅声明 router.get('/time')；
    // 其它 HTTP 方法不得触发 handler，状态码必须 ∈ {404, 405} 硬枚举（不再是"非 200"软阈值）：
    //   - Express 默认未匹配路由 → 404
    //   - 若启用 methodNotAllowed 中间件 → 405
    //   - 其它值（500/200/302/204 等）均视为假实现失败
    // 响应体中不得包含 iso/timezone/unix 任一 key（覆盖"handler 执行但不泄漏" vs "handler 永不执行"两种语义）。
    // 本 supertest 场景无 Brain 全局 middleware，仅挂接 timeRouter，因此硬枚举 {404, 405} 合理；
    // 真机 E2E 场景（Brain 可能叠加 auth/rate-limit/custom 404 等 middleware）状态码由 brain-time.sh step 8
    // 用原则规则 4xx/5xx 判定（Round 7 — Reviewer Round 6 Risk 1/2）
    const ALLOWED_STATUS = [404, 405];
    const app = makeApp();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app)[method]('/api/brain/time');
      expect(ALLOWED_STATUS).toContain(res.status);
      // 响应体若为 JSON 对象，则不得包含任何服务器时间字段
      if (res.body && typeof res.body === 'object' && !Array.isArray(res.body)) {
        expect(res.body).not.toHaveProperty('iso');
        expect(res.body).not.toHaveProperty('timezone');
        expect(res.body).not.toHaveProperty('unix');
      }
    }
  });

  it('POST with JSON body containing {iso,unix,timezone} does NOT poison response — raw res.text must not contain "evil" or "Fake/Zone" literals', async () => {
    // Round 4 立场（Reviewer Round 3 问题 3）：body 污染免疫需在 raw response.text 与 parsed body 双层都机械判定。
    // 不再只靠"非 200"软断言——同样要求 status ∈ {404, 405}，并追加 res.text 字面量反向断言，
    // 覆盖"handler 执行但不回显" vs "handler 根本不执行"的边界模糊场景。
    const res = await request(makeApp())
      .post('/api/brain/time')
      .set('Content-Type', 'application/json')
      .send({ iso: 'evil', unix: 1, timezone: 'Fake/Zone' });
    expect([404, 405]).toContain(res.status);

    // Round 4 新增：对 raw response.text 直接做字面量 not.toContain 检查
    const rawText = typeof res.text === 'string' ? res.text : '';
    expect(rawText).not.toContain('evil');
    expect(rawText).not.toContain('Fake/Zone');

    // 兼容：若响应正文是 buffer/空/非 JSON，仍对序列化形式做反向 regex 双保险
    const bodyText = rawText !== '' ? rawText : JSON.stringify(res.body ?? {});
    expect(bodyText).not.toMatch(/\bevil\b/);
    expect(bodyText).not.toMatch(/Fake\/Zone/);

    // 若响应为结构化 JSON，则不得有 iso/unix/timezone key
    if (res.body && typeof res.body === 'object' && !Array.isArray(res.body)) {
      expect(res.body).not.toHaveProperty('iso');
      expect(res.body).not.toHaveProperty('unix');
      expect(res.body).not.toHaveProperty('timezone');
    }
  });
});
