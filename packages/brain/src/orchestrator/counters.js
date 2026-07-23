/**
 * counters.js —— 从决策日志行 + 外部产物快照推导各计数/streak（纯函数）。
 *
 * 语义 SSOT：docs/superpowers/specs/2026-07-04-orchestrator-skeleton-design.md §关键设计决策 5。
 * streak 清零语义出处：routing-extraction.md（gan.graph.js:94-103——push 成功/拿到 verdict 即清零，
 * "连续性"计数而非累计计数）。
 * 确定性纪律：禁 Date.now/Math.random/new Date；不产生任何 IO。
 *
 * 入参：
 *   logRows —— orchestrator_decision_log 行数组 [{hop, action, observed, ...}]，可乱序/含防御性重复 hop
 *   proposeBranchMaxRn —— propose 分支现查的最大 rN（外部真相，ganRound 唯一权威）
 *
 * 计数语义：
 *   hops       = 去重后的行数（同 hop 不重复计——崩溃重放窗口防御，UNIQUE 正常场景已挡）
 *   fixRound   = COUNT(action='spawn:generator-fix')（intent hop 计数，崩溃窗口 ≤1 过计偏安全方向）
 *   ganRound   = proposeBranchMaxRn（权威）；COUNT(action='spawn:proposer') 仅交叉校验，不一致取分支值
 *   noPushStreak    = 尾部连续的 spawn:proposer 行中 observed.propose_branch_advanced === false 的个数，
 *                     出现 true 即断；缺字段（旧行/崩溃窗口）保守断开不计
 *   noVerdictStreak = 同理，spawn:reviewer 行 × observed.verdict_parsed
 *   crossCheckMismatch = proposerCount !== proposeBranchMaxRn（崩溃窗口漏记 / 记了没派的交叉校验信号，
 *                        loop 把它写进 appendHop detail 供回放排障）
 */
import { ACTION } from './constants.js';

/**
 * 从 (action, observed) 子序列尾部数连续 streak：
 * 只看 action 匹配的行（GAN 交替中夹的其他行不打断）；
 * flagKey === false 计入，其余（true/缺失）即断。
 * 缺字段（旧行/崩溃窗口）保守断开的代价：streak 熔断更晚触发——安全兜底依赖 MAX_HOPS(200)+budget cap，
 * 不会因此放松任何硬上限，只是 GAN 守护可能多跑几跳才停。
 */
function tailStreak(rows, action, flagKey) {
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].action !== action) continue;
    const observed = rows[i].observed || {};
    if (observed[flagKey] === false) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * 尾部连续的 blocked 行数（mark:needs_context 或 mark:blocked，observed.blocked_same_state=true）。
 * Sprint 1b997ed6 新增：从 decision log 持久化推导 blockedStreak，跨进程重启不归零。
 */
function tailBlockedStreak(rows) {
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    // 识别 blocked/needs_context 行：以 mark: 开头或 observed.blocked_same_state=true
    const isBlocked =
      (typeof r.action === 'string' && (r.action === 'mark:needs_context' || r.action === 'mark:blocked'))
      || (r.observed && r.observed.blocked_same_state === true);
    if (isBlocked) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function deriveCounters(logRows, options) {
  if (!Array.isArray(logRows)) {
    throw new Error('deriveCounters: logRows must be an array');
  }
  if (!options || typeof options.proposeBranchMaxRn !== 'number') {
    throw new Error('deriveCounters: options.proposeBranchMaxRn (number) is required');
  }
  const { proposeBranchMaxRn } = options;

  // 按 hop 排序 + 同 hop 去重（保留首次出现的行）
  const seen = new Set();
  const rows = [...logRows]
    .sort((a, b) => a.hop - b.hop)
    .filter((r) => {
      if (seen.has(r.hop)) return false;
      seen.add(r.hop);
      return true;
    });

  const fixRound = rows.filter((r) => r.action === ACTION.SPAWN_GENERATOR_FIX).length;

  // ganRound：分支 rN 是唯一权威（外部真相）；proposer intent COUNT 只作交叉校验，
  // 不一致（崩溃窗口漏记 / 记了没派）一律取分支值，mismatch 信号由 loop 写进 appendHop detail。
  const proposerCount = rows.filter((r) => r.action === ACTION.SPAWN_PROPOSER).length;
  const ganRound = proposeBranchMaxRn;

  // Sprint 1b997ed6：pollCount 持久化推导（COUNT(action='wait:poll_ci') 去重后）
  const pollCount = rows.filter((r) => r.action === ACTION.WAIT_POLL_CI).length;

  // Sprint 1b997ed6：blockedStreak 持久化推导（尾部连续 blocked/needs_context 行）
  const blockedStreak = tailBlockedStreak(rows);

  return {
    hops: rows.length,
    fixRound,
    ganRound,
    noPushStreak: tailStreak(rows, ACTION.SPAWN_PROPOSER, 'propose_branch_advanced'),
    noVerdictStreak: tailStreak(rows, ACTION.SPAWN_REVIEWER, 'verdict_parsed'),
    crossCheckMismatch: proposerCount !== proposeBranchMaxRn,
    // Sprint 1b997ed6 新增：持久化计数
    pollCount,
    blockedStreak,
  };
}
