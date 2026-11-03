import {test,expect,vi} from 'vitest';
import {spawnSkillRelaySession} from '../harness-skill-relay.js';
test.each([{}, {allow_xian:true}, {executor:'codex',allow_xian:true}, {executor:'claude',allow_xian:true}])('xian旧relay无条件退役 %j',async(payload)=>{
 const effect=vi.fn();const result=await spawnSkillRelaySession({id:'historical',location:'xian',payload},{pool:{query:effect},bridgeFn:effect,spawnDockerDetached:effect,execFn:effect});
 expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
});
