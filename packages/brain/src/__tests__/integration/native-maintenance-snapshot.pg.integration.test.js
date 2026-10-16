import {afterEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {nativeMaintenanceDatabase,readSource} from '../fixtures/workflow-assembly-native-db.test.js';
import {nativeSpec as spec,prepareNativeSource} from '../../lib/workflow-assembly-native-source.js';
import {registerNativeReconcile} from '../../lib/workflow-assembly-native-registration.js';
import {runNativeReconcile} from '../../lib/workflow-assembly-native.js';
import {readImplementationSnapshotInTransaction} from '../../lib/implementation-ci-snapshot.js';
import {definitionDigest} from '../../workflow-authoring/contracts.js';
let f;
afterEach(async()=>{await f?.close();f=null;});
const repo='perfectuser21/cecelia',old='a'.repeat(40),next='b'.repeat(40);
const sourcePath='packages/brain/config/workflow-assembly-native.json';
async function setup(){
 f=await nativeMaintenanceDatabase();const db=f.db;
 for(const table of ['areas','activity_cells','map_manifest_versions'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
 // 使用真实系统看护父坐标；该fixture只隔离复制，绝不写生产树。
 await db.query("INSERT INTO value_streams(id,name) VALUES('2d22d890-dbab-441b-a602-2727de668aaf','系统看护')");
 await db.query("UPDATE capabilities SET parent_journey_id='2d22d890-dbab-441b-a602-2727de668aaf' WHERE id=$1",[spec.capability_id]);
 const workflow=randomUUID(),cap=f.definition.capability_id;
 await db.query("INSERT INTO workflows(id,capability_id,key,name,channel,status,source_repo,source_path) VALUES($1,$2,'business','业务定义','internal','active',$3,'contracts/business.json')",[workflow,cap,repo]);
 const payload={workflow_id:workflow,capability_id:cap,activities:[],contract:{version:'1.0.0'}};
 for(const revision of [old,next]){
  const version=(await db.query(`INSERT INTO workflow_definition_versions(workflow_id,payload,payload_sha256,contract_sha256,source_repo,source_path,source_commit)
   VALUES($1,$2,$3,$4,$5,'contracts/business.json',$6) RETURNING id`,[workflow,payload,definitionDigest({source:{repo,path:'contracts/business.json',commit:revision},payload}),definitionDigest(payload.contract),repo,revision])).rows[0].id;
  await db.query('UPDATE workflows SET current_definition_version_id=$2 WHERE id=$1',[workflow,version]);
  const binding=(entity_type,entity_id)=>({entity_type,entity_id,source_repo:repo,source_revision:revision});
  const manifest={schema_version:1,scope_key:'cecelia-kr',value_streams:[{key:'development',brain_binding:binding('value_stream',(await db.query('SELECT parent_journey_id FROM capabilities WHERE id=$1',[cap])).rows[0].parent_journey_id)}],capabilities:[{key:'F0',value_stream_key:'development',brain_binding:binding('capability',cap)}]};
  const id=randomUUID(),digest=definitionDigest(manifest);
  await db.query("INSERT INTO map_manifest_versions(id,scope_key,version,source_decision_id,manifest,digest,status,activated_at) VALUES($1,'cecelia-kr',$2,$3,$4,$5,$6,NOW())",[id,revision===old?1:2,randomUUID(),manifest,digest,revision===old?'superseded':'active']);
  await db.query("INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at) VALUES('cecelia-kr',$1,$2,$3,'fixture',$2,$4,NOW())",[id,digest,{'native-snapshot-fixture':revision},revision===old?'superseded':'active']);
 }
 await db.query("INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config) VALUES('cecelia-kr','native-snapshot-fixture','legacy-ledger-v1',$1)",[{source_repo:repo}]);
 return {db,workflow};
}
const snapshot=(revision=old,scope='cecelia-kr')=>readImplementationSnapshotInTransaction(f.db,{scope,repo,revision});
async function legacyPayload(version){
 const row=(await f.db.query('SELECT * FROM workflow_definition_versions WHERE id=$1',[version])).rows[0];
 delete row.payload.definition_scope;delete row.payload.capability_id;
 const av=(await f.db.query('SELECT * FROM activity_definition_versions WHERE id=$1',[row.payload.activities[0].activity_version_id])).rows[0];
 delete av.payload.definition_scope;delete av.payload.capability_id;
 await f.db.query('UPDATE activity_definition_versions SET payload=$2,payload_sha256=$3 WHERE id=$1',[av.id,av.payload,definitionDigest({source:{repo,path:sourcePath,commit:av.source_commit},payload:av.payload})]);
 await f.db.query('UPDATE workflow_definition_versions SET payload=$2,payload_sha256=$3 WHERE id=$1',[version,row.payload,definitionDigest({source:{repo,path:sourcePath,commit:row.source_commit},payload:row.payload})]);
 return row.payload;
}
it('真实登记后旧无scope维护定义不得混入中央业务KR；升级固定ref后旧新SHA均隔离且旧run不追改',async()=>{
 const {db,workflow}=await setup();const before=await snapshot();expect(before.status,JSON.stringify(before.gaps)).toBe('verified');
 const registered=await registerNativeReconcile(db,f.source);const legacy=await legacyPayload(registered.workflow_definition_version_id);
 const run=await runNativeReconcile(db,{request_key:'historical'},f.services);
 const first=await snapshot();expect(first.gaps).toEqual([]);expect(first.definitions.workflows.map(w=>w.workflow_id)).toEqual([workflow]);
 const upgraded=await registerNativeReconcile(db,await prepareNativeSource({revision:next,readFile:readSource}));
 const payload=(await db.query('SELECT payload FROM workflow_definition_versions WHERE id=$1',[upgraded.workflow_definition_version_id])).rows[0].payload;
 expect(payload).toMatchObject({definition_scope:'native_maintenance_observation',capability_id:spec.capability_id});
 for(const revision of [old,next]){const result=await snapshot(revision);expect(result.gaps).toEqual([]);expect(result.definitions.workflows.map(w=>w.workflow_id)).toEqual([workflow]);}
 expect((await db.query('SELECT payload FROM workflow_definition_versions WHERE id=$1',[registered.workflow_definition_version_id])).rows[0].payload).toEqual(legacy);
 expect((await db.query('SELECT detail FROM runs WHERE run_id=$1',[run.native_run_id])).rows[0].detail.workflow_definition_version_id).toBe(registered.workflow_definition_version_id);
});
it.each(['scope_only','foreign_workflow','bad_digest','foreign_ref','foreign_activity_version','wrong_parent'])('真实PG伪scope或身份损坏%s不能从KR消失',async kind=>{
 const {db,workflow}=await setup();const registered=await registerNativeReconcile(db,f.source);
 if(kind==='scope_only')await db.query("UPDATE workflow_definition_versions SET payload=payload||$2::jsonb WHERE workflow_id=$1",[workflow,{definition_scope:'native_maintenance_observation',protocol:spec.protocol}]);
 else if(kind==='foreign_workflow')await db.query("UPDATE workflow_definition_versions SET workflow_id=$2,payload=jsonb_set(payload,'{workflow_id}',to_jsonb($2::uuid)) WHERE id=$1",[registered.workflow_definition_version_id,workflow]);
 else if(kind==='bad_digest')await db.query("UPDATE workflow_definition_versions SET payload_sha256=repeat('0',64) WHERE id=$1",[registered.workflow_definition_version_id]);
 else if(kind==='foreign_ref')await db.query('UPDATE workflow_activity_refs SET workflow_id=$2 WHERE id=$1',[spec.activities[0].reference_id,workflow]);
 else if(kind==='foreign_activity_version')await db.query("UPDATE activity_definition_versions SET activity_id=$2,payload=jsonb_set(payload,'{activity_id}',to_jsonb($2::uuid)) WHERE id=$1",[registered.activity_definition_version_id,randomUUID()]);
 else await db.query('UPDATE capabilities SET parent_journey_id=$2 WHERE id=$1',[spec.capability_id,f.definition.capability_id]);
 const result=await snapshot();
 if(kind==='scope_only'){expect(result.definitions.workflows.some(w=>w.workflow_id===workflow)).toBe(true);return;}
 expect(result.status).toBe('unknown');
 expect(result.gaps.some(g=>['workflow_capability_unmapped','definition_snapshot_ambiguous'].includes(g.code))).toBe(true);
 if(kind!=='foreign_workflow')expect(result.definitions.workflows.some(w=>w.id===registered.workflow_definition_version_id)).toBe(true);
});
it('真实native登记不改变factory消费者选择与只读快照摘要',async()=>{
 await setup();const before=await snapshot(old,'cecelia-factory');
 await registerNativeReconcile(f.db,f.source);
 const after=await snapshot(old,'cecelia-factory');expect(after).toEqual(before);
});
