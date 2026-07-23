/**
 * failure-class-routing.test.js — B-02: failure_class 路由矩阵（五种，全覆盖）
 *
 * TDD 骨架：全红状态。
 * 目标函数：derive(observed) 扩展支持 judgeVerdict.failure_class
 * 来源：packages/brain/src/orchestrator/derive.js（待实现 failure_class 路由）
 *
 * FR-04 要求：
 * - product_failure → spawn:generator-fix
 * - evidence_invalid → spawn:evaluator-evidence-repair（绝不触发 generator）
 * - contract_invalid → mark_failed（terminal，创建独立后续任务）
 * - environment_failure → 换账号恢复一次；仍失败 → mark_failed
 * - unknown → needs_context 一次；仍未知 → mark_failed
 * - 缺 failure_class → 视为 unknown
 */
import { describe, it, expect } from 'vitest';

// TODO: 实现后取消注释
// import { derive } from '../../../packages/brain/src/orchestrator/derive.js';

// Placeholder derive — 全红骨架
function derive(_observed) {
  return { phase: 'unknown', action: 'unknown', reason: 'not_implemented' };
}

/** 构造 "evaluate PASS + judge FAIL with failure_class" 的 observed */
function baseObservedWithJudgeFail(failureClass, overrides = {}) {
  return {
    run: { phase: 'verify' },
    task: { status: 'in_progress' },
    prdExists: true,
    contract: { approved: true },
    pr: {
      url: 'https://github.com/x/y/pull/1',
      state: 'OPEN',
      ci: 'pass',
      merged: false,
      head_sha: 'sha-trigger',
    },
    inflight: { containers: [], host_pids: [] },
    lastAgentExit: { code: 0, auth_failed: false },
    proposeBranchRn: 0,
    ganLatestRoundVerdict: null,
    generatorSpawned: true,
    evaluateVerdict: { verdict: 'PASS', pr_head_sha: 'sha-trigger' },
    judgeVerdict: {
      verdict: 'FAIL',
      pr_head_sha: 'sha-trigger',
      failure_class: failureClass,
    },
    reviewRequired: false,
    reviewApproved: false,
    counters: {
      hops: 10,
      fixRound: 0,
      pollCount: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      ganCostUsd: 0,
    },
    ...overrides,
  };
}

