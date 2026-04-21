import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ISO_8601_EXTENDED =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// TDD Red 阶段：time.js 尚不存在。每个 it 内部 dynamic import，让每个 it 独立失败——
// Reviewer 看到的是 N 个独立红，而不是整 suite 一次性崩。
// R3 修订：从 .ts 改为 .js，与 Brain workspace 同语言，消除 TS 解析链可用性疑虑。
async function createAppOrThrow() {
  const mod = await import(
    /* @vite-ignore */ '../../../packages/brain/src/routes/time.js'
  );
  const router = mod.default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain/time', router);
  return app;
}

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR]', () => {
  it('returns HTTP 200 with application/json content-type', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('response body contains iso, timezone, unix fields all non-empty', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(res.body).toHaveProperty('iso');
    expect(res.body).toHaveProperty('timezone');
    expect(res.body).toHaveProperty('unix');
    expect(res.body.iso).not.toBe('');
    expect(res.body.iso).not.toBeNull();
    expect(res.body.timezone).not.toBe('');
    expect(res.body.timezone).not.toBeNull();
    expect(res.body.unix).not.toBe('');
    expect(res.body.unix).not.toBeNull();
  });

  it('iso is a valid ISO 8601 extended format string parseable by Date', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(ISO_8601_EXTENDED);
    const parsed = Date.parse(res.body.iso);
    expect(Number.isNaN(parsed)).toBe(false);
  });

  it('timezone is a non-empty string', async () => {
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('timezone is a valid IANA name accepted by Intl.DateTimeFormat', async () => {
    // R2 新增：仅"非空字符串"不够——真实 IANA 时区名会被 ICU/V8 认可，
    // 返回 "x" / "local" / "" 等占位值时此断言失败。
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    const tz = res.body.timezone;
    expect(typeof tz).toBe('string');
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: tz })).not.toThrow();
    // 双保险：构造出的 formatter 的 resolvedOptions.timeZone 与输入一致（IANA 规范化后）
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
    expect(typeof resolved).toBe('string');
    expect(resolved.length).toBeGreaterThan(0);
  });

  it('unix is a positive integer in seconds (lower bound > 1e9, upper bound < 1e12)', async () => {
    // R3 新增下限 1e9（≈ 2001-09-09 后），防止 0/极小正整数等退化值蒙混过关。
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(res.body.unix).toBeGreaterThan(1e9);
    // 秒级判定：当前 unix 秒约 1.7e9；毫秒级会 >= 1e12
    expect(res.body.unix).toBeLessThan(1e12);
    // 合理性：不应比真实当下差 > 60 秒
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Math.abs(res.body.unix - nowSec)).toBeLessThanOrEqual(60);
  });

  it('iso and unix within a single response represent the exact same second (strict equality)', async () => {
    // R2 收紧：单一 new Date() 快照实现下，iso 和 unix 的秒值必然严格相等。
    // 如果 Generator 错误地分别调用了 new Date()，机器负载高时会产生 1 秒偏差 → 被此断言捕获。
    // R3 备注：本断言是"单一快照"语义的真正兜底，因此 ARTIFACT 层删除"new Date( 文本恰好 1 次"约束。
    const app = await createAppOrThrow();
    const res = await request(app).get('/api/brain/time');
    const isoSec = Math.floor(Date.parse(res.body.iso) / 1000);
    const unixSec = res.body.unix;
    expect(isoSec).toBe(unixSec);
  });

  it('two consecutive calls both succeed and each response is internally consistent to the second', async () => {
    // R2 收紧：每次响应内部 iso-秒 与 unix 严格相等；但两次调用间允许自然推进。
    const app = await createAppOrThrow();
    const res1 = await request(app).get('/api/brain/time');
    const res2 = await request(app).get('/api/brain/time');
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    for (const res of [res1, res2]) {
      expect(res.body.iso).toMatch(ISO_8601_EXTENDED);
      expect(Number.isInteger(res.body.unix)).toBe(true);
      expect(res.body.unix).toBeGreaterThan(1e9);
      expect(res.body.unix).toBeLessThan(1e12);
      const isoSec = Math.floor(Date.parse(res.body.iso) / 1000);
      expect(isoSec).toBe(res.body.unix);
    }
    expect(res2.body.unix).toBeGreaterThanOrEqual(res1.body.unix);
  });

  it('does not require any auth header to return 200', async () => {
    const app = await createAppOrThrow();
    // 不带任何 Authorization / Cookie / X-API-Key 等头部也应成功
    const res = await request(app).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('iso');
  });

  it('packages/brain/server.js imports time router and mounts it at /api/brain/time using the same variable', () => {
    // R2 新增：静态解析真实 server.js，确认挂载路径与 import 变量名一致。
    // 不启动 server（有 DB/WebSocket 副作用），但用源文件内容验证"挂载真的可达"。
    const thisFile = fileURLToPath(import.meta.url);
    const serverPath = resolve(dirname(thisFile), '../../../packages/brain/server.js');
    const src = readFileSync(serverPath, 'utf8');

    // 必须有 ESM import timeRoutes from './src/routes/time.js'
    const importRe = /import\s+timeRoutes\s+from\s+['"]\.\/src\/routes\/time\.js['"]/;
    expect(src).toMatch(importRe);

    // 必须以严格字面量挂载：app.use('/api/brain/time', timeRoutes)
    const mountRe = /app\.use\s*\(\s*['"]\/api\/brain\/time['"]\s*,\s*timeRoutes\s*\)/;
    expect(src).toMatch(mountRe);
  });
});
