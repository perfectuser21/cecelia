/**
 * 冻结合同测试 — Diff Impact Gate freshness reason_code 三分类
 *
 * 被改的边（禁 mock）：diff-gate.js freshness 消费处（约 diff-gate.js:201-207）。
 * 唯一被替身的外层边界：mapClient（= radius.js 的 HTTP 客户端）。radius.js 本 sprint
 * 不改（结论正确，错在消费方），故注入其确定性录制响应是合法的外层 mock；被测的
 * diff-gate 分类逻辑全程真实执行，不 mock。db 传 undefined，走不触库的 freshness 分支。
 */
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const HEAD = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

function mapper(freshness, extra = {}) {
  return async () => ({
    freshness,
    affected_nodes: [],
    required_assertions: [],
    ...extra,
  });
}

describe('diff-gate freshness reason_code 三分类', () => {
  it('impact_anchor_missing 分类为 blocked retryable false 且 detail 带 unclaimed_files', async () => {
    const r = await evaluateDiffGate({
      taskId: 'task-anchor',
      headRevision: HEAD,
      changedFiles: ['DoD.md'],
      mapClient: mapper(
        { status: 'unknown', reason_code: 'impact_anchor_missing' },
        { unclaimed_files: ['DoD.md'] },
      ),
    });
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe('impact_anchor_missing');
    expect(r.retryable).toBe(false);
    expect(r.detail?.unclaimed_files).toEqual(['DoD.md']);
  });

  it('capability_assertion_coverage_missing 分类为 blocked retryable false 且 detail 带 capability_ids', async () => {
    const r = await evaluateDiffGate({
      taskId: 'task-cov',
      headRevision: HEAD,
      changedFiles: ['apps/dashboard/pages/admin.tsx'],
      mapClient: mapper(
        { status: 'unknown', reason_code: 'capability_assertion_coverage_missing' },
        { affected_nodes: [{ capability_id: 'G1' }], required_assertions: [] },
      ),
    });
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe('capability_assertion_coverage_missing');
    expect(r.retryable).toBe(false);
    expect(r.detail?.capability_ids).toEqual(['G1']);
  });

  it('fact_snapshot_stale 保持 impact_unknown mapper_stale retryable true 回归保护', async () => {
    const r = await evaluateDiffGate({
      taskId: 'task-stale',
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapper({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_stale');
    expect(r.retryable).toBe(true);
  });

  it('未知 reason_code fail-closed mapper_contract_invalid retryable false', async () => {
    const r = await evaluateDiffGate({
      taskId: 'task-unknown',
      headRevision: HEAD,
      changedFiles: ['packages/brain/src/x.js'],
      mapClient: mapper({ status: 'unknown', reason_code: 'brand_new_reason_xyz' }),
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_contract_invalid');
    expect(r.retryable).toBe(false);
  });
});
