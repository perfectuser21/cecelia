/** 四新获客Workflow正规运行状态入口；发布不等于自动激活。 */
import {UUID,getRelease,getReleaseGate,lockReleaseTarget} from './release-index.js';
import {LEADGEN_KEYS} from './leadgen-dispatch-contract.js';
const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{status:422});};
export async function setLeadgenRuntimeStatus(pool,id,input,deps={}) {
  const index=Number(String(id).slice(-3))-101;
  check(UUID.test(id||'')&&id===`b1000000-0000-4000-8000-000000000${index+101}`&&index>=0&&index<4,'仅支持四个正式获客Workflow');
  check(input&&Object.keys(input).every(k=>['status','actor','task_id','reason','release_id','observation_id','workflow_definition_version_id','snapshot_sha256'].includes(k)),'未知状态输入');
  check(['active','paused'].includes(input.status)&&UUID.test(input.task_id||''),'status/task_id无效');
  check(typeof input.actor==='string'&&input.actor.trim()===input.actor&&input.actor.length>0&&input.actor.length<=100&&typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=2000,'actor/reason必填');
  if(input.status==='active')check(['release_id','observation_id','workflow_definition_version_id'].every(k=>UUID.test(input[k]||''))&&/^[0-9a-f]{64}$/.test(input.snapshot_sha256||''),'启用须显式固定完整发布');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const task=(await client.query('SELECT * FROM tasks WHERE id=$1 FOR SHARE',[input.task_id])).rows[0];
    check(task&&task.status==='in_progress'&&task.payload?.actor===input.actor&&task.payload?.workflow_runtime_scope?.includes(id),'治理任务未登记认领或作用域不符');
    const workflow=(await client.query('SELECT * FROM workflows WHERE id=$1 FOR UPDATE',[id])).rows[0];
    check(workflow?.key===LEADGEN_KEYS[index]&&['active','paused'].includes(workflow.status),'正式Workflow身份或状态不符');
    if(input.status==='active'){
      const release=await (deps.getRelease??getRelease)(client,input.release_id);
      await (deps.lockReleaseTarget??lockReleaseTarget)(client,release.environment,release.target);
      const gate=await (deps.getReleaseGate??getReleaseGate)(client,release.id);
      check(release.environment==='production'&&release.target===(index===2?'mmv':'xian-m4')&&gate.deployed&&gate.actual_matches&&Array.isArray(gate.gaps)&&gate.gaps.length===0&&gate.current_observation_id===input.observation_id,'当前正式目标发布未核验');
      const fixed=release.payload.workflows.find(w=>w.workflow_id===id&&w.id===workflow.current_definition_version_id&&w.id===input.workflow_definition_version_id&&w.payload_sha256===input.snapshot_sha256);
      check(fixed&&fixed.source_repo===workflow.source_repo&&release.payload.components.some(c=>c.kind==='repo'&&c.repo===fixed.source_repo&&c.revision===fixed.source_commit),'当前完整同源Workflow不符');
    }
    const changed=(await client.query('UPDATE workflows SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING *',[id,input.status])).rows[0];
    await client.query('INSERT INTO task_events(task_id,event_type,payload,created_at) VALUES($1,$2,$3::jsonb,NOW())',[input.task_id,'leadgen_runtime_status_changed',JSON.stringify({...input,workflow_id:id,prior_status:workflow.status})]);
    const readback=(await client.query('SELECT * FROM workflows WHERE id=$1',[id])).rows[0];
    check(changed?.status===input.status&&readback?.status===input.status,'运行状态读回不符');
    await client.query('COMMIT');return {workflow:readback,actor:input.actor,task_id:input.task_id,reason:input.reason};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
