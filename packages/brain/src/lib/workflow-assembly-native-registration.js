/** 本系统唯一维护流程的CAS登记，不触发布线/生产指针，不覆盖调度镜子状态。 */
import {nativeSpec as spec,assertNativeSource} from './workflow-assembly-native-source.js';
import {definitionDigest} from '../workflow-authoring/contracts.js';
import {budgetDatabase} from '../workflow-authoring/query-budget.js';
const conflict=()=>{throw Object.assign(Error('native_registration_ownership_conflict'),{status:409});};
async function version(db,kind,id,payload,source){
  const table=kind==='activity'?'activity_definition_versions':'workflow_definition_versions',column=kind+'_id';
  const values=[id,payload,definitionDigest({source:{repo:source.repo,path:source.path,commit:source.commit},payload}),definitionDigest(payload.contract),source.repo,source.path,source.commit];
  const row=(await db.query(`INSERT INTO ${table}(${column},payload,payload_sha256,contract_sha256,source_repo,source_path,source_commit)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(${column},source_repo,source_path,payload_sha256) DO NOTHING RETURNING id`,values)).rows[0];
  return row?.id??(await db.query(`SELECT id FROM ${table} WHERE ${column}=$1 AND payload_sha256=$2 AND source_repo=$3 AND source_path=$4`,[id,values[2],source.repo,source.path])).rows[0]?.id;
}
export async function registerNativeReconcile(pool,source,options={}){
  assertNativeSource(source);const db=await budgetDatabase(pool,{deadline:Date.now()+15000,...options}).connect(),a=spec.activities[0],s=spec.schedule;
  try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[spec.key]);
    const cap=(await db.query('SELECT * FROM capabilities WHERE id=$1 FOR SHARE',[spec.capability_id])).rows[0];
    if(!cap||cap.status!=='active'||cap.name!=='系统看护 · 业务线健康巡检'&&cap.name!=='系统看护·业务线健康巡检')conflict();
    const schedule=(await db.query('SELECT * FROM ops_schedule_entries WHERE id=$1 FOR UPDATE',[s.id])).rows[0];
    const ops=(await db.query('SELECT * FROM ops_workflows WHERE id=$1 FOR UPDATE',[s.ops_workflow_id])).rows[0];
    if(!schedule||!ops||Object.entries(s).some(([k,v])=>String(schedule[k])!==String(v))
      ||ops.source!=='scheduler'||ops.wf_id!==s.label||ops.machine!==s.host_alias
      ||[schedule.workflow_id,ops.workflow_id].some(id=>id&&id!==spec.id))conflict();
    const old=(await db.query('SELECT * FROM workflows WHERE id=$1 OR key=$2 FOR UPDATE',[spec.id,spec.key])).rows;
    if(old.some(w=>w.id!==spec.id||w.key!==spec.key||w.capability_id!==spec.capability_id||w.source_repo!==source.repo||w.source_path!==source.path||w.status!=='active'))conflict();
    await db.query(`INSERT INTO workflows(id,capability_id,key,name,channel,form,version,status,source_repo,source_path)
      VALUES($1,$2,$3,$4,'internal','code',$5,'active',$6,$7) ON CONFLICT(id) DO NOTHING`,[spec.id,spec.capability_id,spec.key,spec.name,spec.version,source.repo,source.path]);
    const existing=(await db.query('SELECT * FROM activities WHERE id=$1 OR (capability_key=$2 AND activity_key=$3) FOR UPDATE',[a.id,spec.capability,a.key])).rows;
    if(existing.some(x=>x.id!==a.id||x.workflow_id!==spec.id||x.status!=='active'||x.executor_kind!=='code'||definitionDigest(x.contract)!==definitionDigest(a)))conflict();
    const url=`https://github.com/${source.repo}/blob/${source.commit}/${source.path}`;
    await db.query(`INSERT INTO activities(id,name,status,workflow_id,capability_key,activity_key,executor_kind,contract,contract_sha256,contract_source,backbone_version)
      VALUES($1,$2,'active',$3,$4,$5,'code',$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`,[a.id,a.name,spec.id,spec.capability,a.key,a,definitionDigest(a),url,spec.version]);
    const av=await version(db,'activity',a.id,{protocol:spec.protocol,activity_id:a.id,contract:a,steps:[],implementation_bindings:source.bindings},source);
    const refs=(await db.query('SELECT * FROM workflow_activity_refs WHERE workflow_id=$1 OR id=$2 FOR UPDATE',[spec.id,a.reference_id])).rows;
    if(refs.some(r=>r.id!==a.reference_id||r.workflow_id!==spec.id||r.activity_id!==a.id||r.slot_key!==a.key||r.sequence_no!==1||!r.active||r.source_repo!==source.repo||r.source_path!==source.path))conflict();
    await db.query(`INSERT INTO workflow_activity_refs(id,workflow_id,slot_key,activity_id,sequence_no,active,source_repo,source_path,source_commit,activity_definition_version_id)
      VALUES($1,$2,$3,$4,1,true,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET activity_definition_version_id=$8,source_commit=$7`,[a.reference_id,spec.id,a.key,a.id,source.repo,source.path,source.commit,av]);
    const payload={protocol:spec.protocol,workflow_id:spec.id,key:spec.key,contract:spec,activities:[{reference_id:a.reference_id,slot_key:a.key,sequence_no:1,activity_id:a.id,activity_version_id:av}]};
    const wv=await version(db,'workflow',spec.id,payload,source);
    await db.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[spec.id,wv]);
    await db.query('UPDATE activities SET current_definition_version_id=$2,contract_source=$3 WHERE id=$1',[a.id,av,url]);
    await db.query('UPDATE ops_schedule_entries SET workflow_id=$2 WHERE id=$1 AND (workflow_id IS NULL OR workflow_id=$2)',[s.id,spec.id]);
    await db.query('UPDATE ops_workflows SET workflow_id=$2 WHERE id=$1 AND (workflow_id IS NULL OR workflow_id=$2)',[s.ops_workflow_id,spec.id]);
    await db.query('COMMIT');return {workflow_id:spec.id,workflow_definition_version_id:wv,activity_id:a.id,activity_definition_version_id:av,source};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
