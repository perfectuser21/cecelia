import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {DB_DEFAULTS} from '../../../db-config.js';
import {directory} from '../../../execution-directory/directory.js';
import {LEGACY_BINDINGS} from '../../../execution-directory/legacy-policy.js';
import {importLegacyPolicy} from '../../../execution-directory/store.js';
import {createAttemptStore} from '../../../orchestrator/attempt-store.js';
import {createDispatcher} from '../../../orchestrator/dispatcher.js';
import {createCapabilityGate} from '../../../orchestrator/preflight/capability-gate.js';
export async function fixture(){
 const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
 const database=process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname:DB_DEFAULTS.database;
 if(!(process.env.CI==='true'?/_(scratch|test)$/:/_scratch$/).test(database))throw Error('scratch database required');
 const schema='kernel_capacity_'+randomUUID().replaceAll('-',''),admin=new pg.Client(options);
 const pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT);CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','366_kernel_harness_failure_class','381_allow_fleet_worker_execution_transport','425_harness_attempt_cleanup_outbox','501_capacity_reservations','503_execution_directory'])await pool.query(readFileSync(new URL(`../../../../migrations/${name}.sql`,import.meta.url),'utf8'));
 const env=Object.fromEntries(LEGACY_BINDINGS.map(([machine])=>[`FLEET_WORKER_${machine.toUpperCase().replaceAll('-','_')}_URL`,'http://127.0.0.1:5231']));
 await importLegacyPolicy({pool,env});await directory.refresh({pool});
 const store=createAttemptStore(pool,{executionDirectory:true}),calls=[],prepared=[],starts=[],snapshots=[];
 const gate=createCapabilityGate({snapshotTtlMs:60000,getMachineHealth:async()=>({ok:true}),
  getMachineCapacity:async({machine})=>({ok:true,available:1,physical_base_slots:1,effective_base_slots:1}),
  probeProviderAuth:async()=>({ok:true}),probeGitHub:async()=>({ok:true}),probePostgres:async()=>({ok:true}),probeModelCapability:async()=>({ok:true}),
  beforeDispatchSnapshotValidation:async({snapshot})=>snapshots.push(snapshot),
 });
 const deps={machineId:'us-mac-m4',leaseOwner:'kernel-capacity-test',preflightGate:gate,
  attemptStore:{...store,createAttempt:async input=>{calls.push(input);return store.createAttempt(input);}},
  registry:{resolve:()=>({name:'codex',start:({execution})=>({provider:'codex',args:[],execution})})},
  resolveAccountHome:(provider,account)=>`/trusted/${provider}/${account}`,
  resolveWorkspaceSpec:async({attemptId,ctx,readOnly})=>({repo:'perfectuser21/cecelia',base_sha:'a'.repeat(40),branch:'cp-capacity-test',expected_head_sha:null,mode:readOnly?'read-only':'read-write',run_id:ctx.runId,attempt_id:attemptId}),
  loadSkill:name=>({name,version:'1.0.0',digest:'sha256:'+'a'.repeat(64),content:name}),
  launcher:{prepare:async input=>{prepared.push(input);return {actualMachineId:input.target.machine,executionTransport:'fleet-worker',remoteJobId:input.attempt.id,jobId:input.attempt.id,containerId:null,attestationStatus:'verified'};},
   start:async input=>{starts.push(input);return {status:'running',attempt_id:input.attempt.id};},cancel:async({attempt})=>({status:'cleaned',attempt_id:attempt.id})},
 };
 async function context(payload={}){
  const runId=randomUUID(),taskId=randomUUID(),receiptId=randomUUID();
  await pool.query("INSERT INTO tasks(id,status) VALUES($1,'in_progress')",[taskId]);await pool.query('INSERT INTO initiative_runs(id) VALUES($1)',[runId]);
  return {runId,taskId,hop:1,decision:{phase:'planning'},observed:{run:{id:runId},task:{id:taskId,title:'容量竞选',status:'in_progress',task_type:'harness_initiative',payload:{sprint_dir:'sprints/kernel-capacity',repo:'perfectuser21/cecelia',change_kind:'bugfix',routing_receipt_id:receiptId,...payload}},
   routingReceipt:{id:receiptId,task_id:taskId,router_version:'work-router-v1',work_kind:'coding_mutation',pipeline:'harness',canonical_task_type:'harness_initiative',change_kind:'bugfix',repo:'perfectuser21/cecelia',impact_contract_required:true,map_scope_validation_version:'active-business-node-v1',evidence:{branch:'cp-capacity-test',base_sha:'a'.repeat(40)}}}};
 }
 return {pool,store,deps,calls,prepared,starts,snapshots,context,dispatch:ctx=>createDispatcher(deps)('spawn:planner',ctx),
  close:async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
}
