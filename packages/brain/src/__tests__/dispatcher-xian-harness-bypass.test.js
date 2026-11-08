// 只验证当前 dispatcher admission：主池满时，西安独立池可用才允许继续选单。
// 选单返回空集，绝不恢复旧 harness 或启动任何执行器。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fixture = vi.hoisted(() => ({
  location: 'xian', codexAvailable: true, peekFails: false,
  query: vi.fn(), select: vi.fn(), executor: vi.fn(), process: vi.fn(), network: vi.fn(),
}));
vi.mock('../db.js', () => ({ default: { query: fixture.query } }));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: fixture.executor,
  checkCeceliaRunAvailable: vi.fn(async () => ({ available: true })),
  killProcessTwoStage: fixture.process,
  getBillingPause: () => ({ active: false }),
}));
vi.mock('node:child_process', async original => {
  const actual = await original();
  const deny = (...args) => { fixture.process(...args); throw Error('测试禁止宿主进程'); };
  return { ...actual, exec: deny, execSync: deny, execFile: deny, execFileSync: deny, spawn: deny, spawnSync: deny };
});
vi.mock('../slot-allocator.js', () => ({
  calculateSlotBudget: vi.fn(async () => ({
    dispatchAllowed: false, resourceAdmissionBlocked: false,
    taskPool: { budget: 0, used: 0, available: 0 },
    user: { mode: 'solo' }, codex: { available: fixture.codexAvailable },
  })),
  harnessSlotCheck: vi.fn(),
}));
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: fixture.select,
  processCortexTask: vi.fn(),
}));
// 强制静态类型映射不是西安，正例必须消费队头真实 location 字段。
vi.mock('../task-router.js', () => ({ getTaskLocation: () => 'us' }));
vi.mock('../quota-cooling.js', () => ({ isGlobalQuotaCooling: () => false }));
vi.mock('../drain.js', () => ({ isDraining: () => false }));
vi.mock('../account-usage.js', () => ({ proactiveTokenCheck: vi.fn() }));
vi.mock('../quota-guard.js', () => ({ checkQuotaGuard: async () => ({ allow: true, bestPct: 0 }) }));
vi.mock('../dispatch-stats.js', () => ({ recordDispatchResult: vi.fn() }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn() }));
vi.mock('../events/taskEvents.js', () => ({ publishTaskStarted: vi.fn() }));
vi.mock('../tick-stats.js', () => ({ incrementActionsToday: vi.fn() }));
vi.mock('../pre-flight-check.js', () => ({ preFlightCheck: vi.fn(), alertOnPreFlightFail: vi.fn() }));
vi.mock('../actions.js', () => ({ updateTask: vi.fn() }));
vi.mock('../llm-caller.js', () => ({ callLLM: fixture.network }));
vi.mock('../notifier.js', () => ({ sendBark: fixture.network, sendFeishu: fixture.network }));

import { dispatchNextTask } from '../dispatcher.js';
import { calculateSlotBudget } from '../slot-allocator.js';

beforeEach(() => {
  vi.clearAllMocks();
  fixture.location = 'xian'; fixture.codexAvailable = true; fixture.peekFails = false;
  fixture.select.mockResolvedValue(null);
  fixture.query.mockImplementation(async sql => {
    if (sql.includes('SELECT priority FROM tasks')) return { rows: [{ priority: 'P2' }] };
    if (sql.includes('SELECT task_type, location FROM tasks')) {
      if (fixture.peekFails) throw Error('owned queue read failed');
      return { rows: [{ task_type: 'data', location: fixture.location }] };
    }
    return { rows: [], rowCount: 0 };
  });
  vi.stubGlobal('fetch', (...args) => { fixture.network(...args); throw Error('测试禁止网络'); });
});
afterEach(() => {
  expect(fixture.executor).not.toHaveBeenCalled();
  expect(fixture.process).not.toHaveBeenCalled();
  expect(fixture.network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
const queuePeekCalls = () => fixture.query.mock.calls.filter(([sql]) => sql.includes('SELECT task_type, location FROM tasks'));

describe('真实 dispatcher 西安 admission', () => {
  it('主池满但独立池可用：队头 location=xian 进入普通选单，不冒充已派发', async () => {
    const result = await dispatchNextTask([]);
    expect(result).toMatchObject({ dispatched: false, reason: 'no_dispatchable_task' });
    expect(calculateSlotBudget).toHaveBeenCalledTimes(2);
    expect(queuePeekCalls()).toHaveLength(1);
    expect(fixture.select).toHaveBeenCalledTimes(1);
    expect(fixture.select).toHaveBeenCalledWith([], [], { priorityFilter: null });
  });

  it.each(['us', null])('队头 location=%s 且静态映射非西安：保持池满拒绝', async location => {
    fixture.location = location;
    const result = await dispatchNextTask([]);
    expect(result).toMatchObject({ dispatched: false, reason: 'pool_exhausted' });
    expect(queuePeekCalls()).toHaveLength(1);
    expect(fixture.select).toHaveBeenCalledTimes(1);
    expect(fixture.select).toHaveBeenCalledWith([], [], expect.objectContaining({ onlyTaskTypes: ['qiumi_task'] }));
  });

  it('独立Codex池不可用：不读西安队头，不进入普通选单', async () => {
    fixture.codexAvailable = false;
    const result = await dispatchNextTask([]);
    expect(result).toMatchObject({ dispatched: false, reason: 'pool_exhausted' });
    expect(queuePeekCalls()).toHaveLength(0);
    expect(fixture.select).toHaveBeenCalledTimes(1);
    expect(fixture.select).toHaveBeenCalledWith([], [], expect.objectContaining({ onlyTaskTypes: ['qiumi_task'] }));
  });

  it('队头读取失败：保守拒绝，不能据 location 默认放行', async () => {
    fixture.peekFails = true;
    const result = await dispatchNextTask([]);
    expect(result).toMatchObject({ dispatched: false, reason: 'pool_exhausted' });
    expect(queuePeekCalls()).toHaveLength(1);
    expect(fixture.select).toHaveBeenCalledTimes(1);
    expect(fixture.select).toHaveBeenCalledWith([], [], expect.objectContaining({ onlyTaskTypes: ['qiumi_task'] }));
  });
});
