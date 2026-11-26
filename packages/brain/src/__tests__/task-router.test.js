import {describe,it,expect} from 'vitest';
import {isValidTaskType} from '../task-router.js';
describe('任务路由器现役输入合同',()=>{
 it('认可现役开发与审查类型，拒绝退役或未知类型',()=>{
  for(const type of ['dev','codex_dev','review'])expect(isValidTaskType(type)).toBe(true);
  for(const type of ['coding_workflow','harness_planner','harness_initiative','unknown-task'])expect(isValidTaskType(type)).toBe(false);
 });
});
