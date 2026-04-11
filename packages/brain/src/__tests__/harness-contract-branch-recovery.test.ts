/**
 * harness-contract-branch-recovery.test.ts
 *
 * 测试 contract_branch=null 时的自动 fallback 逻辑
 * 对应修复：packages/brain/src/routes/execution.js P0 guard + recovery
 */

import { describe, it, expect, vi } from 'vitest';

// ---- 工具函数：从 execution.js 提取的 fallback 逻辑（纯函数便于单元测试）----

/**
 * 从 task_id 获取短 ID（前 8 位 hex）
 */
function getTaskIdShort(taskId: string): string {
  return taskId.split('-')[0];
}

/**
 * 构造 fallback 分支名
 */
function buildFallbackBranchName(taskIdShort: string): string {
  return `cp-harness-review-approved-${taskIdShort}`;
}

/**
 * 从 git ls-remote 输出中判断分支是否存在
 */
function branchExistsInLsRemoteOutput(output: string, branchName: string): boolean {
  return output.includes(branchName);
}

/**
 * 模拟 execution.js 中的 contractBranch fallback 解析逻辑
 * （隔离 execSync 调用，用 lsRemoteFn 注入）
 */
function resolveContractBranch(
  contractBranch: string | null | undefined,
  taskId: string,
  lsRemoteFn: (branchName: string) => string
): string | null {
  if (contractBranch) return contractBranch;

  const taskIdShort = getTaskIdShort(taskId);
  const fallbackBranchName = buildFallbackBranchName(taskIdShort);

  try {
    const output = lsRemoteFn(fallbackBranchName);
    if (branchExistsInLsRemoteOutput(output, fallbackBranchName)) {
      return fallbackBranchName;
    }
  } catch {
    // git ls-remote 失败，继续终止流程
  }

  return null;
}

// ---- 测试用例 ----

describe('harness contract_branch=null 自动恢复', () => {
  const TASK_ID = '1d4bc7f7-abcd-4321-efef-123456789abc';
  const TASK_ID_SHORT = '1d4bc7f7';
  const FALLBACK_BRANCH = `cp-harness-review-approved-${TASK_ID_SHORT}`;

  it('contractBranch 有值时直接返回，不触发 fallback', () => {
    const lsRemoteFn = vi.fn(() => '');
    const result = resolveContractBranch('cp-some-branch', TASK_ID, lsRemoteFn);
    expect(result).toBe('cp-some-branch');
    expect(lsRemoteFn).not.toHaveBeenCalled();
  });

  it('contractBranch=null 且 git ls-remote 找到 fallback 分支 → 返回 fallback 分支名', () => {
    const lsRemoteFn = vi.fn((_branchName: string) =>
      `abc123def456\trefs/heads/${FALLBACK_BRANCH}\n`
    );
    const result = resolveContractBranch(null, TASK_ID, lsRemoteFn);
    expect(result).toBe(FALLBACK_BRANCH);
    expect(lsRemoteFn).toHaveBeenCalledWith(FALLBACK_BRANCH);
  });

  it('contractBranch=null 且 git ls-remote 输出为空 → 返回 null（触发终止）', () => {
    const lsRemoteFn = vi.fn((_branchName: string) => '');
    const result = resolveContractBranch(null, TASK_ID, lsRemoteFn);
    expect(result).toBeNull();
  });

  it('contractBranch=null 且 git ls-remote 抛出异常 → 返回 null（触发终止）', () => {
    const lsRemoteFn = vi.fn((_branchName: string) => {
      throw new Error('git ls-remote 连接超时');
    });
    const result = resolveContractBranch(null, TASK_ID, lsRemoteFn);
    expect(result).toBeNull();
  });

  it('task_id.split("-")[0] 正确提取前 8 位 hex', () => {
    expect(getTaskIdShort('1d4bc7f7-abcd-4321-efef-123456789abc')).toBe('1d4bc7f7');
    expect(getTaskIdShort('a1b2c3d4-0000-0000-0000-000000000000')).toBe('a1b2c3d4');
  });

  it('buildFallbackBranchName 构造正确的分支名格式', () => {
    expect(buildFallbackBranchName('1d4bc7f7')).toBe('cp-harness-review-approved-1d4bc7f7');
  });

  it('branchExistsInLsRemoteOutput 正确判断分支存在', () => {
    const output = `abc123\trefs/heads/cp-harness-review-approved-1d4bc7f7\n`;
    expect(branchExistsInLsRemoteOutput(output, 'cp-harness-review-approved-1d4bc7f7')).toBe(true);
    expect(branchExistsInLsRemoteOutput('', 'cp-harness-review-approved-1d4bc7f7')).toBe(false);
    expect(branchExistsInLsRemoteOutput(output, 'cp-harness-review-approved-99999999')).toBe(false);
  });
});
