import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ============================================================================
// Workstream 1 — routes.js 聚合器挂接 /api/brain/time 的 **行为验证**（Round 5 新增）
// ----------------------------------------------------------------------------
// 背景（Reviewer Round 4 Risk 1）：
//   Round 4 使用 mount-expression 静态正则检查 `timeRouter` 是否以合法形式被挂接到
//   `packages/brain/src/routes.js`。该正则在实际仓库的数组字面量（`for (const subRouter of [...])`）
//   + 具名变量 + 注释字符串组合时，存在**误杀合法挂接**与**被别名/字符串绕过**两类风险，已被
//   Reviewer 反复证明是猫鼠游戏。
//
// Round 5 路线（Reviewer 推荐 a）：
//   **放弃静态 ARTIFACT，改行为路线** —— 用一个合同测试动态 import 真实的 `routes.js`，
//   让 express 实际挂接它，然后发 HTTP GET /api/brain/time，验证 200 + 三字段合规。
//   这是对「timeRouter 被真实聚合挂接且解析路径正确」的**行为判据**，不再依赖任何正则猜测。
//
// 副作用规避：
//   routes.js 会 transitively import 一堆子 router，子 router 在 import 时会触发
//   `db.js` / `websocket.js` / `n8n` 等副作用（Pool 初始化、process.env 读取、WS 启动）。
//   我们对**除 time.js 外的所有子 router + 副作用模块**逐一 vi.mock 替换成空 Router / 空对象，
//   这样动态 import routes.js 时只有 time.js 会使用 Generator 的真实实现，其它被 mock 掩蔽。
//
// 此测试一旦 pass，即证明：
//   - routes/time.js 存在且可加载
//   - routes.js 真实把 timeRouter 聚合到某个能解析 `/time` 的挂接点（无论是 for-of 数组成员
//     还是 router.use('/', timeRouter) 还是其它合法形式 — 行为层不 care 语法形式）
//   - 从聚合器根挂到 `/api/brain` 前缀后，GET `/api/brain/time` 能命中 handler
// ============================================================================

// vi.mock 会被 hoist 到文件顶部（在 import 之前执行）。为了让工厂里能拿到 express.Router，
// 必须用 vi.hoisted 提供一个同样被 hoist 的 factory。
const { mockEmptyRouter, mockBrainMeta, mockShared, mockDb, mockWebsocket } = vi.hoisted(() => {
  const factoryFromExpress = async () => {
    const mod = await import('express');
    return { default: mod.Router() };
  };
  return {
    mockEmptyRouter: factoryFromExpress,
    mockBrainMeta: async () => {
      const mod = await import('express');
      return { default: mod.Router(), triggerAutoRCA: () => {} };
    },
    mockShared: async () => ({
      resolveRelatedFailureMemories: () => {},
      getActivePolicy: () => ({}),
      getWorkingMemory: () => ({}),
      getTopTasks: () => [],
      getRecentDecisions: () => [],
      IDEMPOTENCY_TTL: 0,
      ALLOWED_ACTIONS: [],
      classifyLearningType: () => 'other',
    }),
    mockDb: async () => ({ default: {} }),
    mockWebsocket: async () => ({
      default: {},
      initWebSocketServer: () => {},
      shutdownWebSocketServer: () => {},
    }),
  };
});

// 对 routes.js import 的每个子 router 做 mock（只让 time.js 保持真实实现）
vi.mock('../../../packages/brain/src/routes/status.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/tasks.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/tick.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/actions.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/execution.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/goals.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/analytics.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/brain-meta.js', mockBrainMeta);
vi.mock('../../../packages/brain/src/routes/ops.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/publish-results.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/publish-jobs.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/capacity-budget.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/dev-reviews.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/registry.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/content-pipeline.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/content-library.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/social-trending.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/topics.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/harness.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/kr3.js', mockEmptyRouter);
vi.mock('../../../packages/brain/src/routes/shared.js', mockShared);

// 副作用模块（子 router 以外，time.js 不应 import 这些——但 routes.js transitively 可能触达）
vi.mock('../../../packages/brain/src/db.js', mockDb);
vi.mock('../../../packages/brain/src/websocket.js', mockWebsocket);

const ISO_8601_UTC_Z =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

describe('Workstream 1 — routes.js aggregator mounts /api/brain/time [BEHAVIOR — Risk 1]', () => {
  it('GET /api/brain/time via the REAL routes.js aggregator returns 200 with exact {iso, timezone, unix} body', async () => {
    // 动态 import — vi.mock 已经 hoist，此时所有子 router 都被替换成空 Router，
    // 只有 ../../../packages/brain/src/routes/time.js 保持真实实现
    const aggregatorModule = (await import(
      '../../../packages/brain/src/routes.js'
    )) as { default: express.Router };
    expect(aggregatorModule.default).toBeDefined();

    const app = express();
    app.use(express.json());
    app.use('/api/brain', aggregatorModule.default);

    const res = await request(app).get('/api/brain/time');

    // 行为硬阈值：如果 timeRouter 没被挂到聚合器，这里会 404；挂到错路径会 404；
    // 挂到 200 但不是 time.js 的三字段格式（例如被覆盖为别的 handler）也会被后面断言抓住
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['iso', 'timezone', 'unix']);
    expect(typeof res.body.iso).toBe('string');
    expect(res.body.iso).toMatch(ISO_8601_UTC_Z);
    expect(typeof res.body.unix).toBe('number');
    expect(Number.isInteger(res.body.unix)).toBe(true);
    expect(String(res.body.unix).length).toBeLessThanOrEqual(10);
    expect(typeof res.body.timezone).toBe('string');
    expect(res.body.timezone.length).toBeGreaterThan(0);
  });

  it('non-existent aggregator path /api/brain/__nope__ returns non-2xx — proving the aggregator is not a catch-all', async () => {
    // 反向 sanity：保证聚合器不是用「全部接收 200」的假实现（Risk 1 的逆向兜底）
    // 若实现把整个聚合器挂成 `app.get('*', ...)` 来骗过上一条断言，这里会被抓
    const aggregatorModule = (await import(
      '../../../packages/brain/src/routes.js'
    )) as { default: express.Router };
    const app = express();
    app.use(express.json());
    app.use('/api/brain', aggregatorModule.default);

    const res = await request(app).get('/api/brain/__definitely_not_a_route_xyz__');
    // 聚合器上不该有该路径 → Express 默认 404；非 200 即 pass
    expect(res.status).not.toBe(200);
  });
});
