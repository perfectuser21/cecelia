/**
 * harness-watchdog-never-started.test.js
 *
 * Regression test for Notion issue fabf6bd6 — harness dispatcher deadlock.
 *
 * Gap: resumeStalledHarnessDrivers() already recovers stalled graphs via heartbeat,
 * but every query requires an existing initiative_runs row (JOIN/EXISTS). A task
 * that never even got that far (claim succeeded, status=in_progress, but the graph
 * never invoked — matches the issue's `initiative_runs=0` symptom) is invisible to
 * both existing sections (A and B). This test covers the new "never started" branch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';


// 未显式注入的宿主进程调用只记录、返回空，永远不运行真实 docker。
// never-started 不测 fresh-start 上限；显式传3避免为常量懒加载整个 executor 依赖图。
const hostProcess = vi.hoisted(() => vi.fn(() => ''));
const ownedExec = vi.hoisted(() => vi.fn(() => ''));
vi.mock('child_process', async (original) => ({ ...await original(), execSync: hostProcess }));
afterEach(() => { expect(hostProcess).not.toHaveBeenCalled(); });

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockPoolConnect = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({
  default: { query: mockPoolQuery, connect: mockPoolConnect },
}));

let resumeStalledHarnessDrivers;

function isNeverStartedCandidateSql(sql) {
  return /SELECT/i.test(sql)
    && /NOT\s+EXISTS/i.test(sql)
    && /initiative_runs/i.test(sql)
    && /claimed_at/i.test(sql);
}

function isTaskLockSql(sql) {
  return /FROM\s+tasks/i.test(sql) && /FOR\s+UPDATE/i.test(sql);
}

function isExactRunSql(sql) {
  return /FROM\s+initiative_runs/i.test(sql) && !/FROM\s+tasks/i.test(sql);
}

beforeEach(async () => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  hostProcess.mockClear();
  ownedExec.mockClear();
  mockPoolConnect.mockReset();
  mockPoolConnect.mockImplementation(async () => ({
    query: mockPoolQuery,
    release: vi.fn(),
  }));
  const mod = await import('../harness-watchdog.js');
  resumeStalledHarnessDrivers = mod.resumeStalledHarnessDrivers;
});

describe('resumeStalledHarnessDrivers — 旧有头宽限兼容', () => {
  // ── 有头豁免（并行血管P2，decision 45a2bcfb）──────────────────────────────
  // 真实事故：09-06 战役中误杀 4 次——有头 /dev 会话（claimed_by=interactive-dev-skill）
  // 在 PrepPRD/探索/TDD 阶段 20min 内不写 initiative_runs 行，被区段 C 无差别标 failed
  // 清 claim 触发重复派发。docker 容器探测救不了有头（有头没有 cecelia-relay-* 容器）。
  // 修法：claimed_by 含 interactive-dev-skill 且 claimed_at < 40min（HEADED_CLAIM_GRACE_MINUTES）
  // → 视为有头在工跳过；超 40min 无任何 run 活动才落回判死。候选 SELECT 与事务锁双处谓词（防 TOCTOU）。

  it('候选 SELECT 含 interactive-dev-skill 有头豁免谓词 + 40 分钟宽限窗', async () => {
    mockPoolQuery.mockImplementation(async () => ({ rows: [] }));
    await resumeStalledHarnessDrivers({ maxFreshStarts: 3, execFn: ownedExec,});
    const candidateSql = mockPoolQuery.mock.calls
      .map(([sql]) => String(sql))
      .find(sql => isNeverStartedCandidateSql(sql));
    expect(candidateSql).toBeDefined();
    expect(candidateSql).toMatch(/interactive-dev-skill/);
    expect(candidateSql).toMatch(/claimed_by/i);
    expect(candidateSql).toMatch(/40\s*minutes|\$\d+\s*\|\|\s*' minutes'/i);
  });

  it('事务内 FOR UPDATE 锁查询同样含有头豁免谓词（防 claim 后被刷新的 TOCTOU）', async () => {
    const TASK_ID = 'a795594b-1111-4222-8333-444455556666';
    let lockSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      if (isNeverStartedCandidateSql(String(sql))) return { rows: [{ id: TASK_ID }] };
      if (isTaskLockSql(String(sql))) {
        lockSql = String(sql);
        return { rows: [] }; // 锁时已被豁免谓词过滤掉
      }
      return { rows: [] };
    });
    await resumeStalledHarnessDrivers({ maxFreshStarts: 3,  execFn: () => '' });
    expect(lockSql).toMatch(/interactive-dev-skill/);
  });

  it('claimed 20min 的有头任务（claimed_by=interactive-dev-skill）→ 不标 failed 不清 claim', async () => {
    // 模拟 DB 正确执行豁免谓词：有头新鲜任务不出现在候选/锁结果里
    const HEADED_TASK = { id: 'a795594b-2222-4333-8444-555566667777', claimed_by: 'interactive-dev-skill', claimed_at: new Date(Date.now() - 20 * 60 * 1000) };
    let updateCalled = false;
    mockPoolQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (isNeverStartedCandidateSql(text)) {
        // DB 执行豁免谓词：claimed_by 含 interactive-dev-skill 且 claimed_at 20min < 40min → 过滤
        const exempt = /interactive-dev-skill/.test(text);
        return { rows: exempt ? [] : [{ id: HEADED_TASK.id }] };
      }
      if (isTaskLockSql(text)) return { rows: [{ id: HEADED_TASK.id, status: 'in_progress', claimed_at: HEADED_TASK.claimed_at }] };
      if (isExactRunSql(text)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(text)) { updateCalled = true; return { rows: [{ id: HEADED_TASK.id }] }; }
      return { rows: [] };
    });

    const r = await resumeStalledHarnessDrivers({ maxFreshStarts: 3,  execFn: () => '' });

    expect(updateCalled).toBe(false);
    expect(r.resumed).toEqual([]);
  });

  it('claimed 超 40min 的有头任务 → 豁免失效，落回原判死逻辑标 failed', async () => {
    const STALE_HEADED = 'a795594b-3333-4444-8555-666677778888';
    let updateSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (isNeverStartedCandidateSql(text)) {
        // DB 执行豁免谓词：claimed_at 50min > 40min → 豁免不成立，进候选
        return { rows: [{ id: STALE_HEADED }] };
      }
      if (isTaskLockSql(text)) {
        return { rows: [{ id: STALE_HEADED, status: 'in_progress', claimed_at: new Date(Date.now() - 50 * 60 * 1000) }] };
      }
      if (isExactRunSql(text)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(text)) { updateSql = text; return { rows: [{ id: STALE_HEADED }] }; }
      return { rows: [] };
    });

    const r = await resumeStalledHarnessDrivers({ maxFreshStarts: 3,  execFn: () => '' });

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(r.resumed).toContain(STALE_HEADED);
  });

  it('HEADED_CLAIM_GRACE_MINUTES 常量导出为 40', async () => {
    const mod = await import('../harness-watchdog.js');
    expect(mod.HEADED_CLAIM_GRACE_MINUTES).toBe(40);
  });

  it('docker 命令失败（不可用）→ fail-open 保留现有判死逻辑，不因探测失败而漏判真死亡任务', async () => {
    const TASK_ID = 'ffff1111-2222-3333-4444-555566667777';
    let updateSql = '';
    mockPoolQuery.mockImplementation(async (sql) => {
      if (/SELECT/i.test(sql) && /NOT\s+EXISTS/i.test(sql) && /initiative_runs/.test(sql) && /claimed_at/i.test(sql)) {
        return { rows: [{ id: TASK_ID }] };
      }
      if (isTaskLockSql(sql)) {
        return { rows: [{ id: TASK_ID, status: 'in_progress', claimed_at: new Date(0) }] };
      }
      if (isExactRunSql(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        updateSql = sql;
        return { rows: [{ id: TASK_ID }] };
      }
      return { rows: [] };
    });
    const execFn = vi.fn(() => { throw new Error('docker: command not found'); });

    const r = await resumeStalledHarnessDrivers({ maxFreshStarts: 3,  execFn });

    expect(updateSql).toMatch(/status\s*=\s*'failed'/i);
    expect(r.resumed).toContain(TASK_ID);
  });
});

// ── 有头会话超 grace 后不得再判 failed（2026-09-16 实证）──────────────────
// 根因：豁免只看 claimed_at（开工那一刻），不看"是否仍在活动"。认真干了 44/118 分钟
// 的有头会话，和 40 分钟前就死掉的会话，在 watchdog 眼里一模一样。
// 更要命的是判死方式：failed 是终端态，API 无法回正（状态机 allowed:[]），只能直写 DB。
// 本次会话 4 个有头任务全中：abcbc09f / 2091c21b / 9e949390 / 27600369。
describe('resumeStalledHarnessDrivers — 有头会话超 grace 降级为 blocked 而非 failed', () => {
  function stubNeverStartedFlow({ claimedBy, executorKind }) {
    const captured = { updateSql: null, updateParams: null };
    mockPoolQuery.mockImplementation(async (sql, params) => {
      if (isNeverStartedCandidateSql(sql)) return { rows: [{ id: 'task-headed' }] };
      if (isTaskLockSql(sql)) {
        return {
          rows: [{
            id: 'task-headed',
            status: 'in_progress',
            claimed_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
            claimed_by: claimedBy,
            executor_kind: executorKind,
          }],
        };
      }
      if (isExactRunSql(sql)) return { rows: [] };
      if (/UPDATE\s+tasks/i.test(sql)) {
        captured.updateSql = sql;
        captured.updateParams = params;
        return { rows: [{ id: 'task-headed' }] };
      }
      return { rows: [] };
    });
    return captured;
  }

  it('有头任务（interactive-dev-skill）超 grace → blocked，绝不 failed', async () => {
    const captured = stubNeverStartedFlow({
      claimedBy: 'interactive-dev-skill',
      executorKind: 'headed-session',
    });
    await resumeStalledHarnessDrivers({ maxFreshStarts: 3, execFn: ownedExec, staleMinutesA: 20 });
    expect(captured.updateSql).toBeTruthy();
    expect(captured.updateSql).not.toMatch(/status\s*=\s*'failed'/i);
    expect(captured.updateSql).toMatch(/status\s*=\s*'blocked'/i);
  });

  it('有头任务降级时必须写 blocked_at（DB 约束 chk_blocked_at_not_null）', async () => {
    const captured = stubNeverStartedFlow({
      claimedBy: 'interactive-dev-skill',
      executorKind: 'headed-session',
    });
    await resumeStalledHarnessDrivers({ maxFreshStarts: 3, execFn: ownedExec, staleMinutesA: 20 });
    expect(captured.updateSql).toMatch(/blocked_at\s*=/i);
  });

  it('非有头任务（自动流水线）仍按原样判 failed —— 那条路径是对的', async () => {
    const captured = stubNeverStartedFlow({
      claimedBy: 'cecelia-relay-container',
      executorKind: 'relay-container',
    });
    await resumeStalledHarnessDrivers({ maxFreshStarts: 3, execFn: ownedExec, staleMinutesA: 20 });
    expect(captured.updateSql).toMatch(/status\s*=\s*'failed'/i);
  });
});
