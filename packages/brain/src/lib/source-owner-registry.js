/** 来源owner是当前中央登记；不代表该owner有本次SHA的定义，更不授予执行权限。 */
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
import {TREE_NODES_SQL} from './tree-nodes-sql.js';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const uuid=v=>typeof v==='string'&&UUID.test(v);
const failure=message=>Object.assign(Error(`SOURCE_OWNER_REGISTRY_INVALID: ${message}`),{code:'IMPLEMENTATION_CI_SOURCE_OWNER_REGISTRY_INVALID',status:422});
const plain=v=>JSON.parse(JSON.stringify(v));
export async function readSourceOwnerRegistry(db,{scope,repo},workflows){
 const ids=[...new Set(workflows.map(w=>w.capability_id))];
 const journeys=(await db.query(`WITH RECURSIVE chain AS(SELECT * FROM ${TREE_NODES_SQL} n WHERE id=ANY($1::uuid[])
 UNION SELECT j.* FROM ${TREE_NODES_SQL} j JOIN chain c ON j.id=c.parent_journey_id) SELECT * FROM chain ORDER BY id`,[ids])).rows;
 const areaIds=[...new Set(journeys.map(j=>j.area_id).filter(Boolean))];
 const areas=(await db.query('SELECT * FROM areas WHERE id=ANY($1::uuid[]) ORDER BY id',[areaIds])).rows;
 const body=plain({schema_version:1,scope,repo,source_basis:'current_registration',canonical:{areas,journeys,workflows}});
 return {...body,registry_sha256:stepSha256(body)};
}
export function validateSourceOwnerRegistry(registry,repo){
 if(!registry||registry.schema_version!==1||registry.repo!==repo||typeof registry.scope!=='string'||!registry.scope||registry.source_basis!=='current_registration')throw failure('来源身份无效');
 const {registry_sha256,...body}=registry;
 if(!/^[0-9a-f]{64}$/.test(registry_sha256||'')||stepSha256(plain(body))!==registry_sha256)throw failure('来源摘要不符');
 const {areas,journeys,workflows}=registry.canonical||{};
 if(![areas,journeys,workflows].every(Array.isArray))throw failure('来源闭包无效');
 if(new Set(journeys.map(j=>j.id)).size!==journeys.length||new Set(areas.map(a=>a.id)).size!==areas.length)throw failure('重复树身份');
 for(const j of journeys){
  if(!uuid(j.id)||j.parent_journey_id!=null&&!journeys.some(p=>p.id===j.parent_journey_id)||j.area_id!=null&&!areas.some(a=>a.id===j.area_id))throw failure('业务树/Area闭包缺失');
  const seen=new Set();let node=j;
  while(node){if(seen.has(node.id))throw failure('业务树循环');seen.add(node.id);node=journeys.find(p=>p.id===node.parent_journey_id);}
 }
 if(new Set(workflows.map(w=>w.id)).size!==workflows.length)throw failure('重复workflow身份');
 for(const w of workflows){
  if(!uuid(w.id)||!uuid(w.capability_id)||w.source_repo!==repo||!w.key||typeof w.source_capability!=='string'||!w.source_capability||typeof w.source_path!=='string'||!w.source_path||w.source_path.startsWith('/')||w.source_path.split('/').some(p=>p==='..')||!w.source_workflow)throw failure('workflow来源身份无效');
  if(!journeys.some(j=>j.id===w.capability_id&&j.parent_journey_id))throw failure('业务owner树缺失');
 }
 return registry;
}
export function sourceOwnersForSnapshot(snapshot){
 // 兼容旧schema1完整快照；绝不以latest补来源，缺owner仍由契约核验拒绝。
 if(snapshot.source_registry&&snapshot.scope!==undefined&&snapshot.source_registry.scope!==snapshot.scope)throw failure('来源scope错配');
 return snapshot.source_registry?validateSourceOwnerRegistry(snapshot.source_registry,snapshot.repo).canonical.workflows:snapshot.canonical.workflows;
}
export function validateContractOwners(plans,registeredOwners,repo){
 const ownerFor=cap=>{
  const matches=registeredOwners.filter(w=>w.source_capability===cap);
  if(matches.length!==1||matches[0].source_repo!==repo||matches[0].source_path!==`product-map/contracts/${cap}.yaml`)throw failure(`OWNER来源缺失或冲突: ${cap}`);
  return matches[0];
 };
 for(const p of plans){
  const business=ownerFor(p.contract.capability);
  if(business.capability_id!==p.workflow.capability_id)throw failure(`OWNER业务能力错配: ${p.workflow.key}`);
  for(const i of p.activities)ownerFor(i.activity.from);
 }
 return plans;
}
