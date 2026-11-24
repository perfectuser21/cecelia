import {INFRA_CONSUMER_SCOPE,buildInfraConsumerSources,registerInfraConsumerSources,readInfraConsumerRegistry,prepareInfraManifestAdvance} from '../../packages/brain/src/lib/infra-consumer-source.js';
/** 仅scratch：复用中央身份和正式投影器，固定git产生两侧不可变图。 */
export {createImplementationScratch} from './implementation-scratch.mjs';
import {fixedLocalGit,readFixedLocalGitBlob,fixedLocalSourceOptions} from './fixed-local-git.mjs';
import { loadActivityContracts } from '../../packages/brain/src/lib/activity-contract-loader.js';
import { storeActivityContracts,REGISTRATIONS_SQL } from '../../packages/brain/src/lib/activity-contract-store.js';
import { validateFixedImplementationBindings } from '../../packages/brain/src/workflow-authoring/fixed-git-source.js';
import { exportImplementationSnapshot } from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import { stepSha256 } from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import { lintImplementationRegistry } from './registry-lint.mjs';
import { classifyAssertionRef } from '../../packages/brain/src/lib/gp-assertion-command.js';
import { realpathSync } from 'node:fs';
import { validateImplementationSnapshot,validateImplementationSnapshotForDatabase,implementationSourceOwners,ciFailure,isImplementationScratchDatabase } from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import { runProjection } from '../../packages/brain/src/map/projector.js';
import { digestMapManifest,validateMapManifest } from '../../packages/brain/src/lib/map-manifest-schema.js';
import { replaceRepoEdges } from '../../packages/brain/src/lib/graph-store.js';
import { EXISTING_OPS_SCOPE } from '../../packages/brain/src/lib/existing-ops-source.js';

