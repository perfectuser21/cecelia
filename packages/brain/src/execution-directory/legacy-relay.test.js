import { it,expect,vi } from 'vitest';
vi.mock('../db.js',()=>({default:{query:vi.fn(async()=>({rows:[]}))}}));
vi.mock('../runtime-safety.js',()=>({assertExternalExecutionAllowed:()=>{}}));
import { spawnSkillRelaySession } from '../harness-skill-relay.js';
const task={id:'11111111-1111-4111-8111-111111111111',title:'legacy relay',payload:{orchestrator:'skill-relay',sprint_dir:'sprints/existing'}};
function deps(){return {env:{CECELIA_LOCAL_EXECUTION_ENABLED:'true'},pool:{query:vi.fn(async()=>({rows:[]}))},execFn:vi.fn(()=>''),loadSkill:()=>'',ensureWt:vi.fn(async()=>'/tmp/test-worktree'),spawnFn:vi.fn(),sshSpawnFn:vi.fn(),resolveAccountFn:async opts=>{opts.env.CECELIA_CREDENTIALS='account1';},tokenFn:async()=>'',snapshotCodexHome:()=>'/tmp/credential-snapshot'};}
it.each(['headless','headed'])('legacy-relay %s没有受信宿主/账号绑定，启动前拒绝且不借Harness授权',async mode=>{
 const d=deps();const result=await spawnSkillRelaySession({...task,payload:{...task.payload,executor:'claude',mode}},d);
 expect(result.ok).toBe(false);expect(result.error).toContain('execution_legacy_identity_required');
 expect(d.spawnFn).not.toHaveBeenCalled();expect(d.sshSpawnFn).not.toHaveBeenCalled();
});
it('旧headed session只探活，不被新启动授权撤销影响',async()=>{
 const d=deps();d.execFn.mockReturnValue('TMUX_ALIVE');
 const result=await spawnSkillRelaySession({...task,payload:{...task.payload,executor:'claude',mode:'headed'}},d);
 expect(result.reason).toBe('live_tmux_guard');expect(d.sshSpawnFn).not.toHaveBeenCalled();
});
