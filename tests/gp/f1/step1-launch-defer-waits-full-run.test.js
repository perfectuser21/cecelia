/** 旧Kernel退役后，满槽/超时不能再把任务回队来重启。 */
import {describe,expect,it,vi} from 'vitest';
import {DEFAULT_KERNEL_LAUNCH_MAX_DEFERS,requeueKernelRunLaunchDeferred} from '../../../packages/brain/src/orchestrator/kernel-run-store.js';
describe('Kernel延迟重派已退役，保原占用与未决证据',()=>{
 it('历史上限常量仍可供旧记录解释',()=>{expect(DEFAULT_KERNEL_LAUNCH_MAX_DEFERS).toBeGreaterThanOrEqual(180);});
 it.each([0,1,179,300])('旧延迟计数%s不能重派或改写原任务',async count=>{
  const effect=vi.fn();await expect(requeueKernelRunLaunchDeferred({connect:effect,query:effect},{runId:'historical',expectedTaskId:'historical',maxDefers:count,reason:'orchestrator_slots_exhausted'})).rejects.toMatchObject({code:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
 });
});
