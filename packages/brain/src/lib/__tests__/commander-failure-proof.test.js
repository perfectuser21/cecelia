import { describe, it, expect } from 'vitest';
import { validateFailureProof } from '../commander-failure-proof.js';
import { digest } from '../commander-v2-contract.js';
const root='/Users/worker/wf-agent-runs/wfd-aaaaaaaa-1111-2222-3333-444444444444';
export function failureFixture(){
 const e={protocol:'commander-v2',task_id:'aaaaaaaa-1111-2222-3333-444444444444',run_id:root.split('/').at(-1),attempt:1,owner_epoch:'epoch',input:{title:'固定中文'},definition:{snapshot_sha256:'b'.repeat(64)},deadline_at:'2026-01-01T00:01:00Z',cleanup_deadline_at:'2026-01-01T00:06:00Z',contract:{resources:{device_serial:'SERIAL1',profile:'legacy',machine:'xian-m4'},recovery:{max_attempts:1,retry_safe:false}}};e.input_sha256=digest(e.input);
 const roots={run:{realpath:root,st_dev:1,st_ino:2},evidence:{realpath:root+'/evidence',st_dev:1,st_ino:3},commander:{realpath:'/Users/worker/.openclaw/commander',st_dev:1,st_ino:4}};
 const files=[{path:root+'/root-identity.json',sha256:'1'.repeat(64)},{path:root+'/cleanup-desktop.log',sha256:'2'.repeat(64)}];
 const cleanup={completed:true,failure:null,lock_status:'free',evidence:[files[1].path],_shell:{run_id:e.run_id,activity_key:'cleanup',attempt:1,started_at:'2026-01-01T00:02:00Z',ended_at:'2026-01-01T00:03:00Z',files}};
 const binding={task_id:e.task_id,run_id:e.run_id,nonce:'nonce',parent_session_key:'agent:work-commander:'+e.run_id,child_run_id:'11111111-2222-3333-4444-555555555555',child_session_key:'agent:skill-factory:subagent:22222222-3333-4444-5555-666666666666'};
 const task={id:e.task_id,status:'in_progress',task_type:'workflow_dispatch',payload:{commander_protocol:e.protocol},result:{workflow_control:{phase:'blocked',envelope:e}}};
 const identity={task_id:e.task_id,run_id:e.run_id,attempt:e.attempt,owner_epoch:e.owner_epoch,input_sha256:e.input_sha256,definition_sha256:e.definition.snapshot_sha256};
 const attestation={...identity,verdict:'PASS',scope:'cleanup_only',effects:'unknown',retry_safe:false,cleanup_sha256:'3'.repeat(64),files,review_actor:'codex:independent-review',reviewed_at:'2026-01-01T00:10:00Z',evidence:['actual:desktop-independent-review']};
 const verifier={id:'33333333-4444-5555-6666-777777777777',parent_task_id:e.task_id,status:'completed',claimed_by:attestation.review_actor,payload:{purpose:'commander_failed_reconciliation_cleanup',commander_failure_verification_of:identity},result:{commander_failure_verification:attestation}};
 const observation={run_directory:root,envelope:e,binding,request:{...binding,protocol:e.protocol,expires_at:Date.parse(e.deadline_at)/1000},worker_exclusive:true,nonce_closed:true,cleanup,cleanup_sha256:attestation.cleanup_sha256,files,roots,root_start:{matches:true,roots,observed_at:cleanup._shell.started_at},root_end:{matches:true,roots,observed_at:cleanup._shell.ended_at},current_roots:roots,terminal:{ok:true,toolName:'subagents',source:'core',output:{details:{status:'ok',action:'wait',reason:'completed',completed:[binding.child_run_id],attention:[],runs:[{runId:binding.child_run_id,sessionKey:binding.child_session_key,status:'terminal',startedAt:Date.parse('2026-01-01T00:00:00Z'),endedAt:Date.parse('2026-01-01T00:00:50Z'),outcome:{status:'error'}}]}}},session:{key:binding.child_session_key,hasActiveRun:false,activeRunIds:[],hasActiveSubagentRun:false},controller:{serial:'SERIAL1',profile:'legacy',host:'xian-m4',owner:'free',guard_exclusive:true}};
 return {task,verifier,observation,now:Date.parse('2026-01-01T00:12:00Z')};
}
describe('无delivery的原过期尝试只能由主动证据失败收口',()=>{
 it('接受真实原失败/预算内cleanup/独立签收，保unknown且不造delivery',()=>{const f=failureFixture();const p=validateFailureProof(f.task,f.verifier,f.observation,f.now);expect(p.effects).toBe('unknown');expect(p.retry_safe).toBe(false);expect(p).not.toHaveProperty('delivery');});
 const cases={
  '原child不符':f=>f.observation.terminal.output.details.runs[0].runId='other',
  '原session不符':f=>f.observation.terminal.output.details.runs[0].sessionKey='other',
  '终态失读':f=>f.observation.terminal.output.details.reason='timeout',
  '成功不是失败收口':f=>f.observation.terminal.output.details.runs[0].outcome.status='ok',
  '当前有活跃run':f=>f.observation.session.activeRunIds=['later'],
  'worker占锁':f=>f.observation.worker_exclusive=false,
  'controller占锁':f=>f.observation.controller.owner='other',
  'controllerguard忙':f=>f.observation.controller.guard_exclusive=false,
  'nonce未闭':f=>f.observation.nonce_closed=false,
  'cleanup过期':f=>f.observation.cleanup._shell.ended_at='2026-01-01T00:07:00Z',
  'cleanup未完成':f=>f.observation.cleanup.completed=false,
  'hash改动':f=>f.observation.files[1]={...f.observation.files[1],sha256:'4'.repeat(64)},
  '原件越界':f=>f.observation.files[1]={...f.observation.files[1],path:'/tmp/caller-file'},
  'root换代':f=>f.observation.current_roots={...f.observation.roots,run:{...f.observation.roots.run,st_ino:99}},
  '信封input换代':f=>f.observation.envelope={...f.observation.envelope,input:{title:'changed'}},
  '未独立完成':f=>f.verifier.status='in_progress',
  '核验任务错parent':f=>f.verifier.parent_task_id='other',
  '核验伪装业务成功':f=>f.verifier.result.commander_failure_verification.scope='business',
  '核验授予重试':f=>f.verifier.result.commander_failure_verification.retry_safe=true,
  '过预算之前禁止运维收口':f=>f.now=Date.parse('2026-01-01T00:05:00Z'),
 };
 for(const [name,mutate] of Object.entries(cases))it(name,()=>{const f=structuredClone(failureFixture());mutate(f);expect(()=>validateFailureProof(f.task,f.verifier,f.observation,f.now)).toThrow();});
});
