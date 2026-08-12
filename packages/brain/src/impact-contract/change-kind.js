/**
 * change-kind.js — Change Normalizer（FR-1）
 *
 * 将任务变更语义归一为四类。change_kind 与 gear 执行强度严格分离：
 * - change_kind：描述"这次变更在语义上属于哪一类"（新能力/能力变更/缺陷修复/参数调整）
 * - gear：描述"这次执行走哪个档位"（default/hotfix/segmented）
 * 两者独立计算、独立存储，禁止互相赋值或互相推导。
 *
 * sprint: 08110022-relay-d96c9fa0 ws1
 */

/** 四档 change_kind 枚举（规范值） */
export const CHANGE_KINDS = Object.freeze([
  'new_capability',
  'capability_change',
  'bugfix',
  'parameter_only',
]);

/**
 * task_type → change_kind 默认映射表。
 * 当调用方未显式指定 change_kind 时，从 task_type 自动推导。
 */
const TASK_TYPE_MAP = {
  // 新功能类
  new_feature: 'new_capability',
  harness_initiative: 'new_capability',
  golden_path_proposal: 'new_capability',

  // 增强/变更类
  enhancement: 'capability_change',
  dev: 'capability_change',
  harness_task: 'capability_change',
  harness_generate: 'capability_change',
  harness_fix: 'capability_change',
  scope_plan: 'capability_change',

  // 缺陷修复类
  bugfix: 'bugfix',
  hotfix: 'bugfix',
  sprint_fix: 'bugfix',

  // 参数/配置类
  config_change: 'parameter_only',
  configuration: 'parameter_only',
};

/**
 * 旧值兼容映射（仅在入口层使用，落库统一使用规范值）。
 * 覆盖 harness-skill-relay.js 中 deriveReviewRequired() 里用的旧枚举。
 */
const LEGACY_MAP = {
  fix: 'bugfix',
  thicken: 'capability_change',
  small: 'parameter_only',
  enhancement: 'capability_change',
  new_feature: 'new_capability',
};

/**
 * normalizeChangeKind(value) — 规范化显式传入的 change_kind 值。
 *
 * - null / undefined → null（调用方可继续用 task_type 推导）
 * - 已在 CHANGE_KINDS 中 → 原值透传
 * - 在 LEGACY_MAP 中 → 映射到规范值
 * - 空字符串 → throw（拒绝空值）
 * - 其余非法值 → throw
 *
 * 注意：此函数只处理「显式 change_kind 字段」的归一化。
 * 从 task_type 推导请用 deriveChangeKindFromTaskType()。
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
export function normalizeChangeKind(value) {
  if (value === null || value === undefined) return null;
  if (value === '') {
    throw new Error(`invalid_change_kind: empty string is not allowed. Allowed: ${CHANGE_KINDS.join(', ')}`);
  }
  if (CHANGE_KINDS.includes(value)) return value;
  if (LEGACY_MAP[value]) return LEGACY_MAP[value];
  throw new Error(`invalid_change_kind: "${value}". Allowed: ${CHANGE_KINDS.join(', ')}`);
}

/**
 * deriveChangeKindFromTaskType(taskType) — 从 task_type 推导 change_kind。
 *
 * - taskType 在映射表中 → 返回对应规范值
 * - taskType 不在映射表中（含 undefined/null）→ 返回 null（由上层决定如何处理）
 *
 * @param {string|null|undefined} taskType
 * @returns {string|null}
 */
export function deriveChangeKindFromTaskType(taskType) {
  if (!taskType) return null;
  return TASK_TYPE_MAP[taskType] ?? null;
}

/**
 * resolveChangeKind({ change_kind, task_type }) — 统一入口：
 * 先取显式 change_kind，归一化；若无则从 task_type 推导。
 *
 * 返回规范化后的 change_kind 字符串，或 null（若两者都无法确定）。
 *
 * 注意：
 * - 此函数绝不读取或修改 gear 字段
 * - gear 字段由 deriveGear()（harness-skill-relay.js）独立处理
 *
 * @param {{ change_kind?: string|null, task_type?: string|null }} params
 * @returns {string|null}
 */
export function resolveChangeKind({ change_kind, task_type } = {}) {
  // 显式 change_kind 优先（归一化处理，非法值 throw）
  const normalized = normalizeChangeKind(change_kind);
  if (normalized !== null) return normalized;

  // 无显式值则从 task_type 推导
  return deriveChangeKindFromTaskType(task_type);
}
