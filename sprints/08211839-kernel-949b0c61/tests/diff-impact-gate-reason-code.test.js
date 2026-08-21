/**
 * 冻结回归测试 — Diff Impact Gate 透传 reason_code + fail-closed 出口（r39）
 *
 * 复现 runs f62c7e87 / d1360a48 的 `deny:impact:mapper_stale` 空转：
 * 当 Mapper 给出确定性 freshness reason_code（如 impact_anchor_missing）时，
 * 旧 Gate 把它折叠成 { reason:'mapper_stale', retryable:true }，丢弃真实 reason_code，
 * 导致确定性结论被当成瞬态可重试 → 无限重试空转。
 *
 * 本 sprint 修复后：
 *   - 确定性 reason_code → 透传 reason/reason_code + retryable:false（fail-closed 终止）
 *   - 瞬态 reason_code（快照/投影追赶类）→ 透传 reason_code + retryable:true（仍可重试）
 *   - reason_code 缺失/null 且 status≠fresh → 保守回退 mapper_stale + retryable:true
 *
 * 策略：直接调用真实 evaluateDiffGate / evaluateStructureGate（被改的边不 mock），
 *       仅注入 mapClient 作为 Mapper 边界 fixture（radius.js 产出逻辑本 sprint 明确不在范围）。
 *
 * sprint: 08211839-kernel-949b0c61
 */

import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

// 确定性结论（锚点/覆盖/引用类 → fail-closed，retryable:false）
const DETERMINISTIC = [
  'impact_anchor_missing',
  'capability_not_in_active_projection',
  'unsafe_assertion_ref',
  'assertion_identity_ambiguous',
  'capability_assertion_coverage_missing',
];

// 瞬态结论（快照/投影追赶类 → retryable:true）
const TRANSIENT = [
  'fact_snapshot_stale',
  'projection_revision_missing',
  'projection_revision_mismatch',
  'manifest_projection_mismatch',
  'graph_projection_revision_mismatch',
];

function diffMapClient(freshness) {
  return async () => ({
    freshness,
    affected_nodes: [],
    required_assertions: [],
  });
}

function structContract() {
  return {
    task_id: 't',
    change_kind: 'bugfix',
    repo: 'cecelia',
    base_revision: 'abc',
    affected_capabilities: [{ capability_id: 'c1' }],
    required_assertions: [],
    contract_body: {
      affected_capabilities: [{ capability_id: 'c1' }],
      required_assertions: [],
    },
  };
}

function structMapClient(freshness) {
  return async () => ({
    fact_revisions: { cecelia: 'abc' },
    freshness,
    affected_nodes: [],
    required_assertions: [],
  });
}

describe('Diff Impact Gate — 确定性 reason_code 透传 + fail-closed [BEHAVIOR]', () => {
  test.each(DETERMINISTIC)('确定性结论 %s 透传 reason_code 且 retryable:false（不再折叠 mapper_stale）', async (code) => {
    const r = await evaluateDiffGate({
      db: null,
      taskId: 't',
      mapClient: diffMapClient({ status: 'unknown', reason_code: code }),
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe(code);
    expect(r.reason_code).toBe(code);
    expect(r.retryable).toBe(false);
  });

  test.each(TRANSIENT)('瞬态结论 %s 透传 reason_code 且保持 retryable:true', async (code) => {
    const r = await evaluateDiffGate({
      db: null,
      taskId: 't',
      mapClient: diffMapClient({ status: 'stale', reason_code: code }),
    });
    expect(r.gate).toBe('impact_unknown');
    expect(r.reason).toBe(code);
    expect(r.reason_code).toBe(code);
    expect(r.retryable).toBe(true);
  });

  test('reason_code 缺失/null 且 status≠fresh → 保守回退 mapper_stale + retryable:true（不假绿）', async () => {
    const r = await evaluateDiffGate({
      db: null,
      taskId: 't',
      mapClient: diffMapClient({ status: 'stale', reason_code: null }),
    });
    expect(r.reason).toBe('mapper_stale');
    expect(r.retryable).toBe(true);
  });

  test('同一确定性结论重复进 Gate → 判定稳定不震荡（幂等）', async () => {
    const client = diffMapClient({ status: 'unknown', reason_code: 'impact_anchor_missing' });
    const first = await evaluateDiffGate({ db: null, taskId: 't', mapClient: client });
    const second = await evaluateDiffGate({ db: null, taskId: 't', mapClient: client });
    expect(second.reason).toBe(first.reason);
    expect(second.reason_code).toBe(first.reason_code);
    expect(second.retryable).toBe(first.retryable);
    expect(first.retryable).toBe(false);
  });
});

describe('Structure Gate — 同款折叠缺陷修复 [BEHAVIOR]', () => {
  test.each(DETERMINISTIC)('确定性结论 %s 透传 reason_code 且 retryable:false', async (code) => {
    const r = await evaluateStructureGate({
      db: null,
      task: { id: 't', change_kind: 'bugfix' },
      contract: structContract(),
      mapClient: structMapClient({ status: 'unknown', reason_code: code }),
    });
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe(code);
    expect(r.reason_code).toBe(code);
    expect(r.retryable).toBe(false);
  });

  test('瞬态结论 fact_snapshot_stale 透传 + retryable:true', async () => {
    const r = await evaluateStructureGate({
      db: null,
      task: { id: 't', change_kind: 'bugfix' },
      contract: structContract(),
      mapClient: structMapClient({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
    });
    expect(r.gate).toBe('blocked');
    expect(r.reason).toBe('fact_snapshot_stale');
    expect(r.retryable).toBe(true);
  });

  test('reason_code 缺失/null 且 status≠fresh → 保守回退 mapper_stale + retryable:true', async () => {
    const r = await evaluateStructureGate({
      db: null,
      task: { id: 't', change_kind: 'bugfix' },
      contract: structContract(),
      mapClient: structMapClient({ status: 'stale', reason_code: null }),
    });
    expect(r.reason).toBe('mapper_stale');
    expect(r.retryable).toBe(true);
  });
});
