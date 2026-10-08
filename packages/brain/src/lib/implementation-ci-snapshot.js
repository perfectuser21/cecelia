import {manifestMatchesImplementationSource} from './implementation-context.js';
import {hasFrozenConsumerSource,sealedConsumerVersion} from './consumer-source-set.js';
/** 中央定义只读导出；身份由登记表给出，历史来源不以latest补齐。 */
import {preparePilotManifestAdvance,advancePilotManifest} from './implementation-ci-pilot-manifest.js';
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
import { validateImplementationQuery } from './implementation-consumers.js';
import { syncActivityContracts,CONTRACT_REPO } from '../activity-contract-sync.js';
import { registerCompanyKrWorkflow } from './company-kr-registration.js';
import { resolveGitHubToken } from '../harness-credentials.js';
import { TREE_NODES_SQL } from './tree-nodes-sql.js';
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
export function validateImplementationSnapshot(snapshot){
  if(snapshot?.schema_version!==1)throw ciFailure('SNAPSHOT_INVALID');
  validateSnapshotQuery(snapshot);
  const {snapshot_sha256,...body}=snapshot;
  if(typeof snapshot_sha256!=='string'||digest(body)!==snapshot_sha256)throw ciFailure('SNAPSHOT_DIGEST_MISMATCH');
  const anchor=snapshot.registry_source||{repo:snapshot.repo,revision:snapshot.revision};
  if(snapshot.registry_source){
    if(snapshot.scope!=='cecelia-factory'||anchor.repo!=='perfectuser21/cecelia'||!Array.isArray(snapshot.source_set)
      ||!snapshot.source_set.some(s=>s.repo===snapshot.repo&&s.revision===snapshot.revision)
      ||!snapshot.source_set.some(s=>s.repo===anchor.repo&&s.revision===anchor.revision))throw ciFailure('CONSUMER_SOURCE_SET_INVALID');
    for(const row of snapshot.definitions.activities)if(!sealedConsumerVersion(row)
      ||!row.payload.implementation_bindings.some(b=>b.repo===snapshot.repo&&b.revision===snapshot.revision&&hasFrozenConsumerSource(row.payload,b.repo,b.path)))throw ciFailure('CONSUMER_SOURCE_SET_INVALID');
  }
  for(const kind of ['workflows','activities'])for(const row of snapshot.definitions[kind]){
    if(row.source_repo!==anchor.repo||row.source_commit!==anchor.revision||
      stepSha256({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload})!==row.payload_sha256)
      throw ciFailure('DEFINITION_DIGEST_MISMATCH');
  }
  return snapshot;
}
export async function readImplementationSnapshotInTransaction(db,q){
  const gaps=[],gap=(code,details={})=>gaps.push({code,...details});
  const registrations=(await db.query('SELECT * FROM map_scope_repositories WHERE scope_key=$1 ORDER BY repo',[q.scope])).rows;
  const repositories=registrations.filter(r=>r.repo===q.repo||r.adapter_config?.source_repo===q.repo);
  if(repositories.length!==1)gap(repositories.length?'scope_repository_ambiguous':'scope_repository_missing',{scope:q.scope,repo:q.repo});
  const crossConsumer=q.scope==='cecelia-factory'&&repositories.length===1&&repositories[0].repo==='perfectuser21/cecelia'&&q.repo==='perfectuser21/zenithjoy-workspace';
  let anchor={repo:q.repo,revision:q.revision};
  let candidates;
  if(crossConsumer){
    const rows=(await db.query(`SELECT DISTINCT wv.* FROM workflow_definition_versions wv
      CROSS JOIN LATERAL jsonb_array_elements(wv.payload->'activities') ref(value)
      JOIN activity_definition_versions av ON av.id=(ref.value->>'activity_version_id')::uuid
      WHERE wv.source_repo='perfectuser21/cecelia' AND wv.payload->>'source_scope'=$1
      AND wv.payload->>'definition_scope'='consumer_evidence'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(av.payload->'implementation_bindings') b WHERE b->>'repo'=$2 AND b->>'revision'=$3)`,[q.scope,q.repo,q.revision])).rows;
    const commits=[...new Set(rows.map(r=>r.source_commit))];
    if(commits.length!==1)gap('consumer_source_anchor_ambiguous');
    anchor={repo:'perfectuser21/cecelia',revision:commits.length===1?commits[0]:null};
    candidates=rows.filter(r=>r.source_commit===anchor.revision);
  }else candidates=(await db.query('SELECT * FROM workflow_definition_versions WHERE source_repo=$1 AND source_commit=$2 ORDER BY workflow_id,id',[q.repo,q.revision])).rows;
  const workflows=(await db.query('SELECT * FROM workflows WHERE source_repo=$1 ORDER BY id',[anchor.repo])).rows;
  const selected=[];
  for(const id of [...new Set(candidates.map(r=>r.workflow_id))]){
    const rows=candidates.filter(r=>r.workflow_id===id),current=rows.find(r=>r.id===workflows.find(w=>w.id===id)?.current_definition_version_id);
    if(current)selected.push(current);
    else if(rows.length===1)selected.push(rows[0]);
    else gap('definition_snapshot_ambiguous',{workflow_id:id,revision:q.revision});
  }
  if(!selected.length)gap('definition_snapshot_missing',{repo:q.repo,revision:q.revision});
  const activityVersions=[...new Set(selected.flatMap(w=>w.payload.activities.map(a=>a.activity_version_id)))];
  const activities=(await db.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[]) ORDER BY id',[activityVersions])).rows;
  if(activities.length!==activityVersions.length)gap('activity_snapshot_missing');
  if(crossConsumer)for(const a of activities)if(!sealedConsumerVersion(a)||a.source_commit!==anchor.revision
    ||!a.payload.implementation_bindings.some(b=>b.repo===q.repo&&b.revision===q.revision&&hasFrozenConsumerSource(a.payload,b.repo,b.path)))gap('consumer_source_set_unknown',{activity_id:a.activity_id});
  const workflowIds=selected.map(w=>w.workflow_id),activityIds=activities.map(a=>a.activity_id);
  const refs=selected.flatMap(w=>w.payload.activities.map(r=>r.reference_id));
  const canonicalActivities=(await db.query('SELECT * FROM activities WHERE id=ANY($1::uuid[]) ORDER BY id',[activityIds])).rows;
  const references=(await db.query('SELECT * FROM workflow_activity_refs WHERE id=ANY($1::uuid[]) ORDER BY id',[refs])).rows;
  const steps=(await db.query('SELECT * FROM steps WHERE activity_id=ANY($1::uuid[]) ORDER BY id',[activityIds])).rows;
  let manifest=null,manifestBasis='unknown';
  if(repositories.length===1){
    const historical=(await db.query(`SELECT DISTINCT m.* FROM map_manifest_versions m JOIN map_projection_runs p ON p.manifest_version_id=m.id
      WHERE m.scope_key=$1 AND p.scope_key=$1 AND p.fact_revisions->>$2=$3 AND p.status IN ('active','superseded') ORDER BY m.version DESC`,[q.scope,repositories[0].repo,anchor.revision])).rows.filter(r=>manifestMatchesImplementationSource(r.manifest,anchor.repo,anchor.revision));
    if(historical.length===1){manifest=historical[0];manifestBasis='historical_projection';}
    else if(historical.length>1)gap('manifest_snapshot_ambiguous',{revision:q.revision});
    else if(selected.length&&selected.every(w=>workflows.find(c=>c.id===w.workflow_id)?.current_definition_version_id===w.id)){
      manifest=(await db.query("SELECT * FROM map_manifest_versions WHERE scope_key=$1 AND status='active'",[q.scope])).rows[0]||null;
      manifestBasis='current_registration';
    }
  }
  if(manifest&&!manifestMatchesImplementationSource(manifest.manifest,anchor.repo,anchor.revision))gap('manifest_source_mismatch',{revision:anchor.revision});
  if(!manifest)gap('scope_manifest_missing',{scope:q.scope,revision:q.revision});
  const capabilityIds=[...new Set(selected.map(w=>w.payload.capability_id))];
  const journeys=(await db.query(`WITH RECURSIVE chain AS(SELECT * FROM ${TREE_NODES_SQL} n WHERE id=ANY($1::uuid[])
    UNION SELECT j.* FROM ${TREE_NODES_SQL} j JOIN chain c ON j.id=c.parent_journey_id) SELECT * FROM chain ORDER BY id`,[capabilityIds])).rows;
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
  const body=json({schema_version:1,...q,...(crossConsumer?{registry_source:anchor,source_set:sourceSet}:{}),status:gaps.length?'unknown':'verified',gaps,
    canonical:{areas,journeys,workflows:workflows.filter(w=>workflowIds.includes(w.id)),activities:canonicalActivities,steps,references},
    definitions:{workflows:selected,activities},map:{manifest,repositories,source_basis:manifestBasis},assertion_source:'current_registration',assertions});
  return {...body,snapshot_sha256:digest(body)};
}
export async function exportImplementationSnapshot(pool,input){
  const q=validateSnapshotQuery(input),db=await pool.connect();
  try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await readImplementationSnapshotInTransaction(db,q);await db.query('COMMIT');return result;}
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
  const pilotPlan=await preparePilotManifestAdvance(pool,q);
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
    const text=await readFile('packages/brain/config/company-kr-workflow.json'),spec=JSON.parse(text);
    await registerCompanyKrWorkflow(pool,{spec,revision:q.revision,readSource:async()=>text,beforeCommit:checkMain,definitionsOnly:true,
      readBinding:readBinding||(b=>{if(b.repo!==q.repo)throw ciFailure('CROSS_REPO_SNAPSHOT_MISSING');return readFile(b.path,b.revision);})});
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
