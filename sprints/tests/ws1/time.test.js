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

  it('can GET /api/brain/time against the real Brain app exported from server.js', async () => {
    // R4 新增（响应 Round 3 Reviewer 阻断反馈）：
    // R3 前 9 条 BEHAVIOR 跑在 createAppOrThrow() 合成的迷你 Express 上，第 10 条是静态文本解析。
    // 与 PRD US-001 / SC-002「跑起来的 Brain 能被外部 GET 到」存在可被绕过的缝隙：
    // 构造合法 time.js + 合法文本挂载、但实际 app 实例不接 router 的 bug 能通过 R3 全部断言。
    //
    // 本断言直接从 server.js 的命名导出取真实 app，用 supertest 端到端打 /api/brain/time，
    // 闭合 "import 变量名 + app.use 字面量 + 真实 app 实例" 三者的一致性。
    //
    // Generator 需要完成的前置重构（由 DoD ARTIFACT #11/#12 强制）：
    //   1. `const app = express()` 改为 `export const app = express()`（或等价 `export { app }`）
    //   2. 把 runMigrations / listenWithRetry 等 DB/端口副作用顶层 await 收进
    //      `if (!process.env.VITEST) { ... }` 护栏，保证测试下 import 不连 DB、不开端口
    // 任何一步缺失，本断言都会以"import 抛错 / mod.app undefined / 404 / 字段缺失"失败。

    // vitest 1.6.1 运行时自动注入 process.env.VITEST='true'，此处冗余但显式，防 CI 环境变量被重置
    process.env.VITEST = process.env.VITEST || 'true';

    const mod = await import(
      /* @vite-ignore */ '../../../packages/brain/server.js'
    );
    expect(mod).toBeDefined();
    expect(mod.app, 'server.js must expose a named export "app" (export const app = …)').toBeDefined();
    const app = mod.app;
    expect(typeof app).toBe('function'); // Express app 本体是可作为 handler 的 function

    const res = await request(app).get('/api/brain/time');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toHaveProperty('iso');
    expect(res.body).toHaveProperty('timezone');
    expect(res.body).toHaveProperty('unix');
    expect(res.body.iso).not.toBe('');
    expect(res.body.timezone).not.toBe('');
    expect(typeof res.body.unix).toBe('number');

    // 同一响应内 iso 和 unix 同秒严格相等——与 Feature 1 的单一快照语义保持一致
    const isoSec = Math.floor(Date.parse(res.body.iso) / 1000);
    expect(isoSec).toBe(res.body.unix);
  });

  it('fifty consecutive requests each satisfy strict iso/unix same-second equality', async () => {
    // R5 新增（响应 Round 4 Reviewer 阻断反馈）：
    // R4 it#7 "iso↔unix 同秒严格相等" 对"分别 new Date() × 2"的坏实现是概率检测——
    // 两次 new Date() 只相差微秒、几乎总落在同一秒内，单次调用极难碰到跨秒边界。
    //
    // 本测试把该断言在同一次测试内扩到 50 次连续调用：
    //   - 合法单一快照实现：每一次都 trivially 满足 isoSec === unix（毫秒 → 同一秒）
    //   - 分别 new Date() × 2 的坏实现：50 次中至少有一两次会恰好跨秒，任一次失败即红
    //   - 分别 Date.now() 的坏实现：同理（且已被 ARTIFACT #13 静态禁止）
    //
    // 这是 belt-and-suspenders 层，与 ARTIFACT #13（静态 deterministic 硬锁）互为双保险。
    // 性能说明：50 次 supertest 调用在本机 < 500ms，不影响 CI 时长。
    const app = await createAppOrThrow();
    const N = 50;
    const failures = [];
    for (let i = 0; i < N; i++) {
      const res = await request(app).get('/api/brain/time');
      expect(res.status).toBe(200);
      const isoSec = Math.floor(Date.parse(res.body.iso) / 1000);
      if (isoSec !== res.body.unix) {
        failures.push({ i, iso: res.body.iso, isoSec, unix: res.body.unix });
      }
    }
    expect(
      failures,
      `expected all ${N} calls to have Math.floor(Date.parse(iso)/1000) === unix, ` +
        `but got ${failures.length} mismatch(es): ${JSON.stringify(failures.slice(0, 3))}`,
    ).toEqual([]);
  });
});
