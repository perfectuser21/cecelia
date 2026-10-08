/** 回归定义登记；共享活动按消费者归属，登记不等于验收通过。 */
import { UUID } from './release-index.js';
import { canonicalAssertionCommandText,classifyAssertionRef } from './gp-assertion-command.js';
import { hasFrozenConsumerSource,validAssertionSourceRepo,sealedConsumerVersion,consumerSourceAdmissionScope } from './consumer-source-set.js';
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
const fail=(message,status=422)=>{throw Object.assign(Error(message),{status,code:'CAPABILITY_REGRESSION_INVALID'});};
export async function registerCapabilityRegression(pool,input){
  if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['capability_id','activity_id','step_id','assertion_ref','expected_assertion_ref','assertion_source_repo'].includes(k)))fail('登记字段无效',400);
  if(input.assertion_source_repo!=null&&!validAssertionSourceRepo(input.assertion_source_repo))fail('断言仓库身份无效',400);
  for(const key of ['capability_id','activity_id'])if(typeof input[key]!=='string'||!UUID.test(input[key]))fail('规范身份须为UUID',400);
  if(input.step_id!==undefined&&input.step_id!==null&&(typeof input.step_id!=='string'||!UUID.test(input.step_id)))fail('Step身份须为UUID',400);
  input={...input,capability_id:input.capability_id.toLowerCase(),activity_id:input.activity_id.toLowerCase(),...(input.step_id&&{step_id:input.step_id.toLowerCase()})};
  if(typeof input.assertion_ref!=='string'||input.assertion_ref.length>1024)fail('assertion_ref无效',400);
  try{canonicalAssertionCommandText(input.assertion_ref);}catch{fail('assertion_ref必须是受支持的固定回归路径',400);}
  const sourceRepo=input.assertion_source_repo||null;
  const key=`regression:${input.capability_id}:${input.step_id||'activity'}${sourceRepo?`:repo:${sourceRepo}`:''}`,level=input.step_id?'step':'activity',db=await pool.connect();
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${input.activity_id}:${key}`]);
    const usage=(await db.query(`SELECT r.id FROM workflow_activity_refs r JOIN workflows w ON w.id=r.workflow_id
      WHERE r.active AND r.activity_id=$1 AND w.capability_id=$2 AND w.status<>'retired' LIMIT 1`,[input.activity_id,input.capability_id])).rows[0];
    if(!usage)fail('Capability没有使用此Activity，拒绝登记');
    if(sourceRepo){
      const admissionScope=await consumerSourceAdmissionScope(db);
      const path=classifyAssertionRef(input.assertion_ref).path;
      const candidates=(await db.query(`SELECT av.*,wv.payload workflow_payload,wv.payload_sha256 workflow_hash,
        wv.source_repo workflow_repo,wv.source_path workflow_path,wv.source_commit workflow_commit
        FROM workflow_definition_versions wv JOIN workflows w ON w.id=wv.workflow_id
        CROSS JOIN LATERAL jsonb_array_elements(wv.payload->'activities') ref(value)
        JOIN activity_definition_versions av ON av.id=(ref.value->>'activity_version_id')::uuid
        WHERE w.capability_id=$1 AND av.activity_id=$2`,[input.capability_id,input.activity_id])).rows;
      const sealed=row=>sealedConsumerVersion(row)&&row.workflow_repo==='perfectuser21/cecelia'
       &&row.workflow_hash===stepSha256({source:{repo:row.workflow_repo,path:row.workflow_path,commit:row.workflow_commit},payload:row.workflow_payload})
       &&row.workflow_payload.definition_scope==='consumer_evidence'&&row.workflow_payload.capability_id===input.capability_id
       &&hasFrozenConsumerSource(row.payload,sourceRepo,path,admissionScope);
      if(!path||!candidates.some(sealed))throw Object.assign(Error('断言仓库缺少已准入的冻结 consumer 来源'),{status:422,code:'CAPABILITY_REGRESSION_SOURCE_UNKNOWN'});
    }
    if(input.step_id&&!(await db.query('SELECT id FROM steps WHERE id=$1 AND activity_id=$2 AND active',[input.step_id,input.activity_id])).rows.length)fail('Step不属于此Activity或已退役');
    const old=(await db.query("SELECT * FROM activity_cells WHERE step_id=$1 AND cell_kind='scenario' AND cell_key=$2 FOR UPDATE",[input.activity_id,key])).rows[0];
    if(old&&(old.journey_id!==input.capability_id||(old.step_id_ref||null)!==(input.step_id||null)||old.cell_level!==level||old.enabler_id||(old.assertion_source_repo||null)!==sourceRepo))fail('既有登记身份冲突',409);
    if(old&&old.assertion_ref===input.assertion_ref){await db.query('COMMIT');return {registration:old,created:false,verification_status:'not_evaluated'};}
    if(old&&input.expected_assertion_ref!==old.assertion_ref)fail('回归引用已变化，必须明确匹配旧值',409);
    const registration=old?(await db.query(`UPDATE activity_cells SET assertion_ref=$2,cell_status='gray',status='planned',notion_synced_at=NULL WHERE id=$1 RETURNING *`,[old.id,input.assertion_ref])).rows[0]
      :(await db.query(`INSERT INTO activity_cells(journey_id,step_id,step_id_ref,cell_kind,cell_key,cell_status,status,assertion_ref,cell_level,notion_synced_at,assertion_source_repo)
        VALUES($1,$2,$3,'scenario',$4,'gray','planned',$5,$6,NULL,$7) RETURNING *`,[input.capability_id,input.activity_id,input.step_id||null,key,input.assertion_ref,level,sourceRepo])).rows[0];
    await db.query('COMMIT');return {registration,created:!old,verification_status:'not_evaluated',...(old&&{previous_assertion_ref:old.assertion_ref})};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
