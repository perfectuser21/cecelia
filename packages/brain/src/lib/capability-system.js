/** 规范注册表的只读清单：真身数量、引用位置和证据缺口分别统计。 */
import { JOURNEY_ORGANIZATION_SQL } from './journey-organization.js';
import { listWorkflows } from './workflow-read-service.js';
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
export const pick = (row, keys) => Object.fromEntries(keys.filter(k => row?.[k] !== undefined).map(k => [k, row[k]]));
export { listSystemReleases, listSystemRuns, readSystemReleaseEvidence, readSystemRunEvidence } from './capability-system-evidence.js';
function bindingProjection(binding,steps){
  const result=pick(binding,['kind','repo','path','revision','digest','status','reason','scope','step_key','validation_scope']);
  if(binding.scope==='step'){
    const matches=(steps||[]).filter(s=>s.locator?.step_key===binding.step_key);
    result.step_id=matches.length===1?matches[0].step_id||null:null;
  }
  return result;
}
const stepFields=['id','activity_id','step_order','key','activity_key','mode','active','source_sha256','projection_status'];
function workflowProjection(w){
  return {...pick(w,['id','key','name','capability_id','capability_name','capability_code','value_stream_id','status','channel','form','current_definition_version_id','definition_status','organization','activity_count']),
    activities:(w.activities||[]).map(a=>({...pick(a,['id','activity_id','canonical_id','name','status','capability_key','activity_key','definition_key','definition_status','slot_key','sequence_no','source','usage']),
      steps:(a.steps||[]).map(s=>pick(s,stepFields)),
      shared_components:(a.shared_components||[]).map(e=>pick(e,['id','key','name','kind','active','caller_type','caller_id']))}))};
}

export async function readCapabilitySystem(db) {
  const areas = (await db.query('SELECT id,name,parent_area_id FROM areas ORDER BY name,id')).rows;
  const journeys = (await db.query(`SELECT c.id,c.name,c.parent_journey_id,c.area_id,c.capability_code,
    (${JOURNEY_ORGANIZATION_SQL}) organization FROM journeys c ORDER BY c.name,c.id`)).rows;
  const workflows = (await listWorkflows(db)).map(workflowProjection);
  const byJourney = new Map(journeys.map(j => [j.id,j]));
  for (const j of journeys) j.role = !j.parent_journey_id
    ? workflows.some(w => w.capability_id === j.id) ? 'unknown' : 'value_stream'
    : byJourney.get(j.parent_journey_id)?.parent_journey_id === null ? 'capability' : 'unknown';
  const rows = (await db.query(`SELECT a.id,a.name,a.status,a.capability_key,a.activity_key,a.current_definition_version_id,
    a.contract IS NOT NULL contract_present,v.id version_id,v.source_repo,v.source_path,v.source_commit,
    v.payload->'implementation_bindings' implementation_bindings,v.payload->'steps' definition_steps
    FROM journey_steps a LEFT JOIN activity_definition_versions v ON v.id=a.current_definition_version_id AND v.activity_id=a.id
    ORDER BY a.name,a.id`)).rows;
  const refs = (await db.query(`SELECT r.activity_id,r.workflow_id,r.id reference_id,r.slot_key,r.sequence_no
    FROM workflow_activity_refs r WHERE r.active ORDER BY r.workflow_id,r.sequence_no,r.id`)).rows;
  const activities = rows.map(a => ({...pick(a,['id','name','status','capability_key','activity_key','current_definition_version_id','contract_present']),
    definition_status:a.version_id?'versioned':'unknown',
    definition_source:a.version_id?{repo:a.source_repo,path:a.source_path,commit:a.source_commit}:null,
    implementation_bindings:(a.implementation_bindings || []).map(b=>bindingProjection(b,a.definition_steps)),
    consumers:refs.filter(r=>r.activity_id===a.id).map(r=>pick(r,['workflow_id','reference_id','slot_key','sequence_no']))}));
  const steps = (await db.query('SELECT id,activity_id,step_order,key,activity_key,mode,readback,source_sha256,active FROM steps ORDER BY activity_id,step_order,id')).rows.map(s=>({...pick(s,stepFields),
    content_hash_verified:Boolean(s.source_sha256 && stepSha256({key:s.key,activity:s.activity_key,mode:s.mode,readback:s.readback})===s.source_sha256),
    source_verified:false}));
  // Step内容摘要不能证明Git来源，更不能证明执行成功。
  const enablers = (await db.query('SELECT id,key,name,kind,impl_ref,active FROM enablers ORDER BY key')).rows.map(e=>{
    const match=/^([^/@]+\/[^/@]+)@([0-9a-f]{40}):(.+)$/.exec(e.impl_ref || '');
    const binding=match && activities.flatMap(a=>a.implementation_bindings).find(b=>b.status==='verified'&&b.repo===match[1]&&b.revision===match[2]&&b.path===match[3]&&/^sha256:[0-9a-f]{64}$/.test(b.digest));
    return {...e,source_verified:Boolean(binding),source_evidence:binding||null};
  });
  const gaps=[];
  for(const j of journeys){
    if(j.role==='unknown')gaps.push({entity_type:'journey',entity_id:j.id,code:'hierarchy_unknown'});
    for(const code of j.organization?.gaps||[])gaps.push({entity_type:j.role,entity_id:j.id,code});
  }
  for(const a of activities){
    if(!a.consumers.length)gaps.push({entity_type:'activity',entity_id:a.id,code:'workflow_reference_missing'});
    if(a.definition_status==='unknown')gaps.push({entity_type:'activity',entity_id:a.id,code:'definition_version_missing'});
  }
  const orgCount=role=>{const items=journeys.filter(j=>j.role===role),known=items.filter(j=>j.organization?.source!=='unknown'&&j.organization?.effective_area).length;return {total:items.length,with_area:known,unknown:items.length-known};};
  const versionCount=items=>({total:items.length,versioned:items.filter(i=>i.definition_status==='versioned').length,unknown:items.filter(i=>i.definition_status!=='versioned').length});
  const sourceCount=items=>({total:items.length,source_verified:items.filter(i=>i.source_verified).length,unknown:items.filter(i=>!i.source_verified).length});
  return {generated_at:new Date().toISOString(),counts:{areas:{total:areas.length},value_streams:orgCount('value_stream'),capabilities:orgCount('capability'),
    workflows:versionCount(workflows),activities:{...versionCount(activities),referenced:activities.filter(a=>a.consumers.length).length,usage_count:refs.length},
    steps:{...sourceCount(steps),active:steps.filter(s=>s.active).length},enablers:sourceCount(enablers),
    legacy_features:{total:Number((await db.query('SELECT count(*) FROM journey_features')).rows[0].count)}},
    areas,journeys,workflows,activities,steps,enablers,gaps,source_repos:[...new Set(rows.map(a=>a.source_repo).filter(Boolean))].sort()};
}
