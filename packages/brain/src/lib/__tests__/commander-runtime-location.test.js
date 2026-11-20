import {it, expect, vi} from 'vitest';
import {statusCommander} from '../commander-v2-dispatch.js';
import {makeEnvelope} from '../commander-v2-contract.js';
import {activityBindings} from '../commander-v2-store.js';
import {runtimeRootFromRelease} from '../commander-runtime-location.js';
import {verificationRequest} from '../commander-v2-control.js';
const sha='a'.repeat(40), repo='perfectuser21/zenithjoy-workspace';
const root=`~/.local/share/zenithjoy/phone-candidates/${sha}/runtime/commander`;
const id='11111111-1111-4111-8111-111111111111';
const definition={release_id:id,workflow_id:'workflow',workflow_definition_version_id:'version',snapshot_sha256:'h',runtime_snapshot_sha256:'runtime',expected_path:[{reference_id:'ref',activity_id:'activity',activity_definition_version_id:'av'}]};
function fixture(environment=`staging:${sha}`,components=[{kind:'repo',repo,revision:sha},{kind:'code',repo,revision:sha,path:'runtime/file',digest:'fixed'}]) {
 const contract={key:'report',input_schema:{type:'object'},resources:{},recovery:{max_attempts:2,retry_safe:true,total_timeout_sec:1200,cleanup_timeout_sec:60}};
 const release={id,environment,payload:{components,workflows:[{id:'version',workflow_id:'workflow',payload_sha256:'h',payload:{key:'report',contract,activities:[{reference_id:'ref',activity_id:'activity',activity_version_id:'av',slot_key:'one'}]}}],activities:[{id:'av',activity_id:'activity',payload:{steps:[]}}]}};
 const task={id,status:'queued',payload:{commander_protocol:'commander-v2',workflow_key:'report',workflow_input:{},workflow_definition:definition,runtime_root:'/tmp/user-override',execution_location:{runtime_root:'/tmp/user-override'}}};
 const envelope=makeEnvelope(task,definition,contract);
 envelope.activity_bindings=activityBindings(definition,release);
 const execution_location={runtime_root:runtimeRootFromRelease(release),ssh_target:'worker',run_directory:`~/wf-agent-runs/${envelope.run_id}`};
 envelope.execution_location={...execution_location};
 return {envelope,execution_location,delivery:{outputs:{},evidence:[],effects:[],cleanup:{},status:'completed'}};
}
it('历史冻结release的status与verification同源且不采纳用户目录',async()=>{
 const control=fixture(),sent=control.envelope;
 expect(sent.execution_location).toEqual(control.execution_location);
 expect(control.execution_location).toMatchObject({runtime_root:root,ssh_target:'worker',run_directory:`~/wf-agent-runs/${sent.run_id}`});
 const sshProbe=vi.fn(async()=>JSON.stringify({execution_stopped:true}));
 await statusCommander(sent,{target:'changed-worker',sshProbe});
 expect(sshProbe.mock.calls[0][0].at(-2)).toBe('worker');
 expect(sshProbe.mock.calls[0][0].at(-1)).toBe(`${root}/wf-status.sh ${sent.run_id}`);
 const spec=verificationRequest({id},control);
 expect(spec.metadata.workflow_verification.execution_location.runtime_root).toBe(root);
 expect(spec.metadata.workflow_verification.runtime_helpers).toMatchObject({report:`${root}/wf-report.py`,commander:`${root}/wf-v2.py`});
});
for(const [name,environment,components] of [
 ['malformed environment','staging:../production',null],['short SHA','staging:abc',null],
 ['missing source',`staging:${sha}`,[]],['wrong repo',`staging:${sha}`,[{kind:'repo',repo:'evil/repo',revision:sha}]],
 ['mixed revision',`staging:${sha}`,[{kind:'repo',repo,revision:sha},{kind:'code',repo,revision:'b'.repeat(40)}]],
 ['duplicate repo',`staging:${sha}`,[{kind:'repo',repo,revision:sha},{kind:'repo',repo,revision:sha}]],
]) it(`${name}冻结来源拒绝，不回落生产`,()=>{
 expect(()=>fixture(environment,components??undefined)).toThrow();
});
it('历史生产路径与旧无runtime_root信封仍可读取状态',async()=>{
 const c=fixture('production');expect(c.execution_location.runtime_root).toBe('~/.openclaw/commander');
 const sshProbe=vi.fn(async()=>'{"execution_stopped":true}');
 await statusCommander({run_id:'wfd-1111'},{target:'worker',sshProbe});
 expect(sshProbe.mock.calls[0][0].at(-1)).toBe('~/.openclaw/commander/wf-status.sh wfd-1111');
});
for(const bad of ['/tmp/arbitrary','~/.openclaw/commander; touch /tmp/x',root+'/../other'])it(`冻结runtime路径白名单拒绝 ${bad}`,async()=>{
 const sshProbe=vi.fn();await expect(statusCommander({run_id:'wfd-1111',execution_location:{runtime_root:bad}},{sshProbe})).rejects.toThrow();expect(sshProbe).not.toHaveBeenCalled();
});
it('控制器位置与历史信封漂移时不能生成核验',()=>{
 const c=fixture();
 expect(()=>verificationRequest({id},{...c,execution_location:{...c.execution_location,runtime_root:'~/.openclaw/commander'}})).toThrow();
});

it('发布独立核验固定同SHA Skill包且不回落全局链接',async()=>{
 const c=fixture();c.envelope.workflow_key='douyin_video_publish.android';
 const spec=verificationRequest({id},{...c,delivery:{outputs:{}}});
 expect(spec.metadata.workflow_verification.runtime_helpers.publish_skill).toBe(`~/.local/share/zenithjoy/publish-releases/${sha}/.agents/skills/multi-platform-publish/SKILL.md`);
});
