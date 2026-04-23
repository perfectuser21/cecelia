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

  it('timezone re-resolves per request — NOT cached at module top level (mutation: const CACHED_TZ = Intl.DateTimeFormat()...)', async () => {
    // Round 5 立场（Reviewer Round 4 Risk 2）：
    // 原 it(11) 只验证「timezone 非硬编码 UTC」，但**无法抓住**「模块顶层缓存 Intl 解析」这一假实现
    // （例：`const CACHED_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone; handler → timezone: CACHED_TZ`）。
    // Reviewer Round 4 指出老 ARTIFACT 切片正则可被 `const I = Intl` 别名绕过，必须切到行为验证。
    //
    // 新路线：动态 import + 两次 mock 切换 **且两次之间不重 import 模块**，模拟请求期内时区变化。
    //   步骤：
    //     1. vi.resetModules() 清 ESM module cache
    //     2. 先以 'Asia/Tokyo' mock Intl.DateTimeFormat，**此时才**动态 import time.js — 触发模块顶层代码执行
    //     3. 发请求 A，期望 timezone === 'Asia/Tokyo'（证明 mock 生效）
    //     4. 切换 mock 到 'America/New_York'（不再重 import 模块）
    //     5. 发请求 B，期望 timezone === 'America/New_York'
    //   若实现在模块顶层缓存（`const CACHED = Intl.DateTimeFormat()...`），
    //   第二次请求仍返回首次缓存的 'Asia/Tokyo' → 测试失败 → 抓出 bug
    //   若实现在 handler 内部每次调 Intl（正确），第二次请求反映新 mock → 测试通过。
    vi.resetModules();

    const spyA = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        () =>
          ({
            resolvedOptions: () =>
              ({ timeZone: 'Asia/Tokyo' as string }) as Intl.ResolvedDateTimeFormatOptions,
          }) as unknown as Intl.DateTimeFormat,
      );

    // 动态 import — 模块加载时执行顶层代码会被 spyA 捕获
    const mod = (await import(
      /* @vite-ignore */ `../../../packages/brain/src/routes/time.js?rev5=${Date.now()}`
    )) as { default: express.Router };
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res1 = await request(app).get('/api/brain/time');
    expect(res1.status).toBe(200);
    expect(res1.body.timezone).toBe('Asia/Tokyo');
    spyA.mockRestore();

    // 切换 mock —— **不重 import** 模块
    const spyB = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        () =>
          ({
            resolvedOptions: () =>
              ({ timeZone: 'America/New_York' as string }) as Intl.ResolvedDateTimeFormatOptions,
          }) as unknown as Intl.DateTimeFormat,
      );

    const res2 = await request(app).get('/api/brain/time');
    expect(res2.status).toBe(200);
    // 关键断言：若实现是 `const CACHED_TZ = Intl.DateTimeFormat()...` 在模块顶层求值，
    // 则这里仍返回 'Asia/Tokyo'（模块只 import 一次 → 顶层代码只执行一次 → 缓存到 'Asia/Tokyo'）→ 测试失败
    // 若实现是 handler 内部每次调 Intl，则 res2.body.timezone === 'America/New_York' → 测试通过
    expect(res2.body.timezone).toBe('America/New_York');
    spyB.mockRestore();
  });

  // ===== Round 3 新增 / Round 4 收紧 — Reviewer Round 3 问题 3：机械化 status + raw-text 断言 =====

  it('non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time respond with status in {404,405} and do NOT leak iso/timezone/unix keys', async () => {
    // Round 4 立场（Reviewer Round 3 问题 3）：端点仅声明 router.get('/time')；
    // 其它 HTTP 方法不得触发 handler，状态码必须 ∈ {404, 405} 硬枚举（不再是「非 200」软阈值）：
    //   - Express 默认未匹配路由 → 404
    //   - 若启用 methodNotAllowed 中间件 → 405
    //   - 其它值（500/200/302/204 等）均视为假实现失败
    // 响应体中不得包含 iso/timezone/unix 任一 key（覆盖「handler 执行但不泄漏」 vs 「handler 永不执行」两种语义）。
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
    // 不再只靠「非 200」软断言——同样要求 status ∈ {404, 405}，并追加 res.text 字面量反向断言，
    // 覆盖「handler 执行但不回显」 vs 「handler 根本不执行」的边界模糊场景。
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
