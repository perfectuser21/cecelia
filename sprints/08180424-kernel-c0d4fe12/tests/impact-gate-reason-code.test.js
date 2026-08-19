/**
 * 复现 + 回归：Diff/Structure Impact Gate 透传 Map 真实 reason_code
 * 并对确定性（status:'unknown'）结论 fail-closed（retryable:false），
 * 对瞬态（status:'stale'）结论保留 retryable:true。
 *
 * runs f62c7e87 / d1360a48 观测到 deny:impact:mapper_stale 无限重试空转。
 * 根因：gate 把所有 freshness.status !== 'fresh' 折叠成通用 'mapper_stale' + retryable:true。
 *
 * 覆盖父路：独立小路（无父路）——本 sprint 是 impact-contract gate 裁决分流的纯逻辑修复。
 *
 * 禁 mock 边：gate 内 freshness 分支裁决逻辑（被改的边）真跑，不 stub；
 * 仅注入 mapClient（freshness 来源，radius.js 本次不改）与 harness 出口的外层边界。
 */
import { describe, test, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const SHA = 'a'.repeat(40);
const freshnessClient = (freshness) => async () => ({ freshness });
const BASE_TASK = { id: 'task-x', change_kind: 'code_change' };
const BASE_CONTRACT = {
  task_id: 'task-x',
  change_kind: 'code_change',
  repo: 'cecelia',
  base_revision: SHA,
  affected_capabilities: [],
  required_assertions: [],
  contract_body: { affected_capabilities: [], required_assertions: [] },
};

describe('Diff Gate reason_code 透传 + status 分流', () => {
  test('确定性 unknown 结论 fail-closed 且透传 reason_code（非 mapper_stale）', async () => {
    const result = await evaluateDiffGate({
      taskId: 'task-x',
      mapClient: freshnessClient({ status: 'unknown', reason_code: 'capability_not_in_active_projection' }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(false);
    expect(result.reason).toBe('capability_not_in_active_projection');
    expect(result.reason).not.toBe('mapper_stale');
  });

  test('瞬态 stale 结论仍可重试且透传具体 reason_code', async () => {
    const result = await evaluateDiffGate({
      taskId: 'task-x',
      mapClient: freshnessClient({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
    });
    expect(result.retryable).toBe(true);
    expect(result.reason).toBe('fact_snapshot_stale');
    expect(result.reason).not.toBe('mapper_stale');
  });

  test('freshness 缺失/为 null 视为不可判定 → fail-closed 非重试（不掩盖真因）', async () => {
    const result = await evaluateDiffGate({
      taskId: 'task-x',
      mapClient: async () => ({ freshness: null }),
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.retryable).toBe(false);
    expect(result.reason).not.toBe('mapper_stale');
  });
});

describe('Structure Gate reason_code 透传 + status 分流', () => {
  test('确定性 unknown 结论 fail-closed（retryable:false）且透传 reason_code', async () => {
    const result = await evaluateStructureGate({
      db: null, task: BASE_TASK, contract: BASE_CONTRACT,
      mapClient: freshnessClient({ status: 'unknown', reason_code: 'impact_anchor_missing' }),
    });
    expect(result.gate).toBe('blocked');
    expect(result.retryable).toBe(false);
    expect(result.reason).toBe('impact_anchor_missing');
    expect(result.reason).not.toBe('mapper_stale');
  });

  test('瞬态 stale 结论 blocked 但 retryable:true 且透传 reason_code', async () => {
    const result = await evaluateStructureGate({
      db: null, task: BASE_TASK, contract: BASE_CONTRACT,
      mapClient: freshnessClient({ status: 'stale', reason_code: 'projection_revision_mismatch' }),
    });
    expect(result.gate).toBe('blocked');
    expect(result.retryable).toBe(true);
    expect(result.reason).toBe('projection_revision_mismatch');
    expect(result.reason).not.toBe('mapper_stale');
  });

  test('status 非 fresh 但缺 reason_code → 透传 status 派生值，禁止回退 mapper_stale', async () => {
    const result = await evaluateStructureGate({
      db: null, task: BASE_TASK, contract: BASE_CONTRACT,
      mapClient: freshnessClient({ status: 'unknown' }),
    });
    expect(result.gate).toBe('blocked');
    expect(result.retryable).toBe(false);
    expect(result.reason).not.toBe('mapper_stale');
  });
});

describe('出口贯通：harness-gates receipt 携带真实 reason_code 且 retryable 传播', () => {
  test('确定性 unknown 经真实 diff-gate 抵达 receipt，reason 具体化且 retryable:false', async () => {
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: async () => ({
        id: 'c1', repo: 'cecelia', base_revision: SHA, contract_hash: 'h1',
        contract_body: { required_assertions: [] },
      }),
      readChangedFiles: async () => ['packages/brain/src/impact-contract/diff-gate.js'],
      diffGate: (args) => evaluateDiffGate({
        ...args, db: undefined,
        mapClient: freshnessClient({ status: 'unknown', reason_code: 'unsafe_assertion_ref' }),
      }),
    });
    const receipt = await gates.beforeEvaluate({
      task: { id: 'task-x', payload: {} },
      pr: { head_sha: SHA },
      run: { impact_contract_policy: 'required' },
    });
    expect(receipt.stage).toBe('diff');
    expect(receipt.reason).toBe('unsafe_assertion_ref');
    expect(receipt.retryable).toBe(false);
    expect(receipt.reason).not.toBe('mapper_stale');
  });
});
