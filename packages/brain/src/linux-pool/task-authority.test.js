import {LINUX_POOL_AUTHORITY} from './task-authority.js';
import {it,expect} from 'vitest';
import {routeWork} from '../work-router.js';
import {createRoutedTask} from '../work-routing-store.js';
import {isExternallyExecuted,EXECUTOR_CONTRACTS,VALID_EXECUTOR_KINDS} from '../executor-contracts.js';
const request={source:'scheduler',source_id:'linux-pool-onboarding:fixture',title:'Linux接入',requested_task_type:'audit',
 declared_domain:'operations',mutation_intent:'read_only',task:{executor_kind:'linux-pool-controller'},metadata:{linux_onboarding:{}}};
it('公开JSON与伪造actor不能铸造专属controller豁免',async()=>{
 for(const context of [{},{linuxPoolAuthority:'linux-pool-controller'}]){
  expect(()=>routeWork(request,[],context)).toThrow('linux_pool_task_authority_required');
  await expect(createRoutedTask({},request,[],context)).rejects.toThrow('linux_pool_task_authority_required');
 }
 expect(isExternallyExecuted({task_type:'audit',created_by:'linux-pool-onboarding',claimed_by:'linux-pool-onboarding',payload:request.metadata})).toBe(false);
});
it('持久专用kind交还controller，无本机PID或时间不能回收',async()=>{
 expect(isExternallyExecuted({task_type:'audit',executor_kind:'linux-pool-controller'})).toBe(true);
 expect(VALID_EXECUTOR_KINDS).toContain('linux-pool-controller');
 expect(EXECUTOR_CONTRACTS['linux-pool-controller']).toMatchObject({staleMinutes:null,onStale:'none'});
 expect(await EXECUTOR_CONTRACTS['linux-pool-controller'].probe({})).toBe('unknown');
});

it('私有Symbol仅允许固定audit操作合同，其他类型/来源拒绝',()=>{
 expect(routeWork(request,[],{linuxPoolAuthority:LINUX_POOL_AUTHORITY})).toMatchObject({work_kind:'operations',artifact_kind:'execution',canonical_task_type:'audit'});
 for(const delta of [{source:'api'},{requested_task_type:'dev'},{mutation_intent:'write'},{declared_domain:'coding'}]){
  expect(()=>routeWork({...request,...delta},[],{linuxPoolAuthority:LINUX_POOL_AUTHORITY})).toThrow('linux_pool_task_authority_required');
 }
});
