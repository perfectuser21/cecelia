import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PassThrough} from 'node:stream';
import {EventEmitter} from 'node:events';
import pg from 'pg';
import {DB_DEFAULTS} from '../../../db-config.js';
import {importLegacyPolicy} from '../../../execution-directory/store.js';
import {LEGACY_BINDINGS} from '../../../execution-directory/legacy-policy.js';
import {createAppServerStore} from '../../store.js';
import {createAppServerClient} from '../../client.js';
import {createAuthorizationStore} from '../../authorization-store.js';
import {createCanaryEvidenceStore} from '../../canary-evidence.js';
const require=createRequire(import.meta.url),{createAppServerRunner}=require('../../../../scripts/fleet-worker/app-server-runner.cjs');
const {createFleetWorkerServer}=require('../../../../scripts/fleet-worker/fleet-worker.cjs');
const {profileDigest}=require('../../../../scripts/fleet-worker/app-server-profile.cjs');
export async function fixture(){
 const options=process.env.TEST_DATABASE_URL?{connectionString:process.env.TEST_DATABASE_URL}:DB_DEFAULTS;
 if(!(process.env.CI? /_(scratch|test)$/:/_scratch$/).test(process.env.TEST_DATABASE_URL?new URL(process.env.TEST_DATABASE_URL).pathname:DB_DEFAULTS.database))throw Error('scratch database required');
 const schema=`app_canary_service_${randomUUID().replaceAll('-','')}`,admin=new pg.Client(options);
 const pool=new pg.Pool({...options,max:8,options:`-c search_path=${schema},public`});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'app-canary-service-')),token='service-test-key-'.repeat(3),bootId=randomUUID();
 const profile={image:'sha256:'+'a'.repeat(64),cpus:2,memoryBytes:1073741824,pidsLimit:128,user:'1000:1000',tmpBytes:67108864,network:'none',homeKey:'b'.repeat(64),workspaceKey:'c'.repeat(64)};
 const home={homeId:'chat-test',homeKey:profile.homeKey,provider:'codex',account:'team1',repo:'perfectuser21/cecelia',profile:'chat',configDigest:profileDigest(profile)};
 const containers=new Map(),calls=[];let count=0,removeFails=false,startLost=false,invalidProtocol=false;
 const docker={
  async create({name,identity}){calls.push('create');const id=(++count).toString(16).padStart(64,'0');containers.set(id,{id,name,status:'created',labels:Object.fromEntries(Object.entries(identity).map(([k,v])=>['cecelia.appserver.'+k,String(v)]))});return id;},
  async start(id){calls.push('start');containers.get(id).status='running';if(startLost){startLost=false;throw Error('lost response');}},
  async inspect(id){return containers.get(id)??[...containers.values()].find(c=>c.name===id)??null;},
  async remove(id){calls.push('remove');if(removeFails)throw Error('unconfirmed');containers.delete(id);},
  attach(){calls.push('attach');const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),kill(){this.emit('close',0);}});
   let pending='';child.stdin.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){const frame=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);if(!frame.id)continue;
    const results={initialize:{userAgent:'codex/0.158.0'},'model/list':{data:[],nextCursor:null},'config/read':{config:{}},'configRequirements/read':{requirements:null}};
    calls.push(frame.method);child.stdout.write(JSON.stringify({id:frame.id,result:invalidProtocol?{}:results[frame.method]})+'\n');
   }});child.stdin.on('end',()=>child.stdout.end());return child;
  },
 };
 const runnerConfig={stateRoot:root,machineId:'xian-mac-m1',workerId:'xian-mac-m1',bootId,profiles:{chat:profile},docker,canaryKey:token,assertLocalResources:async()=>{}};
 let runner=createAppServerRunner(runnerConfig);
 const proxy=Object.fromEntries(['start','inspect','cancel','attach','markRpcStarted','recordCanaryEvidence','capabilities'].map(name=>[name,(...args)=>runner[name](...args)]));
 const server=createFleetWorkerServer({attemptToken:token,appServerRunner:proxy});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 await admin.connect();await admin.query(`CREATE SCHEMA ${schema}`);
 await pool.query(`CREATE TABLE system_registry(id UUID PRIMARY KEY,type TEXT,name TEXT,status TEXT,metadata JSONB DEFAULT '{}');CREATE TABLE tasks(id UUID PRIMARY KEY,status TEXT,result JSONB,updated_at TIMESTAMPTZ,completed_at TIMESTAMPTZ,claimed_by TEXT,claimed_at TIMESTAMPTZ,payload JSONB DEFAULT '{}',task_type TEXT CONSTRAINT tasks_task_type_check CHECK(task_type IN ('dev','janitor')),executor_kind TEXT CONSTRAINT tasks_executor_kind_check CHECK(executor_kind IN ('headed-session','preview-janitor')));CREATE TABLE initiative_runs(id UUID PRIMARY KEY,phase TEXT DEFAULT 'planning',map_recovery_contract_id UUID,orchestrator_version TEXT DEFAULT 'v2');CREATE TABLE map_recovery_consumptions(contract_id UUID,attempt_id UUID);CREATE TABLE schema_version(version TEXT PRIMARY KEY,description TEXT,applied_at TIMESTAMPTZ);`);
 for(const [,id,name]of LEGACY_BINDINGS)await pool.query("INSERT INTO system_registry(id,type,name,status) VALUES($1,'machine',$2,'active')",[id,name]);
 for(const name of ['357_harness_provider_attempts','362_kernel_attempt_telemetry_reconcile','363_kernel_fleet_execution_receipts','364_kernel_local_container_naming','425_harness_attempt_cleanup_outbox','501_capacity_reservations','503_execution_directory','504_app_server_generations','506_app_server_streams','508_app_server_authorizations','509_app_server_canary_attempts'])await pool.query(fs.readFileSync(new URL(`../../../../migrations/${name}.sql`,import.meta.url),'utf8'));
 await importLegacyPolicy({pool,env:{FLEET_WORKER_US_MAC_M4_URL:url,FLEET_WORKER_XIAN_MAC_M1_URL:url,FLEET_WORKER_XIAN_MAC_M4_URL:url}});
 const createTask=async({db})=>({success:true,task:(await db.query("INSERT INTO tasks(id,status,task_type,executor_kind) VALUES($1,'in_progress','app_server_run','app-server-controller') RETURNING *",[randomUUID()])).rows[0]});
 const store=createAppServerStore({pool,createTask,afterTask:async()=>{}}),env={KERNEL_FLEET_BRIDGE_TOKEN:token};
 const client=createAppServerClient({pool,store,env});
 const authorizationStore=createAuthorizationStore({pool,homes:{[home.homeId]:home},client,createTask});
 const evidence=createCanaryEvidenceStore({pool,store,client,token,afterTask:async()=>{}});
 const node=(await pool.query("SELECT * FROM execution_nodes WHERE canonical_id='xian-mac-m1'")).rows[0];
 const input={home_id:home.homeId,machine_registry_id:node.machine_registry_id,expected_version_id:node.current_version_id};
 const collectSnapshot=async machine=>({verified:true,machine,captured_at:Date.now(),expires_at:Date.now()+60000,capacity:{ok:true,physical_base_slots:8,effective_base_slots:8}});
 return {pool,home,store,client,authorizationStore,evidence,input,env,calls,containers,root,collectSnapshot,
  restart(){runner.close();runner=createAppServerRunner(runnerConfig);},
  set removeFails(v){removeFails=v;},set startLost(v){startLost=v;},set invalidProtocol(v){invalidProtocol=v;},
  async close(){runner.close();server.closeAllConnections();await new Promise(r=>server.close(r));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();fs.rmSync(root,{recursive:true,force:true});},
 };
}
