/**
 * S2 锚点执法闸（MJ5 刀2）
 *
 * 任务点火前校验 payload.anchor 是否携带承诺地图坐标。
 * 缺锚的新任务 → terminal failed，reason=missing_anchor。
 *
 * 豁免规则（PRD 判定点②：窄白名单）：
 *  1. task_type 在 ANCHOR_EXEMPT_TASK_TYPES 中（系统例行 / harness 子任务 / pipeline 片段）
 *  2. payload.action 在 ANCHOR_EXEMPT_ACTIONS 中（spike / hotfix_emergency / displacement）
 *  3. 存量任务：created_at < ANCHOR_LEGACY_CUTOFF（刀2上线前已存在的任务）
 */

import { ANCHOR_EXEMPT_TASK_TYPES as _ANCHOR_EXEMPT_TASK_TYPES } from './lib/task-type-registry.js';

// 系统例行任务和 harness/pipeline 子任务免锚（不依赖人工拍板的承诺地图）
export const ANCHOR_EXEMPT_TASK_TYPES = new Set(_ANCHOR_EXEMPT_TASK_TYPES);

// 特殊动作豁免语义（PRD §四）
export const ANCHOR_EXEMPT_ACTIONS = new Set([
  'spike',            // 探索性任务，结束后需补锚
  'hotfix_emergency', // 止血任务，24h 内必须补锚归位
  'displacement',     // 置换任务，锚=底座件 id
]);

// 存量豁免截止日（刀2 上线时刻，此前创建的任务走豁免期）
export const ANCHOR_LEGACY_CUTOFF = new Date('2026-07-17T10:00:00Z');

// 存量豁免按【日历日】判定（07-17 验火修正）：tasks.created_at 是无时区 timestamp
// （DB 会话时区 -05），node-pg 按本机时区解析会产生 13h 偏移——精确时刻比较会把
// 豁免窗拉长 13h。wall-clock 的日期部分跨时区解析不变形，用日界做豁免边界。
export const ANCHOR_LEGACY_CUTOFF_DAY = '2026-07-17';

function wallClockDay(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * 检查任务是否因缺锚而应被阻断。
 *
 * @param {Object} task - 任务行
 * @param {string} task.task_type
 * @param {Object} [task.payload]
 * @param {string} [task.created_at] - ISO 时间戳
 * @returns {{ blocked: boolean, reason?: string, detail?: string }}
 */
export function checkAnchor(task) {
  // 1. 豁免 task_type
  if (ANCHOR_EXEMPT_TASK_TYPES.has(task?.task_type)) {
    return { blocked: false };
  }

  // 2. 豁免 payload.action
  const action = task?.payload?.action;
  if (action && ANCHOR_EXEMPT_ACTIONS.has(action)) {
    return { blocked: false };
  }

  // 3. 存量豁免：刀2 上线【日】之前创建的任务不强制锚（判定点④：存量豁免+新任务强制；
  //    日历日边界防 naive timestamp 跨时区解析偏移，见 ANCHOR_LEGACY_CUTOFF_DAY 注释）
  const createdDay = task?.created_at ? wallClockDay(task.created_at) : null;
  if (createdDay && createdDay < ANCHOR_LEGACY_CUTOFF_DAY) {
    return { blocked: false };
  }

  // 4. 锚点检查：anchor 必须含 journey_id / gp_id / step_id 三字段
  const anchor = task?.payload?.anchor;
  if (!anchor || !anchor.journey_id || !anchor.gp_id || !anchor.step_id) {
    return {
      blocked: true,
      reason: 'missing_anchor',
      detail: 'S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火',
    };
  }

  return { blocked: false };
}
