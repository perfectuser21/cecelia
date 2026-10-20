import {advancePilotManifest} from './implementation-ci-pilot-manifest.js';
import {digestMapManifest,validateMapManifest} from './map-manifest-schema.js';
/** 独立infra来源快照；缺事实保持unknown，绝不授予执行权。 */
import {INFRA_CONSUMER_SCOPE as S,INFRA_CONSUMER_REPO as R,INFRA_CONSUMER_IDENTITY as I,INFRA_CONSUMER_PATHS,readInfraConsumerRegistry,validateInfraConsumerRegistry,validateInfraQuery,registerInfraConsumerSources,assertInfraConsumerRuntime,prepareInfraManifestAdvance} from './infra-consumer-source.js';
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
import {manifestMatchesImplementationSource} from './implementation-context.js';
import {TREE_NODES_SQL} from './tree-nodes-sql.js';
import {consumerFailure as fail} from './consumer-evidence-store.js';
const json=x=>JSON.parse(JSON.stringify(x)),digest=x=>stepSha256(json(x));
export function validateInfraSnapshot(s){
 validateInfraQuery(s);
 if(s.snapshot_scope!=='consumer_evidence'||s.execution_status!=='unknown'||!['verified','unknown'].includes(s.status)||!Array.isArray(s.gaps)||(s.status==='verified')!==(s.gaps.length===0)||s.registry_source||s.admission_companion)throw fail('INFRA_SNAPSHOT_INVALID');
 const {snapshot_sha256,...body}=s;if(digest(body)!==snapshot_sha256)throw fail('INFRA_SNAPSHOT_DIGEST_MISMATCH');
 const r=s.consumer_registry,{registry_sha256,...rbody}=r||{};if(digest(rbody)!==registry_sha256)throw fail('INFRA_REGISTRY_INVALID');
 if(s.status==='unknown')return s;
 const identity=validateInfraConsumerRegistry(r);
 for(const key of ['workflows','activities','steps','references'])if(digest(s.canonical[key])!==digest(r[key]))throw fail('INFRA_CANONICAL_MISMATCH');
 if(s.definitions.workflows.length!==1||s.definitions.activities.length!==1)throw fail('INFRA_DEFINITION_INVALID');
 const w=s.definitions.workflows[0],a=s.definitions.activities[0],ref=w.payload.activities?.[0];
 if(w.workflow_id!==I.workflow_id||a.activity_id!==identity.activity_id||w.payload.capability_id!==I.capability_id||w.payload.key!==I.workflow_key
  ||w.payload.activities.length!==1||ref.reference_id!==identity.reference_id||ref.activity_id!==identity.activity_id||ref.activity_version_id!==a.id||ref.slot_key!==I.slot_key||ref.sequence_no!==identity.sequence_no||ref.source_ref!==I.skill_id
  ||digest(w.payload.coverage)!==digest({status:'unknown',verified_reference_ids:[identity.reference_id],unverified_reference_ids:identity.unverified_reference_ids})
  ||digest(s.unverified_reference_ids)!==digest(identity.unverified_reference_ids))throw fail('INFRA_DEFINITION_IDENTITY_INVALID');
 for(const row of [w,a])if(row.source_repo!==R||row.source_commit!==s.revision||row.source_path!==INFRA_CONSUMER_PATHS[0]
  ||row.payload.definition_scope!=='consumer_evidence'||row.payload.source_scope!==S||row.payload.registration_sha256!==registry_sha256
  ||digest(row.payload.contract)!==digest({key:I.workflow_key,definition_scope:'consumer_evidence',executable:false,source_basis:'fixed_git_tree'})
  ||row.contract_sha256!==digest(row.payload.contract)||row.payload_sha256!==digest({source:{repo:R,path:row.source_path,commit:s.revision},payload:row.payload}))throw fail('INFRA_DEFINITION_INVALID');
 const bindings=a.payload.implementation_bindings;
 if(!Array.isArray(bindings)||bindings.length!==INFRA_CONSUMER_PATHS.length||new Set(bindings.map(b=>b.path)).size!==bindings.length
  ||bindings.some(b=>!INFRA_CONSUMER_PATHS.includes(b.path)||b.repo!==R||b.revision!==s.revision||b.kind!=='code'||b.status!=='verified'||!/^[a-f0-9]{64}$/.test(b.content_sha256||'')||b.digest!==`sha256:${b.content_sha256}`))throw fail('INFRA_BINDING_INVALID');
 const expectedJourneys=[...r.value_streams,...r.capabilities].sort((a,b)=>a.id.localeCompare(b.id));
 if(digest(s.canonical.journeys)!==digest(expectedJourneys))throw fail('INFRA_CANONICAL_MISMATCH');
 const registrations=s.map.repositories;
 if(!validateMapManifest(s.map.manifest?.manifest).valid||s.map.manifest.digest!==digestMapManifest(s.map.manifest.manifest)||s.map.manifest.scope_key!==S||s.map.manifest.manifest.scope_key!==S||s.map.manifest.manifest.capabilities.length!==1||s.map.manifest.manifest.capabilities[0].brain_binding?.entity_id!==I.capability_id||s.map.manifest.manifest.value_streams.length!==1||s.map.manifest.manifest.value_streams[0].brain_binding?.entity_id!==I.root||registrations.length!==1||registrations[0].scope_key!==S||registrations[0].adapter_key!=='legacy-ledger-v1'||Object.keys(registrations[0].adapter_config||{}).sort().join(',')!=='source_repo'||registrations[0].adapter_config?.source_repo!==R||!manifestMatchesImplementationSource(s.map.manifest?.manifest,R,s.revision))throw fail('INFRA_MANIFEST_INVALID');
 return s;
}
export async function readInfraSnapshot(db,q){
 validateInfraQuery(q);const gaps=[],gap=code=>gaps.push({code});
 const registry=await readInfraConsumerRegistry(db);let identity;
 try{identity=validateInfraConsumerRegistry(registry);}catch{gap('infra_registry_identity_invalid');}
 const repositories=(await db.query('SELECT * FROM map_scope_repositories WHERE scope_key=$1 ORDER BY repo',[S])).rows;
 if(repositories.length!==1||repositories[0].adapter_config?.source_repo!==R||repositories[0].adapter_config?.definition_protocol)gap('scope_repository_missing');
 const all=(await db.query("SELECT * FROM workflow_definition_versions WHERE workflow_id=$1 AND source_repo=$2 AND source_commit=$3 AND payload->>'source_scope'=$4 AND payload->>'definition_scope'='consumer_evidence' ORDER BY id",[I.workflow_id,R,q.revision,S])).rows;
 if(all.length!==1)gap(all.length?'definition_snapshot_ambiguous':'definition_snapshot_missing');
 const workflows=all.length===1?all:[],ids=workflows.flatMap(w=>w.payload.activities?.map(r=>r.activity_version_id)||[]);
 const activities=(await db.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
 if(ids.length!==activities.length)gap('activity_snapshot_missing');
 if([...workflows,...activities].some(w=>w.payload.registration_sha256!==registry.registry_sha256))gap('infra_registry_changed');
 const manifests=(await db.query(`SELECT DISTINCT m.* FROM map_manifest_versions m JOIN map_projection_runs p ON p.manifest_version_id=m.id
 WHERE m.scope_key=$1 AND p.scope_key=$1 AND p.fact_revisions->>$2=$3 AND p.status IN('active','superseded')`,[S,repositories[0]?.repo||'',q.revision])).rows.filter(m=>manifestMatchesImplementationSource(m.manifest,R,q.revision));
 if(manifests.length===0&&workflows.length===1){
  const active=(await db.query("SELECT * FROM map_manifest_versions WHERE scope_key=$1 AND status='active'",[S])).rows.filter(m=>manifestMatchesImplementationSource(m.manifest,R,q.revision));
  if(active.length===1)manifests.push(active[0]);
 }
 if(manifests.length!==1)gap(manifests.length?'manifest_snapshot_ambiguous':'scope_manifest_missing');
 const manifest=manifests.length===1?manifests[0]:null;
 if(manifest&&(manifest.manifest.capabilities?.length!==1||manifest.manifest.capabilities[0].brain_binding?.entity_id!==I.capability_id||manifest.manifest.value_streams?.length!==1||manifest.manifest.value_streams[0].brain_binding?.entity_id!==I.root))gap('workflow_capability_unmapped');
 const journeys=(await db.query(`SELECT * FROM ${TREE_NODES_SQL} n WHERE id=ANY($1::uuid[]) ORDER BY id`,[[I.root,I.capability_id]])).rows;
 const areas=(await db.query('SELECT * FROM areas WHERE id=ANY($1::uuid[]) ORDER BY id',[[...new Set(journeys.map(j=>j.area_id).filter(Boolean))]])).rows;
 const assertions=(await db.query('SELECT * FROM activity_cells WHERE journey_id=$1 AND step_id=ANY($2::uuid[]) ORDER BY id',[I.capability_id,registry.activities.map(a=>a.id)])).rows;
 const body=json({schema_version:1,...q,status:gaps.length?'unknown':'verified',gaps,snapshot_scope:'consumer_evidence',execution_status:'unknown',consumer_registry:registry,unverified_reference_ids:identity?.unverified_reference_ids||[],canonical:{areas,journeys,workflows:registry.workflows,activities:registry.activities,steps:registry.steps,references:registry.references},definitions:{workflows,activities},map:{manifest,repositories,source_basis:manifest?'historical_projection':'unknown'},assertion_source:'current_registration',assertions});
 const result={...body,snapshot_sha256:digest(body)};validateInfraSnapshot(result);return result;
}
/** 已认证main refresh只追加来源；地图必须先经正规发布登记，不替调用方造base。 */
export async function refreshInfraSnapshot(pool,q,{fetchFn,token,checkMain,readFile}){
 validateInfraQuery(q);const before=await readInfraConsumerRegistry(pool);validateInfraConsumerRegistry(before);
 const plan=await prepareInfraManifestAdvance(pool,q);
 const get=async url=>{const response=await fetchFn(url,{redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});if(!response.ok)throw fail('INFRA_SOURCE_UNAVAILABLE');return response.json();};
 const commit=await get(`https://api.github.com/repos/${R}/git/commits/${q.revision}`);
 if(commit.sha!==q.revision||!/^[a-f0-9]{40}$/.test(commit.tree?.sha||''))throw fail('INFRA_COMMIT_INVALID');
 const tree=await get(`https://api.github.com/repos/${R}/git/trees/${commit.tree.sha}?recursive=1`);
 if(tree.sha!==commit.tree.sha||tree.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length>200000)throw fail('INFRA_TREE_INVALID');
 const entries=new Map();for(const entry of tree.tree){if(!entry||typeof entry.path!=='string'||entries.has(entry.path))throw fail('INFRA_TREE_INVALID');entries.set(entry.path,entry);}
 const readSource=async path=>{
  const entry=entries.get(path);if(entry?.type!=='blob'||!['100644','100755'].includes(entry.mode))throw fail('INFRA_BLOB_INVALID');
  const text=await readFile(path),bytes=Buffer.from(text);const {createHash}=await import('node:crypto');
  if(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')!==entry.sha)throw fail('INFRA_BLOB_MISMATCH');return text;
 };
 await assertInfraConsumerRuntime(readSource);
 await registerInfraConsumerSources(pool,{...q,paths:[...entries.keys()],readSource,checkMain,expectedRegistrySha256:before.registry_sha256,actor:'implementation-ci-main-refresh'});
 await checkMain();await advancePilotManifest(pool,plan,checkMain);return readInfraSnapshot(pool,q);
}
