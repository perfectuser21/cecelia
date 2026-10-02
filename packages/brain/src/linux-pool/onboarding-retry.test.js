import {it,expect} from 'vitest';
import {prepareFailedControllerRetry} from './onboarding-retry.js';
it('普通audit的伪造payload/created_by不构成误收恢复证据，缺原source时零查询',async()=>{
 let queries=0;const db={query:async()=>{queries++;throw Error('unexpected database');}};
 const task={id:'forged',task_type:'audit',status:'failed',claimed_by:null,created_by:'linux-pool-onboarding',
  error_message:'S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火',payload:{linux_onboarding:{phase:'script_prepare'}}};
 await expect(prepareFailedControllerRetry(db,task,null,{id:'machine'},'a'.repeat(40))).rejects.toMatchObject({message:'linux_pool_retry_unconfirmed',status:409});
 expect(queries).toBe(0);
});
