/** 仅scratch：复用中央身份和正式投影器，固定git产生两侧不可变图。 */
import pg from 'pg';
import { registerCompanyKrWorkflow,activityContract } from '../../packages/brain/src/lib/company-kr-registration.js';
import { execFileSync } from 'node:child_process';
import { loadActivityContracts } from '../../packages/brain/src/lib/activity-contract-loader.js';
import { storeActivityContracts,REGISTRATIONS_SQL } from '../../packages/brain/src/lib/activity-contract-store.js';
import { validateImplementationBindings } from '../../packages/brain/src/lib/implementation-bindings.js';
import { exportImplementationSnapshot } from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import { stepSha256 } from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import { lintImplementationRegistry } from './registry-lint.mjs';
import { classifyAssertionRef } from '../../packages/brain/src/lib/gp-assertion-command.js';
import { randomUUID } from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collectScratchWorkspaceConsumerSourceSet,readWorkspaceConsumerBrainRevisions} from '../../packages/brain/src/lib/consumer-source-set.js';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { readFileSync,realpathSync,mkdtempSync,rmSync } from 'node:fs';
import { DB_DEFAULTS } from '../../packages/brain/src/db-config.js';
import { validateImplementationSnapshot,validateImplementationSnapshotForDatabase,ciFailure,isImplementationScratchDatabase } from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import { runProjection } from '../../packages/brain/src/map/projector.js';
import { digestMapManifest } from '../../packages/brain/src/lib/map-manifest-schema.js';
import { scanRepo } from '../scan/scan-graph.mjs';
import { replaceRepoEdges } from '../../packages/brain/src/lib/graph-store.js';
import { EXISTING_OPS_SCOPE,buildExistingOpsSources } from '../../packages/brain/src/lib/existing-ops-source.js';
import { readExistingOpsRegistry,registerExistingOpsSources,prepareExistingOpsManifestAdvance } from '../../packages/brain/src/lib/existing-ops-registration.js';
import {preparePilotManifestAdvance,advancePilotManifest} from '../../packages/brain/src/lib/implementation-ci-pilot-manifest.js';

// journeys 只给旧迁移 511 重放用（它按旧形状读 journeys）；读者读的是 value_streams / capabilities
const TABLES=['areas','schema_version','journeys','value_streams','capabilities','workflows','activities','steps','spans',
  'map_scope_repositories','map_manifest_versions','map_projection_runs','map_projection_nodes','map_projection_edges',
  'graph_edges','graph_snapshot_versions','graph_edge_snapshots','fact_snapshot_headers','activity_cells'];
