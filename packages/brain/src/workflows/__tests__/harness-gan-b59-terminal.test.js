/**
 * B59 回归：terminal error 标记传播验证
 *
 * 设计：streak 中止（proposer_repeatedly_didnt_push / reviewer_no_parseable_verdict）、
 *   budget 超限（gan_budget_exceeded）、serial gate（advanceTaskIndexNode）、
 *   terminalFailNode 在 error 对象带 terminal:true；transient（proposer_failed /
 *   reviewer_failed）不标。
 *
 * 配合 B58 resume 钩子（executor.js channel_values.error.terminal===true → terminal failed），
 *   第一次中止即停，省 MAX-1 次无谓重启。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';

import {
  createGanContractNodes,
  MAX_NO_PUSH_STREAK,
  MAX_NO_VERDICT_STREAK,
} from '../harness-gan.graph.js';

// ── Mock 依赖（与 harness-initiative-abort.test.js 一致） ─────────────────
vi.mock('../../db.js', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../../spawn/index.js', () => ({ spawn: vi.fn() }));
vi.mock('../../spawn/detached.js', () => ({ spawnDockerDetached: vi.fn() }));
vi.mock('../../harness-shared.js', () => ({
  parseDockerOutput: (s) => s,
  loadSkillContent: () => 'SKILL',
  readBrainResult: vi.fn().mockResolvedValue({ propose_branch: 'cp-harness-propose-r1-test' }),
  ReviewerOutputSchema: { safeParse: vi.fn().mockReturnValue({ success: false }) },
}));
vi.mock('../../harness-dag.js', () => ({
  parseTaskPlan: vi.fn().mockReturnValue(null),
  upsertTaskPlan: vi.fn(),
}));
vi.mock('../../harness-worktree.js', () => ({ ensureHarnessWorktree: vi.fn() }));
vi.mock('../../harness-credentials.js', () => ({ resolveGitHubToken: vi.fn() }));
vi.mock('../../harness-container-cleanup.js', () => ({ killInitiativeContainers: vi.fn() }));
vi.mock('../../lib/git-fence.js', () => ({ fetchAndShowOriginFile: vi.fn() }));
vi.mock('../../harness-gan-graph.js', () => ({ runGanContractGraph: vi.fn() }));
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null), put: vi.fn(), setup: vi.fn(),
    list: vi.fn().mockResolvedValue([]), getTuple: vi.fn().mockResolvedValue(null), putWrites: vi.fn(),
  }),
}));
vi.mock('../../spawn/middleware/account-rotation.js', () => ({ resolveAccount: vi.fn() }));

import { runGanLoopNode, advanceTaskIndexNode, terminalFailNode } from '../harness-initiative.graph.js';
import { runGanContractGraph } from '../../harness-gan-graph.js';

// ── 工具 ─────────────────────────────────────────────────────────────────

function makeOkExecutor(worktreePath) {
  return vi.fn(async ({ env }) => {
    writeFileSync(
      path.join(worktreePath, '.brain-result.json'),
      JSON.stringify({ propose_branch: env.PROPOSE_BRANCH || 'cp-test', workstream_count: 1 }),
    );
    return { exit_code: 0, stdout: '', cost_usd: 0.01 };
  });
}

// ── GAN proposer streak 中止 ─────────────────────────────────────────────
describe('B59 — proposer_repeatedly_didnt_push 带 terminal:true', () => {
  it('streak 达上限时 error.terminal === true', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'b59-prop-'));
    try {
      const { proposer } = createGanContractNodes(makeOkExecutor(tmp), {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readContractFile: vi.fn().mockResolvedValue('# contract'),
        fetchOriginFile: vi.fn(async () => '{}'),
        verifyProposer: vi.fn(async () => { throw new Error('proposer_didnt_push: branch not found'); }),
      });

      const r = await proposer({
        round: MAX_NO_PUSH_STREAK - 1,
        prdContent: 'x',
        feedback: null,
        costUsd: 0,
        proposerNoPushStreak: MAX_NO_PUSH_STREAK - 1,
      });

      expect(r.error).toBeTruthy();
      expect(r.error.terminal).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('transient proposer_failed（exit!=0）不带 terminal', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'b59-prop-fail-'));
    try {
      const badExecutor = vi.fn(async () => ({ exit_code: 1, stdout: '', cost_usd: 0 }));
      const { proposer } = createGanContractNodes(badExecutor, {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readContractFile: vi.fn().mockResolvedValue(''),
        fetchOriginFile: vi.fn(async () => '{}'),
        verifyProposer: vi.fn(async () => {}),
      });

      let caughtErr;
      try {
        await proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0 });
      } catch (e) {
        caughtErr = e;
      }
      expect(caughtErr).toBeDefined();
      expect(caughtErr.message).toMatch(/proposer_failed/);
      // transient 错误不带 terminal 标记
      expect(caughtErr.terminal).toBeFalsy();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── GAN reviewer streak 中止 ─────────────────────────────────────────────
describe('B59 — reviewer_no_parseable_verdict 带 terminal:true', () => {
  it('streak 达上限时 error.terminal === true', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'b59-rev-'));
    try {
      // reviewer executor：写无 verdict 的 .brain-result.json
      const emptyExecutor = vi.fn(async () => {
        writeFileSync(
          path.join(tmp, '.brain-result.json'),
          JSON.stringify({ feedback: '' }),
        );
        return { exit_code: 0, stdout: '', cost_usd: 0 };
      });
      const { reviewer } = createGanContractNodes(emptyExecutor, {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readReviewerFeedback: vi.fn(async () => null),
      });

      const r = await reviewer({
        round: 5,
        prdContent: 'x',
        contractContent: '# c',
        costUsd: 0,
        reviewerNoVerdictStreak: MAX_NO_VERDICT_STREAK - 1,
      });

      expect(r.error).toBeTruthy();
      expect(r.error.terminal).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── GAN budget 超限 ───────────────────────────────────────────────────────
describe('B59 — gan_budget_exceeded 带 terminal:true', () => {
  it('costUsd 超 budgetCapUsd 时 error.terminal === true', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'b59-budget-'));
    try {
      const emptyExecutor = vi.fn(async () => {
        writeFileSync(path.join(tmp, '.brain-result.json'), JSON.stringify({ feedback: '' }));
        return { exit_code: 0, stdout: '', cost_usd: 0 };
      });
      // budgetCapUsd=0.5, costUsd=1.0 → budget exceeded
      const { reviewer } = createGanContractNodes(emptyExecutor, {
        taskId: 'test-task', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        budgetCapUsd: 0.5,
        readReviewerFeedback: vi.fn(async () => null),
      });

      const r = await reviewer({
        round: 1,
        prdContent: 'x',
        contractContent: '# c',
        costUsd: 1.0,  // > budgetCapUsd=0.5
        reviewerNoVerdictStreak: 0,
      });

      expect(r.error).toBeTruthy();
      expect(r.error.message).toMatch(/gan_budget_exceeded/);
      expect(r.error.terminal).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

// ── runGanLoopNode terminal 透传 ─────────────────────────────────────────
describe('B59 — runGanLoopNode 透传 err.terminal → state.error.terminal', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('err.terminal===true → error.terminal===true', async () => {
    const terminalErr = new Error('proposer_repeatedly_didnt_push: streak abort');
    terminalErr.terminal = true;
    runGanContractGraph.mockRejectedValue(terminalErr);

    const result = await runGanLoopNode(
      {
        task: { id: 'task-abc', payload: { sprint_dir: 'sprints', budget_usd: 10 } },
        initiativeId: 'task-abc',
        initiative_run_id: null,
        worktreePath: '/tmp/x',
        githubToken: 'fake',
        prdContent: '',
        plannerOutput: '',
        sprintDir: 'sprints',
        ganResult: null,
      },
      { pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } },
    );

    expect(result.error).toBeTruthy();
    expect(result.error.terminal).toBe(true);
  });

  it('普通 err（无 terminal）→ error.terminal===false', async () => {
    const transientErr = new Error('proposer_failed: exit=1');
    runGanContractGraph.mockRejectedValue(transientErr);

    const result = await runGanLoopNode(
      {
        task: { id: 'task-abc', payload: { sprint_dir: 'sprints', budget_usd: 10 } },
        initiativeId: 'task-abc',
        initiative_run_id: null,
        worktreePath: '/tmp/x',
        githubToken: 'fake',
        prdContent: '',
        plannerOutput: '',
        sprintDir: 'sprints',
        ganResult: null,
      },
      { pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } },
    );

    expect(result.error).toBeTruthy();
    expect(result.error.terminal).toBe(false);
  });
});

// ── advanceTaskIndexNode serial gate ─────────────────────────────────────
describe('B59 — advanceTaskIndexNode serial gate 带 terminal:true', () => {
  it('sub-task 未 merged → error.terminal === true', async () => {
    const result = await advanceTaskIndexNode({
      task_loop_index: 0,
      taskPlan: { tasks: [{ id: 'ws1' }] },
      sub_tasks: [{ id: 'ws1', status: 'in_progress' }],
    });

    expect(result.error).toBeTruthy();
    expect(result.error.message).toMatch(/Serial gate/);
    expect(result.error.terminal).toBe(true);
  });
});

// ── terminalFailNode ──────────────────────────────────────────────────────
describe('B59 — terminalFailNode 返回 terminal:true', () => {
  it('正常执行路径 error.terminal === true', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await terminalFailNode(
      { initiativeId: 'init-xyz', task_loop_index: 0, evaluate_feedback: 'tests failed' },
      { pool: mockPool },
    );

    expect(result.error).toBeTruthy();
    expect(result.error.terminal).toBe(true);
  });

  it('幂等路径（已 terminal_fail）保留 terminal:true', async () => {
    const existingError = { node: 'terminal_fail', message: 'reason', terminal: true };
    const result = await terminalFailNode(
      { error: existingError, initiativeId: 'init-xyz' },
      {},
    );

    expect(result.error.terminal).toBe(true);
  });
});
