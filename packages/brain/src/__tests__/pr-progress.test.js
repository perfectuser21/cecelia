/**
 * PR Progress API Tests
 *
 * Tests for GET /api/brain/pr-progress/:kr_id endpoint.
 * Uses mock database to avoid needing a real PostgreSQL connection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mock 数据库 ----
const mockPool = { query: vi.fn() };
vi.mock('../db.js', () => ({ default: mockPool }));

// ---- Mock 所有 routes.js 依赖（避免真实数据库连接）----
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(() => ({ enabled: true, interval: 300 })),
  enableTick: vi.fn(),
  disableTick: vi.fn(),
  executeTick: vi.fn(),
  runTickSafe: vi.fn(),
  routeTask: vi.fn(),
  drainTick: vi.fn(),
  getActiveTaskCount: vi.fn(() => 0),
  getPendingTaskCount: vi.fn(() => 0),
}));

vi.mock('../executor.js', () => ({
  getActiveProcesses: vi.fn(() => []),
  getActiveProcessCount: vi.fn(() => 0),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  killProcess: vi.fn(),
  getProcessById: vi.fn(),
}));

vi.mock('../actions.js', () => ({
  createTask: vi.fn(),
  createInitiative: vi.fn(),
  createProject: vi.fn(),
  updateTask: vi.fn(),
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
  triggerN8n: vi.fn(),
  setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));

vi.mock('../focus.js', () => ({
  getDailyFocus: vi.fn(),
  setDailyFocus: vi.fn(),
  clearDailyFocus: vi.fn(),
  getFocusSummary: vi.fn(() => ({ focus: null })),
}));

vi.mock('../decision.js', () => ({
  generateDecision: vi.fn(),
  getRecentDecisions: vi.fn(() => []),
}));

vi.mock('../thalamus.js', () => ({
  routeEvent: vi.fn(),
  evaluateEvent: vi.fn(),
}));

vi.mock('../cortex.js', () => ({
  analyzeSituation: vi.fn(),
  runCortexAnalysis: vi.fn(),
}));

vi.mock('../selfcheck.js', () => ({
  runSelfCheck: vi.fn(() => ({ ok: true })),
  getSchemaVersion: vi.fn(() => ({ version: 1 })),
}));

vi.mock('../ws.js', () => ({
  broadcast: vi.fn(),
  broadcastTaskState: vi.fn(),
  getConnectedClients: vi.fn(() => 0),
}));

vi.mock('../policy.js', () => ({
  getActivePolicy: vi.fn(() => ({})),
  updatePolicy: vi.fn(),
}));

vi.mock('../alertness.js', () => ({
  getAlertnessLevel: vi.fn(() => ({ level: 'normal', score: 50 })),
  evaluateAlertnessLevel: vi.fn(),
  overrideAlertnessLevel: vi.fn(),
  getAlertnessMetrics: vi.fn(() => ({})),
}));

vi.mock('../quarantine.js', () => ({
  getQuarantinedTasks: vi.fn(() => []),
  getQuarantineStats: vi.fn(() => ({})),
  releaseFromQuarantine: vi.fn(),
}));

vi.mock('../reports.js', () => ({
  check48hReport: vi.fn(),
  getLatestReport: vi.fn(),
  generateReport: vi.fn(),
}));

vi.mock('../memory.js', () => ({
  getWorkingMemory: vi.fn(() => ({})),
  setWorkingMemory: vi.fn(),
}));

vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => ({ location: 'us' })),
  LOCATION_MAP: {},
}));

vi.mock('../okr-tick.js', () => ({
  runOkrTick: vi.fn(),
  getOkrStatus: vi.fn(() => ({})),
}));

vi.mock('../okr-deduplication.js', () => ({
  checkOkrDuplicate: vi.fn(() => ({ isDuplicate: false })),
}));

vi.mock('../intent-parser.js', () => ({
  parseIntent: vi.fn(),
}));

vi.mock('../briefing.js', () => ({
  generateBriefing: vi.fn(),
  getLatestBriefing: vi.fn(),
}));

// ---- 导入被测试模块 ----
// isolate:false 修复：每次在全套测试前 resetModules，确保 vi.mock 工厂生效
// 不用 !router 的懒加载，因为缓存可能是上一个测试文件的真实实现
let router;
beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../routes.js');
  router = mod.default;
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- 辅助函数：模拟 Express 请求/响应 ----
function callRoute(routerInstance, method, path, { params = {}, query = {}, body = {} } = {}) {
  return new Promise((resolve) => {
    const req = {
      method: method.toUpperCase(),
      path,
      params,
      query,
      body,
      headers: {},
      get: () => null,
    };
    const resData = { statusCode: 200, body: null };
    const res = {
      status(code) { resData.statusCode = code; return res; },
      json(data) { resData.body = data; resolve(resData); },
      send(data) { resData.body = data; resolve(resData); },
    };

    // 查找匹配的路由层
    const layers = routerInstance.stack.filter((layer) => {
      if (!layer.route) return false;
      const routeMethods = layer.route.methods;
      if (!routeMethods[method.toLowerCase()]) return false;
      // 简单路径匹配（支持 :param）
      const routePath = layer.route.path;
      const routeParts = routePath.split('/');
      const reqParts = path.split('/');
      if (routeParts.length !== reqParts.length) return false;
      return routeParts.every((part, i) => part.startsWith(':') || part === reqParts[i]);
    });

    if (layers.length === 0) {
      resData.statusCode = 404;
      resData.body = { error: `Route not found: ${method} ${path}` };
      resolve(resData);
      return;
    }

    const handler = layers[0].route.stack[0].handle;
    Promise.resolve(handler(req, res)).catch((err) => {
      resData.statusCode = 500;
      resData.body = { error: err.message };
      resolve(resData);
    });
  });
}

// ---- 测试套件 ----
describe('GET /pr-progress/:kr_id', () => {
  const KR_ID = 'e5ec0510-d7b2-4ee7-99f6-314aac55b3f6';

  function mockGoalFound(overrides = {}) {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: KR_ID,
        title: 'Cecelia 每月自主完成 30 个 PR',
        metadata: { target_pr_count: 30, ...overrides.metadata },
        ...overrides,
      }],
    });
  }

  function mockStats({ completed = 4, in_progress = 2, failed = 1 } = {}) {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        completed_count: String(completed),
        in_progress_count: String(in_progress),
        failed_count: String(failed),
      }],
    });
  }

  function mockDailyBreakdown(rows = []) {
    mockPool.query.mockResolvedValueOnce({ rows });
  }

  it('返回正确的 PR 统计数据（默认当前月）', async () => {
    mockGoalFound();
    mockStats({ completed: 4, in_progress: 2, failed: 1 });
    mockDailyBreakdown([
      { date: '2026-03-01', completed: '1' },
      { date: '2026-03-03', completed: '3' },
    ]);

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.kr_id).toBe(KR_ID);
    expect(result.body.kr_title).toBe('Cecelia 每月自主完成 30 个 PR');
    expect(result.body.target_count).toBe(30);
    expect(result.body.completed_count).toBe(4);
    expect(result.body.in_progress_count).toBe(2);
    expect(result.body.failed_count).toBe(1);
    expect(typeof result.body.progress_percentage).toBe('number');
    expect(result.body.time_range).toHaveProperty('start');
    expect(result.body.time_range).toHaveProperty('end');
    expect(Array.isArray(result.body.daily_breakdown)).toBe(true);
    expect(result.body).toHaveProperty('last_updated');
  });

  it('progress_percentage 计算正确（4/30 = 13.3）', async () => {
    mockGoalFound();
    mockStats({ completed: 4, in_progress: 2, failed: 1 });
    mockDailyBreakdown();

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.progress_percentage).toBe(13.3);
  });

  it('target_count 从 metadata.target_pr_count 读取', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: KR_ID, title: 'Test KR', metadata: { target_pr_count: 50 } }],
    });
    mockStats({ completed: 5 });
    mockDailyBreakdown();

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.target_count).toBe(50);
    expect(result.body.progress_percentage).toBe(10);
  });

  it('target_count 默认 30（metadata 为 null）', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: KR_ID, title: 'Test KR', metadata: null }],
    });
    mockStats({ completed: 15 });
    mockDailyBreakdown();

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.target_count).toBe(30);
    expect(result.body.progress_percentage).toBe(50);
  });

  it('支持 ?month=YYYY-MM 参数', async () => {
    mockGoalFound();
    mockStats({ completed: 2 });
    mockDailyBreakdown([{ date: '2026-02-15', completed: '2' }]);

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
      query: { month: '2026-02' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.time_range.start).toContain('2026-02-01');
    expect(result.body.daily_breakdown.length).toBe(28); // 2026-02 有 28 天
    // 2月15日有 2 个
    const feb15 = result.body.daily_breakdown.find(d => d.date === '2026-02-15');
    expect(feb15).toBeDefined();
    expect(feb15.completed).toBe(2);
    // 其他日期填 0
    const feb10 = result.body.daily_breakdown.find(d => d.date === '2026-02-10');
    expect(feb10.completed).toBe(0);
  });

  it('daily_breakdown 包含指定月份所有天数（无数据的填 0）', async () => {
    mockGoalFound();
    mockStats();
    mockDailyBreakdown(); // 没有每日数据

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
      query: { month: '2026-03' },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.daily_breakdown.length).toBe(31); // 3月有 31 天
    expect(result.body.daily_breakdown[0].date).toBe('2026-03-01');
    expect(result.body.daily_breakdown[30].date).toBe('2026-03-31');
    result.body.daily_breakdown.forEach(d => {
      expect(d.completed).toBe(0);
    });
  });

  it('KR ID 不存在返回 404', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = await callRoute(router, 'GET', '/pr-progress/nonexistent-id', {
      params: { kr_id: 'nonexistent-id' },
    });

    expect(result.statusCode).toBe(404);
    expect(result.body.success).toBe(false);
    expect(result.body.error).toContain('不存在');
  });

  it('month 格式错误返回 400', async () => {
    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
      query: { month: 'invalid-date' },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.success).toBe(false);
    expect(result.body.error).toContain('格式错误');
  });

  it('month 月份值无效返回 400（month=2026-13）', async () => {
    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
      query: { month: '2026-13' },
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.success).toBe(false);
  });

  it('数据库查询失败返回 500', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
    });

    expect(result.statusCode).toBe(500);
    expect(result.body.success).toBe(false);
    expect(result.body.error).toContain('DB connection lost');
  });

  it('completed_count 为 0 时 progress_percentage 为 0', async () => {
    mockGoalFound();
    mockStats({ completed: 0, in_progress: 0, failed: 0 });
    mockDailyBreakdown();

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.progress_percentage).toBe(0);
  });

  it('completed_count 超过 target_count 时 progress_percentage > 100', async () => {
    mockGoalFound();
    mockStats({ completed: 35, in_progress: 0, failed: 0 });
    mockDailyBreakdown();

    const result = await callRoute(router, 'GET', `/pr-progress/${KR_ID}`, {
      params: { kr_id: KR_ID },
    });

    expect(result.statusCode).toBe(200);
    // 35/30 * 100 = 116.7
    expect(result.body.progress_percentage).toBe(116.7);
  });
});
