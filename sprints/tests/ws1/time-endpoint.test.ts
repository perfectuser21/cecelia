import { describe, it, expect } from 'vitest';
import request from 'supertest';

// Round 2：直接从 Brain 的 `createApp()` 工厂获取真实 app 实例，
// 通过 supertest 做内存 HTTP 调用，避免依赖外部监听端口（ECONNREFUSED 假红）。
// Round 3：新增两条实时性断言（wall-clock 锚点 + 时间推进），
// 封死"硬编码固定时间戳"类实现的逃逸路径。
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  // ——————— Round 3 新增：实时性断言 ———————

  it('unix value tracks observer wall-clock within 10 seconds (rejects hardcoded timestamp)', async () => {
    const app = await buildApp();
    // 测试端在调用前后分别取系统时间，形成夹逼区间。
    // 真实端点返回的 unix 必须落在这个区间的 ±10s 容差内。
    const before = Math.floor(Date.now() / 1000);
    const res = await request(app).get('/api/brain/time');
    const after = Math.floor(Date.now() / 1000);
    expect(res.status).toBe(200);
    expect(Number.isInteger(res.body.unix)).toBe(true);
    // 硬编码任何固定时间戳（无论部署期、编译期、还是随便写死的）
    // 都会随着 CI 时钟推进越飘越远，在 ±10s 窗口内破防。
    const lowerBound = before - 10;
    const upperBound = after + 10;
    expect(res.body.unix).toBeGreaterThanOrEqual(lowerBound);
    expect(res.body.unix).toBeLessThanOrEqual(upperBound);
  });

  it('unix advances: second call after 1500ms sleep is strictly greater than first call', async () => {
    const app = await buildApp();
    const r1 = await request(app).get('/api/brain/time');
    expect(r1.status).toBe(200);
    expect(Number.isInteger(r1.body.unix)).toBe(true);
    // 1500ms 间隔保证至少跨过一整秒的边界，即使在 sleep 前 0ms、
    // sleep 后 1500ms 的最坏剪裁下 Math.floor 也会推进 ≥1。
    await sleep(1500);
    const r2 = await request(app).get('/api/brain/time');
    expect(r2.status).toBe(200);
    expect(Number.isInteger(r2.body.unix)).toBe(true);
    // 严格递增：锁死固定 unix 的实现必然命中此断言失败。
    const delta = r2.body.unix - r1.body.unix;
    expect(delta).toBeGreaterThanOrEqual(1);
    // 同时 iso 也应推进（iso-unix 一致约束已被场景 2 覆盖，这里顺带验证可读性）
    const iso1Ms = new Date(r1.body.iso).getTime();
    const iso2Ms = new Date(r2.body.iso).getTime();
    expect(iso2Ms).toBeGreaterThan(iso1Ms);
  });
});
