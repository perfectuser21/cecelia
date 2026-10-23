/** 来源历史共用写入器；从不激活current或执行引用。 */
import {stepSha256} from '../../scripts/sync-steps-from-workspace.mjs';
export const consumerFailure=code=>Object.assign(Error(code),{code,status:409});
export async function appendConsumerEvidence(db,kind,id,payload,source){
 if(!['workflow','activity'].includes(kind)||payload.definition_scope!=='consumer_evidence'||payload.contract?.executable!==false)throw consumerFailure('OPS_HISTORY_INPUT_INVALID');
 const table=kind==='workflow'?'workflow_definition_versions':'activity_definition_versions';
 const column=`${kind}_id`,hash=stepSha256({source,payload});
 await db.query(`INSERT INTO ${table}(${column},payload,payload_sha256,source_repo,source_path,source_commit,contract_sha256)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(${column},source_repo,source_path,payload_sha256) DO NOTHING`,
 [id,payload,hash,source.repo,source.path,source.commit,stepSha256(payload.contract)]);
 const row=(await db.query(`SELECT * FROM ${table} WHERE ${column}=$1 AND payload_sha256=$2 AND source_repo=$3 AND source_path=$4`,[id,hash,source.repo,source.path])).rows[0];
 if(!row)throw consumerFailure('OPS_HISTORY_APPEND_FAILED');return row;
}
export async function assertConsumerScratch(db){
 const name=(await db.query('SELECT current_database() name')).rows[0]?.name;
 if(name!=='cecelia_scratch'&&!(name==='cecelia_test'&&process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'))throw consumerFailure('OPS_SCRATCH_REQUIRED');
}
/** 两种受信来源登记共用事务/CAS临界区；回调仍须锁并比对真实registry。 */
export async function withConsumerEvidenceTransaction(pool,lockName,work,{lockTimeoutMs}={}){
 if(!['existing-factory-consumer-evidence','infra-consumer-evidence'].includes(lockName)||typeof work!=='function')throw consumerFailure('OPS_TRANSACTION_INPUT_INVALID');
 if(lockTimeoutMs!==undefined&&(!Number.isSafeInteger(lockTimeoutMs)||lockTimeoutMs<1||lockTimeoutMs>10000))throw consumerFailure('OPS_TRANSACTION_INPUT_INVALID');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  if(lockTimeoutMs!==undefined)await db.query("SELECT set_config('lock_timeout',$1,true)",[lockTimeoutMs+'ms']);
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[lockName]);
  const result=await work(db);await db.query('COMMIT');return result;
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
