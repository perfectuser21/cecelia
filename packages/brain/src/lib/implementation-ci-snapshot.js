import {manifestMatchesImplementationSource} from './implementation-context.js';
import {hasFrozenConsumerSource,sealedConsumerVersion,collectWorkspaceConsumerSourceSet,isTrustedWorkspaceConsumerSource,sealedBrainConsumerDefinition,consumerSourceAdmissionScope} from './consumer-source-set.js';
/** 中央定义只读导出；身份由登记表给出，历史来源不以latest补齐。 */
import {preparePilotManifestAdvance,advancePilotManifest} from './implementation-ci-pilot-manifest.js';
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
import { validateImplementationQuery } from './implementation-consumers.js';
import { syncActivityContracts,CONTRACT_REPO } from '../activity-contract-sync.js';
import { registerCompanyKrWorkflow } from './company-kr-registration.js';
import { resolveGitHubToken } from '../harness-credentials.js';
import { TREE_NODES_SQL } from './tree-nodes-sql.js';
import { EXISTING_OPS_SCOPE,EXISTING_OPS_REPO,EXISTING_OPS_IDENTITIES } from './existing-ops-source.js';
import { readExistingOpsRegistry,registerExistingOpsSources,validateExistingOpsRegistry,prepareExistingOpsManifestAdvance } from './existing-ops-registration.js';
export const ciFailure=(code,message,status=422)=>Object.assign(Error(message||code),{code:`IMPLEMENTATION_CI_${code}`,status});
export function isImplementationScratchDatabase(database,env=process.env){
  return database==='cecelia_scratch'||database==='cecelia_test'&&env.CI==='true'&&env.GITHUB_ACTIONS==='true';
}
export function validateSnapshotQuery(input){
  validateImplementationQuery({...input,kind:'code',path:'snapshot',revision:input?.revision});
  return {scope:input.scope,repo:input.repo,revision:input.revision};
}
const json=value=>JSON.parse(JSON.stringify(value));
const digest=value=>stepSha256(json(value));
const companionParent = s => s.scope==='cecelia-kr'&&s.repo===EXISTING_OPS_REPO;
const crossCompanionParent = s => s.scope==='zenithjoy'&&s.repo===CONTRACT_REPO;
const exactIds = (actual,expected) => Array.isArray(actual)&&actual.length===expected.length
  &&new Set(actual).size===expected.length&&expected.every(id=>actual.includes(id));
