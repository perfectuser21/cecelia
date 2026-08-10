/**
 * counters.test.js —— spec §测试策略 §3 全场景：
 * - 空日志=0
 * - fixRound = COUNT(action='spawn:generator-fix')
 * - ganRound 权威=分支 rN，COUNT 交叉校验不一致时取分支值
 * - noPushStreak / noVerdictStreak 从 intent + launch + identity callback 链推导
 * - 同 hop 不重复计
 */
import { describe, it, expect } from 'vitest';
import { deriveCounters, replayProductConvergence } from '../counters.js';

/** 造一行决策日志 */
function row(hop, action, observed = {}) {
  return { hop, action, observed };
}

function attemptIdFor(intentHop) {
  return `00000000-0000-4000-8000-${String(intentHop).padStart(12, '0')}`;
}

function completedRoleAttempt({
  intentHop,
  effectHop,
  callbackHop,
  role,
  beforeRn = 0,
  intentObserved = {},
}) {
  const attemptId = attemptIdFor(intentHop);
  return [
    row(intentHop, `spawn:${role}`, {
      proposeBranchRn: beforeRn,
      ...intentObserved,
    }),
    {
      hop: effectHop,
      action: 'effect:attempt_launched',
      observed: {},
      detail: {
        dispatch_hop: intentHop,
        dispatch_action: `spawn:${role}`,
        attempt_id: attemptId,
      },
    },
    {
      hop: callbackHop,
      action: 'verdict:attempt_callback',
      observed: { attempt_id: attemptId, role, status: 'completed' },
      detail: {
        attempt_id: attemptId,
        role,
        hop: intentHop,
        status: 'completed',
      },
    },
  ];
}

describe('deriveCounters：空日志', () => {
  it('空日志 → 全 0（ganRound 跟分支 rN=0）', () => {
    expect(deriveCounters([], { proposeBranchMaxRn: 0 })).toEqual({
      hops: 0,
      fixRound: 0,
      ganRound: 0,
      noPushStreak: 0,
      noVerdictStreak: 0,
      crossCheckMismatch: false,
      pollCount: 0,
      blockedStreak: 0,
      blockedStatus: null,
      blockedFailureClass: null,
      noProgress: false,
      noProgressReason: null,
    });
  });

  it('空日志但分支已有 r2（外部真相优先）→ ganRound=2', () => {
    const c = deriveCounters([], { proposeBranchMaxRn: 2 });
    expect(c.ganRound).toBe(2);
  });
});

describe('deriveCounters：hops 与 fixRound', () => {
  it('hops = 行数', () => {
    const rows = [
      row(1, 'spawn:planner'),
      row(2, 'spawn:proposer'),
      row(3, 'spawn:reviewer'),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).hops).toBe(3);
  });

  it('没有 callback 证明 SHA 前进的 fix intent 不计 fixRound', () => {
    const rows = [
      row(1, 'spawn:generator'),
      row(2, 'spawn:generator-fix'),
      row(3, 'wait:poll_ci'),
      row(4, 'spawn:generator-fix'),
      row(5, 'spawn:evaluator'),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 0 }).fixRound).toBe(0);
  });

  it('infrastructure retry 即使后续 SHA 前进也不计入 product fixRound', () => {
    const rows = [
      row(1, 'spawn:generator-fix', {
        trigger_sha: 'a'.repeat(40),
        failure_class: 'infrastructure_blocked',
      }),
      {
        hop: 2,
        action: 'verdict:generator-fix-callback',
        observed: { pr_head_sha: 'b'.repeat(40) },
        detail: { verification_status: 'verified' },
      },
    ];

    expect(deriveCounters(rows, { proposeBranchMaxRn: 0 }).fixRound).toBe(0);
  });

  it('同 hop 不重复计：重复 hop 行只算一次（hops 与 fixRound 都去重）', () => {
    const rows = [
      row(1, 'spawn:generator'),
      row(2, 'spawn:generator-fix'),
      row(2, 'spawn:generator-fix'), // 崩溃重放窗口的重复行（防御性，UNIQUE 正常挡住）
    ];
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.hops).toBe(2);
    expect(c.fixRound).toBe(0);
  });

  it('乱序输入按 hop 排序后推导（结果与有序输入一致）', () => {
    const ordered = [
      row(1, 'spawn:proposer', { propose_branch_advanced: true }),
      row(2, 'spawn:proposer', { propose_branch_advanced: false }),
    ];
    const shuffled = [ordered[1], ordered[0]];
    expect(deriveCounters(shuffled, { proposeBranchMaxRn: 2 })).toEqual(
      deriveCounters(ordered, { proposeBranchMaxRn: 2 }),
    );
  });
});

