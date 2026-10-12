/** 工厂消费范围与环境配置：显式 verify-only，未知模式拒绝。 */
export const FACTORY_TASK_TYPE = 'skill_factory_run';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readDispatchMode(value = 'all') {
  if (!['all', 'verify-only'].includes(value)) throw new Error('invalid factory dispatch mode');
  return value;
}
export function isFactoryTask(t, mode) {
  readDispatchMode(mode);
  const p = t?.payload, f = p?.factory;
  if (p?.factory_dispatch !== true) return false;
  if (mode !== 'verify-only') return t.task_type === FACTORY_TASK_TYPE || t.task_type === 'research';
  return t.task_type === FACTORY_TASK_TYPE && f?.stage === 'verify'
    && p.skill === 'run-verify' && f.skill === 'run-verify'
    && typeof p.factory_verify_of === 'string' && UUID.test(p.factory_verify_of) && p.factory_verify_of !== t.id
    && typeof p.factory_verify_run_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(p.factory_verify_run_id);
}
export async function refreshEligibleTask(task, brain, mode) {
  readDispatchMode(mode);
  if (mode !== 'verify-only') return task;
  const current = await brain.getTask(task.id);
  return current?.id === task.id && current.status === 'queued' && isFactoryTask(current, mode) ? current : null;
}

export function envMinutes(name, fallbackMs) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v * 60_000 : fallbackMs;
}