const sameIds = (rows,expected) => Array.isArray(rows)&&exactIds(rows.map(r=>r.id),expected);
const SOURCE_OWNER_FIELDS=['id','key','name','channel','capability_id','status','source_repo','source_path','source_capability','source_workflow'];
const sourceOwner=row=>Object.fromEntries(SOURCE_OWNER_FIELDS.map(k=>[k,row[k]]));
function sourceOwnerRequirements(definitions){
  return definitions.filter(w=>w.payload.contract?.contract_key).map(w=>({
    capability:w.payload.contract.capability,capability_id:w.payload.capability_id,
  }));
}
function freezeSourceRegistry(q,definitions,workflows,gap){
  const needs=sourceOwnerRequirements(definitions);
  if(q.repo!==CONTRACT_REPO||q.scope===EXISTING_OPS_SCOPE||!needs.length)return null;
  const owners=[];
  for(const need of needs){
    const matches=workflows.filter(w=>w.source_capability===need.capability);
    const owner=matches.length===1?matches[0]:null;
    if(!owner||owner.source_repo!==q.repo||owner.capability_id!==need.capability_id
      ||owner.source_path!==`product-map/contracts/${need.capability}.yaml`
      ||(!definitions.some(w=>w.workflow_id===owner.id)&&owner.status!=='retired')){
      gap('definition_source_owner_unknown',need);return null;
    }
    if(!owners.some(w=>w.id===owner.id))owners.push(sourceOwner(owner));
  }
  return {schema_version:1,purpose:'definition_source_only',repo:q.repo,workflows:owners.sort((a,b)=>a.id.localeCompare(b.id))};
}
/** 只带取源归属；不能把退役owner升级为canonical或执行定义。 */
function validateSourceRegistry(s){
  const needs=sourceOwnerRequirements(s.definitions.workflows),registry=s.source_registry;
  if(!registry){
    if(needs.length&&s.repo===CONTRACT_REPO&&s.scope!==EXISTING_OPS_SCOPE
      &&!(s.status==='unknown'&&s.gaps.some(g=>g.code==='definition_source_owner_unknown')))
      throw ciFailure('SOURCE_REGISTRY_MISSING');
    return;
  }
  if(s.repo!==CONTRACT_REPO||s.scope===EXISTING_OPS_SCOPE||!needs.length
    ||Object.keys(registry).sort().join(',')!=='purpose,repo,schema_version,workflows'
    ||registry.schema_version!==1||registry.purpose!=='definition_source_only'||registry.repo!==s.repo
    ||!Array.isArray(registry.workflows)||new Set(registry.workflows.map(w=>w.id)).size!==registry.workflows.length)
    throw ciFailure('SOURCE_REGISTRY_INVALID');
  for(const owner of registry.workflows){
    const canonical=s.canonical.workflows.find(w=>w.id===owner.id);
    if(Object.keys(owner).sort().join(',')!==[...SOURCE_OWNER_FIELDS].sort().join(',')
      ||!SOURCE_OWNER_FIELDS.every(k=>typeof owner[k]==='string'&&owner[k].length>0)
      ||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.id)
      ||!/^[\w-]+$/.test(owner.source_capability)||owner.source_repo!==s.repo
      ||owner.source_path!==`product-map/contracts/${owner.source_capability}.yaml`
      ||!needs.some(n=>n.capability===owner.source_capability&&n.capability_id===owner.capability_id)
      ||!s.canonical.journeys.some(j=>j.id===owner.capability_id&&j.parent_journey_id!=null)
      ||(canonical?digest(sourceOwner(canonical))!==digest(owner):owner.status!=='retired'))
      throw ciFailure('SOURCE_REGISTRY_OWNER_INVALID');
  }
  for(const need of needs)if(registry.workflows.filter(w=>w.source_capability===need.capability&&w.capability_id===need.capability_id).length!==1)
    throw ciFailure('SOURCE_REGISTRY_OWNER_INVALID');
}
export function implementationSourceOwners(s){
  validateSourceRegistry(s);
  return [...s.canonical.workflows,...(s.source_registry?.workflows||[]).filter(w=>!s.canonical.workflows.some(c=>c.id===w.id))];
}
/** Factory 完整来源证据始终不授予流程执行权限。 */
function validateFactoryAdmission(snapshot){
  const registry=snapshot.consumer_registry;
  if(snapshot.snapshot_scope!=='consumer_evidence'||snapshot.execution_status!=='unknown'||!registry)
    throw ciFailure('COMPANION_FACTORY_INVALID');
  const {registry_sha256,...body}=registry;
  if(digest(body)!==registry_sha256)throw ciFailure('COMPANION_REGISTRY_DIGEST_MISMATCH');
  validateExistingOpsRegistry(registry);
  const identities=EXISTING_OPS_IDENTITIES, refs=identities.flatMap(i=>[i.reference_id,...i.unverified_reference_ids]);
  const unknown=identities.flatMap(i=>i.unverified_reference_ids);
  if(!sameIds(snapshot.canonical.references,refs)||digest(snapshot.canonical.references)!==digest(registry.references)
    ||digest(snapshot.canonical.workflows)!==digest(registry.workflows)
    ||digest(snapshot.canonical.activities)!==digest(registry.activities)
    ||digest(snapshot.canonical.steps)!==digest(registry.steps)
    ||!Array.isArray(snapshot.unverified_reference_ids)||snapshot.unverified_reference_ids.length!==6
    ||new Set(snapshot.unverified_reference_ids).size!==6||unknown.some(id=>!snapshot.unverified_reference_ids.includes(id))
    ||snapshot.definitions.workflows.length!==2||snapshot.definitions.activities.length!==2)
    throw ciFailure('COMPANION_FACTORY_IDENTITY_INVALID');
  for(const identity of identities){
    const workflow=snapshot.definitions.workflows.find(w=>w.workflow_id===identity.workflow_id);
    const activity=snapshot.definitions.activities.find(a=>a.activity_id===identity.activity_id);
    if(!workflow||!activity||workflow.payload.capability_id!==identity.capability_id
      ||workflow.payload.coverage?.status!=='unknown'
      ||!exactIds(workflow.payload.coverage.verified_reference_ids,[identity.reference_id])
      ||!exactIds(workflow.payload.coverage.unverified_reference_ids,identity.unverified_reference_ids)
      ||workflow.payload.activities?.length!==1
      ||workflow.payload.activities[0].reference_id!==identity.reference_id
      ||workflow.payload.activities[0].activity_id!==identity.activity_id
      ||workflow.payload.activities[0].activity_version_id!==activity.id)
      throw ciFailure('COMPANION_FACTORY_DEFINITION_INVALID');
    for(const row of [workflow,activity])if(row.payload.definition_scope!=='consumer_evidence'
      ||row.payload.source_scope!==EXISTING_OPS_SCOPE||row.payload.registration_sha256!==registry_sha256
      ||row.payload.contract?.executable!==false||row.payload.contract.key!==identity.workflow_key
      ||row.payload.contract.definition_scope!=='consumer_evidence'||row.payload.contract.source_basis!=='fixed_git_tree')throw ciFailure('COMPANION_FACTORY_EXECUTION_INVALID');
  }
}
function validateAdmissionCompanion(parent,admissionScope){
  const c=parent.admission_companion;
  const cross=crossCompanionParent(parent);
  const keys=['schema_version','purpose','scope','repo','revision','snapshot','companion_sha256',...(cross?['source_basis','registry_source','source_set']:[])];
  if((!companionParent(parent)&&!cross)||!c||c.schema_version!==1||c.purpose!=='admission_only'
    ||c.scope!==EXISTING_OPS_SCOPE||c.repo!==parent.repo||c.revision!==parent.revision
    ||Object.keys(c).some(k=>!keys.includes(k)))
    throw ciFailure('COMPANION_IDENTITY_INVALID');
  const {companion_sha256,...body}=c;
  if(digest(body)!==companion_sha256)throw ciFailure('COMPANION_DIGEST_MISMATCH');
  const child=c.snapshot;
  if(!child||Object.hasOwn(child,'admission_companion')||child.scope!==c.scope||child.repo!==c.repo||child.revision!==c.revision)
    throw ciFailure('COMPANION_SNAPSHOT_IDENTITY_INVALID');
  if(cross&&(c.source_basis!=='cross_repo_source_set'||c.registry_source?.repo!==EXISTING_OPS_REPO
    ||digest(c.registry_source)!==digest(child.registry_source)||!Array.isArray(c.source_set)
    ||digest(c.source_set)!==digest(child.source_set)))throw ciFailure('COMPANION_SOURCE_SET_INVALID');
  validateSnapshot(child,admissionScope);
  if(!['verified','unknown'].includes(child.status)||!Array.isArray(child.gaps)
    ||(child.status==='verified')!==(child.gaps.length===0))throw ciFailure('COMPANION_STATUS_INVALID');
  if(child.snapshot_scope!=='consumer_evidence'||child.execution_status!=='unknown'
    ||[...child.definitions.workflows,...child.definitions.activities].some(row=>row.payload.definition_scope!=='consumer_evidence'
      ||row.payload.source_scope!==EXISTING_OPS_SCOPE||row.payload.contract?.executable!==false))
    throw ciFailure('COMPANION_FACTORY_EXECUTION_INVALID');
  if(child.status==='verified')validateFactoryAdmission(child);
}
/** 提取前验证双身份，所有 scope 均通过后才暴露独立输入。 */
export function extractImplementationAdmissionSnapshots(snapshot,scopes){
  return extractAdmissionSnapshots(snapshot,scopes,{allowScratch:false});
}
export async function extractImplementationAdmissionSnapshotsForDatabase(db,snapshot,scopes){
  return extractAdmissionSnapshots(snapshot,scopes,await consumerSourceAdmissionScope(db));
}
function extractAdmissionSnapshots(snapshot,scopes,admissionScope){
  validateSnapshot(snapshot,admissionScope);
  if(!Array.isArray(scopes)||new Set(scopes).size!==scopes.length)throw ciFailure('ADMISSION_SCOPES_INVALID');
  if(scopes.length===1&&scopes[0]===snapshot.scope)return [snapshot];
  if(scopes.length!==2||(!companionParent(snapshot)&&!crossCompanionParent(snapshot))||!scopes.includes(snapshot.scope)||!scopes.includes(EXISTING_OPS_SCOPE)
    ||!Object.hasOwn(snapshot,'admission_companion'))throw ciFailure('ADMISSION_COMPANION_MISSING');
  const child=snapshot.admission_companion.snapshot;
  if([snapshot,child].some(s=>s.status!=='verified'||s.gaps?.length!==0))throw ciFailure('ADMISSION_SNAPSHOT_UNKNOWN');
  validateFactoryAdmission(child);
  return scopes.map(scope=>scope===snapshot.scope?snapshot:child);
}
function validateSnapshot(snapshot,admissionScope={allowScratch:false}){
  if(snapshot?.schema_version!==1)throw ciFailure('SNAPSHOT_INVALID');
  validateSnapshotQuery(snapshot);
  const {snapshot_sha256,...body}=snapshot;
  if(typeof snapshot_sha256!=='string'||digest(body)!==snapshot_sha256)throw ciFailure('SNAPSHOT_DIGEST_MISMATCH');
  if(snapshot.scope===EXISTING_OPS_SCOPE){
    if(snapshot.snapshot_scope!=='consumer_evidence'||snapshot.execution_status!=='unknown'
      ||digest(snapshot.unverified_reference_ids)!==digest(EXISTING_OPS_IDENTITIES.flatMap(i=>i.unverified_reference_ids)))throw ciFailure('FACTORY_EXECUTION_BOUNDARY_INVALID');
    try{validateExistingOpsRegistry(snapshot.consumer_registry);}catch{
      if(snapshot.status!=='unknown'||!snapshot.gaps?.some(g=>g.code==='factory_registry_identity_invalid'))throw ciFailure('FACTORY_REGISTRY_IDENTITY_INVALID');
    }
    const {registry_sha256,...registryBody}=snapshot.consumer_registry;
    if(digest(registryBody)!==registry_sha256)throw ciFailure('FACTORY_REGISTRY_DIGEST_MISMATCH');
    // 缺定义的 UNKNOWN 子证据可保留独立父输入；显式联合准入仍要求完整 verified。
    if(snapshot.status==='verified')for(const field of ['workflows','activities','references','steps'])if(digest(snapshot.canonical[field])!==digest(snapshot.consumer_registry[field]))throw ciFailure('FACTORY_CANONICAL_REGISTRY_MISMATCH');
  }
  const anchor=snapshot.registry_source||{repo:snapshot.repo,revision:snapshot.revision};
  if(snapshot.registry_source){
    if(snapshot.scope!==EXISTING_OPS_SCOPE||snapshot.repo!==CONTRACT_REPO||anchor.repo!==EXISTING_OPS_REPO||!Array.isArray(snapshot.source_set))throw ciFailure('CONSUMER_SOURCE_SET_INVALID');
    const missing=snapshot.status==='unknown'&&snapshot.gaps?.length>0&&anchor.revision===null
      &&snapshot.source_set.length===0&&snapshot.definitions.workflows.length===0&&snapshot.definitions.activities.length===0;
    if(!missing){
    if(!snapshot.source_set.some(s=>s.repo===snapshot.repo&&s.revision===snapshot.revision)
      ||!snapshot.source_set.some(s=>s.repo===anchor.repo&&s.revision===anchor.revision))throw ciFailure('CONSUMER_SOURCE_SET_INVALID');
    const expectedSources=[...new Map(snapshot.definitions.activities.flatMap(a=>a.payload.source_set||[]).map(s=>[`${s.repo}@${s.revision}`,s])).values()];
    const sourceKey=s=>JSON.stringify(s);
    if(snapshot.source_set.length!==expectedSources.length||snapshot.source_set.some(s=>!expectedSources.some(e=>sourceKey(e)===sourceKey(s)))
      ||new Set(snapshot.source_set.map(sourceKey)).size!==snapshot.source_set.length)throw ciFailure('CONSUMER_SOURCE_SET_INVALID');
    const owners=snapshot.definitions.activities.filter(row=>row.payload.implementation_bindings.some(b=>b.repo===snapshot.repo&&b.revision===snapshot.revision));
    if(!owners.length)throw ciFailure('CONSUMER_SOURCE_SET_INVALID');
    for(const row of owners)if(row.activity_id!==EXISTING_OPS_IDENTITIES.find(i=>i.workflow_key==='factory_f3_ops').activity_id||!sealedConsumerVersion(row)
      ||!row.payload.implementation_bindings.some(b=>b.repo===snapshot.repo&&b.revision===snapshot.revision&&hasFrozenConsumerSource(row.payload,b.repo,b.path,admissionScope)))throw ciFailure('CONSUMER_SOURCE_SET_INVALID');
    }
  }
  for(const kind of ['workflows','activities'])for(const row of snapshot.definitions[kind]){
    if(row.source_repo!==anchor.repo||row.source_commit!==anchor.revision||
      stepSha256({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload})!==row.payload_sha256)
      throw ciFailure('DEFINITION_DIGEST_MISMATCH');
  }
  validateSourceRegistry(snapshot);
  if(Object.hasOwn(snapshot,'admission_companion'))validateAdmissionCompanion(snapshot,admissionScope);
  return snapshot;
}
/** 默认同步验证不接受scratch准入；异步入口只由实际数据库身份派生权限。 */
export function validateImplementationSnapshot(snapshot){return validateSnapshot(snapshot);}
export async function validateImplementationSnapshotForDatabase(db,snapshot){return validateSnapshot(snapshot,await consumerSourceAdmissionScope(db));}
export async function readImplementationSnapshotInTransaction(db,q){
  const factory=q.scope===EXISTING_OPS_SCOPE;
  const gaps=[],gap=(code,details={})=>gaps.push({code,...details});
  if(factory&&![EXISTING_OPS_REPO,CONTRACT_REPO].includes(q.repo))gap('factory_source_repo_mismatch');
  const registrations=(await db.query('SELECT * FROM map_scope_repositories WHERE scope_key=$1 ORDER BY repo',[q.scope])).rows;
  const crossRequested=factory&&q.repo===CONTRACT_REPO;
  const repositories=registrations.filter(r=>crossRequested?r.adapter_config?.source_repo===EXISTING_OPS_REPO:r.repo===q.repo||r.adapter_config?.source_repo===q.repo);
  if(repositories.length!==1)gap(repositories.length?'scope_repository_ambiguous':'scope_repository_missing',{scope:q.scope,repo:q.repo});
  const crossConsumer=crossRequested&&repositories.length===1;
  const admissionScope=await consumerSourceAdmissionScope(db);
  let anchor={repo:q.repo,revision:q.revision};
  let candidates;const rowsMatchingCross=new Set();
  if(crossConsumer){
    const rows=(await db.query(`SELECT DISTINCT wv.* FROM workflow_definition_versions wv
      CROSS JOIN LATERAL jsonb_array_elements(wv.payload->'activities') ref(value)
      JOIN activity_definition_versions av ON av.id=(ref.value->>'activity_version_id')::uuid
      WHERE wv.source_repo='perfectuser21/cecelia' AND wv.payload->>'source_scope'=$1
      AND wv.payload->>'definition_scope'='consumer_evidence' AND wv.workflow_id=$4
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(av.payload->'implementation_bindings') b WHERE b->>'repo'=$2 AND b->>'revision'=$3)`,[q.scope,q.repo,q.revision,EXISTING_OPS_IDENTITIES.find(i=>i.workflow_key==='factory_f3_ops').workflow_id])).rows;
    for(const row of rows)rowsMatchingCross.add(row.id);
    const commits=[...new Set(rows.map(r=>r.source_commit))];
    if(commits.length!==1)gap('consumer_source_anchor_ambiguous');
    anchor={repo:'perfectuser21/cecelia',revision:commits.length===1?commits[0]:null};
    candidates=anchor.revision?(await db.query('SELECT * FROM workflow_definition_versions WHERE source_repo=$1 AND source_commit=$2 ORDER BY workflow_id,id',[anchor.repo,anchor.revision])).rows:[];
  }else candidates=(await db.query('SELECT * FROM workflow_definition_versions WHERE source_repo=$1 AND source_commit=$2 ORDER BY workflow_id,id',[q.repo,q.revision])).rows;
  candidates=candidates.filter(w=>factory?
    w.payload.definition_scope==='consumer_evidence'&&w.payload.source_scope===EXISTING_OPS_SCOPE&&EXISTING_OPS_IDENTITIES.some(i=>i.workflow_id===w.workflow_id):!['consumer_evidence','device_workflow_admission'].includes(w.payload.definition_scope));
  const workflows=factory?(await db.query('SELECT * FROM workflows WHERE id=ANY($1::uuid[]) ORDER BY id',[EXISTING_OPS_IDENTITIES.map(i=>i.workflow_id)])).rows:
    (await db.query('SELECT * FROM workflows WHERE source_repo=$1 ORDER BY id',[anchor.repo])).rows;
  const selected=[];
  for(const id of [...new Set(candidates.map(r=>r.workflow_id))]){
    let rows=candidates.filter(r=>r.workflow_id===id);
    if(crossConsumer&&id===EXISTING_OPS_IDENTITIES.find(i=>i.workflow_key==='factory_f3_ops').workflow_id)rows=rows.filter(r=>rowsMatchingCross.has(r.id));
    const current=rows.find(r=>r.id===workflows.find(w=>w.id===id)?.current_definition_version_id);
    if(current)selected.push(current);
    else if(rows.length===1)selected.push(rows[0]);
    else gap('definition_snapshot_ambiguous',{workflow_id:id,revision:q.revision});
  }
  if(crossConsumer)for(const w of selected)if(w.source_repo!==anchor.repo||w.source_commit!==anchor.revision
    ||w.payload_sha256!==stepSha256({source:{repo:w.source_repo,path:w.source_path,commit:w.source_commit},payload:w.payload}))gap('consumer_source_digest_mismatch',{workflow_id:w.workflow_id});
  if(!selected.length)gap('definition_snapshot_missing',{repo:q.repo,revision:q.revision});
  const activityVersions=[...new Set(selected.flatMap(w=>w.payload.activities.map(a=>a.activity_version_id)))];
  const activities=(await db.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[]) ORDER BY id',[activityVersions])).rows;
  if(activities.length!==activityVersions.length)gap('activity_snapshot_missing');
  if(crossConsumer)for(const a of activities){
    if(!sealedBrainConsumerDefinition(a)||a.source_commit!==anchor.revision)gap('consumer_source_digest_mismatch',{activity_id:a.activity_id});
    if(a.activity_id===EXISTING_OPS_IDENTITIES.find(i=>i.workflow_key==='factory_f3_ops').activity_id
      &&(!sealedConsumerVersion(a)||!a.payload.implementation_bindings.some(b=>b.repo===q.repo&&b.revision===q.revision&&hasFrozenConsumerSource(a.payload,b.repo,b.path,admissionScope))))gap('consumer_source_set_unknown',{activity_id:a.activity_id});
  }
  const workflowIds=selected.map(w=>w.workflow_id);
  const fullReferences=factory?(await db.query('SELECT * FROM workflow_activity_refs WHERE workflow_id=ANY($1::uuid[]) ORDER BY id',[workflowIds])).rows:null;
  const activityIds=factory?[...new Set(fullReferences.map(r=>r.activity_id))]:activities.map(a=>a.activity_id);
  const refs=factory?fullReferences.map(r=>r.id):selected.flatMap(w=>w.payload.activities.map(r=>r.reference_id));
  const canonicalActivities=(await db.query('SELECT * FROM activities WHERE id=ANY($1::uuid[]) ORDER BY id',[activityIds])).rows;
  const references=(await db.query('SELECT * FROM workflow_activity_refs WHERE id=ANY($1::uuid[]) ORDER BY id',[refs])).rows;
  const steps=(await db.query('SELECT * FROM steps WHERE activity_id=ANY($1::uuid[]) ORDER BY id',[activityIds])).rows;
  let manifest=null,manifestBasis='unknown';
  if(repositories.length===1){
    const historical=(await db.query(`SELECT DISTINCT m.* FROM map_manifest_versions m JOIN map_projection_runs p ON p.manifest_version_id=m.id
      WHERE m.scope_key=$1 AND p.scope_key=$1 AND p.fact_revisions->>$2=$3 AND p.status IN ('active','superseded') ORDER BY m.version DESC`,[q.scope,repositories[0].repo,anchor.revision])).rows.filter(r=>manifestMatchesImplementationSource(r.manifest,anchor.repo,anchor.revision));
    if(historical.length===1){manifest=historical[0];manifestBasis='historical_projection';}
    else if(historical.length>1)gap('manifest_snapshot_ambiguous',{revision:q.revision});
    else if((factory&&selected.length===EXISTING_OPS_IDENTITIES.length)||(selected.length&&selected.every(w=>workflows.find(c=>c.id===w.workflow_id)?.current_definition_version_id===w.id))){
      manifest=(await db.query("SELECT * FROM map_manifest_versions WHERE scope_key=$1 AND status='active'",[q.scope])).rows[0]||null;
      manifestBasis=factory?'consumer_registry':'current_registration';
    }
  }
  if(manifest&&!manifestMatchesImplementationSource(manifest.manifest,anchor.repo,anchor.revision))gap('manifest_source_mismatch',{revision:anchor.revision});
  if(!manifest)gap('scope_manifest_missing',{scope:q.scope,revision:q.revision});
  const capabilityIds=[...new Set(selected.map(w=>w.payload.capability_id))];
  // scope地图保留已退役能力；核实其规范身份，不把它们加入Workflow执行闭包。
  const mapCapabilityIds=(manifest?.manifest?.capabilities||[]).map(n=>n.brain_binding)
    .filter(b=>b?.entity_type==='capability'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.entity_id||''))
    .map(b=>b.entity_id);
  const journeys=(await db.query(`WITH RECURSIVE chain AS(SELECT * FROM ${TREE_NODES_SQL} n WHERE id=ANY($1::uuid[])
    UNION SELECT j.* FROM ${TREE_NODES_SQL} j JOIN chain c ON j.id=c.parent_journey_id) SELECT * FROM chain ORDER BY id`,[[...new Set([...capabilityIds,...mapCapabilityIds])]])).rows;
  const mapped=new Set();
  for(const node of manifest?.manifest?.capabilities||[]){
    const b=node.brain_binding;
    if(!b||b.entity_type!=='capability'||!journeys.some(j=>j.id===b.entity_id&&j.parent_journey_id))gap('capability_mapping_missing',{node_key:node.key});
    else if(b.source_repo!==anchor.repo)gap('capability_source_repo_mismatch',{node_key:node.key,source_repo:b.source_repo});
    else mapped.add(b.entity_id);
  }
  for(const id of capabilityIds)if(!mapped.has(id))gap('workflow_capability_unmapped',{capability_id:id});
  const areaIds=[...new Set(journeys.map(j=>j.area_id).filter(Boolean))];
  const areas=(await db.query('SELECT * FROM areas WHERE id=ANY($1::uuid[]) ORDER BY id',[areaIds])).rows;
  const assertions=(await db.query('SELECT * FROM activity_cells WHERE journey_id=ANY($1::uuid[]) AND step_id=ANY($2::uuid[]) ORDER BY id',[capabilityIds,activityIds])).rows;
  const sourceSet=crossConsumer?[...new Map(activities.flatMap(a=>a.payload.source_set||[]).map(s=>[`${s.repo}@${s.revision}`,s])).values()]:null;
  let consumerRegistry=null;
  if(factory){
    consumerRegistry=await readExistingOpsRegistry(db);
    try{validateExistingOpsRegistry(consumerRegistry);}catch{gap('factory_registry_identity_invalid');}
    if([...selected,...activities].some(w=>w.payload.registration_sha256!==consumerRegistry.registry_sha256))gap('factory_registry_changed');
  }
  const sourceRegistry=freezeSourceRegistry(q,selected,workflows,gap);
  const body=json({schema_version:1,...q,...(sourceRegistry?{source_registry:sourceRegistry}:{}),...(crossRequested?{registry_source:crossConsumer?anchor:{repo:EXISTING_OPS_REPO,revision:null},source_set:sourceSet||[]}:{}),status:gaps.length?'unknown':'verified',gaps,
    ...(factory?{snapshot_scope:'consumer_evidence',execution_status:'unknown',consumer_registry:consumerRegistry,unverified_reference_ids:EXISTING_OPS_IDENTITIES.flatMap(i=>i.unverified_reference_ids)}:{}),
    canonical:{areas,journeys,workflows:workflows.filter(w=>workflowIds.includes(w.id)),activities:canonicalActivities,steps,references},
    definitions:{workflows:selected,activities},map:{manifest,repositories,source_basis:manifestBasis},assertion_source:'current_registration',assertions});
  return {...body,snapshot_sha256:digest(body)};
}
export async function exportImplementationSnapshot(pool,input){
  const q=validateSnapshotQuery(input),db=await pool.connect();
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    let result=await readImplementationSnapshotInTransaction(db,q);
    if(companionParent(q)||crossCompanionParent(q)){
      const snapshot=await readImplementationSnapshotInTransaction(db,{...q,scope:EXISTING_OPS_SCOPE});
      const companion={schema_version:1,purpose:'admission_only',scope:EXISTING_OPS_SCOPE,repo:q.repo,revision:q.revision,
        ...(crossCompanionParent(q)?{source_basis:'cross_repo_source_set',registry_source:snapshot.registry_source||{repo:EXISTING_OPS_REPO,revision:null},source_set:snapshot.source_set||[]}:{}),snapshot};
      const {snapshot_sha256:_snapshotSha256,...body}=result;
      body.admission_companion={...companion,companion_sha256:digest(companion)};
      result={...body,snapshot_sha256:digest(body)};
    }
    await db.query('COMMIT');return result;
  }
  catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
