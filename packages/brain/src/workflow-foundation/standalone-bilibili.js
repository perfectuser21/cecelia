import {createRoutedTask} from '../work-routing-store.js';
import {digest} from '../orchestrator/commander-decision.js';
import {getRelease} from '../lib/release-index.js';
import {getRunDefinitionBinding} from '../lib/run-definition-binding.js';
import {normalizeSpan,writeSpans} from '../lib/span-ingestion.js';
import {FOUNDATION_PROTOCOL,UUID,onlyKeys,requireFoundation} from './contracts.js';
import {foundationTransaction} from './registry.js';
import {resolveStandaloneRelease} from './standalone-release.js';
import {bilibiliVerificationSource as source} from './standalone-source.js';

const machine='xian-m4', operation='verify_existing';
const providerRepo='perfectuser21/zenithjoy-workspace';
const providerPath='services/phone-adb-controller/standalone-bilibili-verify.mjs';
const approved = Object.freeze({
  bvid:'BV1cLpG6cEHH',
  owner_uid:'3546824935738234',
  source_run_id:'rpa-white-bili-uid-693d858279ad',
  profile:'yueshengyun-work',
  serial:'e6c7ef34',
  title:'傍晚的颜色，慢一点也很好',
  duration_seconds:10,
  width:1080,
  height:2412,
});
const evidenceFiles=['account','author','detail','editor','settings','player'];
const hash=/^[a-f0-9]{64}$/;

export async function resolveBilibiliVerification(db,input) {
  const fixed=await resolveStandaloneRelease(db,input,source,{target:machine,machineId:machine});
  const {release,workflow}=fixed;
  const {environment}=release;
  const components=release.payload.components;
  const provider=components.find(component=>component.kind==='code'&&component.repo===providerRepo
    && component.path===providerPath && component.revision===workflow.source_commit
    && /^sha256:[a-f0-9]{64}$/.test(component.digest));
  requireFoundation((environment==='production'||environment==='staging:'+workflow.source_commit)
    && fixed.definition.observation_id===input.observation_id
    && components.some(component=>component.kind==='repo')
    && components.every(component=>component.repo===providerRepo&&component.revision===workflow.source_commit)
    && workflow.payload.contract?.source?.repo===providerRepo && /^[a-f0-9]{40}$/.test(workflow.source_commit)
    && workflow.payload.contract.runtime?.entrypoint===operation && workflow.payload.activities.length===1
    && workflow.payload.activities[0].slot_key===operation && fixed.definition.expected_path.length===1
    && provider,'bilibili_verification_release_invalid');
  const scope={...approved,workflow_key:source,operation,environment,source_commit:workflow.source_commit,limit:1};
  const skill={name:'android-bilibili-verify-existing',version:workflow.payload.contract.version,
    source_commit:workflow.source_commit,path:providerPath,sha256:provider.digest.slice(7)};
  requireFoundation(typeof skill.version==='string'&&skill.version.length>0,'bilibili_verification_release_invalid');
  return {...fixed,scope,skill};
}

export async function createBilibiliVerificationTask(pool,input) {
  onlyKeys(input,['workflow_id','release_id','observation_id','bvid']);
  requireFoundation([input.workflow_id,input.release_id,input.observation_id].every(value=>UUID.test(value??''))
    &&input.bvid===approved.bvid,'bilibili_verification_scope_invalid',400);
  const requestedRelease=await getRelease(pool,input.release_id);
  const sourceId='foundation:android-bilibili-verify-existing:'+approved.source_run_id+':'+requestedRelease.environment;
  const requestHash=digest(input);
  return foundationTransaction(pool,sourceId,async db=>{
    const existing=(await db.query("SELECT * FROM tasks WHERE payload#>>'{foundation_request,source_id}'=$1",[sourceId])).rows[0];
    if(existing){
      requireFoundation(existing.payload.foundation_request.request_sha256===requestHash,'foundation_idempotency_conflict');
      return {task:existing,created:false};
    }
    const fixed=await resolveBilibiliVerification(db,input);
    const {scope,skill,definition}=fixed;
    const metadata={source,execution_mode:'standalone-skill',commander_protocol:FOUNDATION_PROTOCOL,workflow_key:source,
      workflow_definition:definition,workflow_input:{scope,skill},scope,skill,
      foundation_request:{source_id:sourceId,request_sha256:requestHash,machine_id:machine}};
    const {task}=await createRoutedTask(db,{source:'api',source_id:sourceId,title:'B 站既有私密作品只读核验',
      description:'核验一条现有私密作品的本人归属、可见范围与播放。',
      requested_task_type:'workflow_dispatch',artifact_kind:'execution',mutation_intent:'none',metadata,
      task:{kind:'workflow',status:'queued',priority:'P2'}},null,{transaction:'existing'});
    requireFoundation(task?.id&&task.payload?.source===source,'foundation_task_registration_failed');
    return {task,created:true};
  });
}

