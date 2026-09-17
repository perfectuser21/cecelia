/**
 * manual-dispatch-device-lock.test.js — 手动派发旁路补设备锁（Issue e03fc740）
 *
 * 背景：G5 设备锁已接线 dispatcher/worker-pool，但两个手动派发端点绕过锁：
 * - POST /dispatch-now（routes/execution.js）
 * - POST /api/brain/tasks/:id/dispatch（routes/tasks.js）
 * 铁律同 S2 锚点闸：闸必须站住所有必经之路。
 *
 * 语义（与 dispatcher-device-lock.test.js 同型，端点侧返回 HTTP 语义）：
 * - payload.device_serial 存在 → 触发执行前 acquireDeviceLock(task.id, serial, payload.device_ttl_minutes)
 * - {result:'locked'}         → 409 {success:false, error:'device_locked', locked_by, expires_at}，不点火不改状态
 * - {result:'unknown_device'} → 422 {success:false, error:'unknown_device', device_serial}，提示 register 端点
 * - {result:'acquired'}       → 继续原逻辑
 * - acquire 抛异常            → fail-closed 按 409 device_locked 处理
 * - 无 device_serial          → acquireDeviceLock 从不被调用（零行为变化）
 * - 触发执行失败（既有回滚点）→ 已抢的锁必须 releaseDeviceLocksHeldBy(task.id)（锁不泄漏到 TTL）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock ──────────────────────────────────────────────────

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({
  default: { query: (...args) => mockQuery(...args) },
}));

const mockTriggerCeceliaRun = vi.hoisted(() => vi.fn());
const mockCheckAvailable = vi.hoisted(() => vi.fn());
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: (...args) => mockCheckAvailable(...args),
}));

const mockAcquireDeviceLock = vi.hoisted(() => vi.fn());
const mockReleaseDeviceLocksHeldBy = vi.hoisted(() => vi.fn());
vi.mock('../device-lock-helpers.js', () => ({
  acquireDeviceLock: (...args) => mockAcquireDeviceLock(...args),
  releaseDeviceLocksHeldBy: (...args) => mockReleaseDeviceLocksHeldBy(...args),
  sweepStaleDeviceLocks: vi.fn().mockResolvedValue(0),
}));

// 两个路由文件的其余大量 import（形状照抄 dispatch-anchor-gate.test.js / dispatch-now.test.js）
vi.mock('../actions.js', () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));
vi.mock('../tick.js', () => ({
  runTickSafe: vi.fn(),
  getTickStatus: vi.fn().mockResolvedValue({ enabled: false }),
}));
vi.mock('../tick-helpers.js', () => ({
  routeTask: vi.fn(),
  TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../task-router.js', () => ({
  identifyWorkType: vi.fn(),
  getTaskLocation: vi.fn(),
  routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(() => []),
  LOCATION_MAP: {},
  diagnoseKR: vi.fn(),
}));
vi.mock('../task-weight.js', () => ({ getTaskWeights: vi.fn() }));
vi.mock('../routes/shared.js', () => ({
  classifyLearningType: vi.fn(),
  resolveRelatedFailureMemories: vi.fn().mockResolvedValue([]),
  getActiveExecutionPaths: vi.fn().mockReturnValue([]),
  INVENTORY_CONFIG: {},
}));
vi.mock('../memory-utils.js', () => ({ generateL0Summary: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskCreated: vi.fn(),
  publishTaskCompleted: vi.fn(),
  publishTaskFailed: vi.fn(),
}));
vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn(),
  classifyFailure: vi.fn(),
  getQuarantinedTasks: vi.fn(),
  getQuarantineStats: vi.fn(),
  releaseTask: vi.fn(),
  quarantineTask: vi.fn(),
  QUARANTINE_REASONS: {},
  REVIEW_ACTIONS: {},
}));
vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn().mockResolvedValue('atom-1') }));
vi.mock('../handoff.js', () => ({ pushHandoffAtom: vi.fn() }));
vi.mock('../task-updater.js', () => ({ blockTask: vi.fn() }));
vi.mock('../templates.js', () => ({
  generatePrdFromTask: vi.fn(),
  generatePrdFromGoalKR: vi.fn(),
  generateTrdFromGoal: vi.fn(),
  generateTrdFromGoalKR: vi.fn(),
  validatePrd: vi.fn(),
  validateTrd: vi.fn(),
  prdToJson: vi.fn(),
  trdToJson: vi.fn(),
  PRD_TYPE_MAP: {},
}));
vi.mock('../decision.js', () => ({
  compareGoalProgress: vi.fn(),
  generateDecision: vi.fn(),
  executeDecision: vi.fn(),
  rollbackDecision: vi.fn(),
}));
vi.mock('../planner.js', () => ({
  planNextTask: vi.fn(),
  getPlanStatus: vi.fn(),
  handlePlanInput: vi.fn(),
  getGlobalState: vi.fn(),
  selectTopAreas: vi.fn(),
  selectActiveInitiativeForArea: vi.fn(),
  ACTIVE_AREA_COUNT: 3,
}));
vi.mock('../thalamus.js', () => ({ processEvent: vi.fn(), EVENT_TYPES: {} }));
vi.mock('../decision-executor.js', () => ({ executeDecision: vi.fn() }));
vi.mock('../embedding-service.js', () => ({ generateTaskEmbeddingAsync: vi.fn() }));
vi.mock('../circuit-breaker.js', () => ({
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('../notifier.js', () => ({ notifyTaskCompleted: vi.fn() }));
vi.mock('../platform-utils.js', () => ({
  getAvailableMemoryMB: vi.fn().mockReturnValue(8000),
}));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../desire-feedback.js', () => ({ updateDesireFromTask: vi.fn() }));
vi.mock('../code-review-trigger.js', () => ({ checkAndCreateCodeReviewTrigger: vi.fn() }));
vi.mock('../zenithjoy-db.js', () => ({ getZenithjoyPool: vi.fn() }));

// ── Fixtures ──────────────────────────────────────────────

const SERIAL = 'ANGYVB4311010223';
const ANCHOR = { journey_id: 'j-test', gp_id: 'gp-test', step_id: 'step-test' };

function phoneTask(extra = {}) {
  return {
    id: 'aaaaaaaa-1111-0000-0000-000000000001',
    task_type: 'android_publish',
    status: 'queued',
    title: '手机发布任务（带 device_serial）',
    created_at: '2026-07-01T00:00:00Z', // 锚点闸存量豁免 cutoff 之前，双保险
    payload: { device_serial: SERIAL, anchor: ANCHOR },
    ...extra,
  };
}

function plainTask(extra = {}) {
  return {
    id: 'bbbbbbbb-2222-0000-0000-000000000002',
    task_type: 'android_publish',
    status: 'queued',
    title: '普通任务（无 device_serial）',
    created_at: '2026-07-01T00:00:00Z',
    payload: { anchor: ANCHOR },
    ...extra,
  };
}

let currentTask;
let allQueries;

async function makeExecutionApp() {
  const router = (await import('../routes/execution.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}

async function makeTasksApp() {
  const router = (await import('../routes/tasks.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  allQueries = [];
  currentTask = null;
  mockQuery.mockImplementation((sql, params) => {
    allQueries.push({ sql, params });
    if (/SELECT \* FROM tasks WHERE id/.test(sql)) {
      return Promise.resolve({ rows: currentTask ? [currentTask] : [] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  mockCheckAvailable.mockResolvedValue({ available: true });
  mockTriggerCeceliaRun.mockResolvedValue({ success: true, runId: 'run-manual-1', executor: 'local' });
  mockReleaseDeviceLocksHeldBy.mockResolvedValue(1);
});

function findInProgressUpdate() {
  return allQueries.find(
    ({ sql, params }) =>
      /UPDATE tasks/.test(sql)
      && (sql.includes("'in_progress'") || JSON.stringify(params || []).includes('in_progress'))
  );
}

// ── POST /dispatch-now（routes/execution.js）──────────────

describe('POST /dispatch-now — 设备锁站岗（Issue e03fc740）', () => {
  it('分支1 locked：设备被占 → 409 device_locked，不点火不改状态', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'locked',
      holder: { device_name: SERIAL, locked_by: 'other-task-id', expires_at: '2026-09-17T01:00:00Z' },
    });

    const app = await makeExecutionApp();
    const res = await request(app).post('/api/brain/dispatch-now').send({ task_id: currentTask.id });

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(currentTask.id, SERIAL, undefined);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      error: 'device_locked',
      locked_by: 'other-task-id',
      expires_at: '2026-09-17T01:00:00Z',
    });
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(findInProgressUpdate()).toBeUndefined();
  });

  it('分支2 unknown_device：serial 未注册 → 422 unknown_device + 提示 register 端点', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockResolvedValue({ result: 'unknown_device' });

    const app = await makeExecutionApp();
    const res = await request(app).post('/api/brain/dispatch-now').send({ task_id: currentTask.id });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      error: 'unknown_device',
      device_serial: SERIAL,
    });
    expect(JSON.stringify(res.body)).toMatch(/register/);
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(findInProgressUpdate()).toBeUndefined();
  });

  it('分支3 acquired：抢锁成功 → 继续原逻辑点火（ttl 透传）', async () => {
    currentTask = phoneTask({ payload: { device_serial: SERIAL, device_ttl_minutes: 90, anchor: ANCHOR } });
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: currentTask.id },
    });

    const app = await makeExecutionApp();
    const res = await request(app).post('/api/brain/dispatch-now').send({ task_id: currentTask.id });

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(currentTask.id, SERIAL, 90);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, taskId: currentTask.id });
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(expect.objectContaining({ id: currentTask.id }));
  });

  it('分支4 无 device_serial：acquireDeviceLock 从不被调用，零行为变化', async () => {
    currentTask = plainTask();

    const app = await makeExecutionApp();
    const res = await request(app).post('/api/brain/dispatch-now').send({ task_id: currentTask.id });

    expect(mockAcquireDeviceLock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, taskId: currentTask.id });
    expect(mockTriggerCeceliaRun).toHaveBeenCalled();
  });

  it('fail-closed：acquire 抛异常 → 按 409 device_locked 处理，不点火', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockRejectedValue(new Error('db down'));

    const app = await makeExecutionApp();
    const res = await request(app).post('/api/brain/dispatch-now').send({ task_id: currentTask.id });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, error: 'device_locked' });
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(findInProgressUpdate()).toBeUndefined();
  });

  it('revert 释放：acquired 后执行失败（回滚 queued）→ releaseDeviceLocksHeldBy 被调用', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: currentTask.id },
    });
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, error: 'spawn failed' });

    const app = await makeExecutionApp();
    const res = await request(app).post('/api/brain/dispatch-now').send({ task_id: currentTask.id });

    expect(res.status).toBe(500);
    expect(mockReleaseDeviceLocksHeldBy).toHaveBeenCalledWith(currentTask.id);
  });
});

// ── POST /api/brain/tasks/:id/dispatch（routes/tasks.js）──

describe('POST /api/brain/tasks/:id/dispatch — 设备锁站岗（Issue e03fc740）', () => {
  it('分支1 locked：设备被占 → 409 device_locked，不点火不改状态', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'locked',
      holder: { device_name: SERIAL, locked_by: 'other-task-id', expires_at: '2026-09-17T01:00:00Z' },
    });

    const app = await makeTasksApp();
    const res = await request(app).post(`/api/brain/tasks/${currentTask.id}/dispatch`);

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(currentTask.id, SERIAL, undefined);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      error: 'device_locked',
      locked_by: 'other-task-id',
      expires_at: '2026-09-17T01:00:00Z',
    });
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(findInProgressUpdate()).toBeUndefined();
  });

  it('分支2 unknown_device：serial 未注册 → 422 unknown_device + 提示 register 端点', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockResolvedValue({ result: 'unknown_device' });

    const app = await makeTasksApp();
    const res = await request(app).post(`/api/brain/tasks/${currentTask.id}/dispatch`);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      success: false,
      error: 'unknown_device',
      device_serial: SERIAL,
    });
    expect(JSON.stringify(res.body)).toMatch(/register/);
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(findInProgressUpdate()).toBeUndefined();
  });

  it('分支3 acquired：抢锁成功 → 继续原逻辑点火 202（ttl 透传）', async () => {
    currentTask = phoneTask({ payload: { device_serial: SERIAL, device_ttl_minutes: 90, anchor: ANCHOR } });
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: currentTask.id },
    });

    const app = await makeTasksApp();
    const res = await request(app).post(`/api/brain/tasks/${currentTask.id}/dispatch`);

    expect(mockAcquireDeviceLock).toHaveBeenCalledWith(currentTask.id, SERIAL, 90);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ task_id: currentTask.id });
    expect(mockTriggerCeceliaRun).toHaveBeenCalledWith(expect.objectContaining({ id: currentTask.id }));
  });

  it('分支4 无 device_serial：acquireDeviceLock 从不被调用，零行为变化', async () => {
    currentTask = plainTask();

    const app = await makeTasksApp();
    const res = await request(app).post(`/api/brain/tasks/${currentTask.id}/dispatch`);

    expect(mockAcquireDeviceLock).not.toHaveBeenCalled();
    expect(res.status).toBe(202);
    expect(mockTriggerCeceliaRun).toHaveBeenCalled();
  });

  it('fail-closed：acquire 抛异常 → 按 409 device_locked 处理，不点火', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockRejectedValue(new Error('db down'));

    const app = await makeTasksApp();
    const res = await request(app).post(`/api/brain/tasks/${currentTask.id}/dispatch`);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, error: 'device_locked' });
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(findInProgressUpdate()).toBeUndefined();
  });

  it('revert 释放：acquired 后执行器不可用（503 回滚 queued）→ releaseDeviceLocksHeldBy 被调用', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: currentTask.id },
    });
    mockCheckAvailable.mockResolvedValue({ available: false, error: 'bridge down' });

    const app = await makeTasksApp();
    const res = await request(app).post(`/api/brain/tasks/${currentTask.id}/dispatch`);

    expect(res.status).toBe(503);
    expect(mockReleaseDeviceLocksHeldBy).toHaveBeenCalledWith(currentTask.id);
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  });

  it('revert 释放：acquired 后执行失败（500 回滚 queued）→ releaseDeviceLocksHeldBy 被调用', async () => {
    currentTask = phoneTask();
    mockAcquireDeviceLock.mockResolvedValue({
      result: 'acquired',
      lock: { device_name: SERIAL, locked_by: currentTask.id },
    });
    mockTriggerCeceliaRun.mockResolvedValue({ success: false, error: 'spawn failed' });

    const app = await makeTasksApp();
    const res = await request(app).post(`/api/brain/tasks/${currentTask.id}/dispatch`);

    expect(res.status).toBe(500);
    expect(mockReleaseDeviceLocksHeldBy).toHaveBeenCalledWith(currentTask.id);
  });
});
