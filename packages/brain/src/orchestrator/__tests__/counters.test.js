/**
 * counters.test.js —— spec §测试策略 §3 全场景：
 * - 空日志=0
 * - fixRound = COUNT(action='spawn:generator-fix')
 * - ganRound 权威=分支 rN，COUNT 交叉校验不一致时取分支值
 * - noPushStreak / noVerdictStreak 从 (action, observed) 序列尾部推导（清零语义：产物出现即断）
 * - 同 hop 不重复计
 */
import { describe, it, expect } from 'vitest';
import { deriveCounters, replayProductConvergence } from '../counters.js';

/** 造一行决策日志 */
function row(hop, action, observed = {}) {
  return { hop, action, observed };
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
  it('尾部两连 propose_branch_advanced=false → 2', () => {
    const rows = [
      row(1, 'spawn:proposer', { propose_branch_advanced: true }),
      row(2, 'spawn:proposer', { propose_branch_advanced: false }),
      row(3, 'spawn:proposer', { propose_branch_advanced: false }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noPushStreak).toBe(2);
  });

  it('清零语义：最新一次 push 成功（true）即断 → 0', () => {
    const rows = [
      row(1, 'spawn:proposer', { propose_branch_advanced: false }),
      row(2, 'spawn:proposer', { propose_branch_advanced: false }),
      row(3, 'spawn:proposer', { propose_branch_advanced: true }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noPushStreak).toBe(0);
  });

  it('中间成功打断连续性：false,true,false → 1', () => {
    const rows = [
      row(1, 'spawn:proposer', { propose_branch_advanced: false }),
      row(2, 'spawn:proposer', { propose_branch_advanced: true }),
      row(3, 'spawn:proposer', { propose_branch_advanced: false }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noPushStreak).toBe(1);
  });

  it('GAN 交替：夹在中间的 reviewer 行不打断 proposer streak', () => {
    const rows = [
      row(1, 'spawn:proposer', { propose_branch_advanced: false }),
      row(2, 'spawn:reviewer', { verdict_parsed: true }),
      row(3, 'spawn:proposer', { propose_branch_advanced: false }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 0 }).noPushStreak).toBe(2);
  });

  it('observed 缺 propose_branch_advanced（旧行/崩溃窗口）→ 不计入 streak（保守断开）', () => {
    const rows = [
      row(1, 'spawn:proposer', { propose_branch_advanced: false }),
      row(2, 'spawn:proposer', {}),
      row(3, 'spawn:proposer', { propose_branch_advanced: false }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 0 }).noPushStreak).toBe(1);
  });
});

describe('deriveCounters：noVerdictStreak（尾部连续 reviewer 无 verdict）', () => {
  it('尾部三连 verdict_parsed=false → 3', () => {
    const rows = [
      row(1, 'spawn:reviewer', { verdict_parsed: false }),
      row(2, 'spawn:reviewer', { verdict_parsed: false }),
      row(3, 'spawn:reviewer', { verdict_parsed: false }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(3);
  });

  it('清零语义：拿到 verdict（true）即断 → 0', () => {
    const rows = [
      row(1, 'spawn:reviewer', { verdict_parsed: false }),
      row(2, 'spawn:reviewer', { verdict_parsed: true }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(0);
  });

  it('true 之后再 false：累积从断点重新开始 → 1', () => {
    const rows = [
      row(1, 'spawn:reviewer', { verdict_parsed: false }),
      row(2, 'spawn:reviewer', { verdict_parsed: true }),
      row(3, 'spawn:reviewer', { verdict_parsed: false }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(1);
  });

  it('proposer 行不参与 noVerdictStreak', () => {
    const rows = [
      row(1, 'spawn:reviewer', { verdict_parsed: false }),
      row(2, 'spawn:proposer', { propose_branch_advanced: true }),
      row(3, 'spawn:reviewer', { verdict_parsed: false }),
    ];
    expect(deriveCounters(rows, { proposeBranchMaxRn: 1 }).noVerdictStreak).toBe(2);
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
});
