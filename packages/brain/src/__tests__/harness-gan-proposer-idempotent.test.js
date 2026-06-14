/**
 * B59-idem — GAN proposer 幂等门：本轮合同已 push 到分支时跳过重 spawn。
 *
 * 根因：proposer 节点配 retryPolicy=LLM_RETRY (maxAttempts=3)。节点内 readContractFile 等
 * 偶发 throw → LangGraph 重试整节点 → 重新 spawn executor 容器。实证每轮 proposer 跑 2-3 个
 * 容器（1 初始 + 1-2 重试），一条简单 sprint 烧 12 个容器/25min。
 *
 * 修法：proposer 开头先查本轮 computedBranch 是否已有合同（上次 attempt 已成功 push）。
 * 有 → 复用、跳过 executor（幂等）；无 → 正常 spawn。让重试变廉价，不再重复跑 LLM 容器。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../harness-shared.js', () => ({
  loadSkillContent: vi.fn(() => ''),
  readBrainResult: vi.fn(async () => ({})),
  ReviewerOutputSchema: {},
}));

import { createGanContractNodes } from '../workflows/harness-gan.graph.js';

function makeCtx(overrides = {}) {
  return {
    taskId: 'abc12345-def',
    initiativeId: 'init-1',
    sprintDir: 'sprints',
    worktreePath: '/tmp/wt',
    githubToken: 'tok',
    baseRepo: 'https://github.com/x/y.git',
    plannerOutput: '',
    readContractFile: vi.fn(async () => '# Contract'),
    verifyProposer: vi.fn(async () => undefined),
    readReviewerFeedback: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('GAN proposer 幂等门（B59-idem）', () => {
  it('本轮分支已有合同 → 跳过 executor，复用已有合同', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0 }));
    const readContractFromBranch = vi.fn(async () => '# 已 push 的合同');
    const nodes = createGanContractNodes(executor, makeCtx({ readContractFromBranch }));

    const out = await nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 });

    expect(executor).not.toHaveBeenCalled();          // 关键：没重 spawn
    expect(out.contractContent).toBe('# 已 push 的合同');
    expect(out.proposeBranch).toBe('cp-harness-propose-r1-abc12345-a0'); // attempt 后缀（默认 0）
    expect(out.round).toBe(1);
  });

  it('attempt 版本化：不同 attemptN → proposer 分支不同（跨 fresh-start 不复用上一代旧合同）', async () => {
    // attemptN=0 的旧合同存在；本轮 attemptN=2 → 查的是 r1...-a2（不是 -a0）→ 不命中 → 正常 spawn。
    const executor = vi.fn(async () => ({ exit_code: 0 }));
    const readContractFromBranch = vi.fn(async (_wt, branch) =>
      branch.endsWith('-a0') ? '# 上一代旧合同' : null
    );
    const nodes = createGanContractNodes(executor, makeCtx({ attemptN: 2, readContractFromBranch }));

    await nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 });

    // 查的分支带 -a2（本代），不复用 -a0 的旧合同 → 正常 spawn 产新合同
    expect(readContractFromBranch).toHaveBeenCalledWith(
      '/tmp/wt', 'cp-harness-propose-r1-abc12345-a2', 'sprints', expect.anything()
    );
    expect(executor).toHaveBeenCalledOnce();
  });

  it('本轮分支无合同 → 正常 spawn executor', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0 }));
    const readContractFromBranch = vi.fn(async () => null); // 分支还没合同
    const nodes = createGanContractNodes(executor, makeCtx({ readContractFromBranch }));

    await nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 });

    expect(executor).toHaveBeenCalledOnce();           // 正常 spawn
  });

  it('readContractFromBranch 抛错 → 当作无合同，正常 spawn（不崩）', async () => {
    const executor = vi.fn(async () => ({ exit_code: 0 }));
    const readContractFromBranch = vi.fn(async () => { throw new Error('git show failed'); });
    const nodes = createGanContractNodes(executor, makeCtx({ readContractFromBranch }));

    await nodes.proposer({ prdContent: '# PRD', round: 0, costUsd: 0 });

    expect(executor).toHaveBeenCalledOnce();
  });
});
