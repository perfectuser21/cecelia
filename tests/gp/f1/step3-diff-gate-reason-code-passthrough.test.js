// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Diff Impact Gate 3a 消费 Mapper freshness.reason_code
//                                             ↔ gateReceipt 透传给 kernel deny 标签
//
// 2026-08-21 生产实证（runs f62c7e87 / d1360a48）：diff-gate.js 步骤 3a 把所有非 fresh 结论
//   一律折叠成硬编码 `reason:'mapper_stale'+retryable:true`，丢弃 Mapper 给出的确定性
//   `freshness.reason_code`。gateReceipt 只看到裸 mapper_stale，一个「结构性/revision 不一致、
//   重试永不转 fresh」的确定性结论被当成可重试瞬时态 → kernel 反复重跑同一 gate → task 空转不落地。
//   修复：3a 透传真实 reason_code，依瞬时白名单判 retryable（确定性 fail-closed retryable:false，
//   瞬时/缺失保留 retryable:true）；gateReceipt 结构化透传 reason_code / retryable。
//
// 按产物闸规矩写在边上：真 evaluateDiffGate + 真 gateReceipt（不 vi.mock 被改模块），
// 只注入外层依赖（DB 合同加载桩 + Mapper HTTP 边界桩）。
import { describe, expect, it, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { gateReceipt } from '../../../packages/brain/src/impact-contract/harness-gates.js';

// 合同加载桩（外层依赖，非本单改动边）：返回一个 active impact contract。
function makeContractDb() {
  return {
    query: vi.fn(async () => ({
      rows: [{
        id: 'contract-1',
        repo: 'cecelia',
        change_kind: 'bugfix',
        base_revision: 'base',
        manifest_digest: null,
        projection_digest: null,
        contract_body: {
          affected_capabilities: [{ capability_id: 'impact-contract' }],
          required_assertions: [],
        },
      }],
    })),
  };
}

// Mapper 桩（外层 HTTP 边界，非本单改动边）：仅注入 freshness。
function runGate(freshness) {
  return evaluateDiffGate({
    db: makeContractDb(),
    taskId: 'gp-step3-reason-code',
    repo: 'cecelia',
    headRevision: 'head',
    mapClient: async () => ({ freshness }),
  });
}

describe('F1 step3 · Diff Impact Gate 3a reason_code 透传与 fail-closed 出口（守卫在真实的边上）', () => {
  it('确定性结论透传真码且 fail-closed：kernel deny 标签不再裸 mapper_stale、retryable=false 供落终态', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('projection_revision_mismatch');
    expect(result.reason).toBe('projection_revision_mismatch'); // 不再裸 mapper_stale
    expect(result.retryable).toBe(false);

    const receipt = gateReceipt('diff', result);
    expect(receipt.reason).toBe('projection_revision_mismatch');
    expect(receipt.reason_code).toBe('projection_revision_mismatch');
    expect(receipt.retryable).toBe(false);
    // kernel `deny:impact:${receipt.reason}` 展示真码，确定性空转被终结
    expect(`deny:impact:${receipt.reason ?? 'unknown'}`).toBe('deny:impact:projection_revision_mismatch');
  });

  it('瞬时 staleness 保留 retryable=true（可刷新 staleness 不被 fail-closed 卡死）', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    expect(result.reason_code).toBe('fact_snapshot_stale');
    expect(result.retryable).toBe(true);
    expect(gateReceipt('diff', result).retryable).toBe(true);
  });

  it('reason_code 缺失退回旧瞬时语义 retryable=true、reason 回退 mapper_stale', async () => {
    const result = await runGate({ status: 'stale' });
    expect(result.reason_code ?? null).toBeNull();
    expect(result.retryable).toBe(true);
    expect(result.reason).toBe('mapper_stale');
  });

  it('未知非 null reason_code 默认按确定性 fail-closed retryable=false（失败不降级）', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'some_unregistered_reason_code' });
    expect(result.reason_code).toBe('some_unregistered_reason_code');
    expect(result.retryable).toBe(false);
    expect(gateReceipt('diff', result).retryable).toBe(false);
  });
});
