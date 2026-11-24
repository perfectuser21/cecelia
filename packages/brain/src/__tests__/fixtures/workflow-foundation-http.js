import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createReleasesRouter} from '../../routes/releases.js';
import {createRunDefinitionsRouter} from '../../routes/run-definitions.js';
import {createWorkflowFoundationRouter} from '../../routes/workflow-foundation.js';
import {workflowFoundationDatabase} from './workflow-foundation-db.js';
import processState from '../../orchestrator/activity-supervisor-state.cjs';

export async function foundationHttpFixture(options={}){
 const db=await workflowFoundationDatabase(options),token=randomUUID(),oldToken=process.env.CECELIA_INTERNAL_TOKEN;
 process.env.CECELIA_INTERNAL_TOKEN=token;
 const url=process.env.TEST_DB_URL??`postgresql://${process.env.DB_USER??process.env.USER}@127.0.0.1:5432/cecelia_scratch`;
 const parsed=new URL(url);
 if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.pathname!=='/cecelia_scratch')throw Error('foundation_fixture_requires_local_scratch');
 const env={...process.env,COMMANDER_DATABASE_URL:url,COMMANDER_DATABASE_SCHEMA:db.schema,COMMANDER_DBOS_SCHEMA:db.dbosSchema,DBOS_DURABLE_ENABLED:'true',CECELIA_INTERNAL_TOKEN:token};
 const app=express();app.use(express.json());
 app.use('/api/brain/releases',createReleasesRouter({pool:db.pool,trustedCollectors:['fixture-collector']}));
 app.use('/api/brain/runs',createRunDefinitionsRouter({pool:db.pool}));
 app.use('/api/brain/workflow-foundation',createWorkflowFoundationRouter({pool:db.pool,services:{env}}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}`,children=[];
 const config=path.join(db.root,'worker.json');
 fs.writeFileSync(config,JSON.stringify({schema_version:1,brain_url:base,machine_id:'fixture-host',bundle_root:db.bundleRoot,state_root:db.stateRoot}),{mode:0o600});
 async function request(route,body,{auth=true}={}){
  const response=await fetch(base+'/api/brain'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(auth?{'X-Internal-Token':token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();
  return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?JSON.parse(text):{unparsed:text}};
 }
 async function publish({observe=true,environment}={}){
  const registration=await db.register(),spec=await db.releaseSpec(registration);
  if(options.releaseTarget)spec.target=options.releaseTarget;
  if(environment!==undefined)spec.environment=environment;
  const created=await request('/releases',spec);
  if(created.status!==201)throw Error('fixture_release:'+JSON.stringify(created));
  const release=created.body.release;
  if(observe){
   const components=spec.components.map(c=>c.kind==='repo'?c:{...c,digest:'sha256:'+createHash('sha256').update(fs.readFileSync(path.join(db.bundle,c.path))).digest('hex')});
   const observation=await request(`/releases/${release.id}/observations`,{event_key:randomUUID(),attempt_key:randomUUID(),environment:spec.environment,target:spec.target,components,collector:'fixture-collector',observed_at:new Date().toISOString(),evidence_ref:'fixture:actual-bundle-byte-readback'});
   if(observation.status!==201)throw Error('fixture_observation:'+JSON.stringify(observation));
  }
  return {registration,release,spec};
 }
 function worker(taskId){
  let stdout='',stderr='';
  const child=spawn(process.execPath,[path.join(db.brain,'scripts/commander-workflow/foundation-worker.mjs'),'--config',config,'--once','--task-id',taskId],{env,detached:true,stdio:['ignore','pipe','pipe']});children.push(child);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
  return {child,done};
 }
 return {...db,env,request,publish,worker,async close(){
  for(const child of children)if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}}
  // 宿主是supervise创建的独立进程组，仅清理本夹具状态文件记录的pid。
  for(const run of fs.readdirSync(db.stateRoot)){
   const state=path.join(db.stateRoot,run,'result.json.supervisor.json');
   if(fs.existsSync(state)){const owned=JSON.parse(fs.readFileSync(state,'utf8')).child;if(owned&&processState.sameProcess(owned.pid,owned.birth)){try{process.kill(-owned.pid,'SIGKILL');}catch{}}}
  }
  // SIGKILL宿主可能留下确定性Commander/Activity子进程；只终止路径属于本次私有root的实例。
  const processes=spawnSync('ps',['-axo','pid=,command='],{encoding:'utf8'}).stdout??'';
  for(const line of processes.split('\n')){
   const match=line.trim().match(/^(\d+)\s+(.+)$/);
   if(!match||![db.root,fs.realpathSync(db.root)].some(root=>match[2].includes(root+'/')))continue;
   const pid=Number(match[1]),birth=processState.processBirth(pid);
   if(processState.sameProcess(pid,birth)){try{process.kill(pid,'SIGKILL');}catch{}}
  }
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  if(oldToken===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=oldToken;
  await db.close();
 }};
}
export async function until(read,predicate,timeout=30000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,50));}
 throw Error('foundation_fixture_wait_timeout');
}
