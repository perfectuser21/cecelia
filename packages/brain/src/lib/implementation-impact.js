/** 两个精确源码版本各自反查依赖和冻结定义，再合并使用位置；缺证据绝不借latest。 */
import { createHash } from 'node:crypto';
import { resolveImplementationRegistryRepo,loadImplementationRevisionContext } from './implementation-context.js';
import { readImplementationConsumers, validateImplementationQuery } from './implementation-consumers.js';
const SHA=/^[0-9a-f]{40}$/;
const HASH=/^[0-9a-f]{64}$/;
const fail=message=>{throw Object.assign(Error(message),{code:'MAP_IMPLEMENTATION_IMPACT_INPUT_INVALID',status:400});};
const unique=rows=>[...new Map(rows.map(row=>[JSON.stringify(row),row])).values()];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function validateImplementationImpact(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('需要impact请求对象');
  const {scope,repo,base_revision,head_revision,max_depth=64,max_nodes=10000}=input;
  if(typeof base_revision!=='string'||!SHA.test(base_revision)||typeof head_revision!=='string'||!SHA.test(head_revision))fail('base/head必须为固定SHA字符串');
  if(!Array.isArray(input.changed_files)||!input.changed_files.length||input.changed_files.length>1000)fail('changed_files须为1到1000项数组');
  const changed_files=input.changed_files.map(value=>{
    const item=typeof value==='string'?{path:value}:value;
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['path','old_path'].includes(k)))fail('变更项只接受path与old_path');
    validateImplementationQuery({scope,repo,kind:'code',path:item.path,revision:base_revision});
    if(item.old_path!==undefined)validateImplementationQuery({scope,repo,kind:'code',path:item.old_path,revision:base_revision});
    return {...item};
  });
  if(!Number.isInteger(max_depth)||max_depth<1||max_depth>256||!Number.isInteger(max_nodes)||max_nodes<1||max_nodes>50000)fail('遍历界限无效');
  for(const field of ['base_projection_digest','head_projection_digest'])if(input[field]!==undefined&&(typeof input[field]!=='string'||!HASH.test(input[field])))fail('projection digest无效');
  return {...input,scope,repo,base_revision,head_revision,changed_files:unique(changed_files),max_depth,max_nodes};
}

export function reverseImplementationPaths(edges,starts,{max_depth=64,max_nodes=10000}={}) {
  const reverse=new Map();
  for(const edge of edges){const parents=reverse.get(edge.dst_path)||new Set();parents.add(edge.src_path);reverse.set(edge.dst_path,parents);}
  const paths=new Map(),queue=[];let truncated=false;
  for(const path of [...new Set(starts)].sort()){
    if(paths.size===max_nodes){truncated=true;break;}paths.set(path,0);queue.push(path);
  }
  for(let index=0;index<queue.length;index++){
    const path=queue[index],depth=paths.get(path);
    for(const parent of [...(reverse.get(path)||[])].sort()){
      if(paths.has(parent))continue;
      if(depth===max_depth||paths.size===max_nodes){truncated=true;continue;}
      paths.set(parent,depth+1);queue.push(parent);
    }
  }
  return {paths:[...paths.keys()].sort(),depths:Object.fromEntries(paths),truncated,max_depth,max_nodes};
}

