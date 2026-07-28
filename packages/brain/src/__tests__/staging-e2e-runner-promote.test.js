import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../notifier.js', () => ({ sendFeishu: vi.fn().mockResolvedValue(undefined), sendBark: vi.fn().mockResolvedValue(false) }));

import { handlePromote, runStagingE2E } from '../staging-e2e-runner.js';

// ──────────────────────────────────────────────────────────────────────────
// Slice 2 集成：runStagingE2E PASS 后放行分流（内部线 auto-promote 必 mock，绝不打真生产）
// ──────────────────────────────────────────────────────────────────────────

function makeQueries() {
  const queries = [];
  const pool = { query: vi.fn(async (sql, params) => { queries.push({ sql, params }); return { rows: [] }; }) };
  return { queries, pool };
}

// 让 runner 走到 PASS：mock loadAcceptance 返回非空、deploy 成功、runScenarios 全过
function passDeps(extra = {}) {
  return {
    loadAcceptance: vi.fn(async () => ({
      scenarios: [{ name: 's1', covered_tasks: ['00000000-0000-0000-0000-000000000001'], commands: [{ cmd: 'echo ok' }] }],
    })),
    deploy: vi.fn(() => ({ status: 'success', output: 'deployed' })),
    exec: vi.fn(() => 'ok'), // runStagingCommand 用；命令成功（exitCode 0）
    // 必须注入：不注入会真扫 packages/quality/tests/regression/*.golden-smoke.test.ts 并 spawn vitest
    // 打 staging 端口（07-04 #3538 冻结首个 golden 文件后，单测环境无 staging 必 FAIL）
    runGoldenSmokeRegression: vi.fn(() => ({ verdict: 'SKIP', total: 0, passed: 0, failed: 0, skipped: 0, files: [] })),
    ...extra,
  };
}

describe('runStagingE2E PASS 后 promote 分流', () => {
  beforeEach(() => vi.clearAllMocks());

  it('内部线(cecelia) PASS → 调注入的 promoteExec(mock)，落 auto_promoted；绝不跑真脚本', async () => {
    const { pool, queries } = makeQueries();
    const promoteExec = vi.fn(() => ({ ok: true, output: 'mock promoted' }));
    const task = { id: 't-int', payload: { initiative_id: 'i1', pr_url: 'https://pr/int', base_repo: 'perfectuser21/cecelia' } };

    const res = await runStagingE2E(task, { pool, ...passDeps(), promoteExec });

    expect(res.verdict).toBe('PASS');
    expect(promoteExec).toHaveBeenCalledTimes(1); // 用了 mock，没碰真脚本
    expect(res.promoteStatus).toBe('auto_promoted');
    // promote_status 落库 UPDATE
    const upd = queries.find((q) => /UPDATE staging_e2e_results[\s\S]*promote_status/i.test(q.sql) && q.params.includes('auto_promoted'));
    expect(upd).toBeTruthy();
  });

  it('客户线(zenithjoy) PASS → 不 promote，落 pending_promote + 发通知', async () => {
    const { pool, queries } = makeQueries();
    const notify = vi.fn(async () => {});
    const promoteExec = vi.fn(); // 不应被调用
    const task = { id: 't-cust', payload: { initiative_id: 'i2', pr_url: 'https://pr/cust', base_repo: 'perfectuser21/zenithjoy-workspace' } };

    const res = await runStagingE2E(task, { pool, ...passDeps(), notify, promoteExec });

    expect(res.promoteStatus).toBe('pending_promote');
    expect(promoteExec).not.toHaveBeenCalled(); // 客户线绝不自动 promote
    expect(notify).toHaveBeenCalledTimes(1);     // 通知主理人
    const upd = queries.find((q) => /UPDATE staging_e2e_results[\s\S]*promote_status/i.test(q.sql) && q.params.includes('pending_promote'));
    expect(upd).toBeTruthy();
  });

  it('base_repo 缺失 PASS → 保守 pending_promote，不自动 promote（决策2）', async () => {
    const { pool } = makeQueries();
    const promoteExec = vi.fn();
    const task = { id: 't-none', payload: { initiative_id: 'i3', pr_url: 'https://pr/none' } }; // 无 base_repo

    const res = await runStagingE2E(task, { pool, ...passDeps(), notify: vi.fn(), promoteExec });

    expect(res.promoteStatus).toBe('pending_promote');
    expect(promoteExec).not.toHaveBeenCalled();
  });
});

describe('handlePromote fail-closed status', () => {
  it('never reports auto_promoted when the aggregate gate throws', async () => {
    const res = await handlePromote(
      { query: vi.fn() },
      {
        verdict: 'PASS',
        baseRepo: 'cecelia',
        prUrl: 'https://github.com/perfectuser21/cecelia/pull/1',
        initiativeId: 'initiative-1',
      },
      {
        checkInitiativeAggregate: vi.fn(async () => {
          throw new Error('database unavailable');
        }),
      },
    );
    expect(res).toBe('promote_failed');
  });
});
