import { directory,endpointValid } from './directory.js';
import { legacyRecords } from './legacy-policy.js';
import { MACHINE_CAPACITY_LOCK_SQL } from '../orchestrator/attempt-machine-capacity.js';
export async function transaction(pool,fn){
 if(typeof pool.connect!=='function'||typeof pool.release==='function')return fn(pool);
 const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
 catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
// 调用方持有同机预约锁；所有写入触发器也使用这个锁。
export async function authorize(db,input,operation=a=>a){
 return transaction(db,async c=>{
  const snapshot=directory.current();
  if(!snapshot||snapshot.version!==input.snapshotVersion)throw Error('execution_snapshot_unavailable');
  const expected=snapshot.nodes.find(n=>n.canonical_id===input.machineId);
  if(!expected)throw Error('execution_node_unavailable');
  await c.query(MACHINE_CAPACITY_LOCK_SQL,[input.machineId]);
  const node=(await c.query(`SELECT v.*,n.canonical_id FROM execution_nodes n JOIN execution_node_versions v ON v.id=n.current_version_id
    JOIN system_registry r ON r.id=n.machine_registry_id WHERE n.canonical_id=$1 AND v.state='active' AND r.type='machine' AND r.status='active'`,[input.machineId])).rows[0];
  if(!node||node.id!==expected.id||!endpointValid(node.endpoints?.worker))throw Error('execution_version_stale');
  if(input.executionVersionId&&input.executionVersionId!==node.id)throw Error('execution_version_stale');
  const grant=(await c.query(`SELECT * FROM execution_grants WHERE node_version_id=$1 AND surface=$2 AND provider=$3
    AND account_id=$4 AND profile_id=$5 AND state='active' AND (expires_at IS NULL OR expires_at>clock_timestamp())
    AND ($6::text IS NULL OR $6=ANY(repo_scope)) ORDER BY id LIMIT 1`,
   [node.id,input.surface,input.provider,input.account??'',input.profileId??'',input.repo??null])).rows[0];
  if(!grant||(input.grantId&&input.grantId!==grant.id))throw Error('execution_grant_denied');
  if(!directory.current())throw Error('execution_snapshot_unavailable');
  return operation({executionVersionId:node.id,grantId:grant.id,node,grant},c);
 });
}
export async function resolveCleanup(db,{executionVersionId,persistedAttemptIdentity}){
 const node=(await db.query(`SELECT v.*,n.canonical_id FROM execution_node_versions v JOIN execution_nodes n USING(machine_registry_id) WHERE v.id=$1`,[executionVersionId])).rows[0];
 if(!node||node.canonical_id!==(persistedAttemptIdentity?.requested_machine_id??persistedAttemptIdentity?.machine_id))throw Error('execution_cleanup_identity_mismatch');
 if(!endpointValid(node.endpoints?.worker))throw Error('execution_cleanup_endpoint_unavailable');return node;
}
export async function importLegacyPolicy({pool,env=process.env}){
 for(const n of legacyRecords({env}))await transaction(pool,async c=>{
  await c.query(MACHINE_CAPACITY_LOCK_SQL,[n.canonical_id]);
  const exists=(await c.query('SELECT 1 FROM execution_nodes WHERE machine_registry_id=$1 OR canonical_id=$2',[n.machine_registry_id,n.canonical_id])).rowCount;
  if(exists)return; // 已存在包括撤销和空endpoint，重启不得复活或换址。
  const registry=(await c.query("SELECT 1 FROM system_registry WHERE id=$1 AND type='machine'",[n.machine_registry_id])).rowCount;
  if(!registry)return;
  await c.query('INSERT INTO execution_nodes(machine_registry_id,canonical_id) VALUES($1,$2)',[n.machine_registry_id,n.canonical_id]);
  await c.query(`INSERT INTO execution_node_versions(id,machine_registry_id,revision,identity_mode,worker_id,platform,endpoints,profile,config_hash,state)
   VALUES($1,$2,1,'legacy-v1',$3,'darwin',$4,$5,$6,'active')`,[n.id,n.machine_registry_id,n.worker_id,n.endpoints,n.profile,n.config_hash]);
  for(const g of n.grants)await c.query(`INSERT INTO execution_grants(id,node_version_id,surface,provider,account_id,repo_scope,profile_id,provenance,state)
   VALUES($1,$2,$3,$4,$5,$6,$7,'legacy_policy','active')`,[g.id,n.id,g.surface,g.provider,g.account_id,g.repo_scope,g.profile_id]);
  await c.query('UPDATE execution_nodes SET current_version_id=$2 WHERE machine_registry_id=$1',[n.machine_registry_id,n.id]);
 });
}
export async function revokeGrant({pool,grantId}){
 await transaction(pool,async c=>{
  const row=(await c.query(`SELECT n.canonical_id FROM execution_grants g JOIN execution_node_versions v ON v.id=g.node_version_id JOIN execution_nodes n USING(machine_registry_id) WHERE g.id=$1`,[grantId])).rows[0];
  if(!row)throw Error('execution_grant_missing');await c.query(MACHINE_CAPACITY_LOCK_SQL,[row.canonical_id]);
  await c.query("UPDATE execution_grants SET state='revoked' WHERE id=$1",[grantId]);
 });await directory.refresh({pool});
}
export async function startExecutionDirectory({pool,env=process.env}){
 await importLegacyPolicy({pool,env});await directory.refresh({pool});
 const timer=setInterval(()=>directory.refresh({pool}).catch(()=>{}),10_000);timer.unref();return()=>clearInterval(timer);
}
