/**
 * shepherd-missed-webhook.test.js
 *
 * TDD RED → GREEN: 验证 shepherd 对 missed-webhook 的终态对账行为
 *
 * 场景：PR 合并时线上还是旧 handler，webhook 未匹配。
 * 修复后 deploy，task 状态变为 completed + pr_url IS NOT NULL + pr_status=open + pr_merged_at=null。
 *
 * 要求：
 *   1. completed+open+GitHub MERGED → 补账 pr_status=merged, pr_merged_at, payload.run_status=merged, clear current_run_id
 *   2. completed+OPEN/CONFLICTING → 保持原状，不重排
 *   3. failed/cancelled → 不碰
 *   4. replay 幂等：pr_merged_at 已有值 → 不重复写
 *   5. 不得 requeue、不得 retry_count+1、不得 executeMerge、不得生成新 Run
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));
vi.mock('../quarantine.js', () => ({
  quarantineTask: vi.fn().mockResolvedValue({ success: true }),
}));

import { spawnSync } from 'child_process';
import { reconcileTerminalOpenPRs, _resetReconcileGateForTesting } from '../shepherd.js';

const PR_URL = 'https://github.com/perfectuser21/cecelia/pull/4830';

// ─── 场景 1: completed+open+GitHub MERGED → 补账 ─────────────────────────
describe('reconcileTerminalOpenPRs — completed+open+GitHub MERGED → 补账', () => {
  beforeEach(() => { vi.mocked(spawnSync).mockReset(); _resetReconcileGateForTesting(); });

  it('调用 gh 查询 PR 状态（只读，不调用 gh pr merge）', async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN' }), stderr: '' });

    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'task-terminal-001',
              title: 'fix PR 4830',
              pr_url: PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        if (/UPDATE/i.test(sql)) {
          updates.push({ sql, params });
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    // 必须查询 gh pr view（获取 state）
    expect(spawnSync).toHaveBeenCalled();
    const [cmd, args] = vi.mocked(spawnSync).mock.calls[0];
    expect(cmd).toBe('gh');
    expect(args).toContain('state,mergeable,mergedAt');

    // 不得调用 gh pr merge
    const mergeCalls = vi.mocked(spawnSync).mock.calls.filter(c => Array.isArray(c[1]) && c[1].includes('merge'));
    expect(mergeCalls.length).toBe(0);
  });

  it('GitHub MERGED → pr_status=merged，pr_merged_at 非空，current_run_id=null', async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', mergedAt: '2026-08-12T10:00:00Z' }), stderr: '' });

    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'task-terminal-002',
              title: 'fix PR',
              pr_url: PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        if (/UPDATE/i.test(sql)) {
          updates.push({ sql, params });
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    expect(updates.length).toBeGreaterThan(0);
    const update = updates[0];
    // UPDATE SQL 必须包含 pr_status = 'merged'
    expect(update.sql).toMatch(/pr_status\s*=\s*'merged'/);
    // 必须写 pr_merged_at
    expect(update.sql).toMatch(/pr_merged_at/);
    // 必须清 current_run_id（写 NULL）
    expect(update.sql + JSON.stringify(update.params)).toMatch(/current_run_id.*null|null.*current_run_id/i);
  });

  it('payload.run_status 被写为 merged', async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', mergedAt: '2026-08-12T10:00:00Z' }), stderr: '' });

    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'task-terminal-003',
              title: 'fix PR',
              pr_url: PR_URL,
              pr_status: 'ci_pending',
              payload: {},
            }],
          };
        }
        if (/UPDATE/i.test(sql)) {
          updates.push({ sql, params });
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    expect(updates.length).toBeGreaterThan(0);
    const updateSqlOrParams = updates[0].sql + JSON.stringify(updates[0].params || []);
    expect(updateSqlOrParams).toMatch(/merged/);
  });

  it('不得 requeue（status 不改变，不写 queued）', async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN' }), stderr: '' });

    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'task-no-requeue',
              title: 'fix PR',
              pr_url: PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        if (/UPDATE/i.test(sql)) {
          updates.push({ sql, params });
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    const requeueUpdate = updates.find(u => /status\s*=\s*'queued'/.test(u.sql));
    expect(requeueUpdate).toBeUndefined();
  });

  it('不得 retry_count+1', async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN' }), stderr: '' });

    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'task-no-retry',
              title: 'fix PR',
              pr_url: PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        if (/UPDATE/i.test(sql)) {
          updates.push({ sql, params });
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    const retryUpdate = updates.find(u => /retry_count\s*=\s*retry_count\s*\+/.test(u.sql));
    expect(retryUpdate).toBeUndefined();
  });
});

// ─── 场景 2: completed+GitHub OPEN/CONFLICTING → 不重排 ──────────────────
describe('reconcileTerminalOpenPRs — GitHub OPEN/CONFLICTING → 保持原状', () => {
  beforeEach(() => { vi.mocked(spawnSync).mockReset(); _resetReconcileGateForTesting(); });

  it('GitHub OPEN → 不更新 pr_status，不 requeue', async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: 'CONFLICTING' }), stderr: '' });

    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'task-open-conflict',
              title: 'fix PR',
              pr_url: PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        if (/UPDATE/i.test(sql)) {
          updates.push({ sql, params });
          return { rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    // OPEN/CONFLICTING → 不写任何 UPDATE
    expect(updates.length).toBe(0);
  });

  it('GitHub CI_PENDING → 不重排，不更新状态', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeable: 'MERGEABLE' }), stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ statusCheckRollup: [{ name: 'ci', conclusion: null, status: 'IN_PROGRESS' }] }), stderr: '' });

    const updates = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'task-ci-pending',
              title: 'fix PR',
              pr_url: PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        if (/UPDATE/i.test(sql)) {
          updates.push({ sql, params });
          return { rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    // CI pending → 不 requeue
    const requeueUpdate = updates.find(u => /status\s*=\s*'queued'/.test(u.sql));
    expect(requeueUpdate).toBeUndefined();
  });
});

// ─── 场景 3: failed/cancelled → 不碰 ──────────────────────────────────────
describe('reconcileTerminalOpenPRs — SELECT 只选 completed 任务', () => {
  beforeEach(() => { vi.mocked(spawnSync).mockReset(); _resetReconcileGateForTesting(); });

  it('SELECT SQL 中 status = completed（只对账 terminal completed）', async () => {
    const queryCalls = [];
    const pool = {
      query: vi.fn(async (sql, params) => {
        queryCalls.push(sql);
        return { rows: [] };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    const selectSql = queryCalls[0];
    // 必须仅选 completed 状态（不能选 failed/cancelled/in_progress）
    expect(selectSql).toMatch(/status\s*=\s*'completed'/);
    // 必须要求 pr_merged_at IS NULL（防重复对账）
    expect(selectSql).toMatch(/pr_merged_at\s+IS\s+NULL/i);
    // 必须要求 pr_status IN 开放状态
    expect(selectSql).toMatch(/pr_status\s+IN/i);
  });
});

// ─── 场景 4: 幂等 replay ──────────────────────────────────────────────────
describe('reconcileTerminalOpenPRs — 幂等 replay', () => {
  beforeEach(() => { vi.mocked(spawnSync).mockReset(); _resetReconcileGateForTesting(); });

  it('已有 pr_merged_at 的任务被 SELECT 排除，gh 不被调用', async () => {
    // 修复后 SELECT 带 pr_merged_at IS NULL，所以幂等任务不出现在结果中
    const pool = {
      query: vi.fn(async (sql) => {
        // 模拟已对账任务被 WHERE 过滤掉
        if (/SELECT/i.test(sql)) return { rows: [] };
        return { rows: [], rowCount: 0 };
      }),
    };

    await reconcileTerminalOpenPRs(pool);

    expect(spawnSync).not.toHaveBeenCalled();
  });

  it('UPDATE rowCount=0（pr_merged_at 已有值）→ 幂等跳过，不报错', async () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeable: 'UNKNOWN', mergedAt: '2026-08-12T10:00:00Z' }), stderr: '' });

    const pool = {
      query: vi.fn(async (sql, params) => {
        if (/SELECT/i.test(sql)) {
          return {
            rows: [{
              id: 'task-idempotent',
              title: 'already merged',
              pr_url: PR_URL,
              pr_status: 'open',
              payload: {},
            }],
          };
        }
        if (/UPDATE/i.test(sql)) return { rowCount: 0 }; // 幂等：已处理
        return { rows: [], rowCount: 0 };
      }),
    };

    // 不应抛出
    await expect(reconcileTerminalOpenPRs(pool)).resolves.not.toThrow();
  });
});
