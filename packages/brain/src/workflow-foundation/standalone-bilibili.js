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
const playbackStep='verify_private_playback';
const playbackReadback={type:'metric',key:'private_playback_verified',expect:{op:'==',value:1}};
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
export const BILIBILI_VERIFY_BVID = approved.bvid;
const hash=/^[a-f0-9]{64}$/;

export async function resolveBilibiliVerification(db,input) {
  const fixed=await resolveStandaloneRelease(db,input,source,{target:machine,machineId:machine});
  const {release,workflow}=fixed;
  const {environment}=release;
  const components=release.payload.components;
  const reference=workflow.payload.activities[0];
  const activity=release.payload.activities.find(item=>item.id===reference?.activity_version_id
    && item.activity_id===reference.activity_id);
  const steps=activity?.payload.steps??[];
  const step=steps[0];
  const bindings=activity?.payload.implementation_bindings??[];
  const provider=bindings.find(binding=>binding.path===providerPath);
  const staging=environment==='staging:'+workflow.source_commit;
  const matchesRelease=bindings.every(binding=>{
    const rows=components.filter(component=>component.path===binding.path);
    return binding.kind==='code'&&binding.status==='verified'&&binding.repo===providerRepo
      && binding.revision===workflow.source_commit && /^sha256:[a-f0-9]{64}$/.test(binding.digest)
      && rows.length===1 && ['kind','repo','revision','digest'].every(key=>rows[0][key]===binding[key]);
  });
  requireFoundation((environment==='production'||staging)
    && fixed.definition.observation_id===input.observation_id
    && components.some(component=>component.kind==='repo'&&component.repo===providerRepo&&component.revision===workflow.source_commit)
    && components.every(component=>component.repo===providerRepo&&(staging||component.revision===workflow.source_commit))
    && matchesRelease
    && workflow.payload.contract?.source?.repo===providerRepo && /^[a-f0-9]{40}$/.test(workflow.source_commit)
    && workflow.payload.contract.runtime?.entrypoint===operation && workflow.payload.activities.length===1
    && reference.slot_key===operation && steps.length===1 && UUID.test(step?.step_id??'')
    && step.locator?.step_key===playbackStep && step.locator.activity_id===reference.activity_id
    && step.contract?.key===playbackStep && step.contract.dod?.mode==='hard'
    && step.registration?.id===step.step_id && step.registration.mode==='hard'
    && hash.test(step.registration.source_sha256??'')
    && digest(step.contract.dod.readback??null)===digest(playbackReadback)
    && digest(step.registration.readback??null)===digest(playbackReadback)
    && fixed.definition.expected_path.length===2 && fixed.definition.expected_path[1].step_id===step.step_id
    && provider,'bilibili_verification_release_invalid');
  const scope={...approved,workflow_key:source,operation,environment,source_commit:workflow.source_commit,step_id:step.step_id,limit:1};
  const skill={name:'android-bilibili-verify-existing',version:workflow.payload.contract.version,
    source_commit:workflow.source_commit,path:providerPath,sha256:provider.digest.slice(7)};
  requireFoundation(typeof skill.version==='string'&&skill.version.length>0,'bilibili_verification_release_invalid');
  return {...fixed,scope,skill};
}