export async function createImplementationScratch(){
  if(!isImplementationScratchDatabase(DB_DEFAULTS.database))throw ciFailure('SCRATCH_REQUIRED','只允许本机scratch或GitHub Actions隔离test库');
  const client=new pg.Client(DB_DEFAULTS);await client.connect();
  const schema=`implementation_ci_${randomUUID().replaceAll('-','')}`;let schemaCreated=false;
  const db={query:client.query.bind(client),connect:async()=>({query:client.query.bind(client),release(){}})};
  const close=async()=>{try{if(schemaCreated){await client.query('ROLLBACK');await client.query('SET search_path TO public');await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}}finally{await client.end();}};
  try{
    const actual=(await client.query('SELECT current_database() name')).rows[0].name;
    if(actual!==DB_DEFAULTS.database||!isImplementationScratchDatabase(actual))throw ciFailure('SCRATCH_REQUIRED');
    await client.query(`CREATE SCHEMA ${schema}`);schemaCreated=true;
    for(const table of TABLES)await client.query(`CREATE TABLE ${schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
    await client.query(`SET search_path TO ${schema}`);
    // 511 回填引用要读迁移 528 已删的 journey_id / step_number（快照来源若是旧形状库，行里还带 enabler_id）：只补在这个隔离 schema 里（511 建的旧指标视图依赖它们，不删），不影响生产库。
    await client.query('ALTER TABLE activities ADD COLUMN journey_id uuid,ADD COLUMN step_number integer,ADD COLUMN enabler_id uuid');
    // 511/513 是旧迁移，按旧名 journey_steps 建外键：重放期间把 activities 临时叫回旧名，之后改回（外键按对象 id 跟随）。
    await client.query('ALTER TABLE activities RENAME TO journey_steps');
    for(const file of ['511_shared_activity_refs.sql','513_definition_versions.sql'])await client.query(readFileSync(new URL(`../../packages/brain/migrations/${file}`,import.meta.url),'utf8'));
    await client.query('ALTER TABLE journey_steps RENAME TO activities');
    return {db,close,schema};
  }catch(error){await close();throw error;}
}
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
  const s=await validateImplementationSnapshotForDatabase(db,input);
  if(s.status!=='verified'||s.gaps.length)throw ciFailure('SNAPSHOT_UNKNOWN',JSON.stringify(s.gaps));
  await db.query('BEGIN');
  try{
    for(const row of s.canonical.areas)await insertRow(db,'areas',row);
    for(const row of s.canonical.journeys)await insertRow(db,row.parent_journey_id==null?'value_streams':'capabilities',row);
    for(const row of s.canonical.workflows)await insertRow(db,'workflows',{...row,current_definition_version_id:null},{preserve:s.scope===EXISTING_OPS_SCOPE?['current_definition_version_id']:[]});
    for(const row of s.canonical.activities)await insertRow(db,'activities',{...row,current_definition_version_id:null},{preserve:s.scope===EXISTING_OPS_SCOPE?['current_definition_version_id']:[]});
    for(const row of s.canonical.steps)await insertRow(db,'steps',row);
    for(const row of s.definitions.activities)await insertRow(db,'activity_definition_versions',row,{immutable:true});
    for(const row of s.definitions.workflows)await insertRow(db,'workflow_definition_versions',row,{immutable:true});
    // 活跃关系是当前登记；固定版本查询始终走WV.payload，不用此表改写历史。
    for(const row of s.canonical.references)await insertRow(db,'workflow_activity_refs',{...row,activity_definition_version_id:null},{preserve:s.scope===EXISTING_OPS_SCOPE?['activity_definition_version_id']:[]});
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
      for(const source of new Set([...(w.source_repo===s.repo?[w.source_path]:[]),...(a.source_repo===s.repo?[a.source_path]:[]),...(s.adapter_evidence?.adapter==='activity-contracts-v1'&&s.adapter_evidence.revision===s.revision?[s.adapter_evidence.path]:[])])){definitionEdgePath(source);if(source!==binding.path)edges.push({src_path:binding.path,dst_path:source,edge_type:'import',
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
  if(db)await validateImplementationSnapshotForDatabase(db,s);else validateImplementationSnapshot(s);
  if(s.scope===EXISTING_OPS_SCOPE&&s.repo==='perfectuser21/zenithjoy-workspace'){
    const proof=await scratchWorkspaceProof(db,s.revision,repoRoot,s.registry_source);
    const nativeRoot=fileURLToPath(new URL('../../',import.meta.url)),anchor=s.registry_source;
    const paths=execFileSync('git',['ls-tree','-rz','--name-only',anchor.revision],{cwd:nativeRoot,encoding:'utf8'}).replace(/\0$/,'').split('\0');
    const native=await buildExistingOpsSources({scope:s.scope,repo:anchor.repo,revision:anchor.revision,paths,
      readSource:async path=>execFileSync('git',['show',`${anchor.revision}:${path}`],{cwd:nativeRoot,encoding:'utf8',maxBuffer:32*1024*1024})});
    for(const consumer of native.consumers){
      const activity=s.definitions.activities.find(a=>a.activity_id===consumer.activity_id);
      const extra=consumer.activity_id===proof.consumer.activity_id?proof.consumer.bindings:[];
      const expected=[...new Map([...consumer.bindings,...extra].map(b=>[JSON.stringify([b.repo,b.revision,b.path]),b])).values()];
      const actual=activity?.payload.implementation_bindings||[];
      const relations=[...consumer.input_relations,...(extra.length?proof.consumer.input_relations:[])];
      if(consumer.status!=='verified'||actual.length!==expected.length
        ||expected.some(binding=>!actual.some(b=>stepSha256(b)===stepSha256(binding)))
        ||stepSha256(activity?.payload.input_relations)!==stepSha256(relations))throw ciFailure('CONSUMER_SOURCE_MISMATCH');
    }
    return s;
  }
  if(s.scope===EXISTING_OPS_SCOPE){
    const paths=execFileSync('git',['ls-tree','-rz','--name-only',s.revision],{cwd:repoRoot,encoding:'utf8'}).replace(/\0$/,'').split('\0');
    const readSource=async path=>execFileSync('git',['show',`${s.revision}:${path}`],{cwd:repoRoot,encoding:'utf8',maxBuffer:32*1024*1024});
    const proof=await buildExistingOpsSources({scope:s.scope,repo:s.repo,revision:s.revision,paths,readSource});
    if(proof.consumers.some(c=>c.status!=='verified'||c.gaps.length))throw ciFailure('CONSUMER_SOURCE_MISMATCH');
    for(const consumer of proof.consumers){
      const workflow=s.definitions.workflows.find(w=>w.workflow_id===consumer.workflow_id);
      const activity=s.definitions.activities.find(a=>a.activity_id===consumer.activity_id);
      if(!workflow||!activity||workflow.payload.definition_scope!=='consumer_evidence'||activity.payload.definition_scope!=='consumer_evidence'||
        workflow.payload.source_scope!==s.scope||activity.payload.source_scope!==s.scope||workflow.payload.contract.executable!==false||
        stepSha256(activity.payload.implementation_bindings)!==stepSha256(consumer.bindings)||
        stepSha256(activity.payload.input_relations)!==stepSha256(consumer.input_relations)||
        workflow.payload.registration_sha256!==s.consumer_registry?.registry_sha256||activity.payload.registration_sha256!==s.consumer_registry?.registry_sha256)
        throw ciFailure('CONSUMER_SOURCE_MISMATCH');
    }
    return s;
  }
  return verifyGeneratedSource(s,repoRoot);
}
async function verifyGeneratedSource(s,repoRoot){
  if(s.repo!=='perfectuser21/zenithjoy-workspace')return s;
  const path='product-map/generated/contracts.json';
  const read=path=>execFileSync('git',['show',`${s.revision}:${path}`],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  let text;try{text=read(path);}catch{return s;}
  const digest=JSON.parse(text),owners=s.canonical.workflows;
  const plans=await loadActivityContracts(owners,digest,read,owners);
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
  const cross=s.scope===EXISTING_OPS_SCOPE&&s.repo==='perfectuser21/zenithjoy-workspace';
  const registryRepo=s.map.repositories[0].repo;
  await scanFixedImplementationGraph(db,cross?s.repo:registryRepo,repoRoot,s.revision,edges);
  if(cross){
    const nativeRoot=fileURLToPath(new URL('../../',import.meta.url)),dir=mkdtempSync(join(tmpdir(),'implementation-native-graph-'));
    try{
      execFileSync('git',['clone','--shared','--no-checkout','--quiet',nativeRoot,dir],{stdio:['ignore','pipe','pipe']});
      execFileSync('git',['checkout','--quiet','--detach',s.registry_source.revision],{cwd:dir,stdio:['ignore','pipe','pipe']});
      const nativeEdges=definitionEdges({...s,repo:s.registry_source.repo,revision:s.registry_source.revision,assertions:[]});
      await scanFixedImplementationGraph(db,registryRepo,dir,s.registry_source.revision,nativeEdges,'cecelia');
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
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

export async function buildPrImplementationSnapshot(db,registry,revision,repoRoot){
  const read=path=>execFileSync('git',['show',`${revision}:${path}`],{cwd:repoRoot,encoding:'utf8',maxBuffer:32*1024*1024});
  if(registry.scope===EXISTING_OPS_SCOPE){
    await validateImplementationSnapshotForDatabase(db,registry);
    if(registry.status!=='verified'||registry.gaps.length||registry.snapshot_scope!=='consumer_evidence')throw ciFailure('REGISTRY_UNKNOWN');
    // 候选只落既有真实scratch，绝不把PR来源登记到中央生产库。
    const checkScratch=async()=>{const name=(await db.query('SELECT current_database() name')).rows[0].name;if(!isImplementationScratchDatabase(name))throw ciFailure('SCRATCH_REQUIRED');};
    await checkScratch();
    const cross=registry.repo==='perfectuser21/zenithjoy-workspace';
    const anchor=cross?registry.registry_source:{repo:registry.repo,revision};
    if(!anchor||anchor.repo!=='perfectuser21/cecelia')throw ciFailure('CONSUMER_SOURCE_MISMATCH');
    const nativeRoot=cross?fileURLToPath(new URL('../../',import.meta.url)):repoRoot;
    const paths=execFileSync('git',['ls-tree','-rz','--name-only',anchor.revision],{cwd:nativeRoot,encoding:'utf8'}).replace(/\0$/,'').split('\0');
    const nativeRead=path=>execFileSync('git',['show',`${anchor.revision}:${path}`],{cwd:nativeRoot,encoding:'utf8',maxBuffer:32*1024*1024});
    const workspaceConsumerProof=cross?await scratchWorkspaceProof(db,revision,repoRoot,anchor):undefined;
    const before=await readExistingOpsRegistry(db);
    await registerExistingOpsSources(db,{scope:registry.scope,repo:anchor.repo,revision:anchor.revision,paths,readSource:nativeRead,workspaceConsumerProof,mode:'scratch_candidate',
      expectedRegistrySha256:before.registry_sha256,actor:'implementation-ci-scratch-candidate'});
    await advancePilotManifest(db,await prepareExistingOpsManifestAdvance(db,{scope:registry.scope,repo:anchor.repo,revision:anchor.revision}),checkScratch);
    return exportImplementationSnapshot(db,{scope:registry.scope,repo:registry.repo,revision});
  }
  if(registry.repo==='perfectuser21/cecelia'){
    const text=read('packages/brain/config/company-kr-workflow.json'),spec=JSON.parse(text);
    const workflow=registry.canonical.workflows.find(w=>w.key===spec.key&&w.capability_id===spec.capability_id);
    if(!workflow)throw ciFailure('WORKFLOW_REGISTRATION_MISSING');
    const readBinding=async b=>{if(b.repo!==registry.repo)throw ciFailure('CROSS_REPO_SNAPSHOT_MISSING');return execFileSync('git',['show',`${b.revision}:${b.path}`],{cwd:repoRoot,encoding:'utf8'});};
    const activities=[];
    for(const [index,a] of spec.activities.entries()){
      const activity={...activityContract(a,index+1,spec),from:spec.capability};
      activities.push({activity,bindings:await validateImplementationBindings(activity,readBinding,{repo:registry.repo,commit:revision})});
    }
    const lint=lintImplementationRegistry(registry,[{workflow,activities}],{capabilities:{[spec.capability]:{}}});
    if(lint.gaps.length)throw ciFailure('REGISTRY_UNKNOWN',JSON.stringify(lint.gaps));
    await registerCompanyKrWorkflow(db,{spec,revision,readSource:async()=>text,readBinding,definitionsOnly:true});
    return exportImplementationSnapshot(db,{scope:registry.scope,repo:registry.repo,revision});
  }
  const registrations=(await db.query(REGISTRATIONS_SQL,[registry.repo])).rows;
  if(!registrations.length||registrations.some(w=>!w.source_capability||w.source_path!==`product-map/contracts/${w.source_capability}.yaml`))
    throw ciFailure('PR_ADAPTER_MISSING','该repo没有固定契约adapter；需要显式登记来源');
  const digestPath='product-map/generated/contracts.json',digest=JSON.parse(read(digestPath));
  const plans=await loadActivityContracts(registrations.filter(w=>w.status!=='retired'),digest,read,registrations);
  for(const plan of plans)for(const item of plan.activities)item.bindings=await validateImplementationBindings(item.activity,async b=>{
    if(b.repo!==registry.repo)throw ciFailure('CROSS_REPO_SNAPSHOT_MISSING',`缺固定外仓源码: ${b.repo}`);
    return execFileSync('git',['show',`${b.revision}:${b.path}`],{cwd:repoRoot,encoding:'utf8',maxBuffer:32*1024*1024});
  },{repo:registry.repo,commit:revision});
  const lint=lintImplementationRegistry(registry,plans,digest);
  if(lint.gaps.length)throw ciFailure('REGISTRY_UNKNOWN',JSON.stringify(lint.gaps));
  await storeActivityContracts(db,plans,revision,registry.repo,registrations,{synchronizeSteps:true});
  const candidate=await exportImplementationSnapshot(db,{scope:registry.scope,repo:registry.repo,revision});
  const {snapshot_sha256:_hash,...body}=candidate;
  body.adapter_evidence={adapter:'activity-contracts-v1',path:digestPath,revision,digest_sha256:stepSha256(digest)};
  return {...body,snapshot_sha256:stepSha256(body)};
}

async function scratchWorkspaceProof(db,revision,repoRoot,anchor){
 if(!db)throw ciFailure('SCRATCH_REQUIRED');
 const workspace={repo:'perfectuser21/zenithjoy-workspace',revision},nativeRoot=fileURLToPath(new URL('../../',import.meta.url));
 const readSource=async source=>execFileSync('git',['show',`${source.revision}:${source.path}`],{
  cwd:source.repo===workspace.repo?repoRoot:nativeRoot,maxBuffer:32*1024*1024});
 const revisions=await readWorkspaceConsumerBrainRevisions(workspace,readSource);
 const {EXISTING_OPS_IDENTITIES}=await import('../../packages/brain/src/lib/existing-ops-source.js');
 const {unverified_reference_ids,...identity}=EXISTING_OPS_IDENTITIES.find(i=>i.workflow_key==='factory_f3_ops');
 const proof=await collectScratchWorkspaceConsumerSourceSet(db,{workspace,brain:{repo:'perfectuser21/cecelia',revisions},identity,anchor},{readSource});
 if(proof.status!=='verified')throw ciFailure('CONSUMER_SOURCE_MISMATCH');return proof;
}

async function scanFixedImplementationGraph(db,repo,root,revision,edges,sourceName){
 const staging=`ci-scan:${repo}`;
 const result=await scanRepo({name:staging,root:realpathSync(root),...(sourceName?{sourceName}:{})},db);
 if(result.error||result.skipped||result.sourceRevision!==revision)throw ciFailure('GRAPH_SCAN_FAILED',result.error?.message||'scan revision mismatch');
 const raw=(await db.query('SELECT src_path,dst_path,edge_type,detail FROM graph_edges WHERE repo=$1',[staging])).rows;
 const byKey=new Map(raw.map(e=>[JSON.stringify([e.src_path,e.dst_path,e.edge_type]),e]));
 for(const edge of edges){const key=JSON.stringify([edge.src_path,edge.dst_path,edge.edge_type]);if(!byKey.has(key))byKey.set(key,edge);}
 await replaceRepoEdges(db,repo,[...byKey.values()],{sourceRevision:revision,scannerVersion:'implementation-ci-v1'});
}
