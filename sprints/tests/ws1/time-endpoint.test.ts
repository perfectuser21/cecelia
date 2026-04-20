import { describe, it, expect } from 'vitest';
import request from 'supertest';

// Round 2：直接从 Brain 的 `createApp()` 工厂获取真实 app 实例，
// 通过 supertest 做内存 HTTP 调用，避免依赖外部监听端口（ECONNREFUSED 假红）。
// 工厂尚不存在时 import 会抛 ERR_MODULE_NOT_FOUND，让 7 个 it() 同步变红。
const APP_FACTORY_SPEC = '../../../packages/brain/src/app.js';

// 严格 ISO-8601：YYYY-MM-DDTHH:mm:ss[.sss] + (Z | ±HH:MM | ±HHMM)
// 裸日期 "2026-04-20" 或缺时区后缀不合格。
const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

async function buildApp() {
  const mod: any = await import(/* @vite-ignore */ APP_FACTORY_SPEC);
  const createApp = mod.createApp ?? mod.default?.createApp;
  if (typeof createApp !== 'function') {
    throw new Error(
      `createApp is not exported from ${APP_FACTORY_SPEC}; Round 2 要求 src/app.js 具名导出 createApp`,
    );
  }
  return createApp();
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('responds 200 with application/json content-type', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('returns exactly three keys: iso, timezone, unix', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/time');
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['iso', 'timezone', 'unix']);
  });

  it('iso field matches strict ISO-8601 regex with T separator and timezone suffix', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.iso).toBe('string');
    expect(ISO_8601_REGEX.test(res.body.iso)).toBe(true);
    // 双重防伪：解析为有限毫秒数
    const parsedMs = new Date(res.body.iso).getTime();
    expect(Number.isFinite(parsedMs)).toBe(true);
  });

  it('timezone field is a non-empty string', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('unix field is an integer seconds timestamp within plausible window', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    // 秒级 Unix 时间戳窗口：2020-01-01 ~ 2100-01-01
    // 拦截误返毫秒（会远超 4_102_444_800）或误返 0/负数。
    expect(res.body.unix).toBeGreaterThan(1_577_836_800);
    expect(res.body.unix).toBeLessThan(4_102_444_800);
  });

  it('iso and unix timestamps agree within 2 seconds', async () => {
    const app = await buildApp();
    const res = await request(app).get('/api/brain/time');
    const isoSeconds = new Date(res.body.iso).getTime() / 1000;
    const drift = Math.abs(isoSeconds - res.body.unix);
    expect(drift).toBeLessThanOrEqual(2);
  });

  it('is idempotent: two sequential calls both return 200 with identical shape and timezone', async () => {
    const app = await buildApp();
    const a = await request(app).get('/api/brain/time');
    const b = await request(app).get('/api/brain/time');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(Object.keys(a.body).sort()).toEqual(['iso', 'timezone', 'unix']);
    expect(Object.keys(b.body).sort()).toEqual(['iso', 'timezone', 'unix']);
    expect(a.body.timezone).toBe(b.body.timezone);
  });
});
