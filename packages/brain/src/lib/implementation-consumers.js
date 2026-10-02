/** 精确实现身份→版本引用→业务消费者；地图只提供显式身份，不反写业务真身。 */
import { loadHistoricalImplementationContext } from './implementation-context.js';
import { computeFreshness } from './registry-freshness.js';
import { canonicalAssertionCommandText } from './gp-assertion-command.js';
import { assertionDigest } from './journey-assertion-receipt.js';
import { readMapBrainBindings } from './map-brain-bindings.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/;
const fail=(code,message,status=400)=>{throw Object.assign(Error(message),{code:`MAP_${code}`,status});};
export function validateImplementationQuery(input) {
  const {scope,kind,repo,path,revision,digest,workflow_version_id:versionId}=input??{};
  if(typeof scope!=='string'||!scope||scope.length>128||!['code','skill'].includes(kind)
    ||typeof repo!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(repo)||typeof revision!=='string'||!SHA.test(revision))fail('IMPLEMENTATION_INPUT_INVALID','scope、kind、规范repo及固定revision必填');
  if(typeof path!=='string'||path.length>1024||!path||path.startsWith('/')||/[\\?#\0]/.test(path)
    ||path.split('/').some(part=>!part||part==='.'||part==='..'))fail('IMPLEMENTATION_INPUT_INVALID','实现path必须是规范仓库相对路径');
  if(digest!==undefined&&(typeof digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(digest)))fail('IMPLEMENTATION_INPUT_INVALID','digest格式无效');
  if(versionId!==undefined&&(typeof versionId!=='string'||!UUID.test(versionId)))fail('IMPLEMENTATION_INPUT_INVALID','workflow_version_id格式无效');
  return {scope,kind,repo,path,revision,digest,versionId};
}

async function loadContext(db,q,gaps) {
  const adapters=(await db.query(`SELECT repo,adapter_config FROM map_scope_repositories WHERE scope_key=$1
    AND (repo=$2 OR adapter_config->>'source_repo'=$2)`,[q.scope,q.repo])).rows;
  if(adapters.length!==1)fail('IMPLEMENTATION_REPO_NOT_CONFIGURED','scope与源码repo须有唯一显式登记',422);
  const registryRepo=adapters[0].repo;
  const context=(await db.query(`SELECT m.id manifest_version_id,m.digest manifest_digest,m.manifest,
    p.id projection_run_id,p.projection_digest,p.manifest_digest projection_manifest_digest,p.fact_revisions
    FROM map_manifest_versions m LEFT JOIN map_projection_runs p ON p.manifest_version_id=m.id AND p.status='active'
    WHERE m.scope_key=$1 AND m.status='active'`,[q.scope])).rows[0];
  if(!context)fail('IMPLEMENTATION_MAP_NOT_FOUND','scope没有已激活地图',404);
  if(!context.projection_run_id||context.projection_manifest_digest!==context.manifest_digest)gaps.push({code:'projection_missing_or_stale'});
  const nodes=context.projection_run_id?(await db.query(`SELECT node_key,attributes FROM map_projection_nodes WHERE run_id=$1 AND node_type='capability'`,[context.projection_run_id])).rows:[];
  const authority=await readMapBrainBindings(db,context.manifest,q.scope);
  const mapped=new Map();
  for(const node of context.manifest.capabilities||[]){
    const binding=node.brain_binding,projection=nodes.find(p=>p.node_key===node.key)?.attributes;
    if(!binding||binding.entity_type!=='capability'||!UUID.test(binding.entity_id||'')){gaps.push({code:'capability_mapping_missing',node_key:node.key});continue;}
    mapped.set(binding.entity_id,node.key);
    if(authority[node.key]?.mapping_status!=='verified')gaps.push({code:'capability_authority_changed',node_key:node.key,evidence:authority[node.key]||null});
    if(projection?.canonical_entity_id!==binding.entity_id||projection?.mapping_status!=='verified')gaps.push({code:'capability_mapping_unverified',node_key:node.key});
  }
  const header=(await db.query("SELECT * FROM fact_snapshot_headers WHERE repo=$1 AND kind='graph'",[registryRepo])).rows[0];
  const freshness=computeFreshness(header);
  if(freshness.status!=='fresh')gaps.push({code:'graph_snapshot_stale',source_repo:registryRepo,reason:freshness.reason_code});
  if(!q.versionId&&(header?.source_revision!==q.revision||context.fact_revisions?.[registryRepo]!==q.revision))gaps.push({code:'graph_revision_mismatch',expected:q.revision,actual:header?.source_revision||null});
  return {...context,mapped,registryRepo};
}

async function selectedVersions(db,q,capabilities) {
  return (await db.query(`SELECT w.id workflow_id,wv.id workflow_version_id,wv.payload workflow_payload,
    av.id activity_version_id,av.activity_id,av.payload activity_payload,av.source_repo,av.source_commit,
    ref.value usage,r.active reference_active,r.activity_definition_version_id reference_version
    FROM workflow_definition_versions wv JOIN workflows w ON w.id=wv.workflow_id
    CROSS JOIN LATERAL jsonb_array_elements(wv.payload->'activities') ref(value)
    JOIN activity_definition_versions av ON av.id=(ref.value->>'activity_version_id')::uuid
    LEFT JOIN workflow_activity_refs r ON r.id=(ref.value->>'reference_id')::uuid AND r.workflow_id=w.id
    WHERE (wv.payload->>'capability_id')::uuid=ANY($1::uuid[])
      AND ($2::uuid IS NOT NULL AND wv.id=$2 OR $2::uuid IS NULL AND w.current_definition_version_id=wv.id AND w.status<>'retired')
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(av.payload->'implementation_bindings') b
        WHERE b->>'kind'=$3 AND b->>'repo'=$4 AND b->>'path'=$5 AND b->>'revision'=$6
          AND ($7::text IS NULL OR b->>'digest'=$7))
    ORDER BY w.id,av.id`,[capabilities,q.versionId||null,q.kind,q.repo,q.path,q.revision,q.digest||null])).rows;
}

async function readAssertions(db,usages,gaps) {
  const capabilities=[...new Set(usages.map(u=>u.capability_id))],activities=[...new Set(usages.map(u=>u.activity_id))];
  const rows=(await db.query(`SELECT id,journey_id,step_id,step_id_ref,assertion_ref,assertion_revision
    FROM journey_step_links WHERE journey_id=ANY($1::uuid[]) AND step_id=ANY($2::uuid[]) ORDER BY id`,[capabilities,activities])).rows;
  const groups=new Map(),covered=new Set();
  const pair=(cap,activity,step)=>JSON.stringify([cap,activity,step||null]);
  for(const row of rows){
    const matched=usages.filter(u=>u.capability_id===row.journey_id&&u.activity_id===row.step_id
      &&u.assertion_step_ids.includes(row.step_id_ref||null));
    if(!matched.length)continue;
    let command;try{command=canonicalAssertionCommandText(row.assertion_ref);}catch{continue;}
    const sourceRepos=[...new Set(matched.map(u=>u.source_repo).filter(Boolean))];
    const sourceRepo=sourceRepos.length===1?sourceRepos[0]:null;
    if(!sourceRepo)gaps.push({code:'assertion_source_unknown',journey_step_link_id:row.id});
    if(matched.some(u=>u.implementation_repo!==sourceRepo))gaps.push({code:'assertion_source_repo_mismatch',journey_step_link_id:row.id,source_repo:sourceRepo});
    const key=JSON.stringify([sourceRepo,row.assertion_ref]);
    const group=groups.get(key)||{assertion_ref:row.assertion_ref,source_repo:sourceRepo,source_repo_basis:'activity_definition',command,capability_ids:[],source_bindings:[],validation_status:'not_evaluated'};
    if(!group.capability_ids.includes(row.journey_id))group.capability_ids.push(row.journey_id);
    group.source_bindings.push({assertion_source:'current_registration',source_repo:sourceRepo,source_repo_basis:'activity_definition',capability_id:row.journey_id,journey_step_link_id:row.id,assertion_revision:row.assertion_revision,assertion_digest:assertionDigest(row.assertion_ref),activity_id:row.step_id,step_id:row.step_id_ref});
    groups.set(key,group);covered.add(pair(row.journey_id,row.step_id,row.step_id_ref));
  }
  const missing=new Set();
  for(const usage of usages)for(const step of usage.assertion_step_ids){
    const key=pair(usage.capability_id,usage.activity_id,step);
    if(!covered.has(key)&&!missing.has(key)){
      gaps.push({code:'regression_missing',capability_id:usage.capability_id,activity_id:usage.activity_id,step_id:step});missing.add(key);
    }
  }
  return [...groups.values()].sort((a,b)=>a.assertion_ref.localeCompare(b.assertion_ref));
}

export async function readImplementationConsumers(db,input,{pinnedContext=null}={}) {
  const q=validateImplementationQuery(input),gaps=[];
  if(pinnedContext&&!q.versionId)fail('IMPLEMENTATION_INPUT_INVALID','固定context必须指定workflow_version_id');
  const context=pinnedContext??(q.versionId?await loadHistoricalImplementationContext(db,q,gaps):await loadContext(db,q,gaps));
  const rows=await selectedVersions(db,q,[...context.mapped.keys()]);
  const activities=new Map(),workflows=new Map(),usages=[];
  for(const row of rows){
    const payload=row.activity_payload,capabilityId=row.workflow_payload.capability_id;
    if(!q.versionId&&(!row.reference_active||row.reference_version!==row.activity_version_id))gaps.push({code:'workflow_usage_version_mismatch',reference_id:row.usage.reference_id});
    const bindings=payload.implementation_bindings.filter(b=>b.kind===q.kind&&b.repo===q.repo&&b.path===q.path&&b.revision===q.revision&&(!q.digest||b.digest===q.digest)).map(b=>{
      if(b.status!=='verified')gaps.push({code:'implementation_reference_unverified',activity_id:row.activity_id});
      if(b.scope!=='step')return b;
      const step=payload.steps.find(s=>s.locator?.step_key===b.step_key);
      if(!step?.step_id)gaps.push({code:'step_registration_unknown',activity_id:row.activity_id,step_key:b.step_key});
      return {...b,step_id:step?.step_id||null,locator:step?.locator||{activity_id:row.activity_id,step_key:b.step_key}};
    });
    activities.set(row.activity_version_id,{activity_id:row.activity_id,activity_definition_version_id:row.activity_version_id,definition_key:payload.definition_key,source_repo:row.source_repo,source_revision:row.source_commit,bindings,verification:payload.verification});
    workflows.set(row.workflow_version_id,{workflow_id:row.workflow_id,workflow_definition_version_id:row.workflow_version_id,key:row.workflow_payload.key,capability_id:capabilityId,map_node_key:context.mapped.get(capabilityId)});
    usages.push({...row.usage,source_repo:row.source_repo,implementation_repo:q.repo,assertion_step_ids:[...new Set(bindings.map(b=>b.scope==='step'?b.step_id||null:null))],activity_definition_version_id:row.activity_version_id,workflow_id:row.workflow_id,workflow_definition_version_id:row.workflow_version_id,capability_id:capabilityId});
  }
  if(!rows.length)gaps.push({code:'implementation_mapping_missing'});
  const requiredAssertions=await readAssertions(db,usages,gaps);
  return {scope_key:q.scope,source:{repo:q.repo,registry_repo:context.registryRepo,path:q.path,kind:q.kind,revision:q.revision,digest:q.digest||null},
    manifest_version_id:context.manifest_version_id,manifest_digest:context.manifest_digest,projection_run_id:context.projection_run_id,projection_digest:context.projection_digest,
    mapping_status:gaps.length?'unknown':'verified',verification_status:'unknown',scope_status:context.scope_status??'verified',organization_status:q.versionId?'historical_membership_unknown_organization':'current',
    activities:[...activities.values()],workflows:[...workflows.values()],usages,required_assertions:requiredAssertions,gaps};
}
