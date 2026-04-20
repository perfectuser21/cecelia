# Consciousness E2E Tests (Tick Runtime + HTTP Chain)

**日期**: 2026-04-20
**分支**: cp-*-consciousness-e2e-tests
**前置 PRs**: #2447 / #2457 / #2464（已合并）
**Brain 版本**: 不 bump

---

## 目标

补最后两个测试缺口：
1. **Tick-level runtime**：PATCH memory → 下一轮 tick 真的 0 调用意识模块（当前只有源码级静态断言）
2. **E2E HTTP chain**：GET → PATCH → GET 端到端链路通（当前 routes 单测用 mock pool）

**不做 Playwright** —— 依赖太重（~100MB + chromium + CI service），单 toggle 不值。降级为 supertest + 真 PG HTTP fetch chain。

## 架构

### Part A: `consciousness-tick-runtime.integration.test.js`

**关键策略**：mock 掉 tick.js 顶部 65+ 个重依赖 import（executor / planner / decision / thalamus / alertness / desire / rumination / cognitive-core 等），只留 `consciousness-guard` + `db` + 少量纯函数真实。否则 `executeTick()` 会打到真 LLM / N8N。

```js
// Mock 意识模块（要断言调用次数的）
vi.mock('../../rumination.js', () => ({ runRumination: vi.fn() }));
vi.mock('../../diary-scheduler.js', () => ({ generateDailyDiaryIfNeeded: vi.fn() }));
vi.mock('../../conversation-digest.js', () => ({ runConversationDigest: vi.fn() }));
vi.mock('../../capture-digestion.js', () => ({ runCaptureDigestion: vi.fn() }));
vi.mock('../../suggestion-cycle.js', () => ({ runSuggestionCycle: vi.fn() }));
vi.mock('../../conversation-consolidator.js', () => ({ runConversationConsolidator: vi.fn() }));
vi.mock('../../notebook-feeder.js', () => ({ feedDailyIfNeeded: vi.fn() }));
vi.mock('../../self-report-collector.js', () => ({ collectSelfReport: vi.fn() }));
vi.mock('../../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: vi.fn(),
  synthesizeEvolutionIfNeeded: vi.fn(),
}));
vi.mock('../../desire/index.js', () => ({ runDesireSystem: vi.fn() }));
vi.mock('../../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: vi.fn() }));

// Mock 不想触发真逻辑但不断言的（批量 noop）
vi.mock('../../executor.js', () => ({
  triggerCeceliaRun: vi.fn().mockResolvedValue({ success: false, reason: 'skipped-in-test' }),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue(true),
  getActiveProcessCount: vi.fn().mockResolvedValue(0),
  killProcess: vi.fn(), checkServerResources: vi.fn().mockResolvedValue({ cpu: 50 }),
  probeTaskLiveness: vi.fn(), syncOrphanTasksOnStartup: vi.fn(),
  killProcessTwoStage: vi.fn(), requeueTask: vi.fn(),
  MAX_SEATS: 3, INTERACTIVE_RESERVE: 1,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));
vi.mock('../../planner.js', () => ({ planNextTask: vi.fn().mockResolvedValue(null) }));
vi.mock('../../decision.js', () => ({
  compareGoalProgress: vi.fn().mockResolvedValue({}),
  generateDecision: vi.fn().mockResolvedValue({ action: 'noop' }),
  executeDecision: vi.fn(), splitActionsBySafety: vi.fn().mockReturnValue({ safe: [], unsafe: [] }),
}));
vi.mock('../../thalamus.js', () => ({
  processEvent: vi.fn().mockResolvedValue({ decisions: [] }),
  EVENT_TYPES: {},
}));
vi.mock('../../llm-caller.js', () => ({
  callLLM: vi.fn().mockResolvedValue('mock response'),
}));
// 其它按 executeTick 实际运行时报错的 import 按需补 mock
```

