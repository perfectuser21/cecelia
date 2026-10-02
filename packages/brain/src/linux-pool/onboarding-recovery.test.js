import {it,expect,vi} from 'vitest';
import {createOnboardingRecovery} from './onboarding-recovery.js';
it('原验收不存在或已被明确撤销时，不读凭据、不退役授权、不重新验收',async()=>{
 for(const row of [undefined,{id:'runtime',state:'revoked',evidence_task_id:'evidence'}]){
  const readRuntime=vi.fn(),retire=vi.fn();let count=0;
  const query=vi.fn(async()=>({rows:++count===1?(row?[row]:[]):[{payload:{linux_runtime_revoked:true}}]}));
  const recover=createOnboardingRecovery({pool:{query},readRuntime,runtimeAuthorization:{retire}});
  await expect(recover('script','machine',{runtime_json:JSON.stringify({id:'runtime'})},{}))
   .rejects.toThrow(row?'linux_pool_explicitly_revoked':'linux_pool_stage_unconfirmed');
  expect(readRuntime).not.toHaveBeenCalled();expect(retire).not.toHaveBeenCalled();
 }
});
