/**
 * persistent-counters.test.js — B-04: 持久化计数跨进程重启恢复
 *
 * TDD 骨架：全红状态。
 * 目标函数：deriveCounters(logRows, options) 扩展支持 blockedStreak / pollCount
 * 来源：packages/brain/src/orchestrator/counters.js（待扩展）
 *
 * FR-08 要求：
 * - blockedStreak：尾部连续 BLOCKED/NEEDS_CONTEXT 行数
 * - pollCount：COUNT(action='wait:poll_ci')
 * - 所有计数从 decision log 推导，进程重启不归零
 * - CI pending 30 分钟上限从 decision log 推导首次 wait:poll_ci 时间戳
 */
import { describe, it, expect } from 'vitest';

import { deriveCounters } from '../counters.js';

function row(hop, action, observed = {}) {
  return { hop, action, observed };
}

describe('B-04: pollCount 持久化推导', () => {
  it('空日志 → pollCount=0', () => {
    const c = deriveCounters([], { proposeBranchMaxRn: 0 });
    expect(c.pollCount).toBe(0);
  });

  it('3 次 wait:poll_ci → pollCount=3', () => {
    const rows = [
      row(1, 'spawn:generator'),
      row(2, 'wait:poll_ci'),
      row(3, 'wait:poll_ci'),
      row(4, 'wait:poll_ci'),
    ];
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.pollCount).toBe(3);
  });

  it('同 hop 不重复计（崩溃重放窗口）', () => {
    const rows = [
      row(2, 'wait:poll_ci'),
      row(2, 'wait:poll_ci'), // 重复
      row(3, 'wait:poll_ci'),
    ];
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.pollCount).toBe(2); // hop 2 只算一次
  });

  it('pollCount 跨进程重启：相同 logRows 输入得相同 pollCount', () => {
    const rows = [
      row(1, 'wait:poll_ci'),
      row(2, 'wait:poll_ci'),
      row(3, 'spawn:evaluator'), // 非 poll
      row(4, 'wait:poll_ci'),
    ];
    const c1 = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    const c2 = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c1.pollCount).toBe(c2.pollCount);
    expect(c1.pollCount).toBe(3);
  });
});

describe('B-04: blockedStreak 持久化推导', () => {
  it('空日志 → blockedStreak=0', () => {
    const c = deriveCounters([], { proposeBranchMaxRn: 0 });
    expect(c.blockedStreak).toBe(0);
  });

  it('尾部连续 2 个 mark:needs_context → blockedStreak=2', () => {
    const rows = [
      row(1, 'spawn:generator'),
      row(2, 'mark:needs_context', { blocked_same_state: true }),
      row(3, 'mark:needs_context', { blocked_same_state: true }),
    ];
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.blockedStreak).toBe(2);
  });

  it('中间出现非 blocked 行打断 streak', () => {
    const rows = [
      row(1, 'mark:needs_context', { blocked_same_state: true }),
      row(2, 'spawn:generator'), // 打断
      row(3, 'mark:needs_context', { blocked_same_state: true }),
    ];
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.blockedStreak).toBe(1); // 只有尾部 1 个
  });

  it('blockedStreak 跨进程重启：相同输入得相同 blockedStreak', () => {
    const rows = [
      row(1, 'mark:needs_context', { blocked_same_state: true }),
      row(2, 'mark:needs_context', { blocked_same_state: true }),
    ];
    const c1 = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    const c2 = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c1.blockedStreak).toBe(c2.blockedStreak);
    expect(c1.blockedStreak).toBe(2);
  });
});

describe('B-04: fixRound 跨重启', () => {
  it('fixRound = COUNT(spawn:generator-fix)，去重后', () => {
    const rows = [
      row(1, 'spawn:generator'),
      row(2, 'spawn:generator-fix'),
      row(3, 'spawn:evaluator'),
      row(4, 'spawn:generator-fix'),
      // 崩溃重放窗口重复 hop
      row(4, 'spawn:generator-fix'),
    ];
    const c = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    expect(c.fixRound).toBe(2); // hop 4 只算一次
  });
});

describe('B-04: 相同输入、重启后 derive() 得到相同动作（幂等性）', () => {
  /**
   * 这个测试是端到端幂等验证：
   * 相同 decision log + 相同外部快照 → deriveCounters() 输出相同 counters
   * → derive() 输出相同 action
   *
   * 此处仅验证 deriveCounters() 的幂等性（derive() 的幂等在 derive.test.js 已覆盖）
   */
  it('乱序 logRows 排序后得到相同计数', () => {
    const rows = [
      row(3, 'spawn:generator-fix'),
      row(1, 'spawn:generator'),
      row(2, 'wait:poll_ci'),
    ];
    const shuffled = [
      row(2, 'wait:poll_ci'),
      row(3, 'spawn:generator-fix'),
      row(1, 'spawn:generator'),
    ];
    const c1 = deriveCounters(rows, { proposeBranchMaxRn: 0 });
    const c2 = deriveCounters(shuffled, { proposeBranchMaxRn: 0 });
    expect(c1).toEqual(c2);
  });
});