export async function createBilibiliVerificationTask(pool,input,{notionPageId,notionTenantId}={}) {
  onlyKeys(input,['workflow_id','release_id','observation_id','bvid']);
  requireFoundation([input.workflow_id,input.release_id,input.observation_id].every(value=>UUID.test(value??''))
    &&input.bvid===approved.bvid,'bilibili_verification_scope_invalid',400);
  const fromNotion=notionPageId!==undefined||notionTenantId!==undefined;
  requireFoundation(!fromNotion||[notionPageId,notionTenantId].every(value=>UUID.test(value??'')),
    'foundation_notion_binding_invalid',400);
  const requestedRelease=await getRelease(pool,input.release_id);
  const sourceId='foundation:android-bilibili-verify-existing:'+approved.source_run_id+':'+requestedRelease.environment;
  const requestHash=digest(fromNotion?{...input,notionPageId,notionTenantId}:input);
  const taskKey=fromNotion?'foundation:notion:'+notionPageId:sourceId;
  return foundationTransaction(pool,taskKey,async db=>{
    if(fromNotion){
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,716))',[sourceId]);
      const previous=(await db.query("SELECT payload,tenant_id FROM tasks WHERE payload->>'notion_page_id'=$1 LIMIT 1",[notionPageId])).rows[0];
      requireFoundation(!previous||previous.payload.foundation_request?.source_id===sourceId,
        'foundation_idempotency_conflict');
    }
    const existing=(await db.query("SELECT * FROM tasks WHERE payload#>>'{foundation_request,source_id}'=$1",[sourceId])).rows[0];
    if(existing){
      requireFoundation(existing.payload.foundation_request.request_sha256===requestHash
        &&(!fromNotion||existing.payload.notion_page_id===notionPageId&&existing.tenant_id===notionTenantId),'foundation_idempotency_conflict');
      return {task:existing,created:false};
    }
    const fixed=await resolveBilibiliVerification(db,input);
    const {scope,skill,definition}=fixed;
    const metadata={source,execution_mode:'standalone-skill',commander_protocol:FOUNDATION_PROTOCOL,workflow_key:source,
      workflow_definition:definition,workflow_input:{scope,skill},scope,skill,
      ...(fromNotion?{notion_page_id:notionPageId,tenant_id:notionTenantId}:{}),
      foundation_request:{source_id:sourceId,request_sha256:requestHash,machine_id:machine}};
    const {task}=await createRoutedTask(db,{source:'api',source_id:sourceId,title:'B 站既有私密作品只读核验',
      description:'核验一条现有私密作品的本人归属、可见范围与播放。',
      requested_task_type:'workflow_dispatch',artifact_kind:'execution',mutation_intent:'none',metadata,
      task:{kind:'workflow',status:'queued',priority:'P2'}},null,{transaction:'existing'});
    requireFoundation(task?.id&&task.payload?.source===source,'foundation_task_registration_failed');
    if(fromNotion){
      const update=await db.query('UPDATE tasks SET tenant_id=$2 WHERE id=$1 RETURNING *',[task.id,notionTenantId]);
      requireFoundation(update.rowCount===1,'foundation_task_registration_failed');
      return {task:update.rows[0],created:true};
    }
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
        &&binding.expected_path?.length===2&&binding.expected_path[0].step_id===undefined
        &&binding.expected_path[1].step_id===task.payload.scope.step_id,'standalone_run_unconfirmed');
      const spans=binding.expected_path.map((entry,index)=>normalizeSpan({identity_protocol:2,
        run_id:input.run_id,run_binding_id:binding.id,
        workflow_id:binding.workflow_id,workflow_definition_version_id:binding.workflow_definition_version_id,
        activity_id:entry.activity_id,activity_definition_version_id:entry.activity_definition_version_id,
        reference_id:entry.reference_id,step_id:entry.step_id,attempt_key:binding.attempt_key,
        occurrence_key:entry.step_id?'bilibili-verify-private-playback':'bilibili-verify-existing',
        started_at:input.started_at,ended_at:input.ended_at,
        executor_kind:'code',executor_id:task.claimed_by,outcome:'pass',
        evidence:{runtime_snapshot_sha256:binding.payload.runtime_snapshot_sha256,manifest_sha256:evidence,
          artifact:'bilibili-existing/receipt.json',bvid:approved.bvid,...(entry.step_id?{observed:1}:{})}},index));
      await writeSpans(pool,spans,{transactionClient:db});
      await db.query("UPDATE tasks SET result=result||jsonb_build_object('bilibili_verification',$2::jsonb),updated_at=NOW() WHERE id=$1",
        [task.id,JSON.stringify(proof)]);
    }
    return {attested:true,evidence};
  });
}
