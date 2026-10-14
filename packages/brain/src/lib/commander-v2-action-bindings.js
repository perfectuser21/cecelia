/** 仅派生两个明示身份模板；不修改冻结合同或授权对象。 */
import { object, requireCommander, bounded } from './commander-v2-contract.js';
const token = /\{\{([^{}]+)\}\}/g;
const unresolved = value => typeof value === 'string' ? value.includes('{{') || value.includes('}}')
  : value && typeof value === 'object' ? Object.values(value).some(unresolved) : false;
function resolve(value, task, input, allowed) {
  if (typeof value !== 'string') return value;
  const output = value.replace(token, (_, key) => {
    requireCommander(allowed.includes(key), `动作模板不允许:${key}`);
    const resolved = key === 'task_id' ? task.id : input.content_ref;
    requireCommander(typeof resolved === 'string' && resolved.length > 0 && resolved.length <= 200, '动作模板输入缺失或超限');
    return resolved;
  });
  requireCommander(!output.includes('{{') && !output.includes('}}'), '动作模板格式无效'); return output;
}
export function resolveActionBindings(task, contract) {
  if (contract.action_bindings === undefined) return undefined;
  requireCommander(Array.isArray(contract.action_bindings), '冻结动作绑定缺数组');
  const input = task.payload.workflow_input, keys = new Set();
  return contract.action_bindings.map(raw => {
    requireCommander(object(raw) && object(raw.object) && object(raw.scope), '冻结动作对象或范围缺失');
    const action = structuredClone(raw);
    action.key = resolve(action.key, task, input, ['task_id', 'input.content_ref']);
    action.object.task_id = resolve(action.object.task_id, task, input, ['task_id']);
    if (action.object.content_ref !== undefined) action.object.content_ref = resolve(action.object.content_ref, task, input, ['input.content_ref']);
    if (action.scope.content_ref !== undefined) action.scope.content_ref = resolve(action.scope.content_ref, task, input, ['input.content_ref']);
    requireCommander(typeof action.key === 'string' && action.key.length > 0 && !keys.has(action.key)
      && action.object.task_id === task.id, '动作身份重复或对象任务不符');
    keys.add(action.key);
    requireCommander(!unresolved(action), '动作模板字段未批准');
    bounded(action, 30000, '动作绑定'); return action;
  });
}
