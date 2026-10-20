import {it, expect, vi} from 'vitest';
import {prepareCommander, readyCommander, statusCommander, launchCommander} from '../commander-v2-dispatch.js';
import {verificationRequest} from '../commander-v2-control.js';
const sha='a'.repeat(40), repo='perfectuser21/zenithjoy-workspace';
const root=`~/.local/share/zenithjoy/phone-candidates/${sha}/runtime/commander`;
const id='11111111-1111-4111-8111-111111111111';
const definition={release_id:id,workflow_id:'workflow',workflow_definition_version_id:'version',snapshot_sha256:'h',runtime_snapshot_sha256:'runtime',expected_path:[{reference_id:'ref',activity_id:'activity',activity_definition_version_id:'av'}]};
function fixture(environment=`staging:${sha}`,components=[{kind:'repo',repo,revision:sha},{kind:'code',repo,revision:sha,path:'runtime/file',digest:'fixed'}]) {
 const contract={key:'report',input_schema:{type:'object'},resources:{},recovery:{max_attempts:2,retry_safe:true,total_timeout_sec:1200,cleanup_timeout_sec:60}};
 const release={id,environment,payload:{components,workflows:[{id:'version',workflow_id:'workflow',payload_sha256:'h',payload:{key:'report',contract,activities:[{reference_id:'ref',activity_id:'activity',activity_version_id:'av',slot_key:'one'}]}}],activities:[{id:'av',activity_id:'activity',payload:{steps:[]}}]}};
 const task={id,status:'queued',payload:{commander_protocol:'commander-v2',workflow_key:'report',workflow_input:{},workflow_definition:definition,runtime_root:'/tmp/user-override',execution_location:{runtime_root:'/tmp/user-override'}}};
 const db={release(){},query:vi.fn(async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM tasks')) return {rows:[task]};
  if(sql.startsWith('SELECT * FROM release_versions')) return {rows:[release]};
  if(sql.startsWith('UPDATE tasks SET result=')) task.result={workflow_control:JSON.parse(args[1])};
  if(sql.startsWith("UPDATE tasks SET status='in_progress'"))task.status='in_progress';
  return {rows:[]};
 })};
 const sshDispatch=vi.fn(async(args)=>args.at(-1).endsWith('--ready')?JSON.stringify({protocol:'commander-v2',ready:true,...definition}):'DISPATCHED');
 return {task,release,db,pool:{connect:async()=>db},deps:{target:'worker',sshDispatch,startRun:vi.fn(),setLease:vi.fn()}};
}
it('冻结release决定candidate runtime，ready/launch/status/verification同源且不采纳用户目录',async()=>{
 const f=fixture();const control=await prepareCommander(f.pool,id,f.deps);
 expect(f.deps.sshDispatch.mock.calls[0][0].at(-1)).toBe(`${root}/wf-launch.sh --ready`);
 expect(control.envelope.execution_location).toEqual(control.execution_location);
 expect(control.execution_location).toMatchObject({runtime_root:root,ssh_target:'worker',run_directory:`~/wf-agent-runs/${control.envelope.run_id}`});
 await launchCommander(f.pool,id,f.deps);
 const sent=JSON.parse(f.deps.sshDispatch.mock.calls.at(-1)[1]);expect(sent.execution_location.runtime_root).toBe(root);
 const sshProbe=vi.fn(async()=>JSON.stringify({execution_stopped:true}));
 await statusCommander(sent,{target:'changed-worker',sshProbe});
 expect(sshProbe.mock.calls[0][0].at(-2)).toBe('worker');
 expect(sshProbe.mock.calls[0][0].at(-1)).toBe(`${root}/wf-status.sh ${sent.run_id}`);
 const spec=verificationRequest({id},{...control,delivery:{outputs:{},evidence:[],effects:[],cleanup:{}}});
 expect(spec.metadata.workflow_verification.execution_location.runtime_root).toBe(root);
 expect(spec.metadata.workflow_verification.runtime_helpers).toMatchObject({report:`${root}/wf-report.py`,commander:`${root}/wf-v2.py`});
});
for(const [name,environment,components] of [
 ['malformed environment','staging:../production',null],['short SHA','staging:abc',null],
 ['missing source',`staging:${sha}`,[]],['wrong repo',`staging:${sha}`,[{kind:'repo',repo:'evil/repo',revision:sha}]],
 ['mixed revision',`staging:${sha}`,[{kind:'repo',repo,revision:sha},{kind:'code',repo,revision:'b'.repeat(40)}]],
 ['duplicate repo',`staging:${sha}`,[{kind:'repo',repo,revision:sha},{kind:'repo',repo,revision:sha}]],
]) it(`${name}拒绝且零SSH/起跑，不回落生产`,async()=>{
 const f=fixture(environment,components??undefined);
 await expect(prepareCommander(f.pool,id,f.deps)).rejects.toThrow();
 expect(f.deps.sshDispatch).not.toHaveBeenCalled();expect(f.deps.startRun).not.toHaveBeenCalled();
});
it('正常生产路径保持，旧无runtime_root信封兼容',async()=>{
 const f=fixture('production');const c=await prepareCommander(f.pool,id,f.deps);
 expect(c.execution_location.runtime_root).toBe('~/.openclaw/commander');
 const sshDispatch=vi.fn(async()=>'{"ready":true}');await readyCommander({definition,workflow_key:'report'},{target:'worker',sshDispatch});
 expect(sshDispatch.mock.calls[0][0].at(-1)).toBe('~/.openclaw/commander/wf-launch.sh --ready');
});
for(const bad of ['/tmp/arbitrary','~/.openclaw/commander; touch /tmp/x',root+'/../other'])it(`冻结runtime路径白名单拒绝 ${bad}`,async()=>{
 const sshDispatch=vi.fn();await expect(readyCommander({definition,execution_location:{runtime_root:bad}},{sshDispatch})).rejects.toThrow();expect(sshDispatch).not.toHaveBeenCalled();
});
it('候选ready失败仅失败，不再探测生产',async()=>{
 const f=fixture();f.deps.sshDispatch.mockRejectedValue(Error('candidate missing'));
 await expect(prepareCommander(f.pool,id,f.deps)).rejects.toThrow('candidate missing');
 expect(f.deps.sshDispatch).toHaveBeenCalledTimes(1);expect(f.deps.sshDispatch.mock.calls[0][0].at(-1)).toContain(root);
});
it('恢复复用冻结候选，控制器位置与信封漂移时不能生成核验',async()=>{
 const f=fixture();const c=await prepareCommander(f.pool,id,f.deps);
 f.task.result.workflow_control.phase='recovering';
 const recovered=await prepareCommander(f.pool,id,f.deps);
 expect(recovered.envelope.attempt).toBe(2);expect(recovered.envelope.execution_location.runtime_root).toBe(root);
 expect(()=>verificationRequest({id},{...c,execution_location:{...c.execution_location,runtime_root:'~/.openclaw/commander'},delivery:{outputs:{}}})).toThrow();
});

it('发布独立核验固定同SHA Skill包且不回落全局链接',async()=>{
 const f=fixture();const c=await prepareCommander(f.pool,id,f.deps);c.envelope.workflow_key='douyin_video_publish.android';
 const spec=verificationRequest({id},{...c,delivery:{outputs:{}}});
 expect(spec.metadata.workflow_verification.runtime_helpers.publish_skill).toBe(`~/.local/share/zenithjoy/publish-releases/${sha}/.agents/skills/multi-platform-publish/SKILL.md`);
});
