/** 登记与外部合同同步共用的事务内装配；不创建事务、不推导隐式用料。 */
import {uuid} from '../workflow-authoring/contracts.js';
import {declareStepsFromContract,assertStepsHaveReadback} from './contract-steps.js';
import {syncSteps,canonicalJson} from '../../scripts/sync-steps-from-workspace.mjs';
const fail=message=>{throw Object.assign(Error(message),{code:'WORKFLOW_ASSEMBLY_CONFLICT',status:409});};
const KEY=/^[a-z][a-z0-9_.-]{0,99}$/;
const shelves=new Set(['platform_action','generic_action','data','service','ui','infrastructure','external_dependency','account_secret']);
export async function loadAssemblyCatalog(client,definition){
 const ids=(definition.activities||[]).map(a=>a.reuse_activity_definition_version_id).filter(Boolean);
 ids.forEach(id=>uuid(id,'reuse_activity_definition_version_id'));
 const activity_versions=ids.length?(await client.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[])',[ids])).rows:[];
 const contracts=[...(definition.activities||[]),...activity_versions.map(v=>v.payload.contract)];
 const skillIds=contracts.map(a=>a.implementation?.skill_id).filter(Boolean);
 const skills=skillIds.length?(await client.query('SELECT id,status FROM skill_registry WHERE id=ANY($1::uuid[])',[skillIds])).rows:[];
 const keys=contracts.flatMap(a=>(a.warehouse_dependencies||[]).map(w=>w.key));
 const warehouse_items=keys.length?(await client.query('SELECT * FROM warehouse_items WHERE key=ANY($1::text[]) FOR SHARE',[keys])).rows:[];
 return {activity_versions,skills,warehouse_items};
}
export async function ensureAssemblyWarehouse(client,definition,source){
 const items=definition.warehouse_items??[];
 if(!Array.isArray(items)||items.length>100)fail('仓库声明必须为有界数组');
 const seen=new Set(),sourceRef=`${source.repo}:${source.path}`;
 for(const item of items){
  if(!KEY.test(item?.key||'')||seen.has(item.key)||typeof item.name!=='string'||!item.name.trim()||!shelves.has(item.shelf)
   ||!['code','agent','data','service','ui','infra','external','account','doc'].includes(item.kind)||typeof item.impl_ref!=='string'||!item.impl_ref.trim())fail('仓库声明身份无效或重复');
  seen.add(item.key);
  await client.query(`INSERT INTO warehouse_items(key,name,kind,shelf,impl_ref,source_table,source_ref)
   VALUES($1,$2,$3,$4,$5,'workflow_authoring',$6) ON CONFLICT(key) DO NOTHING`,[item.key,item.name,item.kind,item.shelf,item.impl_ref,sourceRef]);
  const row=(await client.query('SELECT * FROM warehouse_items WHERE key=$1 FOR SHARE',[item.key])).rows[0];
  if(!row?.active||['name','kind','shelf','impl_ref'].some(k=>row[k]!==item[k])||row.source_table!=='workflow_authoring'||row.source_ref!==sourceRef)fail(`仓库物件来源或内容冲突: ${item.key}`);
 }
}
async function contractColumns(client,activityId,contract,strict){
 const columns=['inputs','outputs','preconditions','invariants','nfr','failure','readback'];
 const ready=(await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='activities' AND column_name=ANY($1::text[])`,[columns])).rows;
 if(ready.length!==columns.length){if(strict)fail('合同列底座未齐');return;}
 const values=[contract.input_schema??contract.inputs??null,contract.output_schema??contract.outputs??null,contract.preconditions??null,
  {idempotency:contract.idempotency??null,side_effects:contract.side_effects??null},{budget:contract.budget??null,resources:contract.resources??null},contract.failure??null,contract.postconditions??null];
 await client.query(`UPDATE activities SET inputs=$2::jsonb,outputs=$3::jsonb,preconditions=$4::jsonb,invariants=$5::jsonb,nfr=$6::jsonb,failure=$7::jsonb,readback=$8::jsonb
  WHERE id=$1 AND (inputs,outputs,preconditions,invariants,nfr,failure,readback) IS DISTINCT FROM ($2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb)`,[activityId,...values.map(v=>v===null?null:JSON.stringify(v))]);
}
async function explicitUses(client,activityId,contract,source,{strict=false,readOnly=false}={}){
 const declarations=contract.warehouse_dependencies??[];
 if(!Array.isArray(declarations)||declarations.length>100)fail('用料声明必须为有界数组');
 if(!declarations.length&&(!strict||readOnly))return;
 const roles=new Map(),desired=[];
 const marker=`workflow-assembly:${source.repo}:${source.path}`;
 for(const d of declarations){
  const role=d?.role??'uses';
  if(!KEY.test(d?.key||'')||!['uses','depends','produces'].includes(role))fail('用料声明无效');
  if(roles.has(d.key)&&roles.get(d.key)!==role)fail(`同一物件角色冲突: ${d.key}`);
  if(roles.has(d.key))continue;roles.set(d.key,role);
  const item=(await client.query('SELECT id FROM warehouse_items WHERE key=$1 AND active FOR SHARE',[d.key])).rows[0];
  if(!item)fail(`仓库物件缺失: ${d.key}`);desired.push(item.id);
  if(!readOnly)await client.query(`INSERT INTO activity_uses(activity_id,item_id,role,assertion_ref) VALUES($1,$2,$3,$4) ON CONFLICT(activity_id,item_id) DO NOTHING`,[activityId,item.id,role,marker]);
  const existing=(await client.query('SELECT role FROM activity_uses WHERE activity_id=$1 AND item_id=$2 FOR SHARE',[activityId,item.id])).rows[0];
  if(!existing||existing.role!==role)fail(`用料角色或固定依赖冲突: ${d.key}`);
 }
 if(strict&&!readOnly)await client.query('DELETE FROM activity_uses WHERE activity_id=$1 AND assertion_ref=$2 AND NOT(item_id=ANY($3::uuid[]))',[activityId,marker,desired]);
}
export async function syncAssemblyActivity(client,{activityId,contract,canonical,activityKey,capabilityKey,source,synchronizeSteps=false,strict=false,readOnly=false}){
 if(readOnly){await explicitUses(client,activityId,contract,source,{readOnly:true});return;}
 await contractColumns(client,activityId,contract,strict);
 if(synchronizeSteps){
  assertStepsHaveReadback([contract]);
  const rows=(await client.query('SELECT id,key,source_sha256 FROM steps WHERE activity_id=$1',[activityId])).rows;
  const steps=declareStepsFromContract({...contract,key:activityKey},canonical,rows);
  if(new Set(steps.map(s=>s.key)).size!==steps.length||new Set(steps.map(s=>s.order)).size!==steps.length)fail('步骤身份或顺序重复');
  const conflicts=(await client.query('SELECT key FROM steps WHERE key=ANY($1::text[]) AND activity_id<>$2',[steps.map(s=>s.key),activityId])).rows;
  if(conflicts.length||strict&&rows.some(r=>steps.some(s=>s.key===r.key)&&!r.source_sha256))fail('步骤属于其他或未知来源，不能覆盖');
  if(steps.length)await syncSteps(client,{capability:capabilityKey,steps},{manageTransaction:false});
  if(strict)await client.query('UPDATE steps SET active=(key=ANY($2::text[])) WHERE activity_id=$1 AND source_sha256 IS NOT NULL AND active IS DISTINCT FROM (key=ANY($2::text[]))',[activityId,steps.map(s=>s.key)]);
  const actual=(await client.query('SELECT key,readback FROM steps WHERE activity_id=$1 AND active',[activityId])).rows;
  if(strict&&steps.some(s=>!actual.some(a=>a.key===s.key&&canonicalJson(a.readback)===canonicalJson(s.readback))))fail('步骤回读失败');
 }
 await explicitUses(client,activityId,contract,source,{strict});
}
