/**
 * evaluateContractNode — PR 已 merge 时短路 verdict=PASS（不 checkout 已删分支跑 E2E，不触发 fix loop）。
 *
 * 现场（常态非边缘）：每次 merge 触发 auto-version 重启 brain，checkpoint 大概率断在 merge 节点后 →
 * 成功的 harness run 恢复时会重跑 evaluate；此时 PR 已 merge、分支已删 → evaluate checkout 失败/E2E
 * FAIL → routeAfterEvaluate 路由到 fix → 在【已 merge 的 PR】上 spawn generator（fix loop）。
 * 修复：evaluate 动作前先查 PR 状态，已 MERGED → 直接 PASS（合同已过 CI 合并即达标）。
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

const baseState = (overrides = {}) => ({
  task: { id: 'test-task-uuid', task_type: 'harness_evaluate', payload: { sprint_dir: 'sprints/x' } },
  initiativeId: 'test-init',
  pr_url: 'https://github.com/x/y/pull/123',
  pr_branch: 'cp-test-pr-branch',
  worktreePath: '/tmp/x',
  githubToken: 'fake-token',
  fix_round: 0,
  ...overrides,
});

const baseOpts = () => ({
  resolveToken: vi.fn().mockResolvedValue('fake-token'),
  poolOverride: { query: vi.fn().mockResolvedValue({ rows: [] }) },
});

describe('evaluateContractNode — PR 已 merge 短路 PASS', () => {
  it('PR 已 merge（checkPrMerged=true）→ verdict=PASS，且不 spawn evaluator', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const checkPrMerged = vi.fn().mockResolvedValue(true);

    const res = await evaluateContractNode(
      baseState(),
      { ...baseOpts(), spawnDetached, checkPrMerged }
    );

    expect(res.evaluate_verdict).toBe('PASS');
    expect(res.evaluate_error).toBeFalsy();
    expect(checkPrMerged).toHaveBeenCalledWith('https://github.com/x/y/pull/123');
    // 关键：短路，不 spawn evaluator（= 不 checkout 已删分支跑 E2E）
    expect(spawnDetached).not.toHaveBeenCalled();
  });

  it('PR 未 merge（checkPrMerged=false）→ 不短路，照常进 evaluate 流程（spawn 被调）', async () => {
    const spawnDetached = vi.fn().mockResolvedValue({ containerId: 'fake' });
    const checkPrMerged = vi.fn().mockResolvedValue(false);

    await evaluateContractNode(
      baseState({ worktreePath: '/tmp/does-not-exist' }),
      { ...baseOpts(), spawnDetached, checkPrMerged }
    ).catch(() => { /* interrupt 抛错 OK，spawn 已被调过 */ });

    expect(checkPrMerged).toHaveBeenCalledOnce();
    expect(spawnDetached).toHaveBeenCalledOnce();
  });

  it('幂等门优先：evaluate_verdict 已存在则直接返回，不查 PR 状态', async () => {
    const checkPrMerged = vi.fn().mockResolvedValue(true);
    const res = await evaluateContractNode(
      baseState({ evaluate_verdict: 'FAIL' }),
      { ...baseOpts(), checkPrMerged }
    );
    expect(res.evaluate_verdict).toBe('FAIL');
    expect(checkPrMerged).not.toHaveBeenCalled();
  });
});