**3 个 test**：
1. `memory=true baseline`：setConsciousnessEnabled(true) → executeTick() → rumination/diary/... mock `called >= 1 time`
2. `memory=false → 意识 mock 0 调用`：setConsciousnessEnabled(false) → executeTick() → 所有意识 mock `toHaveBeenCalledTimes(0)`
3. `env override 优先`：memory=true + `process.env.CONSCIOUSNESS_ENABLED='false'` → executeTick() → 意识 mock 0 调用

### Part B: `consciousness-toggle-e2e.integration.test.js`

**策略**：supertest + express app 组合（参考 `critical-routes.integration.test.js` 的 `makeApp()` 范式），不真起端口。

```js
import request from 'supertest';
import express from 'express';
// ...

function makeApp(pool) {
  const app = express();
  app.use(express.json());
  const settingsRoutes = /* dynamic import */
  app.use('/api/brain/settings', settingsRoutes);
  return app;
}

test('full HTTP chain: GET → PATCH → GET persists + cache updates', async () => {
  const app = makeApp(pool);

  // 1. 初始 GET
  const r1 = await request(app).get('/api/brain/settings/consciousness');
  expect(r1.status).toBe(200);
  expect(r1.body.enabled).toBe(true);  // seed

  // 2. PATCH false
  const r2 = await request(app).patch('/api/brain/settings/consciousness').send({ enabled: false });
  expect(r2.status).toBe(200);
  expect(r2.body.enabled).toBe(false);
  expect(r2.body.last_toggled_at).toBeTruthy();

  // 3. 再 GET 断言持久化
  const r3 = await request(app).get('/api/brain/settings/consciousness');
  expect(r3.body.enabled).toBe(false);
  expect(r3.body.last_toggled_at).toBe(r2.body.last_toggled_at);

  // 4. DB 验证
  const db = await pool.query('SELECT value_json FROM working_memory WHERE key=$1', ['consciousness_enabled']);
  expect(db.rows[0].value_json.enabled).toBe(false);

  // 5. isConsciousnessEnabled() 立即返 false（write-through）
  expect(isConsciousnessEnabled()).toBe(false);
});
```

### CI

两文件都在 `integration/`，`brain-integration` job (ci.yml:429) 自动扫。**零 CI 配置改动**。

## DoD

1. `consciousness-tick-runtime.integration.test.js` 3 tests 全绿
2. `consciousness-toggle-e2e.integration.test.js` 1 test 全绿（断言 4 个链路点 + DB + cache）
3. 本地 `npx vitest run src/__tests__/integration/consciousness-*.integration.test.js` 全绿
4. CI brain-integration job 通过
5. **防回归**：临时在 consciousness-guard.js 里把 `isConsciousnessEnabled()` 改成永远返 true → Part A 第 2/3 test 爆红（证明核心 guard 逻辑被端到端验证）
6. PR <800 行（no Playwright / no lockfile 变动）
7. Brain 版本保持 1.221.0

## 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| `executeTick` 内部调未 mock 的重模块导致真 LLM 调用 | 全量 mock tick.js 顶部 65+ import；遇到 "XYZ is not a function" 就补 mock |
| mock 太多导致 tick 逻辑完全跑不通 | 只对"会产生副作用"的 import mock；纯常量/工具函数（event-bus / circuit-breaker）可保留真实 |
| 并发 test 污染 memory key | beforeEach DELETE + 重跑 migration，每 test `_resetCacheForTest()` |
| env 泄漏 | afterEach `delete process.env.CONSCIOUSNESS_ENABLED` |
| Brain 版本 bump 被 check-version-sync 拦 | 不改 package.json，不触发 version sync 检查 |

## 不做

- Playwright 真浏览器 E2E（Phase 3+，如有明确需求再开）
- 装 playwright service container 到 CI
- 切换审计历史表（toggled_by / 审计日志）
- 多浏览器矩阵