const TABLE_KEYS={map_scope_repositories:['scope_key','repo']};
async function insertRow(db,table,row,{immutable=false,preserve=[]}={}){
  const generated=new Set((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND is_generated<>'NEVER'",[table])).rows.map(r=>r.column_name));
  const keys=Object.keys(row).filter(k=>!generated.has(k));
  if(keys.some(k=>!/^\w+$/.test(k)))throw ciFailure('SNAPSHOT_COLUMN_INVALID');
  const columns=keys.map(k=>`"${k}"`).join(','),identity=TABLE_KEYS[table]||['id'];
  const update=keys.filter(k=>!identity.includes(k)&&!preserve.includes(k)).map(k=>`"${k}"=EXCLUDED."${k}"`).join(',');
  await db.query(`INSERT INTO ${table}(${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::${table},$1::jsonb)
    ON CONFLICT(${identity.join(',')}) DO ${immutable?'NOTHING':`UPDATE SET ${update}`}`,[JSON.stringify(row)]);
}
export async function importImplementationSnapshot(db,input){
  const actual=(await db.query('SELECT current_database() name')).rows[0]?.name;
  if(!isImplementationScratchDatabase(actual))throw ciFailure('SCRATCH_REQUIRED');
  const s=await validateImplementationSnapshotForDatabase(db,input);
  if(s.status!=='verified'||s.gaps.length)throw ciFailure('SNAPSHOT_UNKNOWN',JSON.stringify(s.gaps));
  await db.query('BEGIN');
  try{
    if(s.scope===INFRA_CONSUMER_SCOPE)for(const row of s.consumer_registry.skills)await insertRow(db,'skill_registry',row);
    for(const row of s.canonical.areas)await insertRow(db,'areas',row);
    for(const row of s.canonical.journeys)await insertRow(db,row.parent_journey_id==null?'value_streams':'capabilities',row);
    for(const row of s.canonical.workflows)await insertRow(db,'workflows',{...row,current_definition_version_id:null},{preserve:[EXISTING_OPS_SCOPE,INFRA_CONSUMER_SCOPE].includes(s.scope)?['current_definition_version_id']:[]});
    for(const row of implementationSourceOwners(s).filter(w=>!s.canonical.workflows.some(c=>c.id===w.id))){
      // 隔离库可保留base历史版本，但退役取源owner不得保留current执行入口。
      const previous=(await db.query('SELECT * FROM workflows WHERE id=$1',[row.id])).rows[0];
      if(previous&&['key','capability_id','source_repo','source_path','source_capability','source_workflow'].some(k=>previous[k]!==row[k]))
        throw ciFailure('SOURCE_REGISTRY_IMPORT_CONFLICT');
      await insertRow(db,'workflows',{...row,current_definition_version_id:null});
      await db.query('UPDATE workflow_activity_refs SET active=false WHERE workflow_id=$1 AND active',[row.id]);
    }
    for(const row of s.canonical.activities)await insertRow(db,'activities',{...row,current_definition_version_id:null},{preserve:[EXISTING_OPS_SCOPE,INFRA_CONSUMER_SCOPE].includes(s.scope)?['current_definition_version_id']:[]});
    for(const row of s.canonical.steps)await insertRow(db,'steps',row);
    for(const row of s.definitions.activities)await insertRow(db,'activity_definition_versions',row,{immutable:true});
    for(const row of s.definitions.workflows)await insertRow(db,'workflow_definition_versions',row,{immutable:true});
    // 活跃关系是当前登记；固定版本查询始终走WV.payload，不用此表改写历史。
    for(const row of s.canonical.references)await insertRow(db,'workflow_activity_refs',{...row,activity_definition_version_id:null},{preserve:[EXISTING_OPS_SCOPE,INFRA_CONSUMER_SCOPE].includes(s.scope)?['activity_definition_version_id']:[]});
    for(const row of s.definitions.workflows)if(row.payload.definition_scope!=='consumer_evidence')await db.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[row.workflow_id,row.id]);
    for(const row of s.definitions.activities)if(row.payload.definition_scope!=='consumer_evidence')await db.query('UPDATE activities SET current_definition_version_id=$2 WHERE id=$1',[row.activity_id,row.id]);
    for(const row of s.map.repositories)await insertRow(db,'map_scope_repositories',row);
    // 断言来源保持current_registration，两侧使用同一明确导出的登记。
    for(const row of s.assertions)await insertRow(db,'activity_cells',row);
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
}
function definitionEdgePath(path){
  if(typeof path!=='string'||!path.trim()||path!==path.trim()||path.startsWith('/')||path.includes('\\')||path.includes('\0')||path.split('/').some(p=>!p||p==='.'||p==='..')){
    throw ciFailure('DEFINITION_GRAPH_PATH_INVALID','定义依赖边必须有合法仓库相对文件路径');
  }
  return path;
}
export function definitionEdges(s){
  const edges=[];
  for(const w of s.definitions.workflows)for(const ref of w.payload.activities){
    const a=s.definitions.activities.find(a=>a.id===ref.activity_version_id);
    for(const binding of a?.payload.implementation_bindings||[]){
      if(binding.repo!==s.repo||binding.revision!==s.revision||!['code','skill'].includes(binding.kind)||binding.status!=='verified')continue;
      definitionEdgePath(binding.path);
      // 原生短形定义沿用所在仓库；跨仓定义默认归真实登记锚，不能变成实现仓的同名路径。
      const definitionSources=[w,a].map(row=>({repo:row.source_repo??s.registry_source?.repo??s.repo,path:definitionEdgePath(row.source_path)}));
      for(const source of new Set([...definitionSources.filter(row=>row.repo===s.repo).map(row=>row.path),...(s.adapter_evidence?.adapter==='activity-contracts-v1'&&s.adapter_evidence.revision===s.revision?[s.adapter_evidence.path]:[])])){definitionEdgePath(source);if(source!==binding.path)edges.push({src_path:binding.path,dst_path:source,edge_type:'import',
        detail:{via:'frozen_definition',workflow_definition_version_id:w.id,activity_definition_version_id:a.id,source_revision:s.revision}});}
      for(const assertion of s.assertions.filter(r=>r.journey_id===w.payload.capability_id&&r.step_id===a.activity_id)){
        let shape;try{shape=classifyAssertionRef(assertion.assertion_ref);}catch{continue;}
        if(shape.kind==='probe')continue; // 业务探针仍在登记中，没有代码文件依赖。
        const path=definitionEdgePath(shape.path);
        if(path!==binding.path)edges.push({src_path:binding.path,dst_path:path,edge_type:'import',detail:{via:'current_assertion_registration',
          assertion_source:'current_registration',source_repo_basis:'activity_definition',source_repo:s.repo,
          journey_step_link_id:assertion.id,assertion_revision:assertion.assertion_revision,activity_definition_version_id:a.id}});
      }

    }
  }
  return edges;
}
export async function verifySnapshotSource(s,repoRoot,{db}={}){
  if(s.scope===EXISTING_OPS_SCOPE)throw ciFailure('FACTORY_COLLECTION_RETIRED','工厂消费者来源重验已退役；既有历史仍可只读查询',410);
  if(db)await validateImplementationSnapshotForDatabase(db,s);else validateImplementationSnapshot(s);
  if(s.scope===INFRA_CONSUMER_SCOPE){
    const paths=fixedLocalGit(repoRoot,['ls-tree','-rz','--name-only',s.revision],{encoding:'utf8'}).split('\0').filter(Boolean);
    const proof=await buildInfraConsumerSources({...s,paths,readSource:async path=>readFixedLocalGitBlob(repoRoot,{revision:s.revision,path}).toString('utf8')});
    const activity=s.definitions.activities[0];
    if(stepSha256(activity?.payload.implementation_bindings)!==stepSha256(proof.bindings)||stepSha256(activity?.payload.input_relations)!==stepSha256(proof.input_relations))throw ciFailure('CONSUMER_SOURCE_MISMATCH');
    return s;
  }
  return verifyGeneratedSource(s,repoRoot);
}
async function verifyGeneratedSource(s,repoRoot){
  if(s.repo!=='perfectuser21/zenithjoy-workspace')return s;
  const path='product-map/generated/contracts.json';
  const read=path=>fixedLocalGit(repoRoot,['show',`${s.revision}:${path}`],{encoding:'utf8'});
  let text;try{text=read(path);}catch{return s;}
  const digest=JSON.parse(text),owners=implementationSourceOwners(s);
  const plans=await loadActivityContracts(s.canonical.workflows,digest,read,owners);
  for(const plan of plans){
    const version=s.definitions.workflows.find(w=>w.workflow_id===plan.workflow.id);
    if(!version||version.contract_sha256!==stepSha256(plan.contract))throw ciFailure('GENERATED_SOURCE_MISMATCH','固定定义与generated声明来源不同');
  }
  return {...s,adapter_evidence:{adapter:'activity-contracts-v1',path,revision:s.revision,digest_sha256:stepSha256(digest)}};
}
export async function projectImplementationSnapshot(db,s,repoRoot){
  await validateImplementationSnapshotForDatabase(db,s);
  s=await verifySnapshotSource(s,repoRoot,{db});
  const edges=definitionEdges(s); // 在写隔离扫描图之前先拒绝无效定义路径。
  const registryRepo=s.map.repositories[0].repo;
  await scanFixedImplementationGraph(db,registryRepo,repoRoot,s.revision,edges);
  const manifest=structuredClone(s.map.manifest.manifest);
  // 组织UUID仍来自登记；仅本次隔离扫描的source_revision重新钉到实际Git。
  for(const node of [...manifest.value_streams,...manifest.capabilities])if(node.brain_binding?.source_repo===s.repo)node.brain_binding.source_revision=s.revision;
  const digest=digestMapManifest(manifest),client=await db.connect();
  try{
    await client.query('BEGIN');await client.query("UPDATE map_manifest_versions SET status='superseded' WHERE scope_key=$1 AND status='active'",[s.scope]);
    let row=(await client.query('SELECT id FROM map_manifest_versions WHERE scope_key=$1 AND digest=$2',[s.scope,digest])).rows[0];
    if(!row)row=(await client.query(`INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at)
      SELECT $1,COALESCE(max(version),0)+1,$2,$3,$4,'active',NOW() FROM map_manifest_versions WHERE scope_key=$1 RETURNING id`,
      [s.scope,s.map.manifest.source_decision_id,manifest,digest])).rows[0];
    else await client.query("UPDATE map_manifest_versions SET status='active' WHERE id=$1",[row.id]);
    const projected=await runProjection({client,manifestId:row.id,manifestDigest:digest,scopeKey:s.scope,manifest});
    await client.query('COMMIT');return projected;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

/** Replay a frozen Factory manifest only inside the actual isolated scratch DB.
 * Central decisions are not imported; their original anchor remains unchanged.
 * Production continues to use the authenticated manifest store unchanged.
 */
export async function advanceExistingOpsScratchManifest(db,query){
  if(query.scope===EXISTING_OPS_SCOPE)throw ciFailure('FACTORY_COLLECTION_RETIRED','工厂消费者来源地图推进已退役',410);
  const checkScratch=async()=>{
    const name=(await db.query('SELECT current_database() name')).rows[0].name;
    if(!isImplementationScratchDatabase(name))throw ciFailure('SCRATCH_REQUIRED');
  };
  await checkScratch();
  const plan=await prepareInfraManifestAdvance(db,query);
  if(!plan)return;
  if(!validateMapManifest(plan.manifest).valid)throw ciFailure('SCRATCH_MANIFEST_INVALID');
  const client=await db.connect(),digest=digestMapManifest(plan.manifest);
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))',[`map-manifest:${query.scope}`]);
    const active=(await client.query("SELECT id,digest,source_decision_id FROM map_manifest_versions WHERE scope_key=$1 AND status='active' FOR UPDATE",[query.scope])).rows;
    if(active.length!==1||active[0].id!==plan.expectedActive.id||active[0].digest!==plan.expectedActive.digest||
      active[0].source_decision_id!==plan.manifest.source_decision_id)throw ciFailure('SCRATCH_MANIFEST_CONFLICT');
    await client.query("UPDATE map_manifest_versions SET status='superseded' WHERE id=$1",[active[0].id]);
    let row=(await client.query('SELECT id FROM map_manifest_versions WHERE scope_key=$1 AND digest=$2',[query.scope,digest])).rows[0];
    if(!row)row=(await client.query(`INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at)
      SELECT $1,COALESCE(max(version),0)+1,$2,$3,$4,'active',NOW() FROM map_manifest_versions WHERE scope_key=$1 RETURNING id`,
    [query.scope,plan.manifest.source_decision_id,plan.manifest,digest])).rows[0];
    else await client.query("UPDATE map_manifest_versions SET status='active' WHERE id=$1",[row.id]);
    await runProjection({client,manifestId:row.id,manifestDigest:digest,scopeKey:query.scope,manifest:plan.manifest});
    await checkScratch();
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  await checkScratch();
}

export async function buildPrImplementationSnapshot(db,registry,revision,repoRoot){
  if(registry.scope==='cecelia-kr'&&registry.repo==='perfectuser21/cecelia')throw ciFailure('KR_ANALYSIS_RETIRED','公司KR自动分析候选登记已退役',410);
  const read=path=>fixedLocalGit(repoRoot,['show',`${revision}:${path}`],{encoding:'utf8'});
  if(registry.scope===EXISTING_OPS_SCOPE)throw ciFailure('FACTORY_COLLECTION_RETIRED','工厂消费者来源候选采集已退役',410);
  if(registry.scope===INFRA_CONSUMER_SCOPE){
    const paths=fixedLocalGit(repoRoot,['ls-tree','-rz','--name-only',revision],{encoding:'utf8'}).split('\0').filter(Boolean);
    const before=await readInfraConsumerRegistry(db);
    await registerInfraConsumerSources(db,{scope:registry.scope,repo:registry.repo,revision,paths,readSource:async path=>readFixedLocalGitBlob(repoRoot,{revision,path}).toString('utf8'),mode:'scratch_candidate',expectedRegistrySha256:before.registry_sha256,actor:'implementation-ci-scratch-candidate'});
    await advanceExistingOpsScratchManifest(db,{scope:registry.scope,repo:registry.repo,revision});
    return exportImplementationSnapshot(db,{scope:registry.scope,repo:registry.repo,revision});
  }

  const registrations=(await db.query(REGISTRATIONS_SQL,[registry.repo])).rows;
  if(!registrations.length||registrations.some(w=>!w.source_capability||w.source_path!==`product-map/contracts/${w.source_capability}.yaml`))
    throw ciFailure('PR_ADAPTER_MISSING','该repo没有固定契约adapter；需要显式登记来源');
  const digestPath='product-map/generated/contracts.json',digest=JSON.parse(read(digestPath));
  const plans=await loadActivityContracts(registrations.filter(w=>w.status!=='retired'),digest,read,registrations);
  for(const plan of plans)for(const item of plan.activities)item.bindings=await validateFixedImplementationBindings(item.activity,{repo:registry.repo,commit:revision},fixedLocalSourceOptions(repoRoot,registry.repo));
  const lint=lintImplementationRegistry(registry,plans,digest);
  if(lint.gaps.length)throw ciFailure('REGISTRY_UNKNOWN',JSON.stringify(lint.gaps));
  await storeActivityContracts(db,plans,revision,registry.repo,registrations,{synchronizeSteps:true});
  const candidate=await exportImplementationSnapshot(db,{scope:registry.scope,repo:registry.repo,revision});
  const {snapshot_sha256:_hash,...body}=candidate;
  body.adapter_evidence={adapter:'activity-contracts-v1',path:digestPath,revision,digest_sha256:stepSha256(digest)};
  return {...body,snapshot_sha256:stepSha256(body)};
}

async function scanFixedImplementationGraph(db,repo,root,revision,edges){
 // Frozen-definition readers do not need the scanner's root dependencies.
 const {scanRepo}=await import('../scan/scan-graph.mjs');
 const staging=`ci-scan:${repo}`;
 const result=await scanRepo({name:staging,root:realpathSync(root)},db);
 if(result.error||result.skipped||result.sourceRevision!==revision)throw ciFailure('GRAPH_SCAN_FAILED',result.error?.message||'scan revision mismatch');
 const raw=(await db.query('SELECT src_path,dst_path,edge_type,detail FROM graph_edges WHERE repo=$1',[staging])).rows;
 const byKey=new Map(raw.map(e=>[JSON.stringify([e.src_path,e.dst_path,e.edge_type]),e]));
 for(const edge of edges){const key=JSON.stringify([edge.src_path,edge.dst_path,edge.edge_type]);if(!byKey.has(key))byKey.set(key,edge);}
 await replaceRepoEdges(db,repo,[...byKey.values()],{sourceRevision:revision,scannerVersion:'implementation-ci-v3-frozen-definition'});
}