describe('deriveCounters：ganRound 权威与交叉校验', () => {
  it('COUNT 与分支 rN 一致 → 取该值', () => {
    const rows = [
      row(1, 'spawn:proposer'),
      row(2, 'spawn:reviewer'),
      row(3, 'spawn:proposer'),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 2 }).ganRound).toBe(2);
  });

  it('不一致（崩溃窗口漏记 intent）→ 取分支值（外部真相权威）', () => {
    const rows = [row(1, 'spawn:proposer')]; // COUNT=1
    expect(deriveCounters(rows, { proposeBranchMaxRn: 3 }).ganRound).toBe(3);
  });

  it('不一致（记了没派，分支没动）→ 仍取分支值', () => {
    const rows = [
      row(1, 'spawn:proposer'),
      row(2, 'spawn:proposer'),
      row(3, 'spawn:proposer'),
    ]; // COUNT=3
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).ganRound).toBe(1);
  });

  it('crossCheckMismatch：COUNT 与分支 rN 不一致 → true（loop 写进 appendHop detail）', () => {
    const rows = [row(1, 'spawn:proposer')];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 3 }).crossCheckMismatch).toBe(true);
  });

  it('crossCheckMismatch：一致 → false', () => {
    const rows = [row(1, 'spawn:proposer'), row(2, 'spawn:proposer')];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 2 }).crossCheckMismatch).toBe(false);
  });
});

describe('deriveCounters：noPushStreak（尾部连续 proposer 产物未出现）', () => {
  it('r11：admission-blocked intent 不得把两个已 push Attempt 误杀成 no-push streak', () => {
    const rows = [
      ...completedRoleAttempt({
        intentHop: 6,
        effectHop: 7,
        callbackHop: 8,
        role: 'proposer',
        beforeRn: 0,
        intentObserved: { propose_branch_advanced: false },
      }),
      row(17, 'spawn:proposer', {
        proposeBranchRn: 1,
        propose_branch_advanced: true,
      }),
      {
        hop: 18,
        action: 'result:dispatch',
        observed: {},
        detail: { dispatch_hop: 17, status: 'BLOCKED' },
      },
      row(19, 'spawn:proposer', {
        proposeBranchRn: 1,
        propose_branch_advanced: false,
      }),
      {
        hop: 20,
        action: 'result:dispatch',
        observed: {},
        detail: { dispatch_hop: 19, status: 'BLOCKED' },
      },
      ...completedRoleAttempt({
        intentHop: 21,
        effectHop: 22,
        callbackHop: 23,
        role: 'proposer',
        beforeRn: 1,
        intentObserved: { propose_branch_advanced: false },
      }),
    ];

    expect(deriveCounters(rows, { proposeBranchMaxRn: 2 }).noPushStreak).toBe(0);
  });

  it('已 launch 但尚无 terminal callback 的 proposer 不消耗 no-push streak', () => {
    const attemptId = '00000000-0000-4000-8000-000000000001';
    const rows = [
      row(1, 'spawn:proposer', {
        proposeBranchRn: 0,
        propose_branch_advanced: false,
      }),
      {
        hop: 2,
        action: 'effect:attempt_launched',
        observed: {},
        detail: {
          dispatch_hop: 1,
          dispatch_action: 'spawn:proposer',
          attempt_id: attemptId,
        },
      },
    ];

    expect(deriveCounters(rows, { proposeBranchMaxRn: 0 }).noPushStreak).toBe(0);
  });

  it('两个 completed proposer Attempt 都没有推进分支 → 2', () => {
    const rows = [
      ...completedRoleAttempt({
        intentHop: 1, effectHop: 2, callbackHop: 3, role: 'proposer', beforeRn: 0,
      }),
      ...completedRoleAttempt({
        intentHop: 4, effectHop: 5, callbackHop: 6, role: 'proposer', beforeRn: 0,
      }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 0 }).noPushStreak).toBe(2);
  });

  it('清零语义：最新一次 completed Attempt 推进分支即断 → 0', () => {
    const rows = [
      ...completedRoleAttempt({
        intentHop: 1, effectHop: 2, callbackHop: 3, role: 'proposer', beforeRn: 0,
      }),
      ...completedRoleAttempt({
        intentHop: 4, effectHop: 5, callbackHop: 6, role: 'proposer', beforeRn: 0,
      }),
      ...completedRoleAttempt({
        intentHop: 7, effectHop: 8, callbackHop: 9, role: 'proposer', beforeRn: 0,
      }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noPushStreak).toBe(0);
  });

  it('中间分支推进打断连续性：false,true,false → 1', () => {
    const rows = [
      ...completedRoleAttempt({
        intentHop: 1, effectHop: 2, callbackHop: 3, role: 'proposer', beforeRn: 0,
      }),
      ...completedRoleAttempt({
        intentHop: 4, effectHop: 5, callbackHop: 6, role: 'proposer', beforeRn: 0,
      }),
      ...completedRoleAttempt({
        intentHop: 7, effectHop: 8, callbackHop: 9, role: 'proposer', beforeRn: 1,
      }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noPushStreak).toBe(1);
  });

  it('GAN 交替：夹在中间的 reviewer 行不打断 proposer streak', () => {
    const rows = [
      ...completedRoleAttempt({
        intentHop: 1, effectHop: 2, callbackHop: 3, role: 'proposer', beforeRn: 0,
      }),
      row(4, 'spawn:reviewer', {}),
      ...completedRoleAttempt({
        intentHop: 5, effectHop: 6, callbackHop: 7, role: 'proposer', beforeRn: 0,
      }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 0 }).noPushStreak).toBe(2);
  });

  it('未启动的历史 intent 保守断开 completed Attempt streak', () => {
    const rows = [
      ...completedRoleAttempt({
        intentHop: 1, effectHop: 2, callbackHop: 3, role: 'proposer', beforeRn: 0,
      }),
      row(4, 'spawn:proposer', { proposeBranchRn: 0 }),
      ...completedRoleAttempt({
        intentHop: 5, effectHop: 6, callbackHop: 7, role: 'proposer', beforeRn: 0,
      }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 0 }).noPushStreak).toBe(1);
  });
});

