import { it, expect } from 'vitest';
import { sample } from './fixtures/commander-contract-v1.js';
import { makeEnvelope, digest } from '../commander-v2-contract.js';
function templateContract() {
  const contract = structuredClone(sample.contract);
  for (const action of contract.action_bindings) {
    action.key = '{{task_id}}:' + action.action + ':{{input.content_ref}}';
    action.object.task_id = '{{task_id}}';
    if (action.object.content_ref) action.object.content_ref = '{{input.content_ref}}';
    action.scope.content_ref = '{{input.content_ref}}';
  }
  return contract;
}
it('仅冻结的task/content模板派生外层动作绑定，原合同/输入不改hash', () => {
  const contract = templateContract(), before = digest(contract);
  const e = makeEnvelope(sample.task, sample.definition, contract, null);
  expect(e.action_bindings[0].key).toBe(`${sample.task.id}:publish:${e.input.content_ref}`);
  expect(e.action_bindings[0].object.task_id).toBe(sample.task.id);
  expect(e.action_bindings[0].scope.content_ref).toBe(e.input.content_ref);
  expect(digest(contract)).toBe(before); expect(digest(e.contract)).toBe(before);
});
it('错task的固定动作绑定、未批准模板及旧授权对象均拒绝，不自动重绑grant', () => {
  const fixed = structuredClone(sample.contract); fixed.action_bindings[0].object.task_id = 'old';
  expect(() => makeEnvelope(sample.task, sample.definition, fixed, null)).toThrow('动作');
  const unknown = templateContract(); unknown.action_bindings[0].key = '{{input.title}}';
  expect(() => makeEnvelope(sample.task, sample.definition, unknown, null)).toThrow('模板');
  const newTask = structuredClone(sample.task); newTask.id = '00000000-0000-4000-8000-000000000030';
  expect(() => makeEnvelope(newTask, sample.definition, templateContract(), null)).toThrow('授权');
});
