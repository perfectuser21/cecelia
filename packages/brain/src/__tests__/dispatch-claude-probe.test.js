/**
 * 测试 claude --version 健康探针在 dispatchNextTask() 中的行为
 *
 * DoD 映射：
 * - 探针失败 → dispatched=false, reason='claude_probe_failed', _dispatchPaused=true
 * - 探针含 "Not logged in" → eventType=claude_auth_lost
 * - 探针超时 → eventType=claude_probe_timeout
 * - 探针成功 + 之前已暂停 → 写 recovery event, _dispatchPaused=false
 * - 探针成功 + 未暂停 → 正常派发
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
const mockQuery = vi.fn();
vi.mock('../db.js', () => ({
  default: { query: mockQuery }
}));

vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn().mockResolvedValue({
    dispatchAllowed: true,
    taskPool: { budget: 5, available: 3 },
    user: { mode: 'absent', used: 0 },
  })
}));

const mockIsAllowed = vi.fn().mockReturnValue(true);
const mockRecordFailure = vi.fn();
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (...args) => mockIsAllowed(...args),
  recordSuccess: vi.fn(),
  recordFailure: (...args) => mockRecordFailure(...args),
  getAllStates: vi.fn().mockReturnValue({})
}));

vi.mock('../alertness-actions.js', () => ({
  getMitigationState: vi.fn().mockReturnValue({ p2_paused: false, drain_mode_requested: false })
}));

const mockUpdateTask = vi.fn().mockResolvedValue({ success: true });
vi.mock('../actions.js', () => ({
  updateTask: (...args) => mockUpdateTask(...args),
  createTask: vi.fn(),
}));

const mockTriggerCeceliaRun = vi.fn().mockResolvedValue({ success: true, runId: 'run-ok', taskId: 'task-ok' });
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: vi.fn().mockResolvedValue({ available: true }),
  getActiveProcessCount: vi.fn().mockReturnValue(0),
  checkServerResources: vi.fn().mockReturnValue({ ok: true, metrics: { max_pressure: 0.3 } }),
  killProcess: vi.fn(),
  cleanupOrphanProcesses: vi.fn().mockReturnValue(0),
  probeTaskLiveness: vi.fn().mockResolvedValue([]),
  syncOrphanTasksOnStartup: vi.fn().mockResolvedValue({ orphans_fixed: 0, rebuilt: 0 }),
  killProcessTwoStage: vi.fn(),
  requeueTask: vi.fn(),
  MAX_SEATS: 12,
  INTERACTIVE_RESERVE: 2,
  getBillingPause: vi.fn().mockReturnValue({ active: false }),
}));

vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(),
  publishExecutorStatus: vi.fn(),
  publishCognitiveState: vi.fn(),
}));

vi.mock('../event-bus.js', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  ensureEventsTable: vi.fn().mockResolvedValue(undefined)
}));

const mockRecordDispatchResult = vi.fn().mockResolvedValue(undefined);
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
  getDispatchStats: vi.fn().mockResolvedValue({})
}));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: vi.fn().mockResolvedValue({ passed: true, issues: [], suggestions: [] }),
  getPreFlightStats: vi.fn().mockResolvedValue({ totalChecked: 0, passed: 0, failed: 0, passRate: '0%' })
}));

vi.mock('../quarantine.js', () => ({
  handleTaskFailure: vi.fn().mockResolvedValue({ quarantined: false, failure_count: 1 }),
  getQuarantineStats: vi.fn().mockResolvedValue({ total: 0 }),
  checkExpiredQuarantineTasks: vi.fn().mockResolvedValue([])
}));

// ---- helper probes ----
const failProbe = (eventType, reason = 'error') =>
  vi.fn().mockResolvedValue({ ok: false, eventType, reason, output: reason });

const okProbe = () =>
  vi.fn().mockResolvedValue({ ok: true, output: 'Claude 1.0.0' });

describe('claude probe: 探针失败 → 暂停派发', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const tick = await import('../tick.js');
    tick._resetDispatchPausedState();
  });

  it('Not logged in → dispatched=false, reason=claude_probe_failed', async () => {
    const { dispatchNextTask, _getDispatchPausedState } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1'], {
      _probeOverride: failProbe('claude_auth_lost', 'Not logged in'),
    });

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe('claude_probe_failed');
    expect(result.probe.eventType).toBe('claude_auth_lost');
    expect(_getDispatchPausedState().paused).toBe(true);
  });

  it('探针超时 → dispatched=false, eventType=claude_probe_timeout', async () => {
    const { dispatchNextTask, _getDispatchPausedState } = await import('../tick.js');
    const result = await dispatchNextTask(['goal-1'], {
      _probeOverride: failProbe('claude_probe_timeout', 'probe timed out after 5s'),
    });

    expect(result.dispatched).toBe(false);
    expect(result.probe.eventType).toBe('claude_probe_timeout');
    expect(_getDispatchPausedState().paused).toBe(true);
  });

  it('探针失败时写入 cecelia_events', async () => {
    const { dispatchNextTask } = await import('../tick.js');
    await dispatchNextTask(['goal-1'], {
      _probeOverride: failProbe('claude_auth_lost', 'Not logged in'),
    });

    const insertCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO cecelia_events')
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    const args = insertCalls[0][1];
    expect(args[0]).toBe('claude_auth_lost');
    expect(args[1]).toBe('dispatch');
  });

  it('已暂停时再次探针失败 → 不重复写 alert event', async () => {
    const { dispatchNextTask, _getDispatchPausedState } = await import('../tick.js');

    // 第一次失败：写 alert event
    await dispatchNextTask(['goal-1'], { _probeOverride: failProbe('claude_auth_lost', 'Not logged in') });
    mockQuery.mockClear();

    // 第二次失败：_dispatchPaused 已为 true，不再写 alert event
    await dispatchNextTask(['goal-1'], { _probeOverride: failProbe('claude_auth_lost', 'Not logged in') });

    const insertAlertCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' &&
      c[0].includes('INSERT INTO cecelia_events') &&
      Array.isArray(c[1]) && c[1][0] === 'claude_auth_lost'
    );
    expect(insertAlertCalls).toHaveLength(0);
    expect(_getDispatchPausedState().paused).toBe(true);
  });
});

describe('claude probe: 探针成功后恢复', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    const tick = await import('../tick.js');
    tick._resetDispatchPausedState();
  });

  it('paused=true + 探针成功 → _dispatchPaused=false + 写 recovery event', async () => {
    const { dispatchNextTask, _getDispatchPausedState } = await import('../tick.js');

    // 先暂停
    await dispatchNextTask(['goal-1'], { _probeOverride: failProbe('claude_auth_lost', 'Not logged in') });
    expect(_getDispatchPausedState().paused).toBe(true);
    mockQuery.mockClear();

    // 提供候选任务 + 全任务查询
    // Note: recovery event INSERT also consumes a mockResolvedValueOnce slot
    const task = { id: 't1', title: 'ok task', description: 'desc', status: 'queued', priority: 'P1', payload: {} };
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT cecelia_events (recovery)
    mockQuery.mockResolvedValueOnce({ rows: [task] });          // selectNextDispatchableTask
    mockQuery.mockResolvedValueOnce({ rows: [task] });          // SELECT * FROM tasks (full task)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await dispatchNextTask(['goal-1'], { _probeOverride: okProbe() });

    expect(_getDispatchPausedState().paused).toBe(false);
    expect(result.dispatched).toBe(true);

    const recoveryCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' &&
      c[0].includes('INSERT INTO cecelia_events') &&
      Array.isArray(c[1]) && c[1][0] === 'claude_probe_recovered'
    );
    expect(recoveryCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('paused=false + 探针成功 → 正常派发，不写 recovery event', async () => {
    const { dispatchNextTask, _getDispatchPausedState } = await import('../tick.js');

    const task = { id: 't2', title: 'normal task', description: 'desc', status: 'queued', priority: 'P1', payload: {} };
    mockQuery.mockResolvedValueOnce({ rows: [task] });
    mockQuery.mockResolvedValueOnce({ rows: [task] });
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await dispatchNextTask(['goal-1'], { _probeOverride: okProbe() });

    expect(_getDispatchPausedState().paused).toBe(false);
    expect(result.dispatched).toBe(true);

    const recoveryCalls = mockQuery.mock.calls.filter(c =>
      typeof c[0] === 'string' &&
      c[0].includes('INSERT INTO cecelia_events') &&
      Array.isArray(c[1]) && c[1][0] === 'claude_probe_recovered'
    );
    expect(recoveryCalls).toHaveLength(0);
  });
});

describe('runClaudeProbe: 单元测试', () => {
  it('spawn 返回 exit 0 + 正常输出 → ok=true', async () => {
    const { runClaudeProbe } = await import('../claude-probe.js');

    const mockSpawn = vi.fn(() => {
      const ee = { stdout: null, stderr: null, listeners: {} };
      ee.on = (event, cb) => { ee.listeners[event] = cb; return ee; };
      setTimeout(() => ee.listeners?.close?.(0), 0);
      return ee;
    });

    const result = await runClaudeProbe({ _spawnFn: mockSpawn });
    expect(result.ok).toBe(true);
  });

  it('spawn 返回 exit 1 → ok=false, eventType=claude_probe_failed', async () => {
    const { runClaudeProbe } = await import('../claude-probe.js');

    const mockSpawn = vi.fn(() => {
      const ee = { stdout: null, stderr: null, listeners: {} };
      ee.on = (event, cb) => { ee.listeners[event] = cb; return ee; };
      setTimeout(() => ee.listeners?.close?.(1), 0);
      return ee;
    });

    const result = await runClaudeProbe({ _spawnFn: mockSpawn });
    expect(result.ok).toBe(false);
    expect(result.eventType).toBe('claude_probe_failed');
  });

  it('stdout 含 "Not logged in" → ok=false, eventType=claude_auth_lost', async () => {
    const { runClaudeProbe } = await import('../claude-probe.js');
    const { EventEmitter } = await import('events');

    const mockSpawn = vi.fn(() => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter();
      child.stdout = stdout;
      child.stderr = stderr;
      child.kill = vi.fn();
      setTimeout(() => {
        stdout.emit('data', 'Error: Not logged in\nPlease run /login');
        child.emit('close', 1);
      }, 0);
      return child;
    });

    const result = await runClaudeProbe({ _spawnFn: mockSpawn });
    expect(result.ok).toBe(false);
    expect(result.eventType).toBe('claude_auth_lost');
  });
});
