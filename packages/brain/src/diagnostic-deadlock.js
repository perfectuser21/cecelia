/**
 * diagnostic-deadlock.js
 *
 * Cortex Insight 修复（learning_id e8ecab79-68c7-4000-aac1-8230151c02a0）：
 * "诊断工具与被诊断工具共享 executor 时，诊断循环死锁是架构必然，
 * 需在 dispatch 层硬编码检测。"
 *
 * 死锁场景：
 *   code_review / arch_review / *_verify 等诊断类任务的 metadata 指向某个
 *   in_progress 的 dev / harness_initiative 任务（target）。当两者均路由到
 *   同一 executor location（如 'us' / cecelia-run），且 executor slot 有限时，
 *   诊断任务排在被诊断任务后面，被诊断任务又在等诊断完成 → 循环死锁。
 *
 * 解决：dispatch 入口前调 checkDiagnosticDeadlock()，4 项条件全中拒派。
 *   - selectNextDispatchableTask 已通过 task_dependencies 表硬边防护正向依赖；
 *     本模块补的是「诊断 → 被诊断」这一隐式反向引用（target_task_id metadata）。
 */

import pool from './db.js';
import { getTaskLocation } from './task-router.js';

/**
 * 诊断/审查/验收类 task type — 与被诊断对象共享 executor 时易死锁。
 *
 * 条件：必须是 LOCATION_MAP 中已存在的 task type，且语义为「读 + 评判」
 * 而非「写 + 产出」。新增诊断 task type 时同步加进来。
 */
export const DIAGNOSTIC_TASK_TYPES = new Set([
  'code_review',
  'code_review_gate',
  'arch_review',
  'prd_review',
  'spec_review',
  'decomp_review',
  'initiative_review',
  'initiative_verify',
  'audit',
  'pr_review',
  'review',
]);

/**
 * 检查待派发任务是否会触发诊断循环死锁。
 *
 * @param {Object} task - 待派发任务（需含 id / task_type / metadata）
 * @param {Object} [poolOverride] - 测试可注入 pool（默认用 ../db.js 单例）
 * @returns {Promise<{deadlock: boolean, reason?: string, target_task_id?: string, location?: string}>}
 */
export async function checkDiagnosticDeadlock(task, poolOverride = null) {
  if (!task || !DIAGNOSTIC_TASK_TYPES.has(task.task_type)) {
    return { deadlock: false };
  }

  const meta = task.metadata || {};
  const targetId = meta.target_task_id;
  if (!targetId) {
    return { deadlock: false };
  }

  const db = poolOverride || pool;
  const targetResult = await db.query(
    'SELECT id, status, task_type FROM tasks WHERE id = $1',
    [targetId]
  );
  if (targetResult.rows.length === 0) {
    return { deadlock: false };
  }

  const target = targetResult.rows[0];
  if (target.status !== 'in_progress') {
    return { deadlock: false };
  }

  const ownLocation = getTaskLocation(task.task_type);
  const targetLocation = getTaskLocation(target.task_type);
  if (ownLocation !== targetLocation) {
    return { deadlock: false };
  }

  return {
    deadlock: true,
    reason: 'diagnostic_deadlock_risk',
    target_task_id: target.id,
    location: ownLocation,
  };
}
