/**
 * 合同冻结测试 — harness-gates gateReceipt 透传 reason/retryable/detail
 *
 * 本单要求 beforeEvaluate 的 gateReceipt 把确定性 blocked 结果的 detail
 * （unclaimed_files / capability_ids）透传到收据，供 loop.js 落 orchestrator_decision_log
 * 与 derive 路由消费。gateReceipt 原本只透传 reason/retryable，缺 detail。
 *
 * Generator 必须从 harness-gates.js 导出 gateReceipt（`export function gateReceipt`），
 * 使该纯函数收据构造可被单测与 Final E2E 直接复用（真收据构造器，不是复刻）。
 */
import { describe, it, expect } from 'vitest';
import { gateReceipt } from '../../../packages/brain/src/impact-contract/harness-gates.js';

describe('harness-gates gateReceipt 透传 [BEHAVIOR]', () => {
  it('blocked 确定性结果收据含 reason / retryable=false / detail.unclaimed_files', () => {
    const receipt = gateReceipt('diff', {
      gate: 'blocked',
      reason: 'impact_anchor_missing',
      retryable: false,
      detail: { unclaimed_files: ['DoD.md'], capability_ids: [] },
    });
    expect(receipt.stage).toBe('diff');
    expect(receipt.gate).toBe('blocked');
    expect(receipt.reason).toBe('impact_anchor_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail).toEqual({ unclaimed_files: ['DoD.md'], capability_ids: [] });
  });

  it('capability 覆盖缺口收据透传 detail.capability_ids', () => {
    const receipt = gateReceipt('diff', {
      gate: 'blocked',
      reason: 'capability_assertion_coverage_missing',
      retryable: false,
      detail: { unclaimed_files: [], capability_ids: ['G1'] },
    });
    expect(receipt.reason).toBe('capability_assertion_coverage_missing');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail.capability_ids).toEqual(['G1']);
  });

  it('pass 结果无 detail 时收据 detail 为 null（不崩，保持回归形状）', () => {
    const receipt = gateReceipt('diff', { gate: 'pass' });
    expect(receipt.gate).toBe('pass');
    expect(receipt.retryable).toBe(false);
    expect(receipt.detail ?? null).toBeNull();
  });
});