async function graphSnapshot(db,repo,revision,gaps) {
  const snapshot=(await db.query('SELECT * FROM graph_snapshot_versions WHERE repo=$1 AND source_revision=$2',[repo,revision])).rows[0];
  if(!snapshot){gaps.push({code:'graph_snapshot_missing',repo,revision});return null;}
  const edges=(await db.query('SELECT src_path,dst_path,edge_type,detail FROM graph_edge_snapshots WHERE repo=$1 AND source_revision=$2 ORDER BY src_path,dst_path,edge_type',[repo,revision])).rows;
  if(Number(snapshot.row_count)!==edges.length)gaps.push({code:'graph_snapshot_incomplete',expected:Number(snapshot.row_count),actual:edges.length});
  return {snapshot:{...snapshot,id:`${repo}@${revision}`,digest:digest(edges)},edges};
}
async function definitions(db,q,revision,gaps) {
  const workflows=(await db.query(`SELECT id,workflow_id,source_repo,source_path,source_commit,payload_sha256,contract_sha256,payload
    FROM workflow_definition_versions WHERE source_repo=$1 AND source_commit=$2 ORDER BY workflow_id,id`,[q.repo,revision])).rows;
  if(!workflows.length)gaps.push({code:'definition_snapshot_missing',repo:q.repo,revision});
  const grouped=new Map();
  for(const row of workflows){const group=grouped.get(row.workflow_id)||[];group.push(row);grouped.set(row.workflow_id,group);}
  for(const [workflow_id,rows] of grouped)if(rows.length>1)gaps.push({code:'definition_snapshot_ambiguous',workflow_id,revision});
  const ids=[...new Set(workflows.flatMap(w=>(w.payload.activities||[]).map(a=>a.activity_version_id)))];
  const activities=ids.length?(await db.query(`SELECT id,activity_id,source_repo,source_path,source_commit,payload_sha256,contract_sha256,payload FROM activity_definition_versions WHERE id=ANY($1::uuid[]) ORDER BY id`,[ids])).rows:[];
  if(activities.length!==ids.length)gaps.push({code:'activity_snapshot_missing',revision});
  for(const row of activities)if(row.source_repo!==q.repo||row.source_commit!==revision)gaps.push({code:'activity_definition_source_mismatch',activity_definition_version_id:row.id,revision});
  return {workflows,activities};
}
function versionEvidence(rows){return rows.map(({payload,...row})=>row);}
function projectionEvidence(context){if(!context)return null;const {manifest,mapped,registryRepo,...evidence}=context;return evidence;}
function matchedBindings(activity,q,revision,paths){return (activity.payload.implementation_bindings||[]).filter(b=>['code','skill'].includes(b.kind)&&b.repo===q.repo&&b.revision===revision&&paths.has(b.path));}

