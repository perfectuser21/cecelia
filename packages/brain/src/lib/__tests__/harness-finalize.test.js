/**
 * harness-finalize — 收账权收归机械核验（决策 dc18d43d/c3f473eb）。
 *
 * harness_initiative(skill-relay) 的任何 completed 请求一律当"申请"，Brain 用外部真相
 * （PR MERGED + evaluator gate 事件）核验，不信任任何请求体自声明。核验失败保守拒绝并降级。
 *
 * 范式取 harness-relay-watchdog.test.js：按 SQL 分派 mock pool.query + 注入 ghFn（无 shell 参数数组式）。
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
 * 构造按 SQL 分派的 mock pool + ghFn（args 数组式，无 shell）。
 */
function makeDeps({
  taskRow = { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
  evaluatorGate = true,
  prViewState = null,
  prListState = null,
  ghThrows = false,
  demoteRowCount = 1,
} = {}) {
  const pool = { query: vi.fn() };
  const demoteCalls = [];
  pool.query.mockImplementation(async (sql, params) => {
    if (/UPDATE tasks/.test(sql) && /generator_done/.test(sql)) {
      demoteCalls.push({ sql, params });
      return { rowCount: demoteRowCount, rows: [] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: taskRow ? [taskRow] : [] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  // ghFn: (args:string[]) => Promise<stdout:string>
  const ghFn = vi.fn().mockImplementation(async (args) => {
    if (ghThrows) throw new Error('gh boom');
    const sub = args[1];
    if (sub === 'view') return JSON.stringify({ state: prViewState });
    if (sub === 'list') {
      return JSON.stringify(prListState
        ? [{ headRefName: `cp-x-${SHORT}-foo`, url: PR_URL, state: prListState }]
        : []);
    }
    return '';
  });
  return { deps: { pool, ghFn }, pool, ghFn, demoteCalls };
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
    const { deps, ghFn } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: PR_URL, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      prViewState: 'MERGED',
      evaluatorGate: true,
    });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    expect(r).toMatchObject({ applies: true, allow: true });
    // ghFn 被以参数数组调用（无 shell）
    expect(ghFn).toHaveBeenCalledWith(['pr', 'view', PR_URL, '--json', 'state']);
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

  it('demote 幂等：generator_done_at 仅首次写入（CASE WHEN payload ? guard）', async () => {
    const mkTask = () => ({ id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: PR_URL, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } });
    const { deps, demoteCalls } = makeDeps({ taskRow: mkTask(), prViewState: 'OPEN' });
    // 连续两次 demote（模拟重复申请）
    await finalizeHarnessTask(TASK_ID, deps);
    await finalizeHarnessTask(TASK_ID, deps);
    expect(demoteCalls.length).toBe(2);
    // 两次 UPDATE SQL 一致，且都带 payload ? 'generator_done_at' 幂等保护（首次才写 _at）
    for (const c of demoteCalls) {
      expect(c.sql).toMatch(/payload \? 'generator_done_at'/);
      expect(c.sql).toMatch(/CASE WHEN/);
    }
    expect(demoteCalls[0].sql).toBe(demoteCalls[1].sql);
  });

  it('demote rowCount=0（任务非 in_progress）→ console.warn 留痕', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: PR_URL, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      prViewState: 'OPEN',
      demoteRowCount: 0,
    });
    await finalizeHarnessTask(TASK_ID, deps);
    const hit = warnSpy.mock.calls.some(([m]) => /rowCount=0/.test(String(m)));
    expect(hit).toBe(true);
    warnSpy.mockRestore();
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

  it('pr_url 为 shell 注入串 → 不采信，ghFn args 不含注入内容且无 pr view 调用（威胁模型正主）', async () => {
    const EVIL = 'https://github.com/o/r"; curl evil #/pull/1';
    const { deps, ghFn } = makeDeps({
      taskRow: { id: TASK_ID, status: 'in_progress', task_type: 'harness_initiative', pr_url: EVIL, payload: { orchestrator: 'skill-relay', base_repo: BASE_REPO } },
      prListState: null, // 反查无命中 → demote
    });
    const r = await finalizeHarnessTask(TASK_ID, deps);
    // 注入串不匹配严格正则 → 视同无 pr_url，落到反查路径；反查无命中 → demote
    expect(r.applies).toBe(true);
    expect(r.allow).toBe(false);
    // ghFn 被无 shell 数组式调用：任何参数元素都不含注入原始串，且绝不发生 `pr view`（采信 pr_url）调用
    for (const call of ghFn.mock.calls) {
      const args = call[0];
      expect(Array.isArray(args)).toBe(true);
      for (const a of args) expect(String(a)).not.toContain(EVIL);
      expect(args[0] === 'pr' && args[1] === 'view').toBe(false);
    }
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
