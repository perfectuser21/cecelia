// 原生秋米任务按手机serial与当前账号健康准入，纯路由不触发旧设备子任务。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));

vi.mock('../routing/qiumi-router.js', () => ({
  routeQiumiTask: vi.fn(),
  persistDecision: vi.fn().mockResolvedValue(undefined),
}));

const mockTriggerCeceliaRun = vi.fn(async () => ({ success: true, runId: 'r' }));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  killProcessTwoStage: vi.fn(async () => ({ killed: false })),
  getBillingPause: () => ({ active: false }),
}));

vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: vi.fn().mockResolvedValue(undefined),
  getDispatchStats: vi.fn().mockResolvedValue({}),
  DISPATCH_STATS_KEY: 'dispatch_stats',
}));

const mockUpdateTask = vi.fn(async () => ({ success: true }));
vi.mock('../actions.js', () => ({ updateTask: (...args) => mockUpdateTask(...args) }));

vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: vi.fn(async () => null),
  processCortexTask: vi.fn(async () => ({ dispatched: false })),
}));

vi.mock('../quota-cooling.js', () => ({ isGlobalQuotaCooling: () => false, getQuotaCoolingState: () => ({ until: null }) }));
vi.mock('../drain.js', async (original) => ({ ...await original(), isDraining: () => false, getDrainStartedAt: () => null }));
vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok' }),
  calculateSlotBudget: async () => ({
    dispatchAllowed: true, taskPool: { budget: 10 }, user: { mode: 'solo' },
    codex: { available: true, running: 0, max: 5 }, budgetState: { state: 'abundant' },
  }),
  shouldBypassBackpressure: () => false,
}));
vi.mock('../event-bus.js', () => ({ emit: vi.fn(async () => {}) }));
const mockIsAllowed = vi.fn(() => true);
const mockRecordFailure = vi.fn(async () => {});
const mockRecordSuccess = vi.fn(async () => {});
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: (k) => mockIsAllowed(k),
  recordFailure: (...a) => mockRecordFailure(...a),
  recordSuccess: (...a) => mockRecordSuccess(...a),
}));
vi.mock('../events/taskEvents.js', () => ({ publishTaskStarted: vi.fn() }));
vi.mock('../tick-stats.js', () => ({ incrementActionsToday: vi.fn(async () => {}) }));
vi.mock('../account-usage.js', () => ({ proactiveTokenCheck: vi.fn(async () => {}) }));

vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: async () => ({ passed: true, issues: [], suggestions: [] }),
  alertOnPreFlightFail: vi.fn(async () => {}),
  getPreFlightStats: async () => ({}),
  PRE_FLIGHT_ALERT_THRESHOLD: 3,
}));
vi.mock('../dispatch-dedup.js', () => ({ findDuplicateSibling: vi.fn(async () => null) }));

import { routeQiumiTask, persistDecision } from '../routing/qiumi-router.js';
import { buildQiumiSource } from '../lib/qiumi-source.js';
import { dispatchQiumiTask } from '../dispatcher.js';

const candidate = { id: 'q1', task_type: 'qiumi_task', status: 'queued', priority: 'P2', title: '在手机上发一条视频', created_at: new Date().toISOString() };
const fullRow = { ...candidate, payload: { qiumi_source: buildQiumiSource({ title: '在手机上发一条视频' }) } };
const deviceDecision = { outcome: 'agent', payloadPatch: { qiumi_route: { source: 'native-agent', device_hint: { is_device: true, serial: 'S9' } } } };

let healthRows;
let healthError;
let registryRows;
let registryError;

function wire() {
  mockQuery.mockImplementation(async (sql) => {
    if (/SELECT \* FROM tasks WHERE id = \$1/.test(sql)) return { rows: [fullRow] };
    if (/FROM resource_health/.test(sql)) {
      if (healthError) throw healthError;
      return { rows: healthRows };
    }
    if (/FROM phone_registry/.test(sql)) {
      if (registryError) throw registryError;
      return { rows: registryRows };
    }
    return { rows: [], rowCount: 1 };
  });
}

const sqlsOf = () => mockQuery.mock.calls.map(([sql]) => sql);
const now = () => new Date().toISOString();

beforeEach(async () => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockIsAllowed.mockImplementation(() => true);
  healthRows = [];
  healthError = null;
  registryRows = [];
  registryError = null;
  (await import('../lib/resource-health-gate.js'))._resetGateEventMemo();
  (await import('../lib/qiumi-resource-health.js'))._resetBlockedRouteMemo();
  routeQiumiTask.mockReset();
  persistDecision.mockReset();
  persistDecision.mockResolvedValue(undefined);
  wire();
});

