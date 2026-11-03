import {describe,expect,it,vi} from 'vitest';
import {createKernelRun} from '../kernel-run-store.js';
import {fixture} from './recovery-rebase.fixture.js';
describe('Kernel再基/目标冻结新运行已退役',()=>{
 it.each([{}, {phase:'planning'}, {phase:'generate'}, {recoveryRebase:null}, {recoveryRebase:{execution_target:{machine:'xian-mac-m4',provider:'codex',account:'team2'}}}, {recoveryRebase:{expected_profile_hash:['a'.repeat(64)]}}, {recoveryRebase:{expected_profile_hash:123}}, {predecessorRunId:'another-task'}, {createdSource:'planner_recovery'}])('输入%j不改前任run/收据或账号，不新增执行权',async override=>{
  const f=fixture();const connect=vi.fn(f.pool.connect);await expect(createKernelRun({...f.pool,connect},{...f.input,...override},f.deps)).rejects.toMatchObject({code:'kernel_runtime_retired'});expect(f.calls).toEqual([]);expect(connect).not.toHaveBeenCalled();
 });
});