async function readSide(db,q,side,registry) {
  const revision=q[`${side}_revision`],gaps=[];
  const graph=await graphSnapshot(db,registry,revision,gaps);
  const context=await loadImplementationRevisionContext(db,q,revision,registry,q[`${side}_projection_digest`],gaps);
  const versions=await definitions(db,q,revision,gaps);
  const starts=q.changed_files.map(change=>side==='base'?change.old_path||change.path:change.path);
  const traversal=reverseImplementationPaths(graph?.edges||[],starts,q);
  const reports=[],paths=new Set(traversal.paths),activityById=new Map(versions.activities.map(a=>[a.id,a]));
  if(graph&&context)for(const workflow of versions.workflows){
    if(!context.mapped.has(workflow.payload.capability_id))continue;
    const queries=new Map();
    for(const ref of workflow.payload.activities||[]){
      const activity=activityById.get(ref.activity_version_id);if(!activity)continue;
      for(const binding of matchedBindings(activity,q,revision,paths))queries.set(JSON.stringify([binding.kind,binding.path,binding.digest]),binding);
    }
    for(const binding of queries.values()){
      const report=await readImplementationConsumers(db,{scope:q.scope,repo:q.repo,kind:binding.kind,path:binding.path,revision,workflow_version_id:workflow.id,...(binding.digest&&{digest:binding.digest})},{pinnedContext:context});
      reports.push(report);gaps.push(...report.gaps);
    }
  }
  const affected_usages=unique(reports.flatMap(report=>report.usages.map(usage=>({...usage,implementation:report.source}))));
  const implementationPaths=new Set(affected_usages.map(u=>u.implementation.path));
  const file_coverage=starts.map((path,index)=>{
    const reach=reverseImplementationPaths(graph?.edges||[],[path],q);
    const matched_paths=graph?reach.paths.filter(p=>implementationPaths.has(p)):[];
    return {change_index:index,path,matched_paths,truncated:reach.truncated};
  });
  traversal.truncated ||= file_coverage.some(file=>file.truncated);
  if(traversal.truncated)gaps.push({code:'implementation_traversal_truncated'});
  if(!affected_usages.length)gaps.push({code:'implementation_mapping_missing',revision});
  return {revision,graph_snapshot:graph?.snapshot||null,projection:projectionEvidence(context),definition_versions:{workflows:versionEvidence(versions.workflows),activities:versionEvidence(versions.activities)},
    organization_status:'historical_membership_unknown_organization',traversal,file_coverage,affected_usages,required_assertions:unique(reports.flatMap(r=>r.required_assertions)),gaps:unique(gaps),mapping_status:gaps.length?'unknown':'verified'};
}
function mergeUsages(base,head){
  const usages=new Map();
  for(const [side,report] of [['base',base],['head',head]])for(const usage of report.affected_usages){
    const key=JSON.stringify([usage.workflow_id,usage.reference_id,usage.activity_id]);
    const result=usages.get(key)||{workflow_id:usage.workflow_id,reference_id:usage.reference_id,activity_id:usage.activity_id,capability_ids:[],sides:[],evidence:[]};
    if(!result.sides.includes(side))result.sides.push(side);
    if(!result.capability_ids.includes(usage.capability_id))result.capability_ids.push(usage.capability_id);
    result.evidence.push({side,revision:report.revision,...usage});usages.set(key,result);
  }
  return [...usages.values()];
}
function mergeAssertions(base,head){
  const groups=new Map();
  for(const [side,report] of [['base',base],['head',head]])for(const assertion of report.required_assertions){
    const key=JSON.stringify([assertion.source_repo,assertion.assertion_ref]);
    const group=groups.get(key)||{...assertion,capability_ids:[],source_bindings:[],sides:[]};
    group.capability_ids=[...new Set([...group.capability_ids,...assertion.capability_ids])];
    group.source_bindings=unique([...group.source_bindings,...assertion.source_bindings.map(binding=>({...binding,side}))]);
    if(!group.sides.includes(side))group.sides.push(side);groups.set(key,group);
  }
  return [...groups.values()];
}
async function confirmAbsentUsages(db,base,head,{added=false}={}) {
  if(base.mapping_status!=='verified'||!base.affected_usages.length||head.affected_usages.length
    ||head.gaps.some(g=>g.code!=='implementation_mapping_missing'))return;
  const workflows=(await db.query('SELECT id,workflow_id,payload FROM workflow_definition_versions WHERE id=ANY($1::uuid[])',[head.definition_versions.workflows.map(v=>v.id)])).rows;
  const activities=(await db.query('SELECT id,payload FROM activity_definition_versions WHERE id=ANY($1::uuid[])',[head.definition_versions.activities.map(v=>v.id)])).rows;
  const evidence=[];
  for(const usage of base.affected_usages){
    const candidates=workflows.filter(w=>w.workflow_id===usage.workflow_id);if(candidates.length!==1)return;
    const workflow=candidates[0],ref=workflow.payload.activities.find(r=>r.reference_id===usage.reference_id);
    let reason='reference_removed';
    if(ref&&ref.activity_id===usage.activity_id){
      const activity=activities.find(a=>a.id===ref.activity_version_id);if(!activity)return;
      const identity=usage.implementation;
      if((activity.payload.implementation_bindings||[]).some(b=>b.repo===identity.repo&&b.path===identity.path&&b.kind===identity.kind))return;
      reason='implementation_binding_removed';
    }else if(ref)reason='reference_rebound';
    evidence.push({workflow_id:usage.workflow_id,reference_id:usage.reference_id,activity_id:usage.activity_id,
      base_workflow_definition_version_id:added?workflow.id:usage.workflow_definition_version_id,head_workflow_definition_version_id:added?usage.workflow_definition_version_id:workflow.id,reason:added?reason.replace('removed','added'):reason});
  }
  head.gaps=[];head.mapping_status='verified';head.impact_status=added?'known_added':'known_removed';
  head[added?'addition_evidence':'removal_evidence']=unique(evidence);
}
export async function readImplementationImpact(db,input) {
  const q=validateImplementationImpact(input),registry=await resolveImplementationRegistryRepo(db,q);
  const base=await readSide(db,q,'base',registry),head=await readSide(db,q,'head',registry);
  await confirmAbsentUsages(db,base,head);
  await confirmAbsentUsages(db,head,base,{added:true});
  const unclaimed_paths=q.changed_files.filter((_,index)=>!base.file_coverage[index].matched_paths.length&&!head.file_coverage[index].matched_paths.length);
  const gaps=[...unclaimed_paths.map(path=>({code:'changed_file_unclaimed',...path})),...base.gaps.map(g=>({...g,side:'base'})),...head.gaps.map(g=>({...g,side:'head'}))];
  return {scope_key:q.scope,source:{repo:q.repo,base_revision:q.base_revision,head_revision:q.head_revision,changed_files:q.changed_files},registry_repo:registry,unclaimed_paths,
    base,head,affected_usages:mergeUsages(base,head),required_assertions:mergeAssertions(base,head),gaps,
    truncated:base.traversal.truncated||head.traversal.truncated,mapping_status:gaps.length?'unknown':'verified',verification_status:'unknown'};
}
