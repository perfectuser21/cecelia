/**
 * 冻结回归测试（Sprint 08212023-kernel-df8f8d37）— Diff Impact Gate 步骤 3a
 * 透传 freshness.reason_code + 依确定性判 retryable，终结 deny:impact:mapper_stale 空转。
 *
 * 禁 mock 边（本单改动边）：evaluateDiffGate 内部 freshness.reason_code → {reason_code, retryable}
 * 的判定必须由真实 evaluateDiffGate 执行，不得 stub 该函数或其 3a 分支。
 * 允许注入的仅为外层依赖：DB 读取（合同加载，本单未改）与 Mapper HTTP 边界（单元层既有惯例）。
 *
 * 该测试在 diff-gate.js 修复前必红：
 *   - 现 3a 分支只返回 {reason:'mapper_stale', retryable:true}，无 reason_code 字段；
 *   - harness-gates.js 未导出 gateReceipt、未透传 reason_code 字段。
 */

import { describe, it, expect, vi } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { gateReceipt } from '../../../packages/brain/src/impact-contract/harness-gates.js';

// 合同加载桩：返回一个 active impact contract（本单未改合同加载路径，属外层依赖）。
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

// Mapper 桩：仅注入 freshness（外层 HTTP 边界；本单不改 Mapper）。
function mapperWithFreshness(freshness) {
  return async () => ({ freshness });
}

async function runGate(freshness) {
  return evaluateDiffGate({
    db: makeContractDb(),
    taskId: 'task-reason-code',
    repo: 'cecelia',
    headRevision: 'head',
    mapClient: mapperWithFreshness(freshness),
  });
}

describe('Diff Impact Gate 3a — reason_code 透传与 fail-closed', () => {
  it('确定性结论（projection_revision_mismatch, status=stale）→ 透传 reason_code 且 retryable:false', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('projection_revision_mismatch');
    expect(result.reason).toBe('projection_revision_mismatch'); // 不再裸 mapper_stale
    expect(result.retryable).toBe(false);
  });

  it('确定性结论以 reason_code 为准，不看 status 字面（capability_not_in_active_projection, status=unknown → retryable:false）', async () => {
    const result = await runGate({ status: 'unknown', reason_code: 'capability_not_in_active_projection' });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('capability_not_in_active_projection');
    expect(result.retryable).toBe(false);
  });

  it('瞬时 staleness（fact_snapshot_stale）→ 保留 retryable:true 且透传真实 reason_code', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    expect(result.gate).toBe('impact_unknown');
    expect(result.reason_code).toBe('fact_snapshot_stale');
    expect(result.retryable).toBe(true);
  });

  it('瞬时 staleness（projection_revision_missing）→ 保留 retryable:true', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'projection_revision_missing' });
    expect(result.retryable).toBe(true);
    expect(result.reason_code).toBe('projection_revision_missing');
  });

  it('reason_code 缺失/为 null → 退回瞬时语义 retryable:true，reason 回退 mapper_stale', async () => {
    const missing = await runGate({ status: 'stale' });
    expect(missing.retryable).toBe(true);
    expect(missing.reason_code ?? null).toBe(null);
    expect(missing.reason).toBe('mapper_stale');

    const explicitNull = await runGate({ status: 'stale', reason_code: null });
    expect(explicitNull.retryable).toBe(true);
    expect(explicitNull.reason_code ?? null).toBe(null);
  });

  it('gateReceipt 透传 reason_code：receipt.reason 展示真实 Map 码，receipt.reason_code 结构化可读，retryable 随之', async () => {
    const result = await runGate({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    const receipt = gateReceipt('diff', result);
    expect(receipt.reason).toBe('projection_revision_mismatch');
    expect(receipt.reason_code).toBe('projection_revision_mismatch');
    expect(receipt.retryable).toBe(false);
    // kernel deny 标签不再裸 mapper_stale（loop.js: deny:impact:${receipt.reason}）
    expect(`deny:impact:${receipt.reason ?? 'unknown'}`).toBe('deny:impact:projection_revision_mismatch');
  });
});
