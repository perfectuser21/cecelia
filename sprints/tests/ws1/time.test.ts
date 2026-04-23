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

  it('timezone reflects Intl-resolved value (is NOT hardcoded to "UTC")', async () => {
    // 反向：如果实现永远硬编码 'UTC'，本测试会失败（mutation detection）
    // mock Intl.DateTimeFormat().resolvedOptions().timeZone = 'Asia/Tokyo'
    const spy = vi
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        () =>
          ({
            resolvedOptions: () =>
              ({ timeZone: 'Asia/Tokyo' as string }) as Intl.ResolvedDateTimeFormatOptions,
          }) as unknown as Intl.DateTimeFormat,
      );
    const res = await request(makeApp()).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('Asia/Tokyo');
    spy.mockRestore();
  });

  // ===== Round 3 新增 — Reviewer Round 2 问题 2：非 GET 方法 + body 污染立场 =====

  it('non-GET methods (POST/PUT/PATCH/DELETE) on /api/brain/time do NOT return HTTP 200 and do NOT leak iso/timezone/unix', async () => {
    // Round 3 立场：端点仅声明 router.get('/time')；其它 HTTP 方法不得触发 handler。
    // 不绑定具体状态码（404 vs 405 是实现细节），但必须非 200，且响应体不得含三字段任何一个 key。
    const app = makeApp();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app)[method]('/api/brain/time');
      expect(res.status).not.toBe(200);
      // 响应体若为 JSON 对象，则不得包含任何服务器时间字段
      if (res.body && typeof res.body === 'object' && !Array.isArray(res.body)) {
        expect(res.body).not.toHaveProperty('iso');
        expect(res.body).not.toHaveProperty('timezone');
        expect(res.body).not.toHaveProperty('unix');
      }
    }
  });

  it('POST with JSON body containing {iso,unix,timezone} does NOT poison response (handler never executes)', async () => {
    // Round 3 立场：body 污染免疫 = 非 GET 不触发 handler，所以即便带恶意 body
    // 也不会有 iso/timezone/unix 产出。反向验证：body 中的 "evil"/1/"Fake/Zone" 不得回显。
    const res = await request(makeApp())
      .post('/api/brain/time')
      .set('Content-Type', 'application/json')
      .send({ iso: 'evil', unix: 1, timezone: 'Fake/Zone' });
    expect(res.status).not.toBe(200);
    const bodyText = typeof res.text === 'string' ? res.text : JSON.stringify(res.body ?? {});
    // 响应正文不得回显恶意 body 字段值
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
