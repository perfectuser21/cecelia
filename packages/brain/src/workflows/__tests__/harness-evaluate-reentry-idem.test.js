/**
 * B-reentry — evaluate 节点重入幂等门（#3372 配套缺口）。
 *
 * 根因：LangGraph interrupt() 重入会让 evaluateContractNode 从头重跑；spawn 在 interrupt 之前，
 * 每次 resume 都再 spawn 一个新 evaluator 容器（实证 evaluate-ws1-r4 同时 4 个）。#3372 裁判给
 * 回调链路加了 ~6s，拉长 evaluate 回调窗口，放大了并发 resume 同时重 spawn。
 *
 * 修复：spawn 前查同 (task, fix_round) 是否已有活 evaluate 容器（docker ps name 前缀命中）；
 * 有则复用其 containerId、跳过 spawn + thread_lookup INSERT，直接进 interrupt 等它回调。
 *
 * 本测覆盖「同轮第二次进入不重 spawn」。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../spawn/middleware/account-rotation.js', () => ({
  resolveAccount: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../account-usage.js', () => ({
  isSpendingCapped: () => false,
  isAuthFailed: () => false,
  selectBestAccount: vi.fn().mockResolvedValue(null),
}));

const { evaluateContractNode } = await import('../harness-task.graph.js');

const baseState = {
  task: { id: 'reentry-task-uuid', task_type: 'harness_evaluate', payload: { sprint_dir: 'sprints/x' } },
  initiativeId: 'init-1',
  contractBranch: 'cp-proposer-branch',
  pr_branch: 'cp-pr-branch',
  worktreePath: '/tmp/x',
  githubToken: 'fake-token',
  fix_round: 4,
};

// 公共 opts：跳过确定性门 + 不触碰真 docker/网络。
function baseOpts(extra = {}) {
  return {
    resolveToken: vi.fn().mockResolvedValue('fake-token'),
    poolOverride: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    verifyArtifacts: vi.fn().mockResolvedValue({ ran: false }),
    runContractGate: vi.fn().mockResolvedValue({ ok: true }),
    isInitiativeTerminal: vi.fn().mockResolvedValue({ terminal: false }),
    ...extra,
  };
}

describe('B-reentry: evaluate 同轮重入不重 spawn', () => {
  it('已有活 evaluate 容器 → 复用、跳过 spawn 与 thread_lookup INSERT', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'should-not-be-called' });
    const findLiveEvaluateContainer = vi.fn().mockResolvedValue('harness-evaluate-reentry-task-uuid-r4-live9999');
    const opts = baseOpts({ spawnDetached, findLiveEvaluateContainer });

    await evaluateContractNode(baseState, opts)
      .catch(() => { /* interrupt() 抛 GraphInterrupt，spawn 决策已在 interrupt 前完成 */ });

    expect(findLiveEvaluateContainer).toHaveBeenCalledOnce();
    // 复用活容器 → 不再 spawn 新容器
    expect(spawnDetached).not.toHaveBeenCalled();
    // 复用路径不重写 thread_lookup（活容器首跑时已写）
    const insertCalls = opts.poolOverride.query.mock.calls.filter(
      (c) => /walking_skeleton_thread_lookup/.test(c[0])
    );
    expect(insertCalls.length).toBe(0);
  });

  it('无活容器（首次进入）→ 正常 spawn + thread_lookup INSERT', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fresh' });
    const findLiveEvaluateContainer = vi.fn().mockResolvedValue(null);
    const opts = baseOpts({ spawnDetached, findLiveEvaluateContainer });

    await evaluateContractNode(baseState, opts)
      .catch(() => { /* interrupt 抛错 OK，spawn 已被调过 */ });

    expect(findLiveEvaluateContainer).toHaveBeenCalledOnce();
    expect(spawnDetached).toHaveBeenCalledOnce();
    const insertCalls = opts.poolOverride.query.mock.calls.filter(
      (c) => /walking_skeleton_thread_lookup/.test(c[0])
    );
    expect(insertCalls.length).toBe(1);
  });

  it('活容器检测抛错 → fail-open，正常 spawn（不因检测失败卡死）', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fresh' });
    const findLiveEvaluateContainer = vi.fn().mockRejectedValue(new Error('docker daemon down'));
    const opts = baseOpts({ spawnDetached, findLiveEvaluateContainer });

    await evaluateContractNode(baseState, opts)
      .catch(() => { /* interrupt 抛错 OK */ });

    expect(spawnDetached).toHaveBeenCalledOnce();
  });
});
