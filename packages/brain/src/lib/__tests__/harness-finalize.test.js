/**
 * harness-finalize — 收账权收归机械核验（决策 dc18d43d/c3f473eb）。
 *
 * harness_initiative(skill-relay) 的任何 completed 请求一律当"申请"，Brain 用外部真相
 * （PR MERGED + evaluator gate 事件）核验，不信任任何请求体自声明。核验失败保守拒绝并降级。
 *
 * 范式取 harness-relay-watchdog.test.js：按 SQL 分派 mock pool.query + 注入 execFn。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool } = vi.hoisted(() => ({ mockPool: { query: vi.fn() } }));
vi.mock('../../db.js', () => ({ default: mockPool }));
vi.mock('../../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));

import { finalizeHarnessTask, isHarnessRelayTask } from '../harness-finalize.js';

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const SHORT = 'aaaabbbb';
const PR_URL = 'https://github.com/org/repo/pull/42';
const BASE_REPO = 'https://github.com/org/repo';

/**
 * 构造按 SQL 分派的 mock pool + execFn。
 */
function makeDeps({
  taskRow = { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
  evaluatorGate = true,
  prViewState = null,
  prListState = null,
  ghThrows = false,
} = {}) {
  const pool = { query: vi.fn() };
  const demoteCalls = [];
  pool.query.mockImplementation(async (sql, params) => {
    if (/UPDATE tasks/.test(sql) && /generator_done/.test(sql)) {
      demoteCalls.push({ sql, params });
      return { rowCount: 1, rows: [] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: taskRow ? [taskRow] : [] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (ghThrows) throw new Error('gh boom');
    if (/gh pr view/.test(cmd)) return JSON.stringify({ state: prViewState });
    if (/gh pr list/.test(cmd)) {
      return JSON.stringify(prListState
        ? [{ headRefName: `cp-x-${SHORT}-foo`, url: PR_URL, state: prListState }]
        : []);
    }
    return '';
  });
  return { deps: { pool, execFn }, pool, execFn, demoteCalls };
}

beforeEach(() => {
  mockPool.query.mockReset();
});

describe('isHarnessRelayTask', () => {
  it('task_type=harness_initiative + orchestrator=skill-relay → true', () => {
    expect(isHarnessRelayTask({ task_type: 'harness_initiative', payload: { orchestrator: 'skill-relay' } })).toBe(true);
  });
  it('普通 dev 任务 → false', () => {
    expect(isHarnessRelayTask({ task_type: 'dev', payload: {} })).toBe(false);
  });
  it('harness_initiative 但非 skill-relay → false', () => {
    expect(isHarnessRelayTask({ task_type: 'harness_initiative', payload: { orchestrator: 'fullgraph' } })).toBe(false);
  });
});

describe('finalizeHarnessTask — 外部真相核验', () => {
  it('非 harness relay 任务 → applies:false（原逻辑不受影响）', async () => {
    const { deps } = makeDeps({ taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'dev', pr_url: null, payload: {} } });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    expect(r.applies).toBe(false);
  });

  it('PR MERGED + evaluator gate → allow:true', async () => {
    const { deps } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: PR_URL, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      prViewState: 'MERGED',
      evaluatorGate: true,
    });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    expect(r).toMatchObject({ applies: true, allow: true });
  });

  it('PR OPEN → allow:false 且写 generator_done 降级', async () => {
    const { deps, demoteCalls } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: PR_URL, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      prViewState: 'OPEN',
    });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    expect(r.applies).toBe(true);
    expect(r.allow).toBe(false);
    expect(demoteCalls.length).toBeGreaterThan(0);
    expect(demoteCalls[0].sql).toMatch(/generator_done/);
  });

  it('无 pr_url 且 GitHub 反查无命中 → allow:false', async () => {
    const { deps } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      prListState: null,
    });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    expect(r.applies).toBe(true);
    expect(r.allow).toBe(false);
  });

  it('无 pr_url 但反查到 MERGED PR + gate → allow:true', async () => {
    const { deps } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      prListState: 'MERGED',
      evaluatorGate: true,
    });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    expect(r).toMatchObject({ applies: true, allow: true });
  });

  it('PR MERGED 但无 evaluator gate → allow:false 且 reason 含 evaluator', async () => {
    const { deps } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: PR_URL, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      prViewState: 'MERGED',
      evaluatorGate: false,
    });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    expect(r.applies).toBe(true);
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/evaluator/i);
  });

  it('gh 命令抛错 → allow:false（保守拒绝，不放行终态）', async () => {
    const { deps } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: PR_URL, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      ghThrows: true,
    });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    expect(r.applies).toBe(true);
    expect(r.allow).toBe(false);
  });
});
