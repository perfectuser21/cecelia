import {versionsDatabase} from './definition-versions-db.js';
import {migrationSql} from './minimum-definition-schema.js';
import {readInfraConsumerRegistry,INFRA_CONSUMER_IDENTITY as I} from '../../lib/infra-consumer-source.js';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const TASK='a6aa895d-f91e-4eb4-bdc6-242119ca46ce',PARENT='3362c876-447a-49ef-a2df-b0773d880d88',ROUTE='0c0eb3b2-7361-406a-ad9f-11e1b59e3fb1';
export const CLAIM='interactive-dev-skill:infra-bootstrap-20261022';
const root=fileURLToPath(new URL('../../../../../',import.meta.url));
export async function infraBootstrapDatabase(){
 const f=await versionsDatabase();let temp;
 try{
  await f.migrate();
  await f.db.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}',ADD COLUMN IF NOT EXISTS result jsonb,ADD COLUMN IF NOT EXISTS claimed_by text,ADD COLUMN IF NOT EXISTS parent_task_id uuid;
   CREATE TABLE skill_registry(id uuid PRIMARY KEY,name text,status text,location text);`);
  await f.db.query(migrationSql('413_work_routing_receipts.sql'));
  await f.db.query(`INSERT INTO tasks(id,title,status,parent_task_id,payload,claimed_by) VALUES($1,'parent','in_progress',NULL,'{}','parent'),($2,'bootstrap','in_progress',$1,$3,$4)`,[PARENT,TASK,{repo:'cecelia',map_scope:['F2'],routing_receipt_id:ROUTE},CLAIM]);
  await f.db.query(`INSERT INTO work_routing_receipts(id,task_id,source,source_id,work_kind,change_kind,pipeline,canonical_task_type,default_execution_profile,repo,map_scope,impact_contract_required,orchestrator,router_version,route_reason) VALUES($1,$2,'manual','fixture','coding_mutation','bugfix','kernel-v1','harness_initiative','hotfix-v1','cecelia','["F2"]',true,'skill-relay','fixture','fixture')`,[ROUTE,TASK]);
  await f.db.query('INSERT INTO value_streams(id,name) VALUES($1,$2)',[I.root,'系统看护']);
  await f.db.query('INSERT INTO capabilities(id,name,parent_journey_id) VALUES($1,$2,$3)',[I.capability_id,'系统看护 · 清理与容量',I.root]);
  await f.db.query(`INSERT INTO workflows(id,capability_id,key,name,channel,form) VALUES($1,$2,$3,'清理与容量 · 定时作业','internal','scheduled')`,[I.workflow_id,I.capability_id,I.workflow_key]);
  await f.db.query(`INSERT INTO skill_registry VALUES($1,'janitor','active','/Users/administrator/perfect21/cecelia-deploy-main/scripts/ops/janitor.sh')`,[I.skill_id]);
  temp=mkdtempSync(join(tmpdir(),'infra-bootstrap-source-'));const git=(...a)=>execFileSync('git',['-C',temp,...a],{encoding:'utf8'}).trim();
  git('init','-q');git('config','core.hooksPath','/dev/null');
  const paths=['packages/brain/src/routes/implementation-ci.js',...['infra-consumer-source.js','consumer-evidence-store.js','infra-registry-bootstrap.js','infra-bootstrap-source.js'].map(p=>'packages/brain/src/lib/'+p),...['janitor.sh','janitor-effects.sh','__tests__/janitor/janitor_resident_service_exempt.test.sh','__tests__/janitor/janitor_kill_exempt.test.sh'].map(p=>'scripts/ops/'+p)];
  for(const p of paths)if(existsSync(join(root,p))){mkdirSync(dirname(join(temp,p)),{recursive:true});writeFileSync(join(temp,p),readFileSync(join(root,p)));}
  git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','source');const revision=git('rev-parse','HEAD');
  const options={revision,readFile:async(rev,path)=>execFileSync('git',['-C',temp,'show',rev+':'+path],{encoding:'utf8'}),checkMain:async rev=>{if(rev!==revision)throw Error('MAIN_MOVED');}};
  return {...f,revision,options,async input(){return {task_id:TASK,client_request_id:'first-bootstrap',expected_registry_sha256:(await readInfraConsumerRegistry(f.db)).registry_sha256,revision};},async close(){await f.close();rmSync(temp,{recursive:true,force:true});}};
 }catch(e){await f.close();if(temp)rmSync(temp,{recursive:true,force:true});throw e;}
}
