// packages/brain/src/__tests__/dispatcher-dedup.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...args) => mockQuery(...args) } }));

const mockRecordDispatchResult = vi.fn();
vi.mock('../dispatch-stats.js', () => ({
  recordDispatchResult: (...args) => mockRecordDispatchResult(...args),
  DISPATCH_STATS_KEY: 'dispatch_stats',
}));

// ── 下面这批 mock 只服务于第二个 describe（dispatchNextTask 全流程回归测试）。
//    第一个 describe（_internals_findDuplicateTaskSibling 单元测试）不会触碰到这些依赖，
//    但 dispatcher.js 顶部 import 是模块级的，任何一个 test 文件里跑 dispatchNextTask
//    都必须把整条依赖链喂饱，否则会打真实 DB / 真实进程。
vi.mock('../alertness-actions.js', () => ({
  getMitigationState: () => ({ drain_mode_requested: false }),
}));
vi.mock('../quota-cooling.js', () => ({
  isGlobalQuotaCooling: () => false,
  getQuotaCoolingState: () => ({ until: null }),
}));
vi.mock('../drain.js', () => ({
  isDraining: () => false,
  getDrainStartedAt: () => null,
}));
const mockCheckCeceliaRunAvailable = vi.fn(async () => ({ available: true }));
const mockTriggerCeceliaRun = vi.fn(async () => ({ success: true, runId: 'run-candidate-valid' }));
vi.mock('../executor.js', () => ({
  triggerCeceliaRun: (...args) => mockTriggerCeceliaRun(...args),
  checkCeceliaRunAvailable: (...args) => mockCheckCeceliaRunAvailable(...args),
  killProcessTwoStage: vi.fn(async () => ({ killed: false })),
  getBillingPause: () => ({ active: false }),
}));
vi.mock('../slot-allocator.js', () => ({
  harnessSlotCheck: vi.fn().mockResolvedValue({ allow: true, reason: 'ok', containers: 0, inflight: 0, cap: { effective: 4, mem_cap: 8, acct_cap: 4, hard_cap: 8 }, stale: false }),
  calculateSlotBudget: async () => ({
    dispatchAllowed: true,
    taskPool: { budget: 10 },
    user: { mode: 'solo' },
    codex: { available: true, running: 0, max: 5 },
    budgetState: { state: 'abundant' },
  }),
  shouldBypassBackpressure: () => false,
}));
vi.mock('../token-budget-planner.js', () => ({
  shouldDowngrade: () => false,
}));
vi.mock('../event-bus.js', () => ({
  emit: vi.fn(async () => {}),
}));
vi.mock('../circuit-breaker.js', () => ({
  isAllowed: () => true,
  recordFailure: vi.fn(async () => {}),
}));
vi.mock('../events/taskEvents.js', () => ({
  publishTaskStarted: vi.fn(() => {}),
}));
vi.mock('../tick-stats.js', () => ({
  incrementActionsToday: vi.fn(async () => {}),
}));
vi.mock('../account-usage.js', () => ({
  proactiveTokenCheck: vi.fn(async () => {}),
}));
vi.mock('../quota-guard.js', () => ({
  checkQuotaGuard: async () => ({ allow: true, priorityFilter: null, bestPct: 10 }),
}));
const mockUpdateTask = vi.fn(async () => ({ success: true }));
vi.mock('../actions.js', () => ({
  updateTask: (...args) => mockUpdateTask(...args),
}));
vi.mock('../pre-flight-check.js', () => ({
  preFlightCheck: async () => ({ passed: true, issues: [], suggestions: [] }),
  alertOnPreFlightFail: vi.fn(async () => {}),
  getPreFlightStats: async () => ({}),
  PRE_FLIGHT_ALERT_THRESHOLD: 3,
}));

// selectNextDispatchableTask 用一个「按 excludeIds 过滤候选池」的真实实现替身——
// 不是死板按调用次序返回固定值，而是复刻真实语义（跳过 excludeIds 里的 id 选下一个），
// 这样测试才能真正验证 attempt 预算未被判重分支消耗，而不是巧合对上调用序号。
let _candidatePool = [];
const mockSelectNextDispatchableTask = vi.fn(async (goalIds, excludeIds = []) => {
  return _candidatePool.find((c) => !excludeIds.includes(c.id)) || null;
});
vi.mock('../dispatch-helpers.js', () => ({
  selectNextDispatchableTask: (...args) => mockSelectNextDispatchableTask(...args),
  processCortexTask: vi.fn(async () => ({ dispatched: false })),
}));

import { _internals_findDuplicateTaskSibling, dispatchNextTask } from '../dispatcher.js';