/** 目标主机与仓库由受信adapter常量选择，外部输入只作为编码后的path/query。 */
export function implementationGitHubUrl(repo,{path,revision}={}){
  const base=repo===CONTRACT_REPO?'https://api.github.com/repos/perfectuser21/zenithjoy-workspace':
    repo==='perfectuser21/cecelia'?'https://api.github.com/repos/perfectuser21/cecelia':null;
  if(!base)throw ciFailure('SYNC_ADAPTER_MISSING');
  if(path===undefined)return `${base}/commits/main`;
  if(typeof path!=='string'||!path||path.split('/').some(p=>!p||p==='.'||p==='..')
    ||typeof revision!=='string'||!/^[0-9a-f]{40}$/.test(revision))throw ciFailure('SOURCE_PATH_INVALID');
  return `${base}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(revision)}`;
}
/** 原同步已回滚归还连接；仅复用同M赢家完整产物，不重同步或代赢家推进地图。 */
async function reuseConcurrentSnapshot(pool,q,checkMain,conflict,waitMs){
  const deadline=Date.now()+Math.min(5000,Math.max(0,Number.isFinite(waitMs)?waitMs:5000));
  await checkMain();
  while(Date.now()<deadline){
    // 人改映射/父级不能被一次CAS重试掩盖；此函数只读，不执行返回的接力计划。
    await preparePilotManifestAdvance(pool,q);
    const snapshot=await exportImplementationSnapshot(pool,q);
    if(Date.now()>=deadline)throw conflict;
    if(snapshot.scope!==q.scope||snapshot.repo!==q.repo||snapshot.revision!==q.revision)throw conflict;
    if(snapshot.status==='verified'&&snapshot.gaps.length===0){
      await checkMain();if(Date.now()>=deadline)throw conflict;return snapshot;
    }
    if(snapshot.gaps.some(g=>!['manifest_source_mismatch','scope_manifest_missing','definition_snapshot_missing'].includes(g.code)))throw conflict;
    const remaining=deadline-Date.now();if(remaining<=0)break;
    await new Promise(resolve=>setTimeout(resolve,Math.min(50,remaining)));
  }
  await checkMain();
  throw conflict;
}
export async function refreshImplementationSnapshot(pool,input,{fetchFn=globalThis.fetch,resolveToken=resolveGitHubToken,
  readBinding,conflictWaitMs=5000,allowRepos=(process.env.CECELIA_IMPLEMENTATION_CI_REPOS??`${CONTRACT_REPO},perfectuser21/cecelia`).split(',').map(r=>r.trim()).filter(Boolean)}={}){
  const q=validateSnapshotQuery(input);
  const consumer=input?.workspace_consumer;
  if(consumer!==undefined&&(q.scope!==EXISTING_OPS_SCOPE||q.repo!==EXISTING_OPS_REPO
    ||!consumer||Object.keys(consumer).sort().join(',')!=='brain_revisions,run_id,workspace_revision'
    ||!/^[a-f0-9]{40}$/.test(consumer.workspace_revision||'')||!Array.isArray(consumer.brain_revisions)
    ||consumer.brain_revisions.length<1||consumer.brain_revisions.length>2
    ||consumer.brain_revisions.some(r=>typeof r!=='string'||!/^[a-f0-9]{40}$/.test(r))
    ||new Set(consumer.brain_revisions).size!==consumer.brain_revisions.length
    ||!Number.isSafeInteger(consumer.run_id)||consumer.run_id<=0))throw ciFailure('CONSUMER_REFRESH_INPUT_INVALID');
  if(!allowRepos.includes(q.repo))throw ciFailure('REFRESH_UNCONFIGURED','main同步repo未授权',503);
  if(![CONTRACT_REPO,'perfectuser21/cecelia'].includes(q.repo))throw ciFailure('SYNC_ADAPTER_MISSING','该repo缺少固定main同步adapter',422);
  const checkRegistration=async()=>{
    const rows=(await pool.query(`SELECT repo FROM map_scope_repositories WHERE scope_key=$1
      AND (repo=$2 OR adapter_config->>'source_repo'=$2)`,[q.scope,q.repo])).rows;
    if(rows.length!==1)throw ciFailure(rows.length?'SCOPE_REPOSITORY_AMBIGUOUS':'SCOPE_REPOSITORY_MISSING','同步前必须存在唯一scope源码登记');
  };
  await checkRegistration();
  const token=await resolveToken();
  const checkMain=async()=>{
    await checkRegistration();
    const response=await fetchFn(implementationGitHubUrl(q.repo),{redirect:'error',headers:{Accept:'application/vnd.github.sha',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw ciFailure('MAIN_UNAVAILABLE','远端main不可读',503);
    if((await response.text()).trim()!==q.revision)throw ciFailure('MAIN_MOVED','请求revision不等于远端main',409);
  };
  await checkMain();
  const pilotPlan=q.scope===EXISTING_OPS_SCOPE ? await prepareExistingOpsManifestAdvance(pool,q) : await preparePilotManifestAdvance(pool,q);
  if(q.repo===CONTRACT_REPO){
    try{await syncActivityContracts(pool,{fetchFn,resolveToken:async()=>token,expectedRevision:q.revision,beforeCommit:checkMain,synchronizeSteps:true,readBinding});}
    catch(error){
      if(error.code!=='ACTIVITY_CONTRACT_SNAPSHOT_CHANGED'||error.status!==409)throw error;
      return reuseConcurrentSnapshot(pool,q,checkMain,error,conflictWaitMs);
    }
  }
  else{
    const readFile=async(path,revision=q.revision)=>{
      const response=await fetchFn(implementationGitHubUrl(q.repo,{path,revision}),{redirect:'error',headers:{Accept:'application/vnd.github.raw',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw ciFailure('SOURCE_UNAVAILABLE',`固定源码不可读: ${path}`);return response.text();
    };
    if(q.scope===EXISTING_OPS_SCOPE){
      const headers={Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`};
      const commitResponse=await fetchFn(`https://api.github.com/repos/perfectuser21/cecelia/git/commits/${q.revision}`,{redirect:'error',headers,signal:AbortSignal.timeout(15000)});
      if(!commitResponse.ok)throw ciFailure('SOURCE_COMMIT_UNAVAILABLE');
      const commit=await commitResponse.json();
      if(commit.sha!==q.revision||!/^[a-f0-9]{40}$/.test(commit.tree?.sha||''))throw ciFailure('SOURCE_COMMIT_MISMATCH');
      const response=await fetchFn(`https://api.github.com/repos/perfectuser21/cecelia/git/trees/${commit.tree.sha}?recursive=1`,{redirect:'error',headers,signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw ciFailure('SOURCE_TREE_UNAVAILABLE');
      const tree=await response.json();
      if(tree.truncated||tree.sha!==commit.tree.sha||!Array.isArray(tree.tree))throw ciFailure('SOURCE_TREE_INCOMPLETE');
      const paths=tree.tree.filter(n=>n.type==='blob').map(n=>n.path),registry=await readExistingOpsRegistry(pool);
      let workspaceConsumerProof;
      if(consumer!==undefined){
        const {unverified_reference_ids:_unverifiedReferenceIds,...identity}=EXISTING_OPS_IDENTITIES.find(i=>i.workflow_key==='factory_f3_ops');
        workspaceConsumerProof=await collectWorkspaceConsumerSourceSet({
          workspace:{repo:CONTRACT_REPO,revision:consumer.workspace_revision},
          brain:{repo:EXISTING_OPS_REPO,revisions:consumer.brain_revisions},identity,
          anchor:{repo:q.repo,revision:q.revision},run_id:consumer.run_id
        },{fetchFn,resolveToken:async()=>token});
        if(!isTrustedWorkspaceConsumerSource(workspaceConsumerProof))throw ciFailure('CONSUMER_MAIN_SOURCE_UNKNOWN');
      }
      await registerExistingOpsSources(pool,{...q,paths,readSource:readFile,checkMain,workspaceConsumerProof,expectedRegistrySha256:registry.registry_sha256,actor:'implementation-ci-main-refresh'});
    }else{
      const text=await readFile('packages/brain/config/company-kr-workflow.json'),spec=JSON.parse(text);
      await registerCompanyKrWorkflow(pool,{spec,revision:q.revision,readSource:async()=>text,beforeCommit:checkMain,definitionsOnly:true,
        readBinding:readBinding||(b=>{if(b.repo!==q.repo)throw ciFailure('CROSS_REPO_SNAPSHOT_MISSING');return readFile(b.path,b.revision);})});
    }
  }
  await checkMain();await advancePilotManifest(pool,pilotPlan,checkMain);return exportImplementationSnapshot(pool,q);
}

/** 唯一登记键的窄入口；不接收路径、扫描命令或任意adapter参数。 */
export async function registerImplementationRepository(pool,input){
  const validText=(value,pattern)=>typeof value==='string'&&pattern.test(value);
  if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['scope_key','repo','adapter_key','adapter_config'].includes(k))
    ||!validText(input.scope_key,/^[a-z][a-z0-9-]{0,127}$/)||!validText(input.repo,/^[\w.-]+(?:\/[\w.-]+)?$/)
    ||input.adapter_key!=='legacy-ledger-v1'||!input.adapter_config||Array.isArray(input.adapter_config)
    ||Object.keys(input.adapter_config).some(k=>k!=='source_repo')||!validText(input.adapter_config.source_repo,/^[\w.-]+\/[\w.-]+$/))
    throw ciFailure('REPOSITORY_INPUT_INVALID','只接受scope/repo/legacy-ledger-v1及明确source_repo',400);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('implementation-ci-repositories'))");
    const rows=(await client.query(`SELECT * FROM map_scope_repositories WHERE repo=$1 OR
      (scope_key=$2 AND adapter_config->>'source_repo'=$3) FOR UPDATE`,[input.repo,input.scope_key,input.adapter_config.source_repo])).rows;
    if(rows.length){
      const row=rows[0];
      if(rows.length!==1||row.repo!==input.repo||row.scope_key!==input.scope_key||row.adapter_key!==input.adapter_key
        ||JSON.stringify(row.adapter_config)!==JSON.stringify(input.adapter_config))throw ciFailure('REPOSITORY_CONFLICT','登记键或scope canonical来源已被占用',409);
      await client.query('COMMIT');return {repository:row,created:false};
    }
    const row=(await client.query('INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES($1,$2,$3,$4) RETURNING *',
      [input.scope_key,input.repo,input.adapter_key,input.adapter_config])).rows[0];
    await client.query('COMMIT');return {repository:row,created:true};
  }catch(error){await client.query('ROLLBACK');if(error.code==='23505')throw ciFailure('REPOSITORY_CONFLICT','登记关系唯一约束冲突',409);throw error;}
  finally{client.release();}
}
