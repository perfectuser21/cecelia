// Sprint 08180424-kernel-c0d4fe12 — Diff Impact Gate 步骤 3a reason_code 透传 + fail-closed 出口
// TDD Red 证据：当前 diff-gate.js 3a 分支把所有非 fresh 折叠成 mapper_stale/retryable:true，
// 丢弃 freshness.reason_code 且把确定性 unknown 结论误标为可无限重试。
// 本测试直接调用真实 evaluateDiffGate（不 mock 被改的那条边），db=null 即可到达 3a 分支。
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// 注入受控 mapClient 复现 Mapper 复算结果；freshness 由入参决定。
// mapClient 是合法可注入的外层边界（Mapper HTTP，radius.js 不在本 sprint 范围）；
// 被改的边（freshness → reason/retryable 派生）由真实 evaluateDiffGate 执行，不被替身。
const mapClientReturning = (freshness) => async () => ({
  freshness,
  affected_nodes: [],
  required_assertions: [],
  fact_revisions: {},
});

describe('Diff Impact Gate 3a — reason_code 透传 + 按 status fail-closed [BEHAVIOR]', () => {
  it('unknown 确定性结论透传 reason_code 且非重试终止', async () => {
    const r = await evaluateDiffGate({
      db: null,
      taskId: 'task-unknown',
      mapClient: mapClientReturning({ status: 'unknown', reason_code: 'impact_anchor_missing' }),
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('impact_anchor_missing');
    expect(r.reason_code).toBe('impact_anchor_missing');
    expect(r.retryable).toBe(false);
  });

  it('stale 瞬时滞后透传 reason_code 且保持可重试', async () => {
    const r = await evaluateDiffGate({
      db: null,
      taskId: 'task-stale',
      mapClient: mapClientReturning({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('fact_snapshot_stale');
    expect(r.reason_code).toBe('fact_snapshot_stale');
    expect(r.retryable).toBe(true);
  });

  it('freshness 缺失时保守 fail-closed 兜底 mapper_stale 且非重试', async () => {
    const r = await evaluateDiffGate({
      db: null,
      taskId: 'task-missing',
      mapClient: mapClientReturning(undefined),
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_stale');
    expect(r.retryable).toBe(false);
  });

  it('reason_code 为 null 时保守 fail-closed 兜底 mapper_stale 且非重试', async () => {
    const r = await evaluateDiffGate({
      db: null,
      taskId: 'task-null-code',
      mapClient: mapClientReturning({ status: 'unknown', reason_code: null }),
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe('mapper_stale');
    expect(r.retryable).toBe(false);
  });
});