export async function attestBilibiliVerification(pool,input) {
  onlyKeys(input,['machine_id','task_id','run_id','manifest','started_at','ended_at']);
  requireFoundation(input.machine_id===machine&&UUID.test(input.task_id??'')&&UUID.test(input.run_id??''),
    'bilibili_verification_scope_invalid',400);
  const started=Date.parse(input.started_at),ended=Date.parse(input.ended_at);
  requireFoundation(Number.isFinite(started)&&Number.isFinite(ended)&&started<=ended
    &&new Date(started).toISOString()===input.started_at&&new Date(ended).toISOString()===input.ended_at,
    'bilibili_verification_proof_invalid',400);
  const manifest=input.manifest;
  onlyKeys(manifest,['observation','files']);
  onlyKeys(manifest.files,evidenceFiles);
  for(const name of evidenceFiles){
    const file=manifest.files[name];
    onlyKeys(file,['path','sha256']);
    requireFoundation(file.path===name+(name==='player'?'.png':'.xml')&&hash.test(file.sha256??''),
      'bilibili_verification_proof_invalid',400);
  }
  const observation={protocol:'bilibili-verify-existing/v1',run_id:input.run_id,source_run_id:approved.source_run_id,
    owner:input.run_id,profile:approved.profile,serial:approved.serial,bvid:approved.bvid,owner_uid:approved.owner_uid,
    title:approved.title,visibility:'private',duration_seconds:approved.duration_seconds,outward_actions:0};
  requireFoundation(manifest.observation&&digest(manifest.observation)===digest(observation),'bilibili_verification_proof_invalid',400);
  const evidence='sha256:'+digest(manifest);
  return foundationTransaction(pool,'notion-standalone:'+machine,async db=>{
    const task=(await db.query("SELECT * FROM tasks WHERE id=$1 AND payload->>'source'=$2 FOR UPDATE",[input.task_id,source])).rows[0];
    const claim=task?.result?.standalone_claim;
    requireFoundation(task?.status==='in_progress'&&task.claimed_by==='standalone:'+machine
      && claim?.run_id===input.run_id&&claim.machine_id===machine,'standalone_claim_conflict');
    const run=(await db.query(`SELECT id,context,started_at FROM task_runs WHERE task_id=$1 AND run_id=$2
      AND status='running' AND ended_at IS NULL AND context->>'source'='standalone-skill' FOR UPDATE`,[task.id,input.run_id])).rows[0];
    requireFoundation(run&&digest(run.context.scope)===digest(task.payload.scope)
      && digest(run.context.skill)===digest(task.payload.skill),'standalone_run_unconfirmed');
    requireFoundation(started>=+new Date(run.started_at)-5000&&ended<=Date.now()+5000,'bilibili_verification_proof_invalid',400);
    const proof={run_id:input.run_id,task_run_id:run.id,evidence,manifest,started_at:input.started_at,ended_at:input.ended_at};
    const previous=task.result.bilibili_verification;
    requireFoundation(!previous||digest(previous)===digest(proof),'standalone_attestation_conflict');
    if(!previous){
      const {binding}=await getRunDefinitionBinding(db,input.run_id)??{};
      requireFoundation(binding?.task_run_id===run.id&&binding.source_kind==='internal'
        &&binding.actor===task.claimed_by&&binding.release_id===claim.release_id
        &&binding.expected_path?.length===1,'standalone_run_unconfirmed');
      const {activity_id,reference_id,activity_definition_version_id}=binding.expected_path[0];
      const span=normalizeSpan({identity_protocol:2,run_id:input.run_id,run_binding_id:binding.id,
        workflow_id:binding.workflow_id,workflow_definition_version_id:binding.workflow_definition_version_id,
        activity_id,activity_definition_version_id,reference_id,attempt_key:binding.attempt_key,
        occurrence_key:'bilibili-verify-existing',started_at:input.started_at,ended_at:input.ended_at,
        executor_kind:'code',executor_id:task.claimed_by,outcome:'pass',
        evidence:{runtime_snapshot_sha256:binding.payload.runtime_snapshot_sha256,manifest_sha256:evidence,bvid:approved.bvid}},0);
      await writeSpans(pool,[span],{transactionClient:db});
      await db.query("UPDATE tasks SET result=result||jsonb_build_object('bilibili_verification',$2::jsonb),updated_at=NOW() WHERE id=$1",
        [task.id,JSON.stringify(proof)]);
    }
    return {attested:true,evidence};
  });
}
