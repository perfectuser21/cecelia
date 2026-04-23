import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

// ============================================================================
// Workstream 1 — mutation probe：timezone **每次请求**都走 Intl（不可在模块顶层缓存）
// ----------------------------------------------------------------------------
// 历史脉络：
//   - Round 4 曾用 ARTIFACT 切片正则约束 `Intl.DateTimeFormat(` 出现在 handler 内部，
//     但被别名（`const I = Intl`）、字符串拼接、import-level 赋值绕过。
//   - Round 5 改为行为 probe：`vi.resetModules()` + 动态 import + 两次 mock 切换。
//   - Round 6 把该 it 抽到 `time.test.ts` 文件内的独立 describe 块 + `afterAll(vi.restoreAllMocks)` 兜底。
//   - Round 7（Reviewer Round 6 Risk 3）：Reviewer 指出"同文件独立 describe 块 + afterAll"
//     的隔离依赖未明文约束的假设——afterAll 若自身抛错、describe 执行顺序被后续修改打乱，
//     或 vitest 池配置变更（threads → forks 等），都可能让 Intl spy 污染同文件其它 describe。
//     推荐路线 (b)：把这条 it 搬到**独立测试文件**。vitest 默认每个 test file 跑在自己的
//     worker（threads 池 = 独立 thread，forks 池 = 独立进程），module cache + `Intl` 的 spy
//     都不可能跨文件泄漏 —— 这是**OS/VM 层级的强隔离**，不依赖用户测试代码的兜底纪律。
//
// 本文件的唯一职责：验证"模块顶层 Intl 缓存"这一具体 mutation 被抓住。
// 主行为 it()（12 条）住在 time.test.ts 主 describe 块，与本文件**物理隔离**。
// ============================================================================

describe('Workstream 1 — GET /api/brain/time [BEHAVIOR] — mutation: module-top-level Intl caching (isolated file)', () => {
  afterAll(() => {
    // 本文件内 Intl spy 的最终兜底还原 —— 即便仅为保险（file-level worker 隔离已是主防线）
    vi.restoreAllMocks();
  });

  it('timezone re-resolves per request — NOT cached at module top level (mutation: const CACHED_TZ = Intl.DateTimeFormat()...)', async () => {
    // 路线（Round 5 立场保留，Round 7 仅改变物理位置）：
    //   动态 import + 两次 mock 切换 **且两次之间不重 import 模块**，模拟请求期内时区变化。
    //   步骤：
    //     1. vi.resetModules() 清 ESM module cache
    //     2. 先以 'Asia/Tokyo' mock Intl.DateTimeFormat，**此时才**动态 import time.js — 触发模块顶层代码执行
    //     3. 发请求 A，期望 timezone === 'Asia/Tokyo'（证明 mock 生效）
    //     4. 切换 mock 到 'America/New_York'（不再重 import 模块）
    //     5. 发请求 B，期望 timezone === 'America/New_York'
    //   若实现在模块顶层缓存（`const CACHED = Intl.DateTimeFormat()...`），
    //   第二次请求仍返回首次缓存的 'Asia/Tokyo' → 测试失败 → 抓出 bug
    //   若实现在 handler 内部每次调 Intl（正确），第二次请求反映新 mock → 测试通过。
    //
    // 别名/拼接免疫：spy 拦截的是 `Intl.DateTimeFormat` 属性访问，
    // `const I = Intl; I.DateTimeFormat(...)` 与直接 `Intl.DateTimeFormat(...)` 走同一个属性访问路径，
    // 无法绕过 spy。
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

    // 动态 import — vi.mock 的 Intl spy 已经生效，模块顶层代码若访问 Intl.DateTimeFormat 会被 spyA 捕获
    const mod = (await import(
      /* @vite-ignore */ `../../../packages/brain/src/routes/time.js?rev7intl=${Date.now()}`
    )) as { default: express.Router };
    const app = express();
    app.use(express.json());
    app.use('/api/brain', mod.default);

    const res1 = await request(app).get('/api/brain/time');
    expect(res1.status).toBe(200);
    expect(res1.body.timezone).toBe('Asia/Tokyo');
    spyA.mockRestore();

    // 切换 mock —— **不重 import** 模块；模块顶层代码只执行过一次
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
});
