/**
 * Harness v2 — Phase A GAN 合同循环单测
 *
 * 覆盖：
 *   1. 1 轮即 APPROVED → 返回 contractContent + reviewRounds=1
 *   2. 2 轮：REVISION → APPROVED，第二轮 Proposer prompt 含上轮 feedback
 *   3. 达 maxRounds 仍未 APPROVED → 抛 gan_loop_exceeded_max_rounds
 *   4. runInitiative 集成：APPROVED 后走事务，contract status='approved'
 *      + contract_content 写入 + approved_at 非空 + review_rounds 写入
 *   5. runInitiative 集成：超 maxRounds → 返回 success:false（不入库）
 */

import { describe, it, expect, vi } from 'vitest';

// ── 公共 mock：屏蔽外部依赖 ──────────────────────────────────────────────
vi.mock('../db.js', () => ({
  default: { connect: vi.fn(() => Promise.reject(new Error('should not use real pool'))) },
}));

vi.mock('../harness-worktree.js', () => ({
  ensureHarnessWorktree: vi.fn(async () => '/tmp/cec/.claude/worktrees/harness-v2/task-abcdef12'),
  cleanupHarnessWorktree: vi.fn(),
}));

vi.mock('../harness-credentials.js', () => ({
  resolveGitHubToken: vi.fn(async () => 'ghs_test_token'),
}));

// 工具：把字符串包成 docker exec 的 result.json 形式
function dockerOk(text) {
  return {
    exit_code: 0,
    timed_out: false,
    stdout: JSON.stringify({ type: 'result', result: text }),
    stderr: '',
  };
}

// ─── runGanContractLoop 单元 ────────────────────────────────────────────

describe('runGanContractLoop', () => {
  it('returns approved on round 1 when reviewer says APPROVED', async () => {
    const { runGanContractLoop } = await import('../harness-gan-loop.js');

    const calls = [];
    const exec = async (opts) => {
      calls.push(opts);
      const taskType = opts.task.task_type;
      if (taskType === 'harness_contract_propose') {
        return dockerOk('# Sprint Contract Draft\n\n## Feature 1\n... contract body ...');
      }
      if (taskType === 'harness_contract_review') {
        return dockerOk('Looks good.\n\nVERDICT: APPROVED');
      }
      throw new Error(`unexpected task_type ${taskType}`);
    };

    const res = await runGanContractLoop({
      task: { id: 'task-uuid-1' },
      initiativeId: 'init-uuid-1',
      prdContent: 'PRD body',
      worktreePath: '/tmp/wt',
      githubToken: 'tok',
      executor: exec,
    });

    expect(res.reviewRounds).toBe(1);
    expect(res.contractContent).toContain('Sprint Contract Draft');
    expect(res.approvedAt).toBeInstanceOf(Date);

    // 一个 proposer + 一个 reviewer 调用
    expect(calls.map(c => c.task.task_type)).toEqual([
      'harness_contract_propose',
      'harness_contract_review',
    ]);
  });

  it('round 2: REVISION feedback is forwarded into next proposer prompt', async () => {
    const { runGanContractLoop } = await import('../harness-gan-loop.js');

    let proposerCalls = 0;
    let reviewerCalls = 0;
    const proposerPrompts = [];

    const exec = async (opts) => {
      const t = opts.task.task_type;
      if (t === 'harness_contract_propose') {
        proposerCalls += 1;
        proposerPrompts.push(opts.prompt);
        return dockerOk(`# Contract round ${proposerCalls}\n\nbody`);
      }
      if (t === 'harness_contract_review') {
        reviewerCalls += 1;
        if (reviewerCalls === 1) {
          return dockerOk(
            'Issue: 命令 X 太弱，可被空实现绕过。建议改为 psql 校验 DB 行。\n\nVERDICT: REVISION'
          );
        }
        return dockerOk('All clear.\n\nVERDICT: APPROVED');
      }
      throw new Error(`unexpected task_type ${t}`);
    };

    const res = await runGanContractLoop({
      task: { id: 'task-uuid-2' },
      initiativeId: 'init-uuid-2',
      prdContent: 'PRD',
      worktreePath: '/tmp/wt',
      githubToken: 'tok',
      executor: exec,
    });

    expect(res.reviewRounds).toBe(2);
    expect(proposerCalls).toBe(2);
    expect(reviewerCalls).toBe(2);
    // 第 2 轮 Proposer prompt 必须含上轮 Reviewer feedback 关键字
    expect(proposerPrompts[1]).toContain('Reviewer 反馈');
    expect(proposerPrompts[1]).toContain('命令 X 太弱');
    // 第 1 轮 Proposer prompt 不该有反馈区块
    expect(proposerPrompts[0]).not.toContain('Reviewer 反馈');
  });

  it('throws when maxRounds reached without APPROVED', async () => {
    const { runGanContractLoop } = await import('../harness-gan-loop.js');

    const exec = async (opts) => {
      const t = opts.task.task_type;
      if (t === 'harness_contract_propose') return dockerOk('# Contract\nbody');
      if (t === 'harness_contract_review') {
        return dockerOk('Still issues.\n\nVERDICT: REVISION');
      }
      throw new Error(`unexpected ${t}`);
    };

    await expect(
      runGanContractLoop({
        task: { id: 'task-uuid-3' },
        initiativeId: 'init-uuid-3',
        prdContent: 'PRD',
        worktreePath: '/tmp/wt',
        githubToken: 'tok',
        executor: exec,
        maxRounds: 2,
      })
    ).rejects.toThrow(/gan_loop_exceeded_max_rounds/);
  });
});

