/** 调用方持有定义写事务；每个稳定对象的语义内容复用版本，版本中的来源永久固定。 */
import { stepSha256,canonicalJson } from '../../scripts/sync-steps-from-workspace.mjs';
import { runReleaseLineHook,registerActivityBuild,refreshWorkflowRecipe } from './release-line.js';
async function saveVersion(client,kind,id,payload,source) {
  const table=kind==='activity'?'activity_definition_versions':'workflow_definition_versions';
  const column=kind==='activity'?'activity_id':'workflow_id';
  const hash=stepSha256({source,payload}),contractHash=stepSha256(payload.contract);
  let inserted=true;
  let row=(await client.query(`INSERT INTO ${table}(${column},payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256)
    VALUES($1,$2::jsonb,$3,$4,$5,$6,$7) ON CONFLICT(${column},source_repo,source_path,payload_sha256) DO NOTHING RETURNING id`,[id,canonicalJson(payload),hash,source.repo,source.path,source.commit,contractHash])).rows[0];
  if(!row){inserted=false;row=(await client.query(`SELECT id FROM ${table} WHERE ${column}=$1 AND payload_sha256=$2 AND source_repo=$3 AND source_path=$4`,[id,hash,source.repo,source.path])).rows[0];}
  if(!row) throw Error('定义版本未返回身份');
  const object=kind==='activity'?'activities':'workflows';
  await client.query(`UPDATE ${object} SET current_definition_version_id=$2 WHERE id=$1 AND current_definition_version_id IS DISTINCT FROM $2`,[id,row.id]);
  return {id:row.id,inserted};
}
async function snapshotSteps(client,activity) {
  const registered=(await client.query('SELECT id,key,step_order,mode,readback,source_sha256 FROM steps WHERE activity_id=$1 AND active ORDER BY step_order',[activity.id])).rows;
  return (activity.contract?.steps||registered).map(step=>{
    const matches=registered.filter(s=>s.key===step.key||s.key===`${activity.capability_key}.${activity.activity_key}.${step.key}`);
    if(matches.length>1) throw Error(`步骤规范身份不唯一: ${step.key}`);
    return {step_id:matches[0]?.id||null,locator:{activity_id:activity.id,step_key:step.key},contract:step,registration:matches[0]||null};
  });
}
function verifyDocument(workflow,doc) {
  if(!doc||typeof doc!=='object'||Array.isArray(doc)||!Array.isArray(doc.activities)) throw Error(`工作流缺少完整契约: ${workflow.id}`);
  if((workflow.source_workflow&&doc.workflow!==workflow.source_workflow)
    ||(!workflow.source_workflow&&doc.key!==workflow.key)
    ||(workflow.source_capability&&(doc.contract_key??doc.capability)!==workflow.source_capability)
    ||(doc.capability_id&&doc.capability_id!==workflow.capability_id)) throw Error(`工作流契约身份不匹配: ${workflow.id}`);
}
export async function snapshotDefinitions(client,{workflowIds,source,bindingsByActivity=new Map(),documentsByWorkflow=new Map()}) {
  if(!/^[0-9a-f]{40}$/.test(source.commit||'')) throw Error('快照必须使用固定commit');
  const workflows=new Map();
  for(const id of workflowIds) {
    const workflow=(await client.query('SELECT * FROM workflows WHERE id=$1',[id])).rows[0];
    if(!workflow) throw Error(`工作流不存在: ${id}`);
    verifyDocument(workflow,documentsByWorkflow.get(id));
    workflows.set(id,workflow);
  }
  const activities=(await client.query(`SELECT DISTINCT a.* FROM activities a JOIN workflow_activity_refs r ON r.activity_id=a.id
    WHERE r.workflow_id=ANY($1::uuid[]) AND r.active ORDER BY a.id`,[workflowIds])).rows;
  const versions=new Map(),sources=new Map();
  for(const a of activities) {
    const match=a.contract_source?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([0-9a-f]{40})\/(.+)$/);
    if(!match) throw Error(`活动缺少固定来源: ${a.id}`);
    if(match[1]!==source.repo||match[2]!==source.commit) throw Error(`活动来源不匹配: ${a.id}`);
    sources.set(a.id,{repo:match[1],commit:match[2],path:match[3]});
    const binding=bindingsByActivity.get(a.id);
    if(!binding) throw Error(`活动缺少绑定核验证据: ${a.id}`);
  }
  for(const a of activities) {
    const binding=bindingsByActivity.get(a.id),activitySource=sources.get(a.id);
    const payload={activity_id:a.id,definition_key:`${a.capability_key}.${a.activity_key}`,contract:a.contract,
      steps:await snapshotSteps(client,a),implementation_bindings:binding,resources:a.contract?.resources||{},verification:{preconditions:a.contract?.preconditions||[],postconditions:a.contract?.postconditions||[],steps:a.contract?.steps||[]}};
    const saved=await saveVersion(client,'activity',a.id,payload,activitySource),versionId=saved.id;
    versions.set(a.id,versionId);
    // 发布线（迁移 540）：构建登记到内容版本、按冷启动规则动生产指针；SAVEPOINT 内 fail-open，出错不影响同步
    await runReleaseLineHook(client,'register_build',db=>registerActivityBuild(db,{activityId:a.id,buildId:versionId,inserted:saved.inserted}));
    await client.query('UPDATE workflow_activity_refs SET activity_definition_version_id=$2 WHERE activity_id=$1 AND workflow_id=ANY($3::uuid[]) AND active AND activity_definition_version_id IS DISTINCT FROM $2',[a.id,versionId,workflowIds]);
  }
  for(const id of workflowIds) {
    const workflow=workflows.get(id);
    const refs=(await client.query('SELECT * FROM workflow_activity_refs WHERE workflow_id=$1 AND active ORDER BY sequence_no',[id])).rows;
    const payload={workflow_id:id,key:workflow.key,name:workflow.name,capability_id:workflow.capability_id,channel:workflow.channel,form:workflow.form,
      contract:documentsByWorkflow.get(id),activities:refs.map(r=>({reference_id:r.id,slot_key:r.slot_key,sequence_no:r.sequence_no,activity_id:r.activity_id,activity_version_id:versions.get(r.activity_id),source_ref:r.source_ref}))};
    await saveVersion(client,'workflow',id,payload,{...source,path:workflow.source_path||source.path});
    await runReleaseLineHook(client,'refresh_recipe',db=>refreshWorkflowRecipe(db,id,{cause:'definition_sync'}));
  }
}
