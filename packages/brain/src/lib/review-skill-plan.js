import { isDeepStrictEqual } from 'node:util';
import pool from '../db.js';
import { EXECUTOR_SKILL_MAP, REVIEW_SKILL_BINDING_TASK_TYPES } from './task-type-registry.js';
import { readSkillBindingsStrict } from './skill-binding-registry.js';
import { RETIRED_DECOMPOSITION } from './retired-decomposition.js';

// 只针对默认审查提示实际消费 skill 的两个任务类型。
const DEFAULT_REVIEW_SKILL_TYPES = new Set(REVIEW_SKILL_BINDING_TASK_TYPES);
const reviewSkillPlans = new WeakMap();

function isDefaultReviewSkillTask(task) {
  return DEFAULT_REVIEW_SKILL_TYPES.has(task?.task_type)
    && !task?.payload?.invocation && !task?.payload?.invocation_activity;
}

function freezeReviewSnapshot(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeReviewSnapshot(child);
  }
  return value;
}

function isRetiredResolvedSkill(skill) {
  // 与模板插值相同的强转，覆盖 JSON 单元素数组及旧拆解审核命令。
  return /^\s*\/decomp(?:-check)?(?=\s|$)/.test(String(skill));
}

export async function prepareReviewSkillDispatch(task) {
  if (!isDefaultReviewSkillTask(task)) return {blocked:false, task};
  const snapshot = structuredClone(task);
  const override=snapshot.payload?.skill_override;
  const skill = override !== undefined && override !== null ? override
    : (await readSkillBindingsStrict(pool)).get(snapshot.task_type) || EXECUTOR_SKILL_MAP[snapshot.task_type] || '/dev';
  if (isRetiredResolvedSkill(skill)) return {blocked:true, reason:RETIRED_DECOMPOSITION};
  freezeReviewSnapshot(snapshot);
  reviewSkillPlans.set(snapshot, skill);
  return {blocked:false, guarded:true, task:snapshot};
}

// 提示词必须由模块签发的同一快照消费一次，外部对象不能伪造已核验值。
export function consumeReviewSkill(task) {
  if (!reviewSkillPlans.has(task)) return {found:false};
  const skill=reviewSkillPlans.get(task);
  reviewSkillPlans.delete(task);
  return {found:true,skill};
}

// 手动派发在 claim 后重读完整 task；仅允许派发自身产生的状态字段变化。
export function transferReviewSkillPlan(prepared, current) {
  if (!reviewSkillPlans.has(prepared) || prepared.id !== current?.id
      || prepared.task_type !== current?.task_type
      || !isDeepStrictEqual(prepared.payload ?? {},current?.payload ?? {})) return null;
  // 签发后只允许本次认领/启动写入的字段变化；不得借同 ID 和 payload 伪造标题、正文或仓库。
  const changedByDispatch=new Set(['status','claimed_by','claimed_at','started_at','updated_at','dispatch_row_version','metadata']);
  for (const key of new Set([...Object.keys(prepared),...Object.keys(current)])) {
    if (!changedByDispatch.has(key) && !isDeepStrictEqual(prepared[key],current[key])) return null;
  }
  const metadata=prepared.metadata ?? {};
  const currentMetadata=current.metadata ?? {};
  if (!isDeepStrictEqual(metadata,currentMetadata)
      && !isDeepStrictEqual({...metadata,manually_dispatched:true},currentMetadata)) return null;
  if (current.status !== 'in_progress') return null;
  const snapshot=freezeReviewSnapshot(structuredClone(current));
  const skill=reviewSkillPlans.get(prepared);
  reviewSkillPlans.delete(prepared);
  reviewSkillPlans.set(snapshot,skill);
  return snapshot;
}
