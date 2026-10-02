import {expect,it} from 'vitest';
import {VALID_EXECUTOR_KINDS,EXECUTOR_CONTRACTS,isExternallyExecuted} from '../executor-contracts.js';
import {TASK_TYPE_REGISTRY} from '../lib/task-type-registry.js';
it('独立手机controller合同只由远端强回执收口，禁止时间判死',async()=>{
 expect(VALID_EXECUTOR_KINDS).toContain('phone-ssh-controller');
 const contract=EXECUTOR_CONTRACTS['phone-ssh-controller'];expect(contract).toMatchObject({staleMinutes:null,onStale:'none'});
 expect(await contract.probe({})).toBe('unknown');
 expect(TASK_TYPE_REGISTRY.device_job.tick_dispatchable).toBe(false);
 expect(isExternallyExecuted({task_type:'device_job',executor_kind:'phone-ssh-controller'})).toBe(true);
});