describe('dispatcher duplicate-task guard', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRecordDispatchResult.mockReset();
  });

  it('DB 里存在高相似度 sibling → 判定为重复', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'sibling-1', title: 'skill-eval-worker 常驻 daemon + running 超时回收 + pm2 ecosystem' },
      ],
    });
    const candidate = {
      id: 'candidate-1',
      task_type: 'dev',
      title: 'skill-eval-worker 常驻 daemon + running 超时回收',
      created_at: new Date().toISOString(),
    };
    const dup = await _internals_findDuplicateTaskSibling(candidate);
    expect(dup).not.toBeNull();
    expect(dup.id).toBe('sibling-1');
  });

  it('DB 查询失败 → 保守放行（返回 null，不阻塞派发）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const candidate = {
      id: 'candidate-2',
      task_type: 'dev',
      title: '任意标题',
      created_at: new Date().toISOString(),
    };
    const dup = await _internals_findDuplicateTaskSibling(candidate);
    expect(dup).toBeNull();
  });

  it('无 sibling → 返回 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const candidate = {
      id: 'candidate-3',
      task_type: 'dev',
      title: '独一无二的标题',
      created_at: new Date().toISOString(),
    };
    const dup = await _internals_findDuplicateTaskSibling(candidate);
    expect(dup).toBeNull();
  });
});

describe('dispatchNextTask — 判重跳过不消耗 pre-flight attempt 预算（回归 Critical 修复）', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockRecordDispatchResult.mockReset();
    mockSelectNextDispatchableTask.mockClear();
    mockUpdateTask.mockClear();
    mockCheckCeceliaRunAvailable.mockClear();
    mockTriggerCeceliaRun.mockClear();
    _candidatePool = [];
  });

  it('6 个判重命中候选排在合法候选前面时，合法候选仍应被成功派发（MAX_PRE_FLIGHT_RETRIES=5，若判重消耗预算则会在耗尽后 all_candidates_failed_pre_flight）', async () => {
    const now = '2026-07-16T00:00:00Z'; // 存量豁免：刀2上线前，不受 S2 锚点门禁
    // 6 个会被判重命中的候选（数量 > MAX_PRE_FLIGHT_RETRIES+1=6 的边界，刻意卡在
    // "如果判重消耗 attempt 预算，第 6 次 attempt 用完后循环退出，永远够不到合法候选" 这个场景）。
    const dupCandidates = Array.from({ length: 6 }, (_, i) => ({
      id: `dup-${i}`,
      task_type: 'dev',
      title: `重复标题 ${i}`,
      project_id: null,
      priority: 'P1',
      created_at: now,
    }));
    const legitCandidate = {
      id: 'legit-1',
      task_type: 'research',
      title: '独一无二的合法任务标题',
      project_id: null,
      priority: 'P1',
      created_at: now,
    };
    _candidatePool = [...dupCandidates, legitCandidate];

    // pool.query 通用路由：
    // - 判重查询（SELECT tasks.id AS id... WHERE tasks.task_type ... created_at BETWEEN ...）：
    //   用 'created_at BETWEEN' 作为唯一指纹匹配（SELECT 列名/别名与下方 initiative-lock 查询
    //   刻意区分，不能再用 'SELECT id, title FROM tasks' 子串，两条查询都含这个前缀会撞车）：
    //   dup-* 候选返回一个 sibling（判定为重复），legit-1 返回空（不重复）。
    // - claim（UPDATE tasks SET claimed_by ...RETURNING id）：总是成功返回该 id。
    // - 其他一律返回空 rows，不影响流程（都在 try/catch 里被吞掉或走 .rows[0] ?? default）。
    mockQuery.mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('created_at BETWEEN')) {
        const candidateId = params?.[1];
        if (String(candidateId).startsWith('dup-')) {
          // findDuplicateSibling 是真实实现（未 mock），必须让 sibling 标题与候选标题真正
          // 高度重叠（Jaccard >= 阈值）才会被判定为重复——沿用候选自己的标题即可保证命中。
          const candidate = dupCandidates.find((c) => c.id === candidateId);
          return { rows: [{ id: 'sibling-of-' + candidateId, title: candidate?.title || '重复标题' }] };
        }
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('UPDATE tasks SET claimed_by = $1')) {
        return { rows: [{ id: params?.[1] }] };
      }
      if (typeof sql === 'string' && sql.includes('SELECT * FROM tasks WHERE id = $1')) {
        return { rows: [{ ...legitCandidate }] };
      }
      // retired-task 批量 drain / working_memory / decision_log 等：空结果不影响后续判断
      return { rows: [], rowCount: 0 };
    });

    const result = await dispatchNextTask(null);

    expect(result.dispatched).toBe(true);
    expect(result.task_id).toBe('legit-1');
    expect(result.reason).not.toBe('all_candidates_failed_pre_flight');
    // 6 个判重候选都应该被 selectNextDispatchableTask 依次跳过（excludeIds 累积），
    // 第 7 次调用才轮到合法候选——证明判重跳过没有让候选选择提前放弃。
    expect(mockSelectNextDispatchableTask.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(mockTriggerCeceliaRun).toHaveBeenCalledTimes(1);
  });
});
