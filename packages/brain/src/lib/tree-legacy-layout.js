export const TASK_ID='a2b3101f-f76b-4d13-816e-7c42926c2875';
export const DECISION_ID='5155c28c-ce2a-4452-87d4-cefb0362bf34';
export class LayoutError extends Error { constructor(status,code){super(code);this.status=status;this.code=code;} }
const reject=(status,code)=>{throw new LayoutError(status,code);};
const sorted=items=>[...items].sort();
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export async function applyTreeLegacyLayout(pool,input){
 if(input.task_id!==TASK_ID||input.decision_id!==DECISION_ID)reject(403,'SCOPE_FORBIDDEN');
 const db=await pool.connect();let open=false;
 try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');open=true;
  const task=(await db.query('SELECT id,result FROM tasks WHERE id=$1 FOR UPDATE',[input.task_id])).rows[0];
  if(!task)reject(404,'TASK_NOT_FOUND');
  const decision=(await db.query('SELECT id,made_by,status FROM decisions WHERE id=$1 FOR UPDATE',[input.decision_id])).rows[0];
  if(!decision)reject(404,'DECISION_NOT_FOUND');
  if(decision.made_by!=='user'||decision.status!=='active')reject(409,'DECISION_INACTIVE');
  const receipts=task.result?.tree_legacy_layout_receipts??[];
  if(!Array.isArray(receipts))reject(409,'RECEIPTS_INVALID');
  const previous=receipts.find(x=>x.client_request_id===input.client_request_id);
  if(previous){if(!equal(previous.request,input))reject(409,'IDEMPOTENCY_CONFLICT');await db.query('COMMIT');open=false;return {receipt:previous,replayed:true};}
  const changes=[...input.changes].sort((a,b)=>a.workflow_id.localeCompare(b.workflow_id)), workflowIds=changes.map(x=>x.workflow_id);
  const workflows=(await db.query('SELECT id,capability_id,name,key,status,current_definition_version_id,source_repo,source_path,source_capability FROM workflows WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[workflowIds])).rows;
  if(workflows.length!==changes.length)reject(404,'WORKFLOW_NOT_FOUND');
  const targetIds=sorted(new Set(changes.map(x=>x.target_capability_id)));
  const targets=(await db.query('SELECT id,parent_journey_id,status FROM capabilities WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[targetIds])).rows;
  if(targets.length!==targetIds.length)reject(404,'CAPABILITY_NOT_FOUND');
  const streamIds=sorted(new Set(targets.map(x=>x.parent_journey_id)));
  const streams=(await db.query('SELECT id,status FROM value_streams WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[streamIds])).rows;
  if(streams.length!==streamIds.length||targets.some(x=>x.status!=='active'||streams.find(y=>y.id===x.parent_journey_id)?.status!=='active'))reject(409,'TARGET_INACTIVE');
  const refs=(await db.query('SELECT id,workflow_id,activity_id,active FROM workflow_activity_refs WHERE workflow_id=ANY($1::uuid[]) ORDER BY workflow_id,id FOR UPDATE',[workflowIds])).rows;
  const deactivateIds=changes.flatMap(x=>x.deactivate_reference_ids);
  const activityIds=sorted(new Set(refs.filter(x=>deactivateIds.includes(x.id)).map(x=>x.activity_id)));
  const activities=activityIds.length?(await db.query('SELECT id,status,current_definition_version_id FROM activities WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[activityIds])).rows:[];
  const state=(workflow,allRefs,allActivities)=>({workflow_id:workflow.id,capability_id:workflow.capability_id,name:workflow.name,active_reference_ids:sorted(allRefs.filter(x=>x.workflow_id===workflow.id&&x.active).map(x=>x.id)),deactivated_reference_ids:sorted(allRefs.filter(x=>x.workflow_id===workflow.id&&!x.active).map(x=>x.id)),activity_statuses:allActivities.filter(a=>allRefs.some(r=>r.workflow_id===workflow.id&&r.activity_id===a.id)).map(a=>({activity_id:a.id,status:a.status}))});
  const before=[];
  for(const change of changes){
   const workflow=workflows.find(x=>x.id===change.workflow_id);
   if(workflow.current_definition_version_id!==null||workflow.source_repo!==null||workflow.source_path!==null||workflow.source_capability!==null)reject(409,'WORKFLOW_FROZEN');
   if(workflow.capability_id!==change.expected_capability_id||!equal(state(workflow,refs,activities).active_reference_ids,sorted(change.expected_active_reference_ids)))reject(409,'CAS_CONFLICT');
   if(change.deactivate_reference_ids.some(id=>!refs.some(r=>r.id===id&&r.workflow_id===workflow.id&&r.active)))reject(409,'CAS_CONFLICT');
   before.push(state(workflow,refs,activities));
  }
  for(const change of changes){
   await db.query('UPDATE workflows SET capability_id=$2,name=COALESCE($3,name),updated_at=now() WHERE id=$1',[change.workflow_id,change.target_capability_id,change.name??null]);
   if(change.deactivate_reference_ids.length)await db.query('UPDATE workflow_activity_refs SET active=false,updated_at=now() WHERE id=ANY($1::uuid[])',[change.deactivate_reference_ids]);
  }
  const retireIds=changes.filter(x=>x.deprecate_detached).flatMap(x=>x.deactivate_reference_ids);
  for(const activity of activities){
   if(!refs.some(r=>retireIds.includes(r.id)&&r.activity_id===activity.id))continue;
   const consumers=(await db.query('SELECT id FROM workflow_activity_refs WHERE activity_id=$1 AND active LIMIT 1',[activity.id])).rows;
   const versions=(await db.query('SELECT id FROM activity_definition_versions WHERE activity_id=$1 LIMIT 1',[activity.id])).rows;
   if(!consumers.length&&!activity.current_definition_version_id&&!versions.length)await db.query("UPDATE activities SET status='deprecated' WHERE id=$1",[activity.id]);
  }
  const readWorkflows=(await db.query('SELECT id,capability_id,name FROM workflows WHERE id=ANY($1::uuid[]) ORDER BY id',[workflowIds])).rows;
  const readRefs=(await db.query('SELECT id,workflow_id,activity_id,active FROM workflow_activity_refs WHERE workflow_id=ANY($1::uuid[]) ORDER BY workflow_id,id',[workflowIds])).rows;
  const readActivities=activityIds.length?(await db.query('SELECT id,status FROM activities WHERE id=ANY($1::uuid[]) ORDER BY id',[activityIds])).rows:[];
  const after=changes.map(x=>state(readWorkflows.find(w=>w.id===x.workflow_id),readRefs,readActivities));
  for(let i=0;i<changes.length;i++)if(after[i].capability_id!==changes[i].target_capability_id||after[i].name!==(changes[i].name??before[i].name)||!equal(after[i].active_reference_ids,sorted(changes[i].expected_active_reference_ids.filter(id=>!changes[i].deactivate_reference_ids.includes(id)))))reject(500,'READBACK_MISMATCH');
  const receipt={client_request_id:input.client_request_id,actor:input.actor,decision_id:input.decision_id,task_id:input.task_id,request:input,changes:changes.map((x,i)=>({workflow_id:x.workflow_id,before:before[i],after:after[i]})),readback:{workflows:readWorkflows,references:readRefs,activities:readActivities},readback_verified:true};
  await db.query("UPDATE tasks SET result=jsonb_set(COALESCE(result,'{}'::jsonb),'{tree_legacy_layout_receipts}',$2::jsonb),updated_at=now() WHERE id=$1",[input.task_id,JSON.stringify([...receipts,receipt])]);
  const saved=(await db.query('SELECT result FROM tasks WHERE id=$1',[input.task_id])).rows[0]?.result;
  if(!equal(saved?.tree_legacy_layout_receipts,[...receipts,receipt]))reject(500,'RECEIPT_READBACK_MISMATCH');
  await db.query('COMMIT');open=false;return {receipt,replayed:false};
 }catch(error){if(open)await db.query('ROLLBACK');throw error;}finally{db.release();}
}
