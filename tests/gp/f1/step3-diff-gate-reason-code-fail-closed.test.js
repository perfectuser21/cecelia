// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Diff Impact Gate 裁决 ↔ gateReceipt deny 归因
//
// 2026-08-21 生产实证（run f44bdef7，r42）：evaluateDiffGate 步骤 3a 把 Mapper 任意非 fresh
// freshness 一律折叠成裸 `mapper_stale` + `retryable:true`，确定性结论（no_anchor/
// revision_mismatch/resolver_error）被当瞬时无限重试 → merge fence 前的 Diff Impact Gate 空转
// 到耗尽。结构根因：确定性不可判定与瞬时不可判定共用一个出口，归因信息（reason_code）被丢弃。
//
// 修法：3a 出口透传 freshness.reason_code；瞬时白名单（fact_snapshot_stale/
// projection_revision_missing）与 null 保留 retryable=true，其余确定性码 fail-closed
// （retryable=false）；gateReceipt 透传 reason_code 让 deny 标签归因到具体码。3a 仍返回
// impact_unknown 不假绿（fail-closed 铁律强化不破）。
//
// 按产物闸规矩写在边上：真 import 被改的两个流水线模块 diff-gate.js 与 harness-gates.js
// （不 mock 它们），仅注入外层边界（db/mapClient/diffGate）驱动真实裁决路径。
import { describe, it, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { createHarnessImpactGates } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE_REV = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

// 外层边界：受控 db（Postgres 边界）返回 active contract。
function makeDb() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-1',
        repo: 'cecelia',
        base_revision: BASE_REV,
        contract_body: { affected_capabilities: [], required_assertions: [] },
      }],
    })),
  };
}

// 外层边界：Mapper HTTP（mapClient）返回受控 freshness shape 驱动真实 3a 分支。
function makeMapper(freshness) {
  return async () => {
    const res = { affected_nodes: [], required_assertions: [] };
    if (freshness !== undefined) res.freshness = freshness;
    return res;
  };
}

describe('F1 step3 造完真验 — Diff Impact Gate 确定性码 fail-closed 归因', () => {
  it('确定性码走 fail-closed 出口：透传 reason_code 且 retryable=false（不再无限重试空转）', async () => {
    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: TASK_ID,
      mapClient: makeMapper({ status: 'stale', reason_code: 'no_anchor' }),
      headRevision: HEAD_SHA,
      repo: 'cecelia',
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    // 仍 fail-closed 返回 impact_unknown（不假绿）
    expect(result.gate).toBe('impact_unknown');
    // 归因不再被丢弃成裸 mapper_stale
    expect(result.reason_code).toBe('no_anchor');
    expect(result.reason).toBe('no_anchor');
    // 确定性码停机
    expect(result.retryable).toBe(false);
  });

  it('瞬时白名单码保留 retryable=true（等待瞬时状态恢复）', async () => {
    const result = await evaluateDiffGate({
      db: makeDb(),
      taskId: TASK_ID,
      mapClient: makeMapper({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
      headRevision: HEAD_SHA,
      repo: 'cecelia',
      changedFiles: ['packages/brain/src/impact-contract/diff-gate.js'],
    });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('fact_snapshot_stale');
    expect(result.retryable).toBe(true);
  });

  it('gateReceipt deny 标签归因到具体 reason_code，不再裸 mapper_stale（守卫落在 receipt 边上）', async () => {
    const active = { id: 'contract-1', repo: 'cecelia', base_revision: BASE_REV, contract_hash: 'c'.repeat(64) };
    const diffGate = vi.fn().mockResolvedValue({
      gate: 'impact_unknown', reason_code: 'no_anchor', retryable: false, contract: active,
    });
    const gates = createHarnessImpactGates({
      db: {},
      getActiveContract: vi.fn().mockResolvedValue(active),
      diffGate,
      readChangedFiles: vi.fn().mockResolvedValue(['packages/brain/src/impact-contract/diff-gate.js']),
    });

    const receipt = await gates.beforeEvaluate({ task: { id: TASK_ID, payload: {} }, pr: { head_sha: HEAD_SHA } });

    expect(receipt.stage).toBe('diff');
    expect(receipt.gate).toBe('impact_unknown');
    expect(receipt.reason_code).toBe('no_anchor');
    expect(receipt.reason).toBe('no_anchor');
    expect(receipt.reason).not.toBe('mapper_stale');
  });
});
