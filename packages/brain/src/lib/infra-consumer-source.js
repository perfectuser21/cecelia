import {readFileSync} from 'node:fs';
/** 现有infra定时作业桶的来源片段；不是可执行Workflow。 */
import {createHash} from 'node:crypto';
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
import {appendConsumerEvidence,assertConsumerScratch,withConsumerEvidenceTransaction,consumerFailure as fail} from './consumer-evidence-store.js';
export const INFRA_CONSUMER_SCOPE='cecelia-infra';
export const INFRA_CONSUMER_REPO='perfectuser21/cecelia';
export const INFRA_CONSUMER_IDENTITY=Object.freeze({workflow_id:'f03b16c6-b3b8-4a43-8bf0-4da878660c38',workflow_key:'infra_cleanup_capacity_ops',capability_id:'55cb3b8d-200c-445f-9467-616498b40521',root:'2d22d890-dbab-441b-a602-2727de668aaf',skill_id:'03770894-5ac3-4eb7-ae44-5a3e15951d99',slot_key:'janitor_frequent_orphan_reconciliation'});
export const INFRA_CONSUMER_PATHS=Object.freeze(['scripts/ops/janitor.sh','scripts/ops/janitor-effects.sh','scripts/ops/__tests__/janitor/janitor_resident_service_exempt.test.sh','scripts/ops/__tests__/janitor/janitor_kill_exempt.test.sh']);
const I=INFRA_CONSUMER_IDENTITY,SHA=/^[a-f0-9]{40}$/;
const infraRuntime=['infra-consumer-source.js','infra-consumer-snapshot.js','consumer-evidence-store.js'].map(name=>({path:`packages/brain/src/lib/${name}`,sha256:createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex')}));
export async function assertInfraConsumerRuntime(readSource){
 for(const file of infraRuntime){const text=await readSource(file.path);if(typeof text!=='string'||createHash('sha256').update(text).digest('hex')!==file.sha256)throw fail('INFRA_SOURCE_RUNTIME_MISMATCH');}
}
const digest=x=>stepSha256(JSON.parse(JSON.stringify(x)));
export function validateInfraQuery(q){
 if(q?.scope!==INFRA_CONSUMER_SCOPE||q.repo!==INFRA_CONSUMER_REPO||!SHA.test(q.revision||''))throw fail('INFRA_SOURCE_INPUT_INVALID');return q;
}
export async function readInfraConsumerRegistry(db){
 const workflows=(await db.query('SELECT * FROM workflows WHERE id=$1 ORDER BY id',[I.workflow_id])).rows;
 const references=(await db.query('SELECT * FROM workflow_activity_refs WHERE workflow_id=$1 ORDER BY id',[I.workflow_id])).rows;
 const ids=[...new Set(references.map(r=>r.activity_id))];
 const activities=(await db.query('SELECT * FROM activities WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
 const steps=(await db.query('SELECT * FROM steps WHERE activity_id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
 const capabilities=(await db.query('SELECT * FROM capabilities WHERE id=$1 ORDER BY id',[I.capability_id])).rows;
 const value_streams=(await db.query('SELECT * FROM value_streams WHERE id=$1 ORDER BY id',[I.root])).rows;
 const skills=(await db.query('SELECT id,name,status,location FROM skill_registry WHERE id=$1 ORDER BY id',[I.skill_id])).rows;
 const body=JSON.parse(JSON.stringify({workflows,references,activities,steps,capabilities,value_streams,skills}));
 return {...body,registry_sha256:digest(body)};
}
export function validateInfraConsumerRegistry(r){
 const {registry_sha256,...body}=r||{};
 if(!r||digest(body)!==registry_sha256||!['workflows','references','activities','steps','capabilities','value_streams','skills'].every(k=>Array.isArray(r[k])))throw fail('INFRA_REGISTRY_INVALID');
 const workflow=r.workflows[0],cap=r.capabilities[0],root=r.value_streams[0],skill=r.skills[0];
 const refs=r.references.filter(r=>r.slot_key===I.slot_key),ref=refs[0],activity=r.activities.find(a=>a.id===ref?.activity_id);
 if(r.workflows.length!==1||workflow.id!==I.workflow_id||workflow.key!==I.workflow_key||workflow.capability_id!==I.capability_id
  ||r.capabilities.length!==1||cap.id!==I.capability_id||cap.parent_journey_id!==I.root||r.value_streams.length!==1||root.id!==I.root||root.parent_journey_id!=null
  ||refs.length!==1||!ref.active||ref.workflow_id!==I.workflow_id||ref.source_ref!==I.skill_id||!Number.isSafeInteger(ref.sequence_no)||ref.sequence_no<1
  ||!activity||activity.workflow_id!==I.workflow_id||r.skills.length!==1||skill.id!==I.skill_id||skill.name!=='janitor'||skill.status!=='active'
  ||skill.location!=='/Users/administrator/perfect21/cecelia-deploy-main/scripts/ops/janitor.sh')throw fail('INFRA_REGISTRY_IDENTITY_INVALID');
 return {...I,activity_id:activity.id,reference_id:ref.id,sequence_no:ref.sequence_no,unverified_reference_ids:r.references.filter(r=>r.id!==ref.id).map(r=>r.id)};
}
export async function buildInfraConsumerSources(options){
 validateInfraQuery(options);
 const {paths,readSource,revision,repo}=options;
 if(!Array.isArray(paths)||paths.length>200000||new Set(paths).size!==paths.length||paths.some(p=>typeof p!=='string'||p.length>1024||p.startsWith('/')||/[\\\0?#]/.test(p)||p.split('/').some(x=>!x||x==='.'||x==='..'))||typeof readSource!=='function')throw fail('INFRA_SOURCE_INPUT_INVALID');
 const bindings=[],texts=new Map();let budget=0;
 for(const path of INFRA_CONSUMER_PATHS){
  if(!paths.includes(path))throw fail('INFRA_SOURCE_MISSING');
  const text=await readSource(path,revision);
  if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>4*1024*1024||(budget+=Buffer.byteLength(text))>8*1024*1024)throw fail('INFRA_SOURCE_INVALID');
  texts.set(path,text);const hash=createHash('sha256').update(text).digest('hex');
  bindings.push({kind:'code',repo,path,revision,digest:`sha256:${hash}`,content_sha256:hash,scope:'activity',validation_scope:'consumer_source',status:'verified'});
 }
 const shell=texts.get(INFRA_CONSUMER_PATHS[0]).split('\n').filter(l=>!l.trim().startsWith('#')).join('\n');
 if(!shell.includes('source "$(dirname "$SCRIPT_PATH")/janitor-effects.sh" || exit 1'))throw fail('INFRA_SOURCE_DEPENDENCY_UNPROVEN');
 for(const path of INFRA_CONSUMER_PATHS.slice(2)){
  const text=texts.get(path).split('\n').filter(l=>!l.trim().startsWith('#')).join('\n');
  if(!text.includes('JANITOR="$(dirname "$0")/../../janitor.sh"')||!text.includes('"$JANITOR"'))throw fail('INFRA_VERIFICATION_CONSUMER_UNPROVEN');
 }
 return {scope:options.scope,repo,revision,status:'verified',definition_scope:'consumer_evidence',bindings:bindings.sort((a,b)=>a.path.localeCompare(b.path)),
  input_relations:[{src_path:INFRA_CONSUMER_PATHS[0],dst_path:INFRA_CONSUMER_PATHS[1],relation:'shell_source'},...INFRA_CONSUMER_PATHS.slice(2).map(path=>({src_path:path,dst_path:INFRA_CONSUMER_PATHS[0],relation:'verification_input'}))]};
}
export async function registerInfraConsumerSources(pool,options){
 validateInfraQuery(options);const mode=options.mode||'trusted_main';
 if(!['trusted_main','scratch_candidate'].includes(mode)||!/^[a-f0-9]{64}$/.test(options.expectedRegistrySha256||'')||typeof options.actor!=='string'||!options.actor.trim()||mode==='trusted_main'&&typeof options.checkMain!=='function')throw fail('INFRA_REGISTRATION_INPUT_INVALID');
 const check=mode==='trusted_main'?options.checkMain:()=>assertConsumerScratch(pool);
 await check();const proof=await buildInfraConsumerSources(options);
 return withConsumerEvidenceTransaction(pool,'infra-consumer-evidence',async db=>{
  await db.query('SELECT id FROM workflows WHERE id=$1 FOR UPDATE',[I.workflow_id]);
  for(const table of ['workflow_activity_refs','activities'])await db.query(`SELECT id FROM ${table} WHERE workflow_id=$1 ORDER BY id FOR UPDATE`,[I.workflow_id]);
  await db.query('SELECT id FROM steps WHERE activity_id IN(SELECT activity_id FROM workflow_activity_refs WHERE workflow_id=$1) ORDER BY id FOR UPDATE',[I.workflow_id]);
  for(const [table,id] of [['capabilities',I.capability_id],['value_streams',I.root],['skill_registry',I.skill_id]])await db.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`,[id]);
  const before=await readInfraConsumerRegistry(db);if(before.registry_sha256!==options.expectedRegistrySha256)throw fail('OPS_REGISTRY_CONFLICT');
  const identity=validateInfraConsumerRegistry(before),source={repo:options.repo,path:INFRA_CONSUMER_PATHS[0],commit:options.revision};
  const contract={key:I.workflow_key,definition_scope:'consumer_evidence',executable:false,source_basis:'fixed_git_tree'};
  const common={source_scope:options.scope,definition_scope:'consumer_evidence',registration_sha256:before.registry_sha256,contract};
  const activity=await appendConsumerEvidence(db,'activity',identity.activity_id,{...common,activity_id:identity.activity_id,definition_key:`${I.workflow_key}.${I.slot_key}`,steps:[],implementation_bindings:proof.bindings,input_relations:proof.input_relations,verification:{runtime_status:'not_evaluated'}},source);
  const w=before.workflows[0],ref=before.references.find(r=>r.id===identity.reference_id);
  const workflow=await appendConsumerEvidence(db,'workflow',w.id,{...common,workflow_id:w.id,key:w.key,name:w.name,capability_id:w.capability_id,channel:w.channel,form:w.form,
   coverage:{status:'unknown',verified_reference_ids:[ref.id],unverified_reference_ids:identity.unverified_reference_ids},activities:[{reference_id:ref.id,slot_key:ref.slot_key,sequence_no:ref.sequence_no,activity_id:activity.activity_id,activity_version_id:activity.id,source_ref:ref.source_ref}]},source);
  if((await readInfraConsumerRegistry(db)).registry_sha256!==before.registry_sha256)throw fail('OPS_REGISTRY_CONFLICT');
  await check();return {scope:options.scope,repo:options.repo,revision:options.revision,actor:options.actor,registration_scope:'consumer_evidence',source_basis:mode,registry_sha256:before.registry_sha256,source_sha256:digest(proof),definitions:{workflows:[workflow],activities:[activity]},executable:false,remaining_unknown_reference_ids:identity.unverified_reference_ids};
 });
}
/** 仅为已登记同一infra地图生成明确CAS计划；调用方负责正式/隔离激活门。 */
export async function prepareInfraManifestAdvance(db,q){
 validateInfraQuery(q);validateInfraConsumerRegistry(await readInfraConsumerRegistry(db));
 const rows=(await db.query("SELECT * FROM map_manifest_versions WHERE scope_key=$1 AND status='active'",[q.scope])).rows;
 if(rows.length!==1)throw fail('INFRA_MANIFEST_NOT_READY');
 const row=rows[0],manifest=structuredClone(row.manifest);
 if(manifest.scope_key!==q.scope||manifest.value_streams?.length!==1||manifest.capabilities?.length!==1)throw fail('INFRA_MANIFEST_INVALID');
 let changed=false;
 for(const [node,type,id] of [[manifest.value_streams[0],'value_stream',I.root],[manifest.capabilities[0],'capability',I.capability_id]]){
  const b=node?.brain_binding;if(b?.entity_id!==id||b.entity_type!==type||b.source_repo!==q.repo||!SHA.test(b.source_revision||''))throw fail('INFRA_MANIFEST_INVALID');
  changed||=b.source_revision!==q.revision;b.source_revision=q.revision;
 }
 if(manifest.capabilities[0].value_stream_key!==manifest.value_streams[0].key)throw fail('INFRA_MANIFEST_INVALID');
 return changed?{manifest,expectedActive:{id:row.id,digest:row.digest}}:null;
}
