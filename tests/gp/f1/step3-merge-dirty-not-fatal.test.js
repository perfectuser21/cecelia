// GP 锚：factory/F1 造完真验 — step3（merge 权威的终点安全）
// 回归：r40（run 08b3b2b5 hop 217/218）merge_pr 撞真冲突 PR 被 kernel_process_fatal
// 判 run 终态。根因：GitHub mergeStateStatus 的冲突枚举值是 'DIRTY'，
// kernel-handlers 判的是 'CONFLICTING'（那是 `mergeable` 字段的枚举）→ DIRTY 漏网
// 直接执行 `gh pr merge` → "not mergeable" throw → process fatal 烧掉整条 run。
// 修法：DIRTY 并入冲突分支返回 BLOCKED；gh merge 命令失败降级 BLOCKED 不 fatal
// （merge 失败是可观测可重试的外部状态，不是进程性 fatal）。
import { describe, it, expect, vi } from 'vitest';
import { createKernelHandlers } from '../../../packages/brain/src/orchestrator/kernel-handlers.js';

const runId = '08b3b2b5-ac29-4ae1-9693-d2345135631d';
const taskId = 'df8f8d37-ad4b-47ab-8037-d240773bc074';

function context(prOverrides = {}) {
  return {
    runId,
    taskId,
    observed: {
      run: { id: runId, initiative_id: taskId },
      pr: {
        url: 'https://github.com/perfectuser21/cecelia/pull/5001',
        state: 'OPEN',
        head_sha: '040d6e40bef3415cb7e6fd15ae250f003f5c8d2a',
        mergeStateStatus: 'CLEAN',
        merged: false,
        ...prOverrides,
      },
      reviewApproved: true,
      evaluateVerdict: { verdict: 'PASS' },
      decisionLog: [],
    },
  };
}

function deps(overrides = {}) {
  return {
    pool: { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) },
    execCmd: vi.fn(() => ''),
    ...overrides,
  };
}

describe('merge_pr 冲突/失败不判 run 终态（F1 step3 r40 案卷回归）', () => {
  it('mergeStateStatus=DIRTY（GitHub 真冲突枚举）→ BLOCKED，不执行 gh merge', async () => {
    const d = deps();
    const result = await createKernelHandlers(d).merge_pr(context({ mergeStateStatus: 'DIRTY' }));
    expect(result.status).toBe('BLOCKED');
    expect(result.detail).toMatch(/conflict/i);
    expect(d.execCmd).not.toHaveBeenCalled();
  });

  it('mergeStateStatus=CONFLICTING（兼容 mergeable 枚举混入观测）仍 BLOCKED', async () => {
    const d = deps();
    const result = await createKernelHandlers(d).merge_pr(
      context({ mergeStateStatus: 'CONFLICTING' }),
    );
    expect(result.status).toBe('BLOCKED');
    expect(d.execCmd).not.toHaveBeenCalled();
  });

  it('gh pr merge 命令失败（not mergeable 竞态）→ BLOCKED 降级，不 throw 成 process fatal', async () => {
    const d = deps({
      execCmd: vi.fn(() => {
        throw new Error(
          "Command failed: gh pr merge 'https://github.com/perfectuser21/cecelia/pull/5001' "
          + '--squash --delete-branch X Pull request #5001 is not mergeable',
        );
      }),
    });
    const result = await createKernelHandlers(d).merge_pr(context());
    expect(result.status).toBe('BLOCKED');
    expect(result.detail).toMatch(/merge command failed/i);
  });

  it('CLEAN 主路径不回归：仍执行 gh merge 并 DONE', async () => {
    const d = deps();
    const result = await createKernelHandlers(d).merge_pr(context());
    expect(result.status).toBe('DONE');
    expect(d.execCmd).toHaveBeenCalledTimes(1);
    expect(String(d.execCmd.mock.calls[0][0])).toContain('gh pr merge');
  });
});
