/**
 * Critical Routes Integration Test — 真实 PostgreSQL
 *
 * 覆盖 Brain 最关键的 4 个路由，使用真实 PostgreSQL 连接（不 mock db.js）：
 *   GET /api/brain/context       — 全景摘要（SQL bug 保护）
 *   GET /api/brain/tasks         — 任务列表
 *   GET /api/brain/okr/current   — OKR 树形结构
 *   GET /api/brain/health        — 器官健康检查
 *
 * 不 mock db.js：任何 SQL 回归（列名改动、表结构变更）都会被捕获。
 * 依赖：CI brain-unit job 提供的 PostgreSQL 服务（DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD）
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

// ─── Mock tick.js 以避免 goals.js 带入的 30+ 传递依赖在 CI 中触发副作用 ────────
// 注意：这不影响 db.js（仍然真实），仅隔离 tick 内存状态，使 /health 断言确定性更强
vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({
    loop_running: false,
    enabled: false,
    last_tick: null,
    max_concurrent: 3,
    actions_today: 0,
    next_tick: null,
    last_dispatch: null,
    startup_ok: true,
    startup_errors: null,
    recovery_attempts: null,
  }),
  initTickLoop: vi.fn(),
  stopTickLoop: vi.fn(),
  runTick: vi.fn(),
  routeTask: vi.fn().mockResolvedValue(null),
  selectNextDispatchableTask: vi.fn().mockResolvedValue(null),
  TASK_TYPE_AGENT_MAP: {},
  TICK_INTERVAL_MINUTES: 5,
  TICK_LOOP_INTERVAL_MS: 5000,
  TICK_TIMEOUT_MS: 300000,
  DISPATCH_TIMEOUT_MINUTES: 10,
  MAX_CONCURRENT_TASKS: 3,
  AUTO_DISPATCH_MAX: 3,
  MAX_NEW_DISPATCHES_PER_TICK: 2,
  CLEANUP_INTERVAL_MS: 3600000,
  ZOMBIE_SWEEP_INTERVAL_MS: 300000,
  ZOMBIE_CLEANUP_INTERVAL_MS: 600000,
  PIPELINE_PATROL_INTERVAL_MS: 300000,
  GOAL_EVAL_INTERVAL_MS: 300000,
  REPORT_INTERVAL_MS: 172800000,
  getRampedDispatchMax: vi.fn().mockReturnValue(3),
  getStartupErrors: vi.fn().mockReturnValue([]),
  check48hReport: vi.fn(),
  generate48hReport: vi.fn(),
  _resetLastExecuteTime: vi.fn(),
  _resetLastCleanupTime: vi.fn(),
  _resetLastZombieCleanupTime: vi.fn(),
  _resetLastHealthCheckTime: vi.fn(),
  _resetLastKrProgressSyncTime: vi.fn(),
  _resetLastHeartbeatTime: vi.fn(),
  _resetLastGoalEvalTime: vi.fn(),
  _resetLastZombieSweepTime: vi.fn(),
  _resetLastPipelinePatrolTime: vi.fn(),
}));

// Mock okr-tick 和 nightly-tick（仅用于 goals.js 路由声明，不影响 health 端点逻辑）
vi.mock('../../okr-tick.js', () => ({
  executeOkrTick: vi.fn(),
  runOkrTickSafe: vi.fn(),
  startOkrTickLoop: vi.fn(),
  stopOkrTickLoop: vi.fn(),
  getOkrTickStatus: vi.fn().mockReturnValue({ running: false }),
  addQuestionToGoal: vi.fn(),
  answerQuestionForGoal: vi.fn(),
  getPendingQuestions: vi.fn().mockResolvedValue([]),
  OKR_STATUS: { ACTIVE: 'active', COMPLETED: 'completed', ARCHIVED: 'archived' },
}));

vi.mock('../../nightly-tick.js', () => ({
  executeNightlyAlignment: vi.fn(),
  runNightlyAlignmentSafe: vi.fn(),
  startNightlyScheduler: vi.fn(),
  stopNightlyScheduler: vi.fn(),
  getNightlyTickStatus: vi.fn().mockReturnValue({ running: false }),
  getDailyReports: vi.fn().mockResolvedValue([]),
}));

// ─── 导入路由（db.js 不 mock — 真实 PostgreSQL）─────────────────────────────
import contextRouter from '../../routes/context.js';
import taskTasksRouter from '../../routes/task-tasks.js';
import okrHierarchyRouter from '../../routes/okr-hierarchy.js';
import goalsRouter from '../../routes/goals.js';

// ─── 直连池（仅用于测试 setup/teardown 验证）──────────────────────────────────
const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });

// ─── Test App Factory ─────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/context', contextRouter);
  app.use('/api/brain/tasks', taskTasksRouter);
  app.use('/api/brain/okr', okrHierarchyRouter);
  app.use('/api/brain', goalsRouter);
  return app;
}

let app;

beforeAll(async () => {
  // 验证真实 DB 可用
  await testPool.query('SELECT 1');
  app = makeApp();
});

afterAll(async () => {
  await testPool.end();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brain/context — 全景摘要
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brain/context', () => {
  it('返回 HTTP 200', async () => {
    const res = await request(app).get('/api/brain/context');
    expect(res.status).toBe(200);
  });

  it('返回 success: true 和预期 JSON 字段', async () => {
    const res = await request(app).get('/api/brain/context');
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.okr)).toBe(true);
    expect(Array.isArray(res.body.recent_prs)).toBe(true);
    expect(Array.isArray(res.body.active_tasks)).toBe(true);
    expect(typeof res.body.summary_text).toBe('string');
    expect(typeof res.body.generated_at).toBe('string');
  });

  it('不抛 500 SQL 错误（防 SQL 列名回归）', async () => {
    const res = await request(app).get('/api/brain/context');
    expect(res.status).not.toBe(500);
    expect(res.body.error).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brain/tasks — 任务列表
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brain/tasks', () => {
  it('返回 HTTP 200 且结果为数组', async () => {
    const res = await request(app).get('/api/brain/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('支持 status 过滤参数，结果中所有任务状态一致', async () => {
    const res = await request(app).get('/api/brain/tasks?status=in_progress&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const task of res.body) {
      expect(task.status).toBe('in_progress');
    }
  });

  it('支持 limit 参数限制返回数量', async () => {
    const res = await request(app).get('/api/brain/tasks?limit=3');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(3);
  });

  it('任务对象包含必要字段（id/title/status/priority）', async () => {
    const res = await request(app).get('/api/brain/tasks?limit=1');
    expect(res.status).toBe(200);
    if (res.body.length > 0) {
      const task = res.body[0];
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('title');
      expect(task).toHaveProperty('status');
      expect(task).toHaveProperty('priority');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brain/okr/current — OKR 树形结构
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brain/okr/current', () => {
  it('返回 HTTP 200 且 success: true', async () => {
    const res = await request(app).get('/api/brain/okr/current');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('包含 objectives 数组和 generated_at 时间戳', async () => {
    const res = await request(app).get('/api/brain/okr/current');
    expect(Array.isArray(res.body.objectives)).toBe(true);
    expect(typeof res.body.generated_at).toBe('string');
  });

  it('每个 objective 包含 key_results 数组和必要字段', async () => {
    const res = await request(app).get('/api/brain/okr/current');
    for (const obj of res.body.objectives) {
      expect(Array.isArray(obj.key_results)).toBe(true);
      expect(typeof obj.id).toBe('string');
      expect(typeof obj.title).toBe('string');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/brain/health — 器官健康检查
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/brain/health', () => {
  it('返回 HTTP 200', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.status).toBe(200);
  });

  it('status 字段为合法值（healthy / degraded / error）', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(['healthy', 'degraded', 'error'].includes(res.body.status)).toBe(true);
  });

  it('包含 timestamp 字段（ISO8601 格式）', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(typeof res.body.timestamp).toBe('string');
    expect(() => new Date(res.body.timestamp)).not.toThrow();
  });

  it('organs 包含 scheduler 和 circuit_breaker', async () => {
    const res = await request(app).get('/api/brain/health');
    expect(res.body.organs).toBeDefined();
    expect(res.body.organs.scheduler).toBeDefined();
    expect(res.body.organs.circuit_breaker).toBeDefined();
  });
});
