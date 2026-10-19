/** 只证明旧尝试安全失败收口；不产生 delivery 或业务成功/重试授权。 */
import { isDeepStrictEqual as same } from 'node:util';
import { digest, requireCommander } from './commander-v2-contract.js';
const check=(ok,message)=>requireCommander(ok,`failure_reconciliation: ${message}`,409);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=v=>v instanceof Date?v.getTime():typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
export function failureIdentity(e){return {task_id:e.task_id,run_id:e.run_id,attempt:e.attempt,owner_epoch:e.owner_epoch,input_sha256:e.input_sha256,definition_snapshot_sha256:e.definition.snapshot_sha256};}
export function validateFailureProof(task,verifier,o,now=Date.now()){
 const c=task.result?.workflow_control,e=c?.envelope,a=verifier?.result?.commander_failure_verification;
 check(task.task_type==='workflow_dispatch'&&task.payload?.commander_protocol==='commander-v2'&&e?.protocol==='commander-v2'&&e.task_id===task.id,'原任务协议');
 check(now>=time(e.cleanup_deadline_at)&&time(e.deadline_at)<=time(e.cleanup_deadline_at),'原预算未终结');
 check(!c.delivery&&c.phase!=='final'&&task.status==='in_progress','非无delivery在途尝试');
 check(digest(e.input)===e.input_sha256&&same(o.envelope,e)&&same(o.original_input,e.input)&&same(o.original_contract,e.contract),'冻结信封');
 const identity=failureIdentity(e),auth=verifier?.result?.commander_failure_verification_authorization;
 const fixed=auth;
 check(verifier?.parent_task_id===task.id&&verifier.task_type==='research'&&verifier.status==='completed'&&verifier.payload?.publication_allowed===false&&verifier.payload.verified_task_id===task.id&&verifier.payload.verified_run_id===e.run_id&&verifier.payload.verified_attempt===e.attempt&&auth?.purpose==='commander_failed_reconciliation_cleanup'&&Object.entries(identity).every(([k,v])=>fixed[k]===v),'独审任务授权');
 check(a&&Object.entries(identity).every(([k,v])=>a[k]===v)&&a.verdict==='PASS'&&a.scope==='cleanup_only'&&a.effects==='unknown'&&a.retry_safe===false&&a.effects_safe_to_retry===undefined,'独审范围');
 check(typeof a.review_actor==='string'&&a.review_actor.startsWith('codex:')&&a.review_actor===verifier.payload?.independent_verifier&&a.review_actor===verifier.verification_lease?.claimer&&verifier.verification_lease.source==='claim'&&time(verifier.verification_lease.claimed_at)<=time(a.reviewed_at)&&a.review_actor!==task.claimed_by&&Array.isArray(a.evidence)&&a.evidence.length>0&&time(a.reviewed_at)<=now,'独审actor/证据');
 const root=o.run_directory;
 check(typeof root==='string'&&root.endsWith('/wf-agent-runs/'+e.run_id)&&root.startsWith('/')&&!root.includes('/../'),'原根目录');
 check(o.worker_exclusive===true&&o.nonce_closed===true,'worker/nonce仍开放');
 const runtime=o.runtime_files;
 check(runtime&&same(o.runtime_manifest?.files,runtime)&&o.runtime_manifest.protocol==='commander-v2'&&digest(runtime)===e.definition.runtime_snapshot_sha256&&o.runtime_manifest.runtime_snapshot_sha256===e.definition.runtime_snapshot_sha256,'原冻结runtime闭包');
 check(runtime['wf-v2.py']==='59645f9b3c798521d4fbefe4d3a20ef7d37fd721f102c25ceb1ec32e17a56a3c'&&o.legacy_branches_absent===true,'仅已审037预算守卫兼容');
 check(o.preflight?._shell?.run_id===e.run_id&&o.preflight._shell.activity_key==='preflight'&&o.preflight._shell.attempt===e.attempt&&o.preflight_state?.terminal===true&&o.preflight_state.error===null&&o.cleanup_state?.terminal===true&&o.cleanup_state.error===null,'原preflight/cleanup终态');
 const b=o.binding,r=o.request;
 check(b?.run_id===e.run_id&&b.task_id===task.id&&typeof b.nonce==='string'&&b.nonce.length>0&&b.parent_session_key==='agent:work-commander:'+e.run_id,'原binding');
 check(['run_id','task_id','nonce','parent_session_key'].every(k=>r?.[k]===b[k])&&r.protocol===e.protocol&&r.expires_at===time(e.deadline_at)/1000,'原request');
 check(/^[-a-f0-9]{36}$/.test(b.child_run_id??'')&&/^agent:skill-factory:subagent:[-a-f0-9]{36}$/.test(b.child_session_key??''),'child身份');
 const terminal=o.terminal,d=terminal?.output?.details,run=d?.runs?.[0];
 check(terminal?.ok===true&&terminal.toolName==='subagents'&&terminal.source==='core'&&d?.status==='ok'&&d.action==='wait'&&d.reason==='completed'&&same(d.completed,[b.child_run_id])&&same(d.attention,[])&&(!d.unavailable||same(d.unavailable,[]))&&d.runs.length===1,'官方持久终态');
 check(run.runId===b.child_run_id&&run.sessionKey===b.child_session_key&&run.status==='terminal'&&['error','timeout','aborted'].includes(run.outcome?.status),'原child确实失败');
 check([run.startedAt,run.endedAt].every(v=>typeof v==='number'&&Number.isFinite(v))&&run.startedAt>0&&run.startedAt<=run.endedAt&&run.endedAt<=time(e.cleanup_deadline_at),'原失败时间');
 const s=o.session;
 check(s?.key===b.child_session_key&&s.hasActiveRun===false&&same(s.activeRunIds,[])&&s.hasActiveSubagentRun===false,'原session仍active或失读');
 const resources=e.contract.resources;
 check(resources&&o.controller?.host===resources.machine&&o.controller.profile===resources.profile&&o.controller.serial===resources.device_serial&&o.controller.owner==='free'&&o.controller.guard_exclusive===true,'controller实际锁');
 const cleanup=o.cleanup,shell=cleanup?._shell;
 check(cleanup?.completed===true&&cleanup.failure===null&&cleanup.lock_status==='free'&&shell?.run_id===e.run_id&&shell.activity_key==='cleanup'&&shell.attempt===e.attempt,'原cleanup身份');
 check(run.endedAt<=time(shell.started_at)&&time(shell.started_at)<=time(shell.ended_at)&&time(shell.ended_at)<=time(e.cleanup_deadline_at),'原cleanup时限');
 check(same(o.roots,o.current_roots)&&o.root_start?.matches===true&&o.root_end?.matches===true&&same(o.root_start.roots,o.roots)&&same(o.root_end.roots,o.roots)&&o.roots.run.realpath===root&&o.roots.evidence.realpath===root+'/evidence','原roots');
 check(time(a.reviewed_at)>=time(shell.ended_at),'独审早于原清理完成');
 check(time(o.root_start.observed_at)>=time(shell.started_at)&&time(o.root_start.observed_at)<=time(o.root_end.observed_at)&&time(o.root_end.observed_at)<=time(shell.ended_at),'原root采样时限');
 check(sha(o.cleanup_sha256)&&o.cleanup_sha256===a.cleanup_sha256&&same(o.files,shell.files)&&same(o.files,a.files)&&o.files.length>0&&o.files.length<=200,'全引用摘要');
 const paths=new Set();
 for(const f of o.files){check(f&&sha(f.sha256)&&typeof f.path==='string'&&f.path.startsWith(root+'/')&&!f.path.slice(root.length+1).split('/').some(p=>['','..','.'].includes(p))&&!paths.has(f.path),'引用越界/重复');paths.add(f.path);}
 check(Array.isArray(cleanup.evidence)&&cleanup.evidence.length>0&&cleanup.evidence.every(p=>paths.has(p))&&paths.has(root+'/root-identity.json'),'cleanup证据未覆盖');
 return {schema_version:1,...identity,verdict:'FAIL',effects:'unknown',retry_safe:false,verification_task_id:verifier.id,attestation_sha256:digest(a),cleanup_sha256:o.cleanup_sha256,files:o.files,terminal_sha256:digest(terminal),binding_sha256:digest(b),runtime_snapshot_sha256:e.definition.runtime_snapshot_sha256,runtime_files:structuredClone(runtime),original_child:{run_id:b.child_run_id,session_key:b.child_session_key,status:run.outcome.status,started_at:run.startedAt,ended_at:run.endedAt}};
}
