/**
 * Alertness State Behavior Integration Test
 *
 * 行为级覆盖（非端点存活）：
 *   1. GET /api/brain/alertness — 响应结构含 level/levelName/reason/startedAt 字段
 *   2. POST /api/brain/alertness/override — level 真实变更，reason 含 "Manual override:" 前缀
 *   3. POST /api/brain/alertness/override — 无效参数返回 400
 *   4. POST /api/brain/alertness/clear-override — 清除覆盖，success=true
 *   5. afterAll 严格还原：POST clear-override 确保不污染 Brain 运行状态
 *
 * Mock 策略：
 *   - db.js pool：mock connect/query（无真实 PG 依赖）
 *   - event-bus.js emit：mock（不触发真实事件）
 *   - events/taskEvents.js publishAlertnessChanged：mock（不触发 WebSocket）
 *   - alertness/metrics.js：mock collectMetrics/calculateHealthScore（不读 OS 真实指标）
 *   - alertness/diagnosis.js：mock diagnoseProblem（返回 low severity）
 *   - alertness/escalation.js：mock escalateResponse/getCurrentResponseLevel/executeResponse
 *   - alertness/healing.js：mock getRecoveryStatus/startRecovery
 *
 * 状态隔离：vi.resetModules() + 每次 beforeEach 重新 import，确保模块级 _manualOverride/currentState 干净。
 */

import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ─── Mock 外部依赖（必须在任何 import 之前声明）───────────────────────────

// Mock db.js pool
vi.mock('../../db.js', () => {
  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };
  return {
    default: {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    },
    getPoolHealth: vi.fn().mockReturnValue({ waiting: 0, idle: 5, total: 5, activeCount: 0, status: 'normal', timestamp: Date.now() }),
  };
});

