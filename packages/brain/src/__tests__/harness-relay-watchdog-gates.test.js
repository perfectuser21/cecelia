/**
 * watchdog 生命周期闸门（Task 5）：
 * A. generator_done 短路——Task 4 finalizeHarnessTask 把被拒的 completed 申请降级为
 *    in_progress + payload.generator_done=true，watchdog 绝不能二次 spawn generator（防重复 PR）。
 * B. generator_done 6h 超时兜底——generator 完成后长期无 MERGED（pr_url 空永挂，e90c0fbb 变体）→ 标 failed。
 * C. skill-relay-spawn 事件三口收尾——executor spawn 写 running 后无人收尾（17 条永久 running），
 *    _finalizeMergedRun 成功 / attempt-cap failed / scanStuckHarness 逾期 三口按 initiative 批量关闭。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(true) }));
vi.mock('../orchestrator/kernel-run-store.js', () => ({
  patchKernelRunById: async (db, input) => {
    await db.query(
      `UPDATE initiative_runs SET phase='${input.phase}',
         failure_reason=COALESCE(failure_reason, '${input.failureReason ?? ''}'),
         pr_url=COALESCE(pr_url, $2) WHERE id=$1`,
      [input.runId, input.prUrl],
    );
    await db.query(`UPDATE tasks SET status='${input.phase === 'done' ? 'completed' : 'failed'}'`);
    return { id: input.runId, phase: input.phase };
  },
}));

import {
  resumeStalledRelayRuns,
  scanStuckHarness,
  _finalizeMergedRun,
  GENERATOR_DONE_TIMEOUT_MS,
  MAX_RELAY_ATTEMPTS,
} from '../harness-relay-watchdog.js';

const TASK_ID = 'aaaabbbb-cccc-dddd-eeee-ffff00001111';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PR_URL = 'https://github.com/org/repo/pull/42';

/**
 * 构造 deps：支持 generator_done 短路场景。
 */
function makeDeps({
  taskStatus = 'in_progress',
  attempts = 2,
  containerRunning = false,
  orchestrator = 'skill-relay',
  orchestratorHost = 'skill-relay-session',
  generatorDone = false,
  generatorDoneAt = null,
  prUrl = null,
  prState = null,
  evaluatorGate = true,
} = {}) {
  const payload = { orchestrator };
  if (generatorDone) payload.generator_done = true;
  if (generatorDoneAt != null) payload.generator_done_at = generatorDoneAt;

  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/FROM initiative_runs r/.test(sql)) {
      return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: String(attempts), deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: prUrl, orchestrator_host: orchestratorHost }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', pr_url: null, payload }] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return containerRunning ? 'abc123\n' : '';
    if (/gh pr view/.test(cmd) && prState) return JSON.stringify({ state: prState });
    return '';
  });
  return {
    pool,
    execFn,
    spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-x' }),
  };
}

const spawnEventUpdates = (pool) =>
  pool.query.mock.calls.filter(
    ([sql]) => /UPDATE initiative_run_events/.test(sql) && /skill-relay-spawn/.test(sql)
  );

beforeEach(() => {
  vi.clearAllMocks();
});

// C. skill-relay-spawn 事件三口收尾

describe('C：skill-relay-spawn 事件三口收尾', () => {
  it('1) _finalizeMergedRun 成功 -> 批量关闭 spawn 事件为 done', async () => {
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/FROM initiative_run_events/.test(sql)) return { rows: [{ x: 1 }] };
      return { rows: [] };
    })};
    const out = { mergedPr: 0, mergedWithoutGate: 0 };
    await _finalizeMergedRun(pool, { id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID }, PR_URL, out);
    const calls = spawnEventUpdates(pool);
    expect(calls.length).toBeGreaterThan(0);
    const [sql, params] = calls[0];
    expect(sql).toMatch(/status\s*=\s*'running'/);
    expect(params).toContain(TASK_ID);
    expect(params).toContain('done');
  });

  it('2) attempt-cap failed -> 批量关闭 spawn 事件为 failed', async () => {
    const deps = makeDeps({ attempts: MAX_RELAY_ATTEMPTS });
    const r = await resumeStalledRelayRuns(deps);
    expect(r.capped).toBe(1);
    const calls = spawnEventUpdates(deps.pool);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1]).toContain('failed');
  });

  it('3) scanStuckHarness 逾期 -> 批量关闭 spawn 事件为 failed', async () => {
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/SELECT id, initiative_id/.test(sql)) {
        return { rows: [{ id: 'run-1', initiative_id: TASK_ID, current_task_id: TASK_ID, orchestrator_host: 'skill-relay-session', phase: 'generate', deadline_at: new Date(Date.now() - 1000).toISOString() }] };
      }
      return { rows: [] };
    })};
    await scanStuckHarness({ pool });
    const calls = spawnEventUpdates(pool);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][1]).toContain('failed');
  });
});

// A + B. generator_done 短路 + 6h 超时兜底

