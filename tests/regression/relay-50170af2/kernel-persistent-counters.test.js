/**
 * kernel-persistent-counters.test.js
 *
 * [BEHAVIOR] B-05：持久化计数跨重启不归零
 *
 * 先红后绿：当前代码 loop.js 的 pollCount 是进程内 let 变量（初始化为 0）。
 * wait:poll_ci 不写 decision log，重启后归零。
 * blockedStreak 同样是进程内变量。
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 */

import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';

describe('[BEHAVIOR] B-05 持久化计数从 DB decision log 推导', () => {

  /**
   * T-08-a: pollCount 从 decision log 推导，重启后恢复
   * 当前（先红）：deriveCounters 不提供 pollCount 字段（进程内变量）
   */
  test('T-08-a: deriveCounters 应推导 pollCount 字段', () => {
    const logRows = [
      { hop: 1, action: 'spawn:generator', observed: {} },
      { hop: 2, action: 'wait:poll_ci', observed: { ci: 'pending' } },
      { hop: 3, action: 'wait:poll_ci', observed: { ci: 'pending' } },
      { hop: 4, action: 'wait:poll_ci', observed: { ci: 'pending' } },
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });

    // 实现后期望：pollCount=3
    // 当前（先红）：deriveCounters 不返回 pollCount
    expect(counters).toHaveProperty('pollCount');
    expect(counters.pollCount).toBe(3);
  });

  /**
   * T-08-b: pollCount 在有 spawn 类 action 后重置（重新进入 poll 环从 0 开始）
   */
  test('T-08-b: pollCount 在非 poll action 后重置', () => {
    const logRows = [
      { hop: 1, action: 'wait:poll_ci', observed: {} }, // old poll
      { hop: 2, action: 'wait:poll_ci', observed: {} }, // old poll
      { hop: 3, action: 'spawn:evaluator', observed: {} }, // 中断，pollCount 应清零
      { hop: 4, action: 'wait:poll_ci', observed: {} }, // new poll
      { hop: 5, action: 'wait:poll_ci', observed: {} }, // new poll
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });

    // 实现后期望：pollCount=2（从最后一次 spawn 后的 poll 行计）
    // 当前（先红）：不提供 pollCount
    expect(counters.pollCount).toBe(2);
  });

  /**
   * T-08-c: pollCount=0 当 log 里没有 wait:poll_ci 行
   */
  test('T-08-c: 无 poll_ci 行时 pollCount=0', () => {
    const logRows = [
      { hop: 1, action: 'spawn:generator', observed: {} },
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });
    expect(counters.pollCount).toBe(0);
  });

  /**
   * T-08-d: loop.js wait:poll_ci 时必须写 decision log
   * 验证 wait:poll_ci 的 append 行为（实现后 loop.js 在 wait:poll_ci 时也要 appendHop）
   *
   * 当前（先红）：loop.js 的 WAIT_POLL_CI 分支直接 sleep，不 appendHop。
   */

  /**
   * T-09: blockedStreak 从 DB 推导（实现后 loop 不再依赖进程内 blockedState/blockedStreak）
   * 当前（先红）：blockedStreak 是进程内 let 变量。
   */
  test('T-09: deriveCounters 应推导 blockedStreak 字段', () => {
    const logRows = [
      { hop: 1, action: 'spawn:evaluator', observed: {}, gate_verdict: 'deny:BLOCKED' },
      { hop: 2, action: 'spawn:evaluator', observed: {}, gate_verdict: 'deny:BLOCKED' },
    ];

    const counters = deriveCounters(logRows, { proposeBranchMaxRn: 0 });

    // 实现后期望：blockedStreak 字段存在（用于跨重启保持熔断状态）
    // 当前（先红）：不提供 blockedStreak
    expect(counters).toHaveProperty('blockedStreak');
  });
});
