import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {releaseEvidenceDatabase} from './release-evidence-db.js';
import {migrationSql,migrationTable} from './minimum-definition-schema.js';
import {prepareDefinitionFreeze,FREEZE_PROTOCOL} from '../../workflow-authoring/freeze.js';
import {registerWorkflow,registrationDigest} from '../../workflow-authoring/registration.js';

export const FOUNDATION_FIXTURE_REPO='perfectuser21/cecelia';
export const FOUNDATION_FIXTURE_REVISION='b'.repeat(40);
const hash=value=>createHash('sha256').update(value).digest('hex');
const brain=fileURLToPath(new URL('../../../',import.meta.url));
const fixtureDir=path.join(brain,'scripts/smoke/fixtures/commander-foundation');

// 在私有空schema用仓库真实表迁移建账，不依赖开发机public库已有结构。
async function addFoundationTaskSchema(db){
 for(const [file,table] of [['283_skill_registry_and_journey_step_links.sql','skill_registry'],['000_base_schema.sql','cecelia_events'],['268_task_events.sql','task_events']])await db.query(migrationTable(file,table));
 await db.query(migrationSql('413_work_routing_receipts.sql'));
 await db.query('CREATE TABLE initiative_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),current_task_id uuid,orchestrator_version text)');
 await db.query(migrationTable('409_harness_gap_ledger.sql','harness_gaps'));
 await db.query(migrationTable('237_harness_v2_task_dependencies.sql','task_dependencies'));
 await db.query('ALTER TABLE task_dependencies ADD COLUMN status text DEFAULT \'satisfied\'');
 await db.query(migrationTable('007_pending_actions.sql','pending_actions'));
 await db.query('ALTER TABLE pending_actions ADD COLUMN signature text');
 await db.query(migrationSql('465_work_routing_receipt_supersession.sql'));
 await db.query('ALTER TABLE work_routing_receipts ADD COLUMN IF NOT EXISTS map_scope_validation_version text,ADD COLUMN IF NOT EXISTS direct_contract_seed jsonb');
 // 本夹具只读取旧接力状态，不启动旧Harness。
 await db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type text, ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS trigger_source text,ADD COLUMN IF NOT EXISTS domain text,ADD COLUMN IF NOT EXISTS okr_initiative_id uuid,
  ADD COLUMN IF NOT EXISTS ability_id uuid,ADD COLUMN IF NOT EXISTS blocked_at timestamptz,ADD COLUMN IF NOT EXISTS prd_content text,
  ADD COLUMN IF NOT EXISTS execution_profile text,ADD COLUMN IF NOT EXISTS owner_role text,ADD COLUMN IF NOT EXISTS delivery_type text,
  ADD COLUMN IF NOT EXISTS created_by text,ADD COLUMN IF NOT EXISTS dept text,ADD COLUMN IF NOT EXISTS phase text,
  ADD COLUMN IF NOT EXISTS executor_kind text,ADD COLUMN IF NOT EXISTS parent_task_id uuid,ADD COLUMN IF NOT EXISTS sequence_no integer,
  ADD COLUMN IF NOT EXISTS kind text,ADD COLUMN IF NOT EXISTS blocked_reason text,ADD COLUMN IF NOT EXISTS blocked_detail jsonb,
  ADD COLUMN IF NOT EXISTS result jsonb,ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text,ADD COLUMN IF NOT EXISTS summary text,ADD COLUMN IF NOT EXISTS blocked_until timestamptz,ADD COLUMN IF NOT EXISTS notion_synced_at timestamptz,ADD COLUMN IF NOT EXISTS driver_heartbeat_at timestamptz`);
}

/** 隔离协议夹具：定义来源/CI报告是合成的，执行产物、PG、DBOS和宿主是真实的。 */
export async function workflowFoundationDatabase({scenario='healthy',playbook}={}){
 const base=await releaseEvidenceDatabase(),f={...base,pool:base.db},root=fs.mkdtempSync(path.join(os.tmpdir(),'foundation-registration-'));
 const dbosSchema=`foundation_dbos_${randomUUID().replaceAll('-','')}`;
 let closed=false;
 try{
  await addFoundationTaskSchema(f.pool);
  await f.pool.query(fs.readFileSync(path.join(brain,'migrations/558_commander_activity_actions.sql'),'utf8'));
  await f.pool.query(fs.readFileSync(path.join(brain,'migrations/559_commander_activity_attempts.sql'),'utf8'));
  const cap=randomUUID(),vs=randomUUID(),task=randomUUID(),key=`foundation_${cap.slice(0,8)}`;
  await f.pool.query("INSERT INTO value_streams(id,name) VALUES($1,'隔离Foundation价值流')",[vs]);
  await f.pool.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'隔离Foundation能力',$2,'active')",[cap,vs]);
  await f.pool.query("INSERT INTO tasks(id,title,status,task_type,payload) VALUES($1,'隔离冻结登记','in_progress','research',$2)",[task,{workflow_authoring:true}]);
  const inputSchema={type:'object',properties:{label:{type:'string'}},required:['label'],additionalProperties:false};
  const activity=(key,order)=>({key,order,budget:{max_duration_s:15,heartbeat_s:1},acceptance:{description:'真实读回base=21或answer=42'},
   failure:{empty_ok:[],retryable:[],fatal:['error'],needs_human:{cases:['unknown']}},
   runtime:{phase:'source',protocol:'json-stdio-v1',entry:'work.mjs',argv:[key],executor_kind:'code'}});
  const contract={workflow:key,goal:'先写base=21，再交answer=42，逐项真实读回',activities:[activity('prepare',1),activity('double',2)]};
  const sourceFiles=Object.fromEntries(['adapter.mjs','work.mjs','commander.mjs','skill.txt'].map(name=>[name,fs.readFileSync(path.join(fixtureDir,name),'utf8')]));
  const profileDocument=JSON.stringify({schema_version:1,contract,...(playbook===undefined?{}:{playbook}),profile:{adapter:'adapter.mjs',files:Object.fromEntries(Object.entries(sourceFiles).map(([name,text])=>[name,hash(text)])),commander:{provider:'adapter'},scenario,realAgent:false}});
  sourceFiles['profile.json']=profileDocument;
  const runtime={kind:'commander-foundation-v1',profile_ref:{repo:FOUNDATION_FIXTURE_REPO,path:'profile.json',revision:FOUNDATION_FIXTURE_REVISION,digest:`sha256:${hash(profileDocument)}`},timeout_ms:45000,input_schema:inputSchema};
  const binding=name=>({kind:'code',repo:FOUNDATION_FIXTURE_REPO,path:name,revision:'contract'});
  const definition={key,name:'隔离Foundation样例',capability_id:cap,channel:'internal',form:'code',version:'1.0.0',
   source:{repo:FOUNDATION_FIXTURE_REPO,ref:'workflow.json',revision:FOUNDATION_FIXTURE_REVISION},runtime,
   activities:contract.activities.map((a,index)=>({key:a.key,name:a.key,executor_kind:'code',acceptance:[a.acceptance.description],
    implementation:{...binding('work.mjs'),ref:'work.mjs',version:'1.0.0'},
    ...(index===0?{implementation_bindings:Object.keys(sourceFiles).filter(name=>name!=='work.mjs').map(binding)}:{})}))};
  const reader=async s=>{
   if(s.repo!==FOUNDATION_FIXTURE_REPO||s.revision!==FOUNDATION_FIXTURE_REVISION)throw Error('fixture_source_unknown');
   if(s.path==='workflow.json')return JSON.stringify(Object.fromEntries(Object.entries(definition).filter(([k])=>k!=='source')));
   if(s.path==='.skills-source.json')return null;
   if(!Object.hasOwn(sourceFiles,s.path))throw Error('fixture_file_unknown');return sourceFiles[s.path];
  };
  const bundleRoot=path.join(root,'bundles'),bundle=path.join(bundleRoot,FOUNDATION_FIXTURE_REPO,FOUNDATION_FIXTURE_REVISION),stateRoot=path.join(root,'state');
  fs.mkdirSync(bundle,{recursive:true});fs.mkdirSync(stateRoot,{recursive:true});
  for(const [name,text] of Object.entries(sourceFiles))fs.writeFileSync(path.join(bundle,name),text);
  async function register(d=definition){
   const proof=await prepareDefinitionFreeze(d,{readFile:reader,readBusinessFile:reader});
   const db=await f.pool.connect();try{
    await db.query('BEGIN');
    const receipt=await registerWorkflow(db,d,{registrationProtocol:FREEZE_PROTOCOL,definitionSha256:registrationDigest(d),freezeProof:proof,taskId:task,operation:'create'});
    await db.query('UPDATE tasks SET result=$2 WHERE id=$1',[task,{workflow_authoring:{outputs:{register:receipt}}}]);
    await db.query('COMMIT');return receipt;
   }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
  }
  async function releaseSpec(receipt){
   const workflow=(await f.pool.query('SELECT * FROM workflow_definition_versions WHERE id=$1',[receipt.current_definition_version_id])).rows[0];
   const activities=(await f.pool.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[])',[workflow.payload.activities.map(r=>r.activity_version_id)])).rows;
   const components=[{kind:'repo',repo:FOUNDATION_FIXTURE_REPO,revision:FOUNDATION_FIXTURE_REVISION},...Object.entries(sourceFiles).map(([name,text])=>({kind:'code',repo:FOUNDATION_FIXTURE_REPO,revision:FOUNDATION_FIXTURE_REVISION,path:name,digest:`sha256:${hash(text)}`}))];
   const report=syntheticCiReport(workflow,activities,cap),ciReceipt={schema_version:1,actor:'implementation_ci_gate',source:report.source,report_sha256:hash(JSON.stringify(report)),verdict:'PASS',scope:'regression_tests',business_runtime_status:'not_evaluated',assertions:report.required_assertions.map(a=>({assertion_ref:a.assertion_ref,source_repo:FOUNDATION_FIXTURE_REPO,source_revision:FOUNDATION_FIXTURE_REVISION,source_bindings:a.source_bindings,test_sha256:'f'.repeat(64),exit_code:0,error:null,signal:null}))};
   return {release_key:`foundation-fixture-${randomUUID()}`,environment:'scratch',target:`fixture-host/${key}`,actor:'test:foundation',workflows:[{workflow_definition_version_id:workflow.id,payload_sha256:workflow.payload_sha256}],components,ci_evidence:[{report,receipt:ciReceipt,evidence_ref:'fixture:synthetic-ci-protocol-not-production-evidence'}]};
  }
  return {...f,root,dbosSchema,brain,key,task,cap,definition,profileDocument,bundleRoot,bundle,stateRoot,register,releaseSpec,
   async close(){if(closed)return;closed=true;try{await f.pool.query(`DROP SCHEMA IF EXISTS ${dbosSchema} CASCADE`);}finally{try{await f.close();}finally{fs.rmSync(root,{recursive:true,force:true});}}}};
 }catch(error){try{await f.close();}finally{fs.rmSync(root,{recursive:true,force:true});}throw error;}
}

// 此报告只为发布协议的正/反例提供完整固定身份；不声称在GitHub跑过业务CI。
function syntheticCiReport(workflow,activities,capabilityId){
 const head=FOUNDATION_FIXTURE_REVISION,base='a'.repeat(40),h='c'.repeat(64);
 const source={repo:FOUNDATION_FIXTURE_REPO,base_revision:base,head_revision:head,changed_files:[{path:'profile.json',status:'modified'}]};
 const evidence=revision=>({revision,graph_snapshot:{digest:h,source_revision:revision},projection:{projection_run_id:randomUUID(),manifest_version_id:randomUUID(),projection_digest:h,manifest_digest:h},gaps:[],traversal:{truncated:false},definition_versions:{workflows:[workflow],activities},file_coverage:[{change_index:0,path:'profile.json',matched_paths:['profile.json'],truncated:false}]});
 return {mapping_status:'verified',truncated:false,gaps:[],source,base:evidence(base),head:evidence(head),unclaimed_paths:[],
  affected_usages:activities.map(a=>({evidence:[{capability_id:capabilityId,activity_id:a.activity_id,assertion_step_ids:[null]}]})),
  required_assertions:activities.map(a=>({assertion_ref:'tests/foundation-protocol.test.js',source_repo:FOUNDATION_FIXTURE_REPO,source_bindings:[{capability_id:capabilityId,activity_id:a.activity_id}]}))};
}