// ─── runInitiative 集成（GAN 入库 + 失败短路） ─────────────────────────

describe('runInitiative GAN 集成', () => {
  function plannerStdout(taskPlanJson) {
    return JSON.stringify({
      type: 'result',
      result: '# PRD body\n\n```json\n' + JSON.stringify(taskPlanJson) + '\n```',
    });
  }

  const TASK_PLAN = {
    initiative_id: 'pending',
    tasks: [
      { logical_task_id: 'ws1', title: 't', complexity: 'S', files: [], dod: [] },
    ],
  };

  it('APPROVED → contract status=approved + contract_content + approved_at + review_rounds 写入', async () => {
    vi.resetModules();
    vi.doMock('../db.js', () => ({
      default: { connect: vi.fn(() => Promise.reject(new Error('should not use real pool'))) },
    }));
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/wt'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => 'tok'),
    }));
    vi.doMock('../harness-dag.js', () => ({
      parseTaskPlan: (_text) => TASK_PLAN,
      upsertTaskPlan: async () => ({ idMap: { ws1: 'task-row-1' }, insertedTaskIds: ['task-row-1'] }),
    }));

    let proposerCalls = 0;
    const exec = async (opts) => {
      const t = opts.task.task_type;
      if (t === 'harness_planner') return { exit_code: 0, timed_out: false, stdout: plannerStdout(TASK_PLAN), stderr: '' };
      if (t === 'harness_contract_propose') {
        proposerCalls += 1;
        return dockerOk('# Final Contract\n\nfeature + Workstreams body');
      }
      if (t === 'harness_contract_review') {
        return dockerOk('OK\n\nVERDICT: APPROVED');
      }
      throw new Error(`unexpected ${t}`);
    };

    const queries = [];
    const fakeClient = {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (/INSERT INTO initiative_contracts/i.test(sql)) {
          return { rows: [{ id: 'contract-uuid-1' }] };
        }
        if (/INSERT INTO initiative_runs/i.test(sql)) {
          return { rows: [{ id: 'run-uuid-1' }] };
        }
        return { rows: [] };
      },
      release: () => {},
    };
    const pool = { connect: async () => fakeClient };

    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'task-init-uuid-1', title: 'x', description: 'y' },
      { executor: exec, pool }
    );

    expect(res.success).toBe(true);
    expect(proposerCalls).toBe(1);

    // 找到 INSERT initiative_contracts 那次 call，验证字段
    const cInsert = queries.find(q => /INSERT INTO initiative_contracts/i.test(q.sql));
    expect(cInsert).toBeTruthy();
    // SQL 必须含 'approved' 字面量 + contract_content + approved_at + review_rounds
    expect(cInsert.sql).toMatch(/'approved'/);
    expect(cInsert.sql).toMatch(/contract_content/);
    expect(cInsert.sql).toMatch(/approved_at/);
    expect(cInsert.sql).toMatch(/review_rounds/);
    // params: [initiativeId, plannerOutput, contractContent, reviewRounds, budget, timeout]
    expect(cInsert.params[2]).toContain('Final Contract'); // contract_content
    expect(cInsert.params[3]).toBe(1);                     // review_rounds = 1

    // initiative_runs 应进 B_task_loop（合同已 approved）
    const runInsert = queries.find(q => /INSERT INTO initiative_runs/i.test(q.sql));
    expect(runInsert.sql).toMatch(/'B_task_loop'/);
  });

  it('GAN exceeds maxRounds → runInitiative returns success:false (no DB insert)', async () => {
    vi.resetModules();
    vi.doMock('../db.js', () => ({
      default: { connect: vi.fn(() => Promise.reject(new Error('should not use real pool'))) },
    }));
    vi.doMock('../harness-worktree.js', () => ({
      ensureHarnessWorktree: vi.fn(async () => '/tmp/wt'),
      cleanupHarnessWorktree: vi.fn(),
    }));
    vi.doMock('../harness-credentials.js', () => ({
      resolveGitHubToken: vi.fn(async () => 'tok'),
    }));
    vi.doMock('../harness-dag.js', () => ({
      parseTaskPlan: (_text) => TASK_PLAN,
      upsertTaskPlan: async () => ({ idMap: {}, insertedTaskIds: [] }),
    }));
    // 强制 maxRounds=1 后无限 REVISION
    vi.doMock('../harness-gan-loop.js', async (importActual) => {
      const actual = await importActual();
      return {
        ...actual,
        runGanContractLoop: async () => {
          throw new Error('gan_loop_exceeded_max_rounds: 1 rounds without APPROVED');
        },
      };
    });

    const exec = async (opts) => {
      const t = opts.task.task_type;
      if (t === 'harness_planner') return { exit_code: 0, timed_out: false, stdout: plannerStdout(TASK_PLAN), stderr: '' };
      throw new Error(`should not reach proposer/reviewer in mock`);
    };

    const connectFn = vi.fn(async () => ({
      query: vi.fn(async () => ({ rows: [] })),
      release: () => {},
    }));
    const pool = { connect: connectFn };

    const { runInitiative } = await import('../harness-initiative-runner.js');
    const res = await runInitiative(
      { id: 'task-init-uuid-2', title: 'x', description: 'y' },
      { executor: exec, pool }
    );

    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/gan_loop/);
    // 短路：DB 事务连接没拿（因为在 GAN 之后才 connect）
    expect(connectFn).not.toHaveBeenCalled();
  });
});