describe('B-02: failure_class 路由矩阵', () => {
  describe('product_failure → spawn:generator-fix', () => {
    it('judge failure_class=product_failure → spawn:generator-fix', () => {
      const r = derive(baseObservedWithJudgeFail('product_failure'));
      expect(r.action).toBe('spawn:generator-fix');
    });

    it('product_failure + fixRound=0 → generator-fix（未超上限）', () => {
      const r = derive(baseObservedWithJudgeFail('product_failure', {
        counters: { hops: 10, fixRound: 0, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
      }));
      expect(r.action).toBe('spawn:generator-fix');
    });

    it('product_failure + fixRound=3（达到 MAX_FIX_ROUNDS=3）→ mark_failed（不再 fix）', () => {
      const r = derive(baseObservedWithJudgeFail('product_failure', {
        counters: { hops: 20, fixRound: 3, pollCount: 0, noPushStreak: 0, noVerdictStreak: 0, ganCostUsd: 0 },
      }));
      expect(r.action).toBe('mark_failed');
      expect(r.reason).toMatch(/fix_cap/);
    });
  });

  describe('evidence_invalid → spawn:evaluator-evidence-repair（绝不触发 generator）', () => {
    it('judge failure_class=evidence_invalid → spawn:evaluator-evidence-repair', () => {
      const r = derive(baseObservedWithJudgeFail('evidence_invalid'));
      expect(r.action).toBe('spawn:evaluator-evidence-repair');
    });

    it('evidence_invalid 不得产生 spawn:generator 或 spawn:generator-fix', () => {
      const r = derive(baseObservedWithJudgeFail('evidence_invalid'));
      expect(r.action).not.toBe('spawn:generator');
      expect(r.action).not.toBe('spawn:generator-fix');
    });

    it('evidence_invalid 第二次（evidence repair 后 digest 未变）→ no_progress_same_evidence terminal', () => {
      // 场景：evidence_digest 未变化，same_evidence fence 已触发
      const r = derive(baseObservedWithJudgeFail('evidence_invalid', {
        noProgressSameEvidence: true, // 新字段，derive 读取
      }));
      // 期望：mark_failed 且 reason 含 no_progress
      expect(r.action).toBe('mark_failed');
      expect(r.reason).toMatch(/no_progress/);
    });
  });

  describe('contract_invalid → mark_failed（terminal）', () => {
    it('judge failure_class=contract_invalid → mark_failed', () => {
      const r = derive(baseObservedWithJudgeFail('contract_invalid'));
      expect(r.action).toBe('mark_failed');
    });

    it('contract_invalid 不得 spawn:generator 或 spawn:generator-fix', () => {
      const r = derive(baseObservedWithJudgeFail('contract_invalid'));
      expect(r.action).not.toBe('spawn:generator');
      expect(r.action).not.toBe('spawn:generator-fix');
    });
  });

  describe('environment_failure → 恢复一次；同签名第二次 → mark_failed', () => {
    it('environment_failure 首次 → 环境恢复 action（spawn:evaluator 或环境恢复动作）', () => {
      const r = derive(baseObservedWithJudgeFail('environment_failure', {
        environmentRecoveryCount: 0,
        environmentErrorSignature: 'err-sig-1',
      }));
      // 期望不是 generator-fix，也不是 mark_failed
      expect(r.action).not.toBe('spawn:generator-fix');
      expect(r.action).not.toBe('mark_failed');
    });

    it('同错误签名 environment_failure 第二次 → mark_failed', () => {
      const r = derive(baseObservedWithJudgeFail('environment_failure', {
        environmentRecoveryCount: 1, // 已恢复过一次
        environmentErrorSignature: 'err-sig-1',
      }));
      expect(r.action).toBe('mark_failed');
    });
  });

  describe('unknown → needs_context；第二次 unknown → mark_failed', () => {
    it('failure_class=unknown 首次 → needs_context（不是 generator-fix）', () => {
      const r = derive(baseObservedWithJudgeFail('unknown', {
        needsContextCount: 0,
      }));
      expect(r.action).not.toBe('spawn:generator-fix');
      // 期望 wait:needs_context 或 needs_context 相关 action
    });

    it('unknown 第二次 → mark_failed', () => {
      const r = derive(baseObservedWithJudgeFail('unknown', {
        needsContextCount: 1,
      }));
      expect(r.action).toBe('mark_failed');
    });
  });

  describe('缺 failure_class → 视为 unknown', () => {
    it('judgeVerdict.failure_class 缺失 → 不得 spawn:generator-fix', () => {
      const observed = baseObservedWithJudgeFail(undefined);
      // 删除 failure_class 字段
      delete observed.judgeVerdict.failure_class;
      const r = derive(observed);
      expect(r.action).not.toBe('spawn:generator-fix');
    });

    it('judgeVerdict.failure_class=null → 不得 spawn:generator-fix', () => {
      const r = derive(baseObservedWithJudgeFail(null));
      expect(r.action).not.toBe('spawn:generator-fix');
    });
  });
});

describe('B-02: decision log 写入失败分类元数据', () => {
  /**
   * 验证 derive() 返回值包含足够信息供 dispatcher 写入 decision log。
   * derive() 返回 reason 字段须包含 failure_class。
   */
  it('product_failure route → reason 含 failure_class 信息', () => {
    const r = derive(baseObservedWithJudgeFail('product_failure'));
    // reason 字符串或 meta 对象应包含失败分类信息
    expect(r.reason || r.meta?.failure_class).toBeTruthy();
  });

  it('evidence_invalid route → reason 可追溯到 evidence_invalid', () => {
    const r = derive(baseObservedWithJudgeFail('evidence_invalid'));
    expect(r.action).toBe('spawn:evaluator-evidence-repair');
    // reason 应指示来自 evidence_invalid 路由
    expect(r.reason).toMatch(/evidence/);
  });
});
