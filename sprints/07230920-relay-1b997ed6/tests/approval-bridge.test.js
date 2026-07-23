/**
 * approval-bridge.test.js — B-08: human-review approval bridge 认证
 *
 * TDD 骨架：全红状态。
 * 目标函数：validateApproval(request, context) → { valid: boolean, reason?: string }
 * 来源：packages/brain/src/routes/（approval bridge 路由，待实现）
 *       或 packages/brain/src/orchestrator/kernel-handlers.js
 *
 * FR-09 要求：
 * - 批准入口必须认证，校验 task/run、当前 PR SHA、review_request_hop、操作者
 * - 旧 SHA 批准 → 拒绝（reason: stale_sha）
 * - 错误 run 批准 → 拒绝（reason: run_mismatch）
 * - 重复批准 → 拒绝（reason: duplicate_approval）
 * - 无 request effect 的批准 → 拒绝（reason: no_review_request）
 * - 合法批准追加唯一 verdict:human_review，detail 含必要字段
 * - approval bridge 不直接 UPDATE run phase
 */
import { describe, it, expect } from 'vitest';

import { validateApproval } from '../../../packages/brain/src/orchestrator/kernel-handlers.js';

/** 构造合法批准请求 */
function validRequest(overrides = {}) {
  return {
    runId: 'run-001',
    taskId: 'task-001',
    prHeadSha: 'sha-current',
    approvedBy: 'user@example.com',
    approvedAt: '2026-07-23T10:00:00.000Z',
    reviewRequestHop: 30,
    ...overrides,
  };
}

/** 构造批准上下文（模拟 decision log + DB 状态） */
function validContext(overrides = {}) {
  return {
    currentPrHeadSha: 'sha-current',
    runId: 'run-001',
    hasReviewRequestEffect: true,    // decision log 含 effect:human_review_requested
    hasExistingApproval: false,      // verdict:human_review 尚不存在
    reviewRequestHop: 30,
    isAuthenticated: true,
    ...overrides,
  };
}

describe('B-08: 合法批准 → valid=true', () => {
  it('所有条件满足 → valid=true', () => {
    const result = validateApproval(validRequest(), validContext());
    expect(result.valid).toBe(true);
  });
});

describe('B-08: 旧 SHA 批准 → 拒绝', () => {
  it('request.prHeadSha 与 context.currentPrHeadSha 不一致 → invalid（stale_sha）', () => {
    const result = validateApproval(
      validRequest({ prHeadSha: 'sha-old' }),
      validContext({ currentPrHeadSha: 'sha-current' }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/stale_sha/);
  });
});

describe('B-08: 错误 run 批准 → 拒绝', () => {
  it('request.runId 与 context.runId 不一致 → invalid（run_mismatch）', () => {
    const result = validateApproval(
      validRequest({ runId: 'run-wrong' }),
      validContext({ runId: 'run-001' }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/run_mismatch/);
  });
});

describe('B-08: 重复批准 → 拒绝', () => {
  it('verdict:human_review 已存在 → invalid（duplicate_approval）', () => {
    const result = validateApproval(
      validRequest(),
      validContext({ hasExistingApproval: true }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/duplicate_approval/);
  });
});

describe('B-08: 无 review request effect → 拒绝', () => {
  it('decision log 中无 effect:human_review_requested → invalid（no_review_request）', () => {
    const result = validateApproval(
      validRequest(),
      validContext({ hasReviewRequestEffect: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no_review_request/);
  });
});

describe('B-08: 未认证请求 → 拒绝', () => {
  it('context.isAuthenticated=false → invalid（unauthorized）', () => {
    const result = validateApproval(
      validRequest(),
      validContext({ isAuthenticated: false }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unauthorized/);
  });
});

describe('B-08: approval bridge 不直接更新 run phase', () => {
  /**
   * 验证 validateApproval 是纯函数（不产生 DB 副作用）。
   * approval bridge 只验证请求合法性，不 UPDATE runs.phase。
   * 实际写入 verdict:human_review 由 dispatcher 在下一轮根据 derive() 结果执行。
   */
  it('validateApproval 是纯函数（返回验证结果，不执行 DB 写入）', () => {
    // 此测试通过验证函数签名和返回值推断
    const result = validateApproval(validRequest(), validContext());
    // 纯函数只返回 { valid, reason?, verdict? }，不返回 Promise 或副作用对象
    expect(typeof result).toBe('object');
    expect(typeof result.valid).toBe('boolean');
    // 函数同步返回，不是 Promise
    expect(result instanceof Promise).toBe(false);
  });
});

describe('B-08: 合法批准的 verdict detail 字段', () => {
  it('合法批准返回 verdict detail 包含必要字段', () => {
    const result = validateApproval(validRequest(), validContext());
    // 实现后应包含 verdict, pr_head_sha, review_request_hop, approved_by, approved_at
    if (result.valid) {
      expect(result.verdictDetail).toBeDefined();
      expect(result.verdictDetail.verdict).toBe('APPROVED');
      expect(result.verdictDetail.pr_head_sha).toBe('sha-current');
      expect(result.verdictDetail.review_request_hop).toBe(30);
      expect(result.verdictDetail.approved_by).toBe('user@example.com');
    }
  });
});
