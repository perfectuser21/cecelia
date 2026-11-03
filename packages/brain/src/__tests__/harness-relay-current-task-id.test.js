/** 新run已退役，既有run身份字段由历史读回与迁移合同保留。 */
import {describe,it,expect,vi} from 'vitest';
import {spawnSkillRelaySession} from '../harness-skill-relay.js';
describe('旧relay不能再产生缺身份或任意身份的新run',()=>{
 it.each([{}, {current_task_id:'old',created_source:'legacy_relay'}])('旧身份%j不能恢复写路径',async input=>{
  const effect=vi.fn();const result=await spawnSkillRelaySession({id:'historical',...input,payload:{orchestrator:'skill-relay'}},{pool:{query:effect},spawnFn:effect,execFn:effect});expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
 });
});
