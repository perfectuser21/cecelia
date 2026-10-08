/** scope登记与固定历史地图上下文；不以当前active地图改写旧membership。 */
import {sealedConsumerVersion,hasFrozenConsumerSource,consumerSourceAdmissionScope} from './consumer-source-set.js';
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function manifestMatchesImplementationSource(manifest,repo,revision) {
  const nodes=[...(manifest?.value_streams||[]),...(manifest?.capabilities||[])];
  return nodes.length>0&&nodes.every(n=>n.brain_binding?.source_repo===repo&&n.brain_binding?.source_revision===revision);
}
export async function resolveImplementationRegistryRepo(db,q) {
  const rows=(await db.query(`SELECT repo FROM map_scope_repositories WHERE scope_key=$1 AND (repo=$2 OR adapter_config->>'source_repo'=$2)`,[q.scope,q.repo])).rows;
  if(rows.length!==1)throw Object.assign(Error('scope与源码repo须有唯一显式登记'),{code:'MAP_IMPLEMENTATION_REPO_NOT_CONFIGURED',status:422});
  return rows[0].repo;
}
export async function loadImplementationRevisionContext(db,q,revision,registry,projectionDigest,gaps) {
  const candidates=(await db.query(`SELECT p.id projection_run_id,p.projection_digest,p.manifest_digest projection_manifest_digest,p.fact_revisions,
    m.id manifest_version_id,m.digest manifest_digest,m.manifest
    FROM map_projection_runs p JOIN map_manifest_versions m ON m.id=p.manifest_version_id
    WHERE p.scope_key=$1 AND m.scope_key=$1 AND p.status IN ('active','superseded') AND p.fact_revisions->>$2=$3
      AND ($4::text IS NULL OR p.projection_digest=$4) ORDER BY p.created_at DESC,p.id`,[q.scope,registry,revision,projectionDigest||null])).rows;
  const rows=candidates.filter(r=>manifestMatchesImplementationSource(r.manifest,q.repo,revision));
  if(!rows.length)for(const c of candidates)for(const [field,type] of [['capabilities','capability'],['value_streams','value_stream']])for(const node of c.manifest[field]||[]){
    const b=node.brain_binding;
    if(!b)gaps.push({code:`${type}_mapping_missing`,node_key:node.key,revision});
    else if(b.source_repo!==q.repo||b.source_revision!==revision)gaps.push({code:`${type}_source_mismatch`,node_key:node.key,revision});
  }
  if(!rows.length){gaps.push({code:'projection_snapshot_missing',revision});return null;}
  if(new Set(rows.map(row=>`${row.manifest_digest}:${row.projection_digest}`)).size>1){gaps.push({code:'projection_snapshot_ambiguous',revision});return null;}
  const context=rows[0],mapped=new Map();
  if(context.manifest_digest!==context.projection_manifest_digest)gaps.push({code:'projection_manifest_mismatch',revision});
  const nodes=(await db.query("SELECT node_key,attributes FROM map_projection_nodes WHERE run_id=$1 AND node_type='capability'",[context.projection_run_id])).rows;
  for(const node of context.manifest.capabilities||[]){
    const binding=node.brain_binding;
    if(!binding||binding.entity_type!=='capability'||!UUID.test(binding.entity_id||'')){gaps.push({code:'capability_mapping_missing',node_key:node.key});continue;}
    mapped.set(binding.entity_id.toLowerCase(),node.key);
    if(binding.source_repo!==q.repo||binding.source_revision!==revision)gaps.push({code:'capability_source_mismatch',node_key:node.key,revision});
    const projected=nodes.find(n=>n.node_key===node.key)?.attributes;
    if(projected?.canonical_entity_id?.toLowerCase()!==binding.entity_id.toLowerCase()||projected?.mapping_status!=='verified')gaps.push({code:'capability_mapping_unverified',node_key:node.key});
  }
  return {...context,mapped,registryRepo:registry};
}

/** 显式Workflow版本查询；缺scope历史证据时保留版本membership，但不得宣称scope已核验。 */
export async function loadHistoricalImplementationContext(db,q,gaps) {
  const registry=await resolveImplementationRegistryRepo(db,q);
  const version=(await db.query('SELECT * FROM workflow_definition_versions WHERE id=$1',[q.versionId])).rows[0];
  if(!version)throw Object.assign(Error('Workflow定义版本不存在'),{code:'MAP_WORKFLOW_VERSION_NOT_FOUND',status:404});
  let sourceQuery=q;
  if(q.scope==='cecelia-factory'&&version.source_repo===registry&&registry==='perfectuser21/cecelia'
    &&version.payload.definition_scope==='consumer_evidence'&&version.payload.source_scope===q.scope
    &&version.payload_sha256===stepSha256({source:{repo:version.source_repo,path:version.source_path,commit:version.source_commit},payload:version.payload})){
    const ids=version.payload.activities.map(r=>r.activity_version_id);
    const activities=(await db.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[])',[ids])).rows;
    const admissionScope=await consumerSourceAdmissionScope(db);
    const witness=activities.some(a=>sealedConsumerVersion(a)&&a.source_repo===version.source_repo&&a.source_commit===version.source_commit
      &&hasFrozenConsumerSource(a.payload,q.repo,q.path,admissionScope)&&a.payload.implementation_bindings.some(b=>b.kind===q.kind&&b.repo===q.repo&&b.path===q.path&&b.revision===q.revision&&(!q.digest||b.digest===q.digest)));
    if(witness)sourceQuery={...q,repo:version.source_repo,revision:version.source_commit};
  }
  if(version.source_repo!==sourceQuery.repo||version.source_commit!==sourceQuery.revision)gaps.push({code:'workflow_definition_source_mismatch',workflow_definition_version_id:version.id});
  const snapshot=(await db.query('SELECT source_revision,row_count FROM graph_snapshot_versions WHERE repo=$1 AND source_revision=$2',[registry,sourceQuery.revision])).rows[0];
  if(!snapshot)gaps.push({code:'graph_snapshot_missing',repo:registry,revision:sourceQuery.revision});
  else {
    const count=(await db.query('SELECT count(*)::int count FROM graph_edge_snapshots WHERE repo=$1 AND source_revision=$2',[registry,sourceQuery.revision])).rows[0].count;
    if(Number(snapshot.row_count)!==count)gaps.push({code:'graph_snapshot_incomplete',revision:sourceQuery.revision});
  }
  const context=await loadImplementationRevisionContext(db,sourceQuery,sourceQuery.revision,registry,null,gaps);
  if(context){
    if(!context.mapped.has(version.payload.capability_id))gaps.push({code:'workflow_scope_membership_mismatch',workflow_definition_version_id:version.id});
    return {...context,scope_status:context.mapped.has(version.payload.capability_id)?'verified':'unknown'};
  }
  return {registryRepo:registry,mapped:new Map([[version.payload.capability_id,null]]),scope_status:'unknown',
    manifest_version_id:null,manifest_digest:null,projection_run_id:null,projection_digest:null};
}