describe('秋米 device 出口接资源健康闸', () => {
  it('定到的手机 offline → 不启动、放 claim、记 resource_unhealthy、进 resourceSkipIds 不进 holSkipIds', async () => {
    routeQiumiTask.mockResolvedValue(deviceDecision);
    healthRows = [{ resource_type: 'phone', resource_key: 'S9', status: 'offline', reason: 'adb 掉线', observed_at: now() }];
    const holSkipIds = [];
    const resourceSkipIds = [];
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds, resourceSkipIds });
    expect(r).toMatchObject({ outcome: 'skip', resource: true });
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
    expect(sqlsOf().some((s) => /claimed_by = NULL/.test(s)), 'claim 泄漏').toBe(true);
    expect(mockQuery.mock.calls.some(([sql,args])=>String(sql).includes('INSERT INTO task_events')&&args?.[1]==='resource_health_blocked')).toBe(true);
    expect(resourceSkipIds).toContain('q1');
    expect(holSkipIds).not.toContain('q1');
  });

  it('账号维度：手机健康但它当前登录的抖音号被风控 → 同样挡（不用等建单方写 account_ref）', async () => {
    routeQiumiTask.mockResolvedValue(deviceDecision);
    registryRows = [{ douyin_accounts: [{ id: 'other', current: false }, { id: 'acc-77', current: true }] }];
    healthRows = [{ resource_type: 'account', resource_key: 'douyin:acc-77', status: 'restricted', reason: '切换要人脸', observed_at: now() }];
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [], resourceSkipIds: [] });
    expect(r).toMatchObject({ outcome: 'skip', resource: true });
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();
  });

  it('手机与账号都健康 → 完成路由后准入原生执行', async () => {
    routeQiumiTask.mockResolvedValue(deviceDecision);
    registryRows = [{ douyin_accounts: [{ id: 'acc-77', current: true }] }];
    healthRows = [{ resource_type: 'phone', resource_key: 'S9', status: 'healthy', reason: null, observed_at: now() }];
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [], resourceSkipIds: [] });
    expect(r.outcome).toBe('proceed');
    expect(persistDecision).toHaveBeenCalled();
  });

  it('健康表查询出错 → fail-safe 保留准入', async () => {
    routeQiumiTask.mockResolvedValue(deviceDecision);
    healthError = new Error('relation "resource_health" does not exist');
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [], resourceSkipIds: [] });
    expect(r.outcome).toBe('proceed');
    expect(persistDecision).toHaveBeenCalled();
  });

  it('台账查询出错 → 只按手机 serial 判，手机健康照常准入', async () => {
    routeQiumiTask.mockResolvedValue(deviceDecision);
    registryError = new Error('phone_registry boom');
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [], resourceSkipIds: [] });
    expect(r.outcome).toBe('proceed');
    expect(persistDecision).toHaveBeenCalled();
  });

  it('被挡后下一轮：先复查那台手机，仍掉线 → 仍让位，恢复后准入', async () => {
    routeQiumiTask.mockResolvedValue(deviceDecision);
    healthRows = [{ resource_type: 'phone', resource_key: 'S9', status: 'offline', reason: 'adb 掉线', observed_at: now() }];
    await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [], resourceSkipIds: [] });
    expect(routeQiumiTask).toHaveBeenCalledTimes(1);

    const r2 = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [], resourceSkipIds: [] });
    expect(r2).toMatchObject({ outcome: 'skip', resource: true });
    expect(mockTriggerCeceliaRun).not.toHaveBeenCalled();

    healthRows = [{ resource_type: 'phone', resource_key: 'S9', status: 'healthy', reason: null, observed_at: now() }];
    const r3 = await dispatchQiumiTask(candidate, { actions: [], holSkipIds: [], resourceSkipIds: [] });
    expect(routeQiumiTask).toHaveBeenCalledTimes(3);
    expect(r3.outcome).toBe('proceed');
    expect(persistDecision).toHaveBeenCalledTimes(3);
  });

  it('agent 出口被健康闸挡 → 也进 resourceSkipIds 不进 holSkipIds', async () => {
    routeQiumiTask.mockResolvedValue({
      outcome: 'agent', model: 'm', runId: 'qiumi-q1-2',
      payloadPatch: { run_id: 'qiumi-q1-2', qiumi_route: { source: 'native-agent', device_hint: { is_device: true, serial: 'S9' } } },
    });
    healthRows = [{ resource_type: 'phone', resource_key: 'S9', status: 'restricted', reason: 'x', observed_at: now() }];
    const holSkipIds = [];
    const resourceSkipIds = [];
    const r = await dispatchQiumiTask(candidate, { actions: [], holSkipIds, resourceSkipIds });
    expect(r).toMatchObject({ outcome: 'skip', resource: true });
    expect(resourceSkipIds).toContain('q1');
    expect(holSkipIds).toEqual([]);
  });
});