describe('A/B：generator_done 短路 + 超时兜底', () => {
  it('4) generator_done=true + 容器消失 + 无 PR -> spawnFn 零调用', async () => {
    const deps = makeDeps({ generatorDone: true, generatorDoneAt: Date.now(), prUrl: null });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });

  it('5) generator_done 超 6h 无 MERGED -> tasks 标 failed + 事件收尾 + spawnFn 零调用', async () => {
    const oldAt = Date.now() - (GENERATOR_DONE_TIMEOUT_MS + 60000);
    const deps = makeDeps({ generatorDone: true, generatorDoneAt: oldAt, prUrl: null });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    const updates = deps.pool.query.mock.calls.map((c) => c[0]);
    expect(updates.some((s) => /UPDATE tasks/.test(s) && /'failed'/.test(s))).toBe(true);
    expect(updates.some((s) => /UPDATE initiative_runs/.test(s) && /'failed'/.test(s) && /generator_done_timeout/.test(s))).toBe(true);
    expect(spawnEventUpdates(deps.pool).length).toBeGreaterThan(0);
    expect(r.capped).toBe(1);
  });

  it('6) generator_done=true 未到期 + PR OPEN -> 不重点火不标 failed', async () => {
    const deps = makeDeps({ generatorDone: true, generatorDoneAt: Date.now(), prUrl: PR_URL, prState: 'OPEN' });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    const updates = deps.pool.query.mock.calls.map((c) => c[0]);
    expect(updates.some((s) => /UPDATE tasks/.test(s) && /'failed'/.test(s))).toBe(false);
    expect(r.capped).toBe(0);
    expect(r.resumed).toBe(0);
  });

  it('7) generator_done 超 6h 但 gh 查到 MERGED -> 走 _finalizeMergedRun 不标 failed', async () => {
    const oldAt = Date.now() - (GENERATOR_DONE_TIMEOUT_MS + 60000);
    const deps = makeDeps({ generatorDone: true, generatorDoneAt: oldAt, prUrl: PR_URL, prState: 'MERGED', evaluatorGate: true });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    expect(r.mergedPr).toBe(1);
    const updates = deps.pool.query.mock.calls.map((c) => c[0]);
    expect(updates.some((s) => /generator_done_timeout/.test(s))).toBe(false);
    expect(updates.some((s) => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
  });

  it('8) M1 headed 分支 generator_done=true + evaluator 已完成 + session 消失 → spawnFn 零调用（headed 短路）', async () => {
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/FROM initiative_runs r/.test(sql)) {
        return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: '1', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-claude-headed', started_at: new Date(Date.now() - 3600e3).toISOString() }] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', generator_done: true } }] };
      }
      // evaluator 已完成：_hasEvaluatorGate 返回 true
      if (/FROM initiative_run_events/.test(sql)) return { rows: [{ x: 1 }] };
      return { rows: [] };
    })};
    const execFn = vi.fn((cmd) => {
      // tmux has-session 抛非连接错误 = session 消失 -> needsRefire=true
      if (/tmux has-session/.test(cmd)) throw new Error('exit status 1: session not found');
      return '';
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });
    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });
    expect(spawnFn).not.toHaveBeenCalled();
    expect(r.resumed).toBe(0);
  });

  it('11) headless: generator_done=true + evaluator 未完成 + 容器消失 → 允许重点火（evaluator gate 修复）', async () => {
    // failing test: 当前代码 generator_done=true → 跳过重点火，evaluator 永远不跑
    // fix 后：evaluator 未完成时应允许重点火让 controller 从 Step 4 恢复
    const deps = makeDeps({
      generatorDone: true,
      generatorDoneAt: Date.now(),
      prUrl: null,
      evaluatorGate: false, // evaluator 未完成
    });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).toHaveBeenCalled();
    expect(r.resumed).toBe(1);
  });

  it('12) headed: generator_done=true + evaluator 未完成 + session 消失 → 允许重点火（evaluator gate 修复）', async () => {
    // failing test: 当前 headed 短路逻辑不检查 evaluator，session 死后 evaluator 永远不跑
    // fix 后：evaluator 未完成时应重点火让 controller 从 Step 4 恢复
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/FROM initiative_runs r/.test(sql)) {
        return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: '1', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-claude-headed', started_at: new Date().toISOString() }] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', generator_done: true } }] };
      }
      // evaluator 未完成：_hasEvaluatorGate 返回 false
      if (/FROM initiative_run_events/.test(sql)) return { rows: [] };
      return { rows: [] };
    })};
    const execFn = vi.fn((cmd) => {
      if (/tmux has-session/.test(cmd)) throw new Error('exit status 1: session not found');
      return '';
    });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });
    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });
    expect(spawnFn).toHaveBeenCalled();
    expect(r.resumed).toBe(1);
  });

  it('9) M2 generator_done=true 但 generator_done_at 缺失 -> 回退 run.started_at 判超时标 failed', async () => {
    const oldStarted = new Date(Date.now() - (GENERATOR_DONE_TIMEOUT_MS + 60000)).toISOString();
    const pool = { query: vi.fn().mockImplementation(async (sql) => {
      if (/FROM initiative_runs r/.test(sql)) {
        return { rows: [{ id: RUN_ID, initiative_id: TASK_ID, current_task_id: TASK_ID, phase: 'planning', attempts: '1', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: null, orchestrator_host: 'skill-relay-session', started_at: oldStarted }] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', generator_done: true } }] };
      }
      if (/FROM initiative_run_events/.test(sql)) return { rows: [] };
      return { rows: [] };
    })};
    const execFn = vi.fn((cmd) => { if (/docker ps/.test(cmd)) return ''; return ''; });
    const spawnFn = vi.fn().mockResolvedValue({ ok: true });
    const r = await resumeStalledRelayRuns({ pool, execFn, spawnFn });
    expect(spawnFn).not.toHaveBeenCalled();
    const updates = pool.query.mock.calls.map((c) => c[0]);
    expect(updates.some((s) => /UPDATE tasks/.test(s) && /'failed'/.test(s))).toBe(true);
    expect(updates.some((s) => /generator_done_timeout/.test(s))).toBe(true);
    expect(r.capped).toBe(1);
  });

  it('10) M2 exact-run SELECT 选出 started_at 列', async () => {
    const deps = makeDeps({ generatorDone: false });
    await resumeStalledRelayRuns(deps);
    const runsSql = deps.pool.query.mock.calls.map((c) => c[0]).find((s) => /FROM initiative_runs r/.test(s));
    expect(runsSql).toMatch(/started_at/);
  });
});
