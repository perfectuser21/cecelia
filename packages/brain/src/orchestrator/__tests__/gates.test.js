/**
 * gates.js 纯函数测试：mergeGate 全分支 + 各上限判断。
 * 对齐：spec §测试策略 §2 + routing-extraction.md「merge gate 三道」。
 */
import { describe, it, expect } from 'vitest';
import { mergeGate, caps, isPassVerdict } from '../gates.js';
import {
  MAX_FIX_ROUNDS,
  MAX_POLL_COUNT,
  POLL_INTERVAL_MS,
  MAX_HOPS,
  MAX_NO_PUSH_STREAK,
  MAX_NO_VERDICT_STREAK,
  MAX_REBASE_ATTEMPTS,
  BLOCKED_SAME_STATE_CAP,
  BUDGET_CAP_USD,
} from '../constants.js';

function baseInput(overrides = {}) {
  return {
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
    judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-1' },
    prHeadSha: 'sha-1',
    reviewRequired: false,
    reviewApproved: false,
    ...overrides,
  };
}

describe('mergeGate（mergePrNode 前置门=evaluate_verdict PASS + review_gate 人工 + judge 硬门禁）', () => {
  it('双 PASS（本 sha）&& 无需 review → 放行', () => {
    const r = mergeGate(baseInput());
    expect(r.allow).toBe(true);
  });

  it('evaluate 缺失 → 拒', () => {
    const r = mergeGate(baseInput({ evaluateVerdict: null }));
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/evaluate/);
  });

  it('evaluate 非 PASS → 拒（reportNode 自合语义：只有 evaluate_verdict===PASS 才自合）', () => {
    const r = mergeGate(baseInput({ evaluateVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-1' } }));
    expect(r.allow).toBe(false);
  });

  it('evaluate FIXED 归一为 PASS → 放行（harness-evaluator-verdict-bug）', () => {
    const r = mergeGate(baseInput({ evaluateVerdict: { verdict: 'FIXED', pr_head_sha: 'sha-1' } }));
    expect(r.allow).toBe(true);
  });

  it('evaluate PASS 但 sha 不匹配（stale PASS + 新 commit）→ 拒（P0-2）', () => {
    const r = mergeGate(baseInput({ evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-old' } }));
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/stale/);
  });

  it('judge 缺失 → 拒', () => {
    const r = mergeGate(baseInput({ judgeVerdict: null }));
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/judge/);
  });

  it('judge 非 PASS → 拒', () => {
    const r = mergeGate(baseInput({ judgeVerdict: { verdict: 'FAIL', pr_head_sha: 'sha-1' } }));
    expect(r.allow).toBe(false);
  });

  it('judge PASS 但 sha 不匹配 → 拒', () => {
    const r = mergeGate(baseInput({ judgeVerdict: { verdict: 'PASS', pr_head_sha: 'sha-old' } }));
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/stale/);
  });

  it('review_required && 未批准 → 拒', () => {
    const r = mergeGate(baseInput({ reviewRequired: true, reviewApproved: false }));
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/review/);
  });

  it('review_required && 已批准 → 放行', () => {
    const r = mergeGate(baseInput({ reviewRequired: true, reviewApproved: true }));
    expect(r.allow).toBe(true);
  });

  it('缺 prHeadSha → throw 带字段名（fail-fast）', () => {
    const input = baseInput();
    delete input.prHeadSha;
    expect(() => mergeGate(input)).toThrow(/prHeadSha/);
  });
});

describe('常量 pin（钉死具体数值，防改值后测试仍绿的语义漂移；出处 routing-extraction.md）', () => {
  it('9 个常量数值（Sprint 1b997ed6 更新 MAX_FIX_ROUNDS=3, MAX_HOPS=60）', () => {
    // Sprint 1b997ed6: MAX_FIX_ROUNDS 20→3, MAX_HOPS 200→60
    expect(MAX_FIX_ROUNDS).toBe(3);
    expect(MAX_POLL_COUNT).toBe(20);
    expect(POLL_INTERVAL_MS).toBe(90000);
    expect(MAX_NO_PUSH_STREAK).toBe(2);
    expect(MAX_NO_VERDICT_STREAK).toBe(3);
    expect(MAX_REBASE_ATTEMPTS).toBe(3);
    expect(MAX_HOPS).toBe(60);
    expect(BLOCKED_SAME_STATE_CAP).toBe(2);
    expect(BUDGET_CAP_USD).toBe(10);
  });
});

describe('caps 上限判断（数值出处 routing-extraction.md）', () => {
  it('MAX_HOPS=60（Sprint 1b997ed6 收紧）', () => {
    expect(caps.hopsExceeded(MAX_HOPS - 1)).toBe(false);
    expect(caps.hopsExceeded(MAX_HOPS)).toBe(true);
  });

  it('MAX_FIX_ROUNDS=3（Sprint 1b997ed6 收紧）', () => {
    expect(caps.fixExceeded(MAX_FIX_ROUNDS - 1)).toBe(false);
    expect(caps.fixExceeded(MAX_FIX_ROUNDS)).toBe(true);
  });

  it('MAX_POLL_COUNT=20', () => {
    expect(caps.pollExceeded(MAX_POLL_COUNT - 1)).toBe(false);
    expect(caps.pollExceeded(MAX_POLL_COUNT)).toBe(true);
  });

  it('MAX_NO_PUSH_STREAK=2', () => {
    expect(caps.noPushStreakExceeded(MAX_NO_PUSH_STREAK - 1)).toBe(false);
    expect(caps.noPushStreakExceeded(MAX_NO_PUSH_STREAK)).toBe(true);
  });

  it('MAX_NO_VERDICT_STREAK=3', () => {
    expect(caps.noVerdictStreakExceeded(MAX_NO_VERDICT_STREAK - 1)).toBe(false);
    expect(caps.noVerdictStreakExceeded(MAX_NO_VERDICT_STREAK)).toBe(true);
  });

  it('BUDGET_CAP_USD=10', () => {
    expect(caps.budgetExceeded(BUDGET_CAP_USD - 0.01)).toBe(false);
    expect(caps.budgetExceeded(BUDGET_CAP_USD)).toBe(true);
  });

  it('MAX_REBASE_ATTEMPTS=3（merge_pr BEHIND update-branch 上限）', () => {
    expect(caps.rebaseExceeded(MAX_REBASE_ATTEMPTS - 1)).toBe(false);
    expect(caps.rebaseExceeded(MAX_REBASE_ATTEMPTS)).toBe(true);
  });

  it('BLOCKED_SAME_STATE_CAP=2（loop 四态：连续 2 次同态 → failed）', () => {
    expect(caps.blockedSameStateExceeded(BLOCKED_SAME_STATE_CAP - 1)).toBe(false);
    expect(caps.blockedSameStateExceeded(BLOCKED_SAME_STATE_CAP)).toBe(true);
  });
});

describe('isPassVerdict', () => {
  it('PASS/FIXED 为真，FAIL/null 为假', () => {
    expect(isPassVerdict('PASS')).toBe(true);
    expect(isPassVerdict('FIXED')).toBe(true);
    expect(isPassVerdict('FAIL')).toBe(false);
    expect(isPassVerdict(null)).toBe(false);
  });
});
