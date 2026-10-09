/** 回归定义登记；共享活动按消费者归属，登记不等于验收通过。 */
import { UUID } from './release-index.js';
import { canonicalAssertionCommandText } from './gp-assertion-command.js';
const fail=(message,status=422)=>{throw Object.assign(Error(message),{status,code:'CAPABILITY_REGRESSION_INVALID'});};
export async function registerCapabilityRegression(pool,input){
  if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['capability_id','activity_id','step_id','assertion_ref','expected_assertion_ref'].includes(k)))fail('登记字段无效',400);
  for(const key of ['capability_id','activity_id'])if(typeof input[key]!=='string'||!UUID.test(input[key]))fail('规范身份须为UUID',400);
  if(input.step_id!==undefined&&input.step_id!==null&&(typeof input.step_id!=='string'||!UUID.test(input.step_id)))fail('Step身份须为UUID',400);
  input={...input,capability_id:input.capability_id.toLowerCase(),activity_id:input.activity_id.toLowerCase(),...(input.step_id&&{step_id:input.step_id.toLowerCase()})};
  if(typeof input.assertion_ref!=='string'||input.assertion_ref.length>1024)fail('assertion_ref无效',400);
  try{canonicalAssertionCommandText(input.assertion_ref);}catch{fail('assertion_ref必须是受支持的固定回归路径',400);}
  const key=`regression:${input.capability_id}:${input.step_id||'activity'}`,level=input.step_id?'step':'activity',db=await pool.connect();
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${input.activity_id}:${key}`]);
    const usage=(await db.query(`SELECT r.id FROM workflow_activity_refs r JOIN workflows w ON w.id=r.workflow_id
      WHERE r.active AND r.activity_id=$1 AND w.capability_id=$2 AND w.status<>'retired' LIMIT 1`,[input.activity_id,input.capability_id])).rows[0];
    if(!usage)fail('Capability没有使用此Activity，拒绝登记');
    if(input.step_id&&!(await db.query('SELECT id FROM steps WHERE id=$1 AND activity_id=$2 AND active',[input.step_id,input.activity_id])).rows.length)fail('Step不属于此Activity或已退役');
    const old=(await db.query("SELECT * FROM activity_cells WHERE step_id=$1 AND cell_kind='scenario' AND cell_key=$2 FOR UPDATE",[input.activity_id,key])).rows[0];
    if(old&&(old.journey_id!==input.capability_id||(old.step_id_ref||null)!==(input.step_id||null)||old.cell_level!==level||old.enabler_id))fail('既有登记身份冲突',409);
    if(old&&old.assertion_ref===input.assertion_ref){await db.query('COMMIT');return {registration:old,created:false,verification_status:'not_evaluated'};}
    if(old&&input.expected_assertion_ref!==old.assertion_ref)fail('回归引用已变化，必须明确匹配旧值',409);
    const registration=old?(await db.query(`UPDATE activity_cells SET assertion_ref=$2,cell_status='gray',status='planned',notion_synced_at=NULL WHERE id=$1 RETURNING *`,[old.id,input.assertion_ref])).rows[0]
      :(await db.query(`INSERT INTO activity_cells(journey_id,step_id,step_id_ref,cell_kind,cell_key,cell_status,status,assertion_ref,cell_level,notion_synced_at)
        VALUES($1,$2,$3,'scenario',$4,'gray','planned',$5,$6,NULL) RETURNING *`,[input.capability_id,input.activity_id,input.step_id||null,key,input.assertion_ref,level])).rows[0];
    await db.query('COMMIT');return {registration,created:!old,verification_status:'not_evaluated',...(old&&{previous_assertion_ref:old.assertion_ref})};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