describe('deriveCounters：noVerdictStreak（尾部连续 reviewer 无 verdict）', () => {
  it('admission-blocked reviewer intents 不消耗 no-verdict streak', () => {
    const rows = [
      row(1, 'spawn:reviewer', { verdict_parsed: false }),
      {
        hop: 2,
        action: 'result:dispatch',
        observed: {},
        detail: { dispatch_hop: 1, status: 'BLOCKED' },
      },
      row(3, 'spawn:reviewer', { verdict_parsed: false }),
      {
        hop: 4,
        action: 'result:dispatch',
        observed: {},
        detail: { dispatch_hop: 3, status: 'BLOCKED' },
      },
    ];

    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(0);
  });

  it('两个 completed reviewer Attempt 都没有 role verdict 才计为 2', () => {
    const rows = [
      ...completedRoleAttempt({
        intentHop: 1,
        effectHop: 2,
        callbackHop: 3,
        role: 'reviewer',
        intentObserved: { verdict_parsed: false },
      }),
      ...completedRoleAttempt({
        intentHop: 4,
        effectHop: 5,
        callbackHop: 6,
        role: 'reviewer',
        intentObserved: { verdict_parsed: false },
      }),
    ];

    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(2);
  });

  it('三个 completed reviewer Attempt 都没有 role verdict → 3', () => {
    const rows = [
      ...completedRoleAttempt({ intentHop: 1, effectHop: 2, callbackHop: 3, role: 'reviewer' }),
      ...completedRoleAttempt({ intentHop: 4, effectHop: 5, callbackHop: 6, role: 'reviewer' }),
      ...completedRoleAttempt({ intentHop: 7, effectHop: 8, callbackHop: 9, role: 'reviewer' }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(3);
  });

  it('清零语义：最新 completed reviewer 拿到 identity-bound verdict 即断 → 0', () => {
    const rows = [
      ...completedRoleAttempt({ intentHop: 1, effectHop: 2, callbackHop: 3, role: 'reviewer' }),
      ...completedRoleAttempt({ intentHop: 4, effectHop: 5, callbackHop: 6, role: 'reviewer' }),
      {
        hop: 7,
        action: 'verdict:reviewer',
        observed: {},
        detail: { attempt_id: attemptIdFor(4), verdict: 'APPROVED' },
      },
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(0);
  });

  it('有 verdict 后下一 completed reviewer 无 verdict：从断点重新计 1', () => {
    const rows = [
      ...completedRoleAttempt({ intentHop: 1, effectHop: 2, callbackHop: 3, role: 'reviewer' }),
      {
        hop: 4,
        action: 'verdict:reviewer',
        observed: {},
        detail: { attempt_id: attemptIdFor(1), verdict: 'APPROVED' },
      },
      ...completedRoleAttempt({ intentHop: 5, effectHop: 6, callbackHop: 7, role: 'reviewer' }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(1);
  });

  it('proposer 行不参与 noVerdictStreak', () => {
    const rows = [
      ...completedRoleAttempt({ intentHop: 1, effectHop: 2, callbackHop: 3, role: 'reviewer' }),
      row(4, 'spawn:proposer', { proposeBranchRn: 1 }),
      ...completedRoleAttempt({ intentHop: 5, effectHop: 6, callbackHop: 7, role: 'reviewer' }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(2);
  });
});

describe('deriveCounters：noProgress —— 基础设施 fix 轮无事可做不误判（b19e6e6e 实证）', () => {
  // 缺陷现场：run b19e6e6e —— generator 已把活干完/推送/开 PR，只是 provider 会话
  // 超时被判 failed；基础设施触发的 fix 轮 3 分半发现没新活可干，SHA 不变是正确行为，
  // 却被 same-SHA no-progress 误杀整条 run。触发来源从结构化字段
  // observed.failure_class 读取，禁止对 reason 字符串做模糊匹配。
  const triggerSha = 'b4d2c85e5e82d1375f6a1baa56096534007d08a3';

  function fixCallbackRows({ failureClass, callbackStatus }) {
    return [
      row(21, 'spawn:generator-fix', {
        trigger_sha: triggerSha,
        failure_class: failureClass,
      }),
      {
        hop: 24,
        action: 'verdict:generator-fix-callback',
        observed: { pr_head_sha: triggerSha, trigger_hop: 21 },
        detail: {
          status: callbackStatus,
          verification_status: 'verified',
          pr_head_sha: triggerSha,
          trigger_sha: triggerSha,
        },
      },
    ];
  }

  it('基础设施触发 + fix 轮 completed_with_concerns + SHA 不变 → noProgress=false（放行下游）', () => {
    const rows = fixCallbackRows({
      failureClass: 'infrastructure_blocked',
      callbackStatus: 'completed_with_concerns',
    });
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.noProgress).toBe(false);
    expect(c.noProgressReason).toBe(null);
  });

  it('反向红线：product_failure 触发 + SHA 不变 → 仍 noProgress=true（防死循环红线不削弱）', () => {
    const rows = fixCallbackRows({
      failureClass: 'product_failure',
      callbackStatus: 'completed_with_concerns',
    });
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.noProgress).toBe(true);
    expect(c.noProgressReason).toBe('no_progress_same_sha');
  });

  it('回调失败：基础设施触发但 fix 轮 callback status=failed + SHA 不变 → 仍 noProgress=true（agent 没跑成就是真没进展）', () => {
    const rows = fixCallbackRows({
      failureClass: 'infrastructure_blocked',
      callbackStatus: 'failed',
    });
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.noProgress).toBe(true);
    expect(c.noProgressReason).toBe('no_progress_same_sha');
  });
});

describe('deriveCounters：入参防御', () => {
  it('缺 proposeBranchMaxRn → throw（fail-fast，禁默认猜测）', () => {
    expect(() => deriveCounters([], {})).toThrow(/proposeBranchMaxRn/);
  });

  it('logRows 非数组 → throw', () => {
    expect(() => deriveCounters(null, { proposeBranchMaxRn: 0 })).toThrow(/logRows/);
  });
});

describe('replayProductConvergence：无 claimed SHA 的 pending callback', () => {
  const triggerSha = 'a'.repeat(40);
  const advancedSha = 'b'.repeat(40);

  function unclaimedPendingRows() {
    return [
      row(1, 'spawn:generator-fix', {
        trigger_sha: triggerSha,
        failure_class: 'product_failure',
      }),
      {
        ...row(2, 'verdict:generator-fix-callback', {
          trigger_hop: 1,
          pr_head_sha: triggerSha,
        }),
        detail: { verification_status: 'verification_pending' },
      },
    ];
  }

  it('服务端同 SHA 时将无 claimed pending callback 收敛为 no-progress', () => {
    expect(replayProductConvergence(unclaimedPendingRows(), {
      currentFailureSet: null,
      currentHeadSha: triggerSha,
    })).toEqual({ outcome: 'failed', reason: 'no_progress_same_sha' });
  });

  it('服务端 SHA 前进时将无 claimed pending callback 认定为 verified progress', () => {
    expect(replayProductConvergence(unclaimedPendingRows(), {
      currentFailureSet: null,
      currentHeadSha: advancedSha,
    })).toEqual({ outcome: 'continue', reason: 'verified_new_sha' });
  });

  it('Run B normalizes and stops on the same product-failure set persisted by Run A', () => {
    expect(replayProductConvergence([], {
      currentFailureSet: ['test:b', 'lint'],
      currentHeadSha: advancedSha,
      historicalFailureSets: [[' lint ', 'test:b', 'lint']],
    })).toEqual({
      outcome: 'review',
      reason: 'failure_set_repeated_across_runs',
      failureSet: ['lint', 'test:b'],
      failureSetKey: '["lint","test:b"]',
    });
  });

  it('an approval for a different failure set cannot unlock a repeated cross-Run set', () => {
    const staleRequest = {
      ...row(1, 'effect:human_review_requested', {
        pr: { head_sha: advancedSha },
      }),
      detail: {
        review_reason: 'failure_set_repeated',
        failure_set: ['old-check'],
      },
    };
    const staleApproval = {
      ...row(2, 'verdict:human_review'),
      detail: {
        approved: true,
        pr_head_sha: advancedSha,
        review_request_hop: '1',
      },
    };

    expect(replayProductConvergence([staleRequest, staleApproval], {
      currentFailureSet: ['lint', 'test:b'],
      currentHeadSha: advancedSha,
      historicalFailureSets: [['test:b', 'lint']],
    })).toMatchObject({
      outcome: 'review',
      reason: 'failure_set_repeated_across_runs',
    });
  });
});

describe('replayProductConvergence:reopen_gan_contract = 纪元切换(r43 实证)', () => {
  // r43 实证:generator-fix blocked → 仲裁成立 → reopen_gan_contract 重开合同后,
  // 守卫仍拿着重开前的 fix intent 等一个永远不会来的 fix 回调,两拍后判
  // generator_fix_callback_missing_after_observation 杀掉 run。
  // 正确语义:重开合同 = 旧产品修复周期整体作废,守卫只看重开之后的行。
  const eraSha = 'c'.repeat(40);

  it('重开行之后无新 fix intent → continue,不再追讨重开前的 fix 回调', () => {
    const rows = [
      row(1, 'spawn:generator-fix', { trigger_sha: eraSha, failure_class: 'product_failure' }),
      row(2, 'effect:attempt_launched', {}),
      // blocked 回调走的是 verdict:attempt_callback,没有 generator-fix-callback 行
      row(5, 'reopen_gan_contract', {}),
      row(6, 'wait:generator_fix_callback', {}),
    ];
    const r = replayProductConvergence(rows, {
      currentFailureSet: null,
      currentHeadSha: eraSha,
    });
    expect(r.outcome).toBe('continue');
  });

  it('重开行之后的新 fix intent 照常收敛追踪(纪元内规则不变)', () => {
    const rows = [
      row(1, 'spawn:generator-fix', { trigger_sha: eraSha, failure_class: 'product_failure' }),
      row(5, 'reopen_gan_contract', {}),
      row(7, 'spawn:generator-fix', { trigger_sha: eraSha, failure_class: 'product_failure' }),
      row(8, 'wait:generator_fix_callback', {}),
    ];
    const r = replayProductConvergence(rows, {
      currentFailureSet: null,
      currentHeadSha: eraSha,
    });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toBe('generator_fix_callback_missing_after_observation');
  });
});

describe('replayProductConvergence:blocked/failed 终局的 fix attempt = 已答,不是回调失踪(r43 二次实证)', () => {
  // r43 实证:generator-fix attempt 以 blocked 终局(verdict:attempt_callback,
  // 不产生 generator-fix-callback 行),其出路已被别的路由收编(仲裁/人工/重开)。
  // 守卫仍判"回调失踪",两拍杀 run。终局回调 = 已答(aborted),不追讨。
  const abortSha = 'd'.repeat(40);

  it('fix intent 的 attempt_callback blocked → continue,不判 missing', () => {
    const rows = [
      row(1, 'spawn:generator-fix', { trigger_sha: abortSha, failure_class: 'product_failure' }),
      row(2, 'effect:attempt_launched', {}),
      {
        hop: 3,
        action: 'verdict:attempt_callback',
        observed: {},
        detail: { role: 'generator', status: 'blocked', failure_class: 'semantic_refusal', hop: 1 },
      },
      row(4, 'wait:generator_fix_callback', {}),
    ];
    const r = replayProductConvergence(rows, {
      currentFailureSet: null,
      currentHeadSha: abortSha,
    });
    expect(r.outcome).toBe('continue');
  });

  it('无任何终局回调时仍判 missing(原语义不变)', () => {
    const rows = [
      row(1, 'spawn:generator-fix', { trigger_sha: abortSha, failure_class: 'product_failure' }),
      row(2, 'effect:attempt_launched', {}),
      row(4, 'wait:generator_fix_callback', {}),
    ];
    const r = replayProductConvergence(rows, {
      currentFailureSet: null,
      currentHeadSha: abortSha,
    });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toBe('generator_fix_callback_missing_after_observation');
  });
});