// Mock event-bus.js
vi.mock('../../event-bus.js', () => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

// Mock events/taskEvents.js
vi.mock('../../events/taskEvents.js', () => ({
  publishAlertnessChanged: vi.fn(),
}));

// Mock alertness/metrics.js
vi.mock('../../alertness/metrics.js', () => ({
  collectMetrics: vi.fn().mockResolvedValue({
    cpu: { value: 30, status: 'normal' },
    memory: { value: 50, status: 'normal' },
  }),
  getRecentMetrics: vi.fn().mockResolvedValue([]),
  calculateHealthScore: vi.fn().mockReturnValue(95),
}));

// Mock alertness/diagnosis.js
vi.mock('../../alertness/diagnosis.js', () => ({
  diagnoseProblem: vi.fn().mockResolvedValue({
    severity: 'low',
    issues: [],
    patterns: [],
    summary: 'System healthy',
  }),
  getAnomalyPatterns: vi.fn().mockReturnValue([]),
}));

// Mock alertness/escalation.js
vi.mock('../../alertness/escalation.js', () => ({
  escalateResponse: vi.fn().mockResolvedValue(null),
  getCurrentResponseLevel: vi.fn().mockReturnValue('L1'),
  executeResponse: vi.fn().mockResolvedValue(null),
  getEscalationStatus: vi.fn().mockReturnValue({ level: 'L1', active: false }),
}));

// Mock alertness/healing.js
vi.mock('../../alertness/healing.js', () => ({
  applySelfHealing: vi.fn().mockResolvedValue(null),
  getRecoveryStatus: vi.fn().mockReturnValue({ phase: 0, active: false }),
  startRecovery: vi.fn().mockResolvedValue(null),
}));

// Mock tick.js（tick 路由 import 的其他依赖，防止 side effect）
vi.mock('../../tick.js', () => ({
  getTickStatus: vi.fn().mockResolvedValue({ enabled: true, loop_running: false }),
  enableTick: vi.fn().mockResolvedValue({ enabled: true }),
  disableTick: vi.fn().mockResolvedValue({ enabled: false }),
  executeTick: vi.fn().mockResolvedValue({}),
  runTickSafe: vi.fn().mockResolvedValue({}),
  drainTick: vi.fn().mockResolvedValue({ draining: true }),
  getDrainStatus: vi.fn().mockResolvedValue({ draining: false }),
  cancelDrain: vi.fn().mockReturnValue({ draining: false }),
  getStartupErrors: vi.fn().mockResolvedValue([]),
  check48hReport: vi.fn().mockResolvedValue(null),
}));

// ─── App 工厂函数 ──────────────────────────────────────────────────────────

async function makeApp() {
  const { default: tickRouter } = await import('../../routes/tick.js');
  const app = express();
  app.use(express.json());
  // tick.js 路由通过 routes.js 挂载在 /api/brain，alertness 端点为 /api/brain/alertness
  app.use('/api/brain', tickRouter);
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Alertness State Behavior Integration Test', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    app = await makeApp();
  });

  afterAll(async () => {
    // 严格还原：清除任何残留的 manual override，防止污染 Brain 全局状态
    if (app) {
      await request(app).post('/api/brain/alertness/clear-override');
    }
  });

  // ─── 1. GET /api/brain/alertness 字段完整性 ──────────────────────────────

  describe('GET /api/brain/alertness — 响应结构', () => {
    test('响应包含 level、levelName、reason、startedAt 必填字段', async () => {
      const res = await request(app).get('/api/brain/alertness');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // 必填字段存在
      expect(res.body).toHaveProperty('level');
      expect(res.body).toHaveProperty('levelName');
      expect(res.body).toHaveProperty('reason');
      expect(res.body).toHaveProperty('startedAt');

      // level 在合法范围 0-4
      expect(res.body.level).toBeGreaterThanOrEqual(0);
      expect(res.body.level).toBeLessThanOrEqual(4);

      // levelName 是已知枚举值
      const VALID_NAMES = ['SLEEPING', 'CALM', 'AWARE', 'ALERT', 'PANIC'];
      expect(VALID_NAMES).toContain(res.body.levelName);

      // reason 是非空字符串
      expect(typeof res.body.reason).toBe('string');
      expect(res.body.reason.length).toBeGreaterThan(0);

      // startedAt 是合法时间戳
      expect(new Date(res.body.startedAt).getTime()).not.toBeNaN();
    });

    test('响应还包含 levels 枚举对象和 level_names 数组', async () => {
      const res = await request(app).get('/api/brain/alertness');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('levels');
      expect(res.body.levels).toHaveProperty('SLEEPING', 0);
      expect(res.body.levels).toHaveProperty('CALM', 1);
      expect(res.body.levels).toHaveProperty('AWARE', 2);
      expect(res.body.levels).toHaveProperty('ALERT', 3);
      expect(res.body.levels).toHaveProperty('PANIC', 4);

      expect(res.body).toHaveProperty('level_names');
      expect(Array.isArray(res.body.level_names)).toBe(true);
      expect(res.body.level_names).toHaveLength(5);
    });
  });

  // ─── 2. POST /api/brain/alertness/override — level 真实变更 ──────────────

  describe('POST /api/brain/alertness/override — 状态变更行为', () => {
    test('override level=2(AWARE) 后 GET 返回 level=2，reason 含 override 信息', async () => {
      // 先 GET 确认初始状态
      const before = await request(app).get('/api/brain/alertness');
      expect(before.status).toBe(200);

      // POST override
      const overrideRes = await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 2, reason: 'integration-test-aware', duration_minutes: 5 });

      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.success).toBe(true);
      expect(overrideRes.body.level).toBe(2);
      expect(overrideRes.body.level_name).toBe('AWARE');

      // GET 验证状态已变更
      const after = await request(app).get('/api/brain/alertness');
      expect(after.status).toBe(200);
      expect(after.body.level).toBe(2);
      expect(after.body.levelName).toBe('AWARE');

      // reason 必须包含 override 相关信息（来自 setManualOverride → transitionToLevel 写入 "Manual override:" 前缀）
      expect(after.body.reason).toContain('override');
    });

    test('override level=3(ALERT) 后 GET 返回 level=3', async () => {
      const overrideRes = await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 3, reason: 'integration-test-alert' });

      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.level).toBe(3);

      const after = await request(app).get('/api/brain/alertness');
      expect(after.body.level).toBe(3);
      expect(after.body.levelName).toBe('ALERT');
    });

    test('override level=1(CALM) 后 GET 返回 level=1', async () => {
      const overrideRes = await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 1, reason: 'integration-test-calm' });

      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.level).toBe(1);

      const after = await request(app).get('/api/brain/alertness');
      expect(after.body.level).toBe(1);
      expect(after.body.levelName).toBe('CALM');
    });

    test('连续两次 override 以最后一次为准', async () => {
      await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 4, reason: 'first-override' });

      await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 0, reason: 'second-override' });

      const after = await request(app).get('/api/brain/alertness');
      expect(after.body.level).toBe(0);
      expect(after.body.levelName).toBe('SLEEPING');
    });
  });

  // ─── 3. POST /api/brain/alertness/override — 参数校验 ────────────────────

  describe('POST /api/brain/alertness/override — 参数校验', () => {
    test('缺少 reason 字段 → 400', async () => {
      const res = await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 2 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('level 超出范围（level=5）→ 400', async () => {
      const res = await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 5, reason: 'out-of-range' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    test('level 为负数（level=-1）→ 400', async () => {
      const res = await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: -1, reason: 'negative-level' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  // ─── 4. POST /api/brain/alertness/clear-override — 还原 ──────────────────

  describe('POST /api/brain/alertness/clear-override — 覆盖清除', () => {
    test('存在 override 时 clear-override 返回 success=true', async () => {
      // 先设置 override
      await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 3, reason: 'to-be-cleared' });

      // 清除
      const res = await request(app).post('/api/brain/alertness/clear-override');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('current_level');
      expect(res.body).toHaveProperty('current_level_name');
    });

    test('clear-override 后 GET override 字段为 null', async () => {
      // 设置 override
      await request(app)
        .post('/api/brain/alertness/override')
        .send({ level: 4, reason: 'clear-test' });

      // 清除
      await request(app).post('/api/brain/alertness/clear-override');

      // override 字段应为 null
      const after = await request(app).get('/api/brain/alertness');
      expect(after.status).toBe(200);
      expect(after.body.override).toBeNull();
    });

    test('无 override 时 clear-override 返回 success=false', async () => {
      // 确保无 override（先尝试清除）
      await request(app).post('/api/brain/alertness/clear-override');

      // 再次清除（此时已无 override）
      const res = await request(app).post('/api/brain/alertness/clear-override');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
    });
  });
});
