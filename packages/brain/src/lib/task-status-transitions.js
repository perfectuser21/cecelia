/**
 * task-status-transitions.js — 任务状态机的唯一真身。
 *
 * 为什么单独成一个模块：原先这张表内联在 `routes/tasks.js` 的 PATCH 处理里，
 * 只枚举了 8 个状态。生产实际用到 15 个——任何没枚举到的状态取到 `undefined`，
 * 被判否后以 `allowed: []` 返回，**和「设计上的终态」长得一模一样**。
 *
 * 2026-09-21 实测在押：blocked 287 / cancelled（双 L）1485 / archived 673 /
 * completed_no_pr 38 / quota_exhausted，共 2483 条活干完了写不回账本
 * （issue a4991491，当天第五次发作：任务 a70d7743 因 map_stale 判 blocked，
 * PR #5457 已合并，回写 completed 被 409 `allowed: []` 挡死）。
 *
 * 两条设计约束，由 __tests__/task-status-transitions.test.js 机械守住：
 *  ① 每个已知状态都必须有**显式**表项——终态也要写成 `[]`，
 *     绝不允许靠「查不到」默认成终态；
 *  ② 等待态必须有出边、且必须能直接回 `completed`。等待态是「等一等」不是「结局」。
 */

/**
 * 等待态：任务停在这里是在等外部条件，不是得出了结论。必须有出路。
 *
 * `canceled` / `cancelled` 两种拼写生产里都在用（1688 / 1485 条），
 * 谁也没法把历史数据改干净，所以两个都当一等公民认下来。
 */
export const WAITING_STATUSES = Object.freeze([
  'blocked',
  'quota_exhausted',
  'paused',
  'quarantined',
  'canceled',
  'cancelled',
  'dep_failed',
  'pending_postdeploy',
]);

/** 设计上的终态：到这里就是结论，不再回头。显式写出来，不靠"查不到"。 */
export const TERMINAL_STATUSES = Object.freeze([
  'completed',
  'completed_no_pr',
  'failed',
  'archived',
]);

/** 全部已知状态。新增状态必须同时进这里和 TRANSITIONS，否则守卫报红。 */
export const TASK_STATUSES = Object.freeze([
  'pending',
  'queued',
  'in_progress',
  ...WAITING_STATUSES,
  ...TERMINAL_STATUSES,
]);

/**
 * 等待态的公共出路：回队列、直接销账（含非产 PR 执行面的 completed_no_pr）、判死、或取消。
 * completed_no_pr 加入这里的原因见 task-type-registry.js 的 `pr: false`——
 * openclaw-agent 等执行面完成不产 PR，销账态就是 completed_no_pr，等待态也要能到达。
 */
const WAITING_EXITS = Object.freeze(['queued', 'in_progress', 'completed', 'completed_no_pr', 'failed', 'cancelled']);

export const TRANSITIONS = Object.freeze({
  pending: ['in_progress'],
  queued: ['in_progress'],
  in_progress: ['completed', 'completed_no_pr', 'failed'],

  // 等待态一律给同一组出路。逐个写出来而不是循环生成——这张表是给人看的，
  // 读的人要能一眼看出"blocked 能回 completed"，不该去脑补一个 spread。
  blocked: [...WAITING_EXITS],
  quota_exhausted: [...WAITING_EXITS],
  paused: [...WAITING_EXITS],
  quarantined: ['queued', 'completed', 'completed_no_pr', 'failed', 'cancelled'],
  canceled: ['queued', 'completed', 'completed_no_pr', 'failed', 'cancelled'],
  cancelled: ['queued', 'completed', 'completed_no_pr', 'failed', 'cancelled'],
  dep_failed: ['queued', 'completed', 'completed_no_pr', 'failed', 'cancelled'],
  pending_postdeploy: ['queued', 'completed', 'completed_no_pr', 'failed'],

  completed: [],
  completed_no_pr: [],
  failed: [],
  archived: [],
});

/**
 * 查某状态的出边。
 *
 * 关键在于把「这个状态是终态」和「我不认识这个状态」分开——
 * 前者返回 `{known:true, allowed:[]}`，后者返回 `{known:false, allowed:[]}`。
 * 0921 之前两者都只表现为 `allowed: []`，于是"漏枚举"永远伪装成"设计如此"。
 *
 * @param {string} current 当前状态
 * @returns {{known: boolean, allowed: string[], terminal: boolean}}
 */
export function resolveAllowedTransitions(current) {
  if (!Object.hasOwn(TRANSITIONS, current)) {
    return { known: false, allowed: [], terminal: false };
  }
  // `?? []` 不是多余：表被改坏（某状态值写成 undefined）时要落回"没有出边"，
  // 而不是在展开处抛 TypeError。崩溃会把调用方变成 500，把一个可诊断的
  // 409 变成一桩糊涂账；也会让守卫以"崩溃红"通过，掩盖断言其实没跑到。
  const allowed = TRANSITIONS[current] ?? [];
  return { known: true, allowed: [...allowed], terminal: allowed.length === 0 };
}
