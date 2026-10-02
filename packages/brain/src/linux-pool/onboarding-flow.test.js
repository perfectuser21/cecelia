import {it,expect,vi} from 'vitest';
import {createLinuxOnboardingFlow} from './onboarding-flow.js';
import {US_SCHEDULER_ID} from './deployment.js';
it('observer、非Linux和US节点不登记执行任务，原请求observer不因metadata改变升权',async()=>{
 const createTask=vi.fn(),query=vi.fn(async()=>({rows:[{payload:{node_onboarding:{id:'machine',request:{name:'node',role:'observer'}}}}]}));
 const flow=createLinuxOnboardingFlow({pool:{query},createTask,step:async()=>{}});
 for(const machine of [{id:US_SCHEDULER_ID,metadata:{role:'worker',node_health:{os:'linux'}}},
  {id:'machine',metadata:{role:'observer',node_health:{os:'linux'}}},{id:'machine',metadata:{role:'worker',node_health:{os:'darwin'}}}]){
  expect(await flow.ensure(machine,'parent')).toBeNull();
 }
 expect(query).not.toHaveBeenCalled();
 expect(await flow.ensure({id:'machine',name:'node',metadata:{role:'worker',node_health:{os:'linux'}}},'parent',{query})).toBeNull();
 expect(createTask).not.toHaveBeenCalled();
});
