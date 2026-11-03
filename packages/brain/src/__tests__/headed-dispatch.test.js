/** 旧headed/headless relay已退役；新派发不得改凭据、工作区或会话。 */
import {describe,it,expect,vi} from 'vitest';
import {spawnSkillRelaySession,isSkillRelayTask,HEADED_HOSTS,HEADED_TMUX_PREFIXES} from '../harness-skill-relay.js';
describe('旧relay所有headed/headless新启动无条件退役',()=>{
 it.each([{}, {mode:'headed'}, {mode:'headless'}, {mode:'headed',executor:'codex'}, {mode:'headed',executor:'claude'}, {mode:'headed',executor:'grok'}, {mode:'headed',ssh_host:'administrator@host.docker.internal'}, {harness_runtime:'kernel-v1'}])('payload %j 不触碰旧执行现场',async payload=>{
  const effect=vi.fn();const result=await spawnSkillRelaySession({id:'historical',payload:{orchestrator:'skill-relay',...payload}},{pool:{query:effect},spawnFn:effect,sshSpawnFn:effect,execFn:effect,ensureWt:effect,loadSkill:effect,tokenFn:effect,env:{CECELIA_LOCAL_EXECUTION_ENABLED:'true'}});
  expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
 });
 it('历史会话识别信息保留，不能被用作新启动开关',()=>{
  expect(isSkillRelayTask({payload:{orchestrator:'skill-relay'}})).toBe(true);
  expect(isSkillRelayTask({payload:{}})).toBe(false);
  expect(HEADED_HOSTS.codex).toBe('skill-relay-codex-headed');expect(HEADED_TMUX_PREFIXES.codex).toBe('codex-relay-');
 });
});
