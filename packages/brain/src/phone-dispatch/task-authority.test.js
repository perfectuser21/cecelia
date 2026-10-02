import {it,expect,vi} from 'vitest';
import {routeWork} from '../work-router.js';
import {createRoutedTask} from '../work-routing-store.js';
const input={source:'scheduler',source_id:'recurring:fixture:slot',title:'phone',requested_task_type:'device_job',declared_domain:'operations',mutation_intent:'none',metadata:{policy:'phone-schedule-v1',phone_authority:true},task:{status:'queued',executor_kind:'phone-ssh-controller',kind:'agent'}};
it('普通caller的executor/source/模板payload旗标不能取得phone建单权',async()=>{
 for(const context of [{},{phoneTaskAuthority:true},{phoneTaskAuthority:'phone-schedule-v1'}]){
  expect(()=>routeWork(input,[],context)).toThrow('phone_task_authority_required');
  const query=vi.fn();await expect(createRoutedTask({query},input,[],context)).rejects.toThrow('phone_task_authority_required');expect(query).not.toHaveBeenCalled();
 }
});
it('普通device_job即使payload带phone flag仍保留原非执行路由，不授内部authority',()=>{
 expect(routeWork({...input,task:{status:'queued',executor_kind:null}},[],{})).toMatchObject({canonical_task_type:'device_job'});
});
