/**
 * Sprint red 回归 — Diff Impact Gate 步骤 3a：透传 reason_code + 按 freshness.status 分流 retryable。
 *
 * Golden Path 溯源：覆盖 sprint PRD Golden Path 第 1-3 步（Mapper 返回 status!==fresh →
 * 按 status 分流 → 终局/可重试 deny）。
 *
 * 禁 mock 边：被改的边是 diff-gate 内部「freshness → receipt」映射逻辑，本测试真实执行
 * evaluateDiffGate（不 mock 被测函数）。仅注入越界外部 Mapper 边界（mapClient，本 sprint 明确不改）
 * 与 db=null——步骤 3a 在任何 DB 写入前提前返回，故无需真实 Postgres，也不触达任何 DB 写路径。
 */

import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

// 用注入的 mapClient 构造一个 status!=='fresh' 的 Mapper 结果，db=null 直达步骤 3a。
function runGate(freshness) {
  return evaluateDiffGate({
    db: null,
    taskId: 'task-diffgate-3a',
    repo: 'cecelia',
    headRevision: 'head',
    changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    mapClient: async () => ({ freshness }),
  });
}

describe('Diff Impact Gate 步骤 3a — reason_code 透传 + fail-closed 分流 [BEHAVIOR]', () => {
  it('unknown 结构性确定结论产出终局 deny：retryable=false 且 reason 透传真实 reason_code', async () => {
    for (const code of [
      'capability_not_in_active_projection',
      'impact_anchor_missing',
      'unsafe_assertion_ref',
      'assertion_identity_ambiguous',
      'capability_assertion_coverage_missing',
    ]) {
      const r = await runGate({ status: 'unknown', reason_code: code });
      expect(r.gate).toBe('impact_unknown');
      expect(r.reason).toBe(code);      // 真实 reason_code 原样透传，不再折叠成常量
      expect(r.retryable).toBe(false);  // 结构性确定结论 → fail-closed 终局，dispatcher 不再空转
    }
  });

  it('stale 事实快照滞后仍可重试：retryable=true 且 reason 透传真实 reason_code', async () => {
    for (const code of ['fact_snapshot_stale', 'projection_revision_behind']) {
      const r = await runGate({ status: 'stale', reason_code: code });
      expect(r.gate).toBe('impact_unknown');
      expect(r.reason).toBe(code);     // 透传真实 code，不回退
      expect(r.retryable).toBe(true);  // 可自愈滞后 → 保留重试，行为不回退
    }
  });

  it('reason_code 缺失时回退 mapper_stale：retryable 仍按 status 判定（unknown→false）', async () => {
    // unknown + 缺 reason_code → 保底 reason=mapper_stale，但仍 fail-closed
    for (const missing of [{ status: 'unknown' }, { status: 'unknown', reason_code: null }]) {
      const r = await runGate(missing);
      expect(r.reason).toBe('mapper_stale');
      expect(r.retryable).toBe(false);
    }
    // stale + 缺 reason_code → 保底 reason=mapper_stale，retryable 按 status=stale → true
    const s = await runGate({ status: 'stale' });
    expect(s.reason).toBe('mapper_stale');
    expect(s.retryable).toBe(true);
    // freshness 对象整体缺失 → 最不可判定，reason=mapper_stale 且 fail-closed（不假绿）
    const none = await evaluateDiffGate({
      db: null, taskId: 't', repo: 'cecelia', headRevision: 'h',
      mapClient: async () => ({ affected_nodes: [], required_assertions: [] }),
    });
    expect(none.reason).toBe('mapper_stale');
    expect(none.retryable).toBe(false);
  });

  it('非 fresh 分流恒保持 gate=impact_unknown（透传只改 reason/retryable，不改 gate）', async () => {
    const u = await runGate({ status: 'unknown', reason_code: 'impact_anchor_missing' });
    const s = await runGate({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    expect(u.gate).toBe('impact_unknown');
    expect(s.gate).toBe('impact_unknown');
  });
});
