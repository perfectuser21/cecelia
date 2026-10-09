/**
 * task-kind.js — 任务 kind（agent | workflow）与属性读取器。
 *
 * 决策 df67a9d6：任务只有两种 kind；department / skill（或 workflow_ref）/ engine / device
 * 都是属性。真身：kind 落 tasks.kind 真列（迁移 466），department 落 tasks.dept 真列，
 * 其余走 payload 规范键；历史 payload 键（qiumi_*、device_hint）由 resolveTaskAttributes
 * 的兼容链兜住，调用方不必知道哪一代写的。
 */
import { TASK_KINDS, KIND_FOR_TASK_TYPE, SKILL_WHITELIST } from './task-type-registry.js';

export { TASK_KINDS };

export function isTaskKind(value) {
  return typeof value === 'string' && TASK_KINDS.includes(value);
}

/** 非法值抛 code=invalid_task_kind（建单入口 400 / 存储层回滚都认这个 code）。 */
export function assertTaskKind(value) {
  if (!isTaskKind(value)) {
    const err = new Error(`invalid_task_kind: ${JSON.stringify(value)}，只认 ${TASK_KINDS.join(' | ')}`);
    err.code = 'invalid_task_kind';
    throw err;
  }
  return value;
}

/** 按 task_type 从注册表派生；未注册类型回落 agent（单步是缺省，与 Jev 判定的缺省一致）。 */
export function deriveTaskKind(taskType) {
  return KIND_FOR_TASK_TYPE[taskType] ?? 'agent';
}

const nonEmpty = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * 读一条任务行的 kind 与四个属性。链式取值：真列 → 规范 payload 键 → 历史键；取不到为 null。
 * @param {{task_type?:string, kind?:string, dept?:string, payload?:object}} task
 */
export function resolveTaskAttributes(task) {
  const p = task?.payload && typeof task.payload === 'object' ? task.payload : {};
  const route = p.qiumi_route && typeof p.qiumi_route === 'object' ? p.qiumi_route : {};
  return {
    kind: isTaskKind(task?.kind) ? task.kind : deriveTaskKind(task?.task_type),
    department: nonEmpty(task?.dept) ?? nonEmpty(p.department) ?? nonEmpty(p.qiumi_department),
    skill: nonEmpty(p.skill) ?? nonEmpty(SKILL_WHITELIST[task?.task_type]),
    workflow_ref: nonEmpty(p.workflow_ref) ?? nonEmpty(p.qiumi_workflow_ref),
    engine: nonEmpty(p.engine) ?? nonEmpty(route.answers?.engine?.choice),
    device: nonEmpty(p.serial) ?? nonEmpty(route.device_hint?.serial),
  };
}
