/** 旧三provider有头relay均已退役；不再生成launcher命令。 */
import {describe,it,expect,vi} from 'vitest';
import {spawnSkillRelaySession} from '../../../packages/brain/src/harness-skill-relay.js';
describe('旧三provider relay新启动拒绝',()=>{
 it.each(['codex','grok','claude','unknown',undefined])('executor %s 不触及launcher或执行现场',async executor=>{
  const effect=vi.fn();const result=await spawnSkillRelaySession({id:'old',payload:{executor,mode:'headed',orchestrator:'skill-relay'}},{execFn:effect,sshSpawnFn:effect,spawnFn:effect,loadSkill:effect,ensureWt:effect,pool:{query:effect}});
  expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
 });
});
