import {test,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {existsSync} from 'node:fs';
import {observeProcess} from '../../../scripts/native-agent/store.mjs';
import {groupMembers} from '../../../scripts/native-agent/process.mjs';
const sha='a'.repeat(40);
const script=fileURLToPath(new URL('../../../scripts/native-agent/staging-business.mjs',import.meta.url));
function environment(){
 const nightly=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_JOB==='brain-integration'&&process.env.GITHUB_WORKFLOW==='Deep Regression'&&process.env.CI==='true'&&process.env.POSTGRES_INTEGRATION==='1';
 expect(nightly?['cecelia_scratch','cecelia_test']:['cecelia_scratch']).toContain(process.env.DB_NAME);
 expect(['127.0.0.1','localhost']).toContain(process.env.DB_HOST);
 return {PATH:process.env.PATH,HOME:process.env.HOME,DB_NAME:process.env.DB_NAME,DB_HOST:process.env.DB_HOST,DB_PORT:process.env.DB_PORT||'5432',DB_USER:process.env.DB_USER,DB_PASSWORD:process.env.DB_PASSWORD||'',NODE_ENV:'test',CI:'true',POSTGRES_INTEGRATION:process.env.POSTGRES_INTEGRATION,GITHUB_ACTIONS:process.env.GITHUB_ACTIONS,GITHUB_JOB:process.env.GITHUB_JOB,GITHUB_WORKFLOW:process.env.GITHUB_WORKFLOW,BRAIN_PREVIEW:'1',CECELIA_TICK_HARD_OFF:'1',EXPECTED_SHA:sha,GIT_SHA:sha};
}
function connection(env){return new pg.Pool({host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,max:2,connectionTimeoutMillis:3000,query_timeout:6000,options:'-c statement_timeout=5000 -c lock_timeout=3000'});}
async function runCandidate(env,{hang=false}={}){
 const evaluation=`import {verifyStagingBusiness} from ${JSON.stringify(new URL('../../../scripts/native-agent/staging-business.mjs',import.meta.url).href)};verifyStagingBusiness(process.env,{promptMarker:'NATIVE_HANG',progress:value=>process.stderr.write('STAGING_BUSINESS_PROGRESS '+JSON.stringify(value)+'\\n')}).then(value=>process.stdout.write('STAGING_BUSINESS_RECEIPT '+JSON.stringify(value)+'\\n')).catch(error=>{process.stderr.write(error.message+'\\n');process.exitCode=1;});`;
 const child=spawn(process.execPath,hang?['--input-type=module','--eval',evaluation]:[script],{env,detached:true,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',timedOut=false,killTimer,closedTimer,interrupted=false;
 child.stdout.on('data',data=>{stdout=(stdout+data).slice(-32768)});child.stderr.on('data',data=>{stderr=(stderr+data).slice(-32768);if(hang&&!interrupted&&stderr.includes('\"phase\":\"native-running\"')){interrupted=true;kill('SIGTERM');}});
 const kill=signal=>{if(!Number.isInteger(child.pid))return;try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
 const clear=()=>{clearTimeout(timer);clearTimeout(killTimer);clearTimeout(closedTimer);};
 const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),7000);closedTimer=setTimeout(()=>doneTimeout(),8500);},30000);
 let doneTimeout=()=>{};
 try{return await new Promise((done,reject)=>{
  doneTimeout=()=>{clear();done({code:null,signal:null,timedOut:true,closeUnconfirmed:true,stdout,stderr});};
  child.once('error',error=>{clear();reject(error)});
  child.once('close',(code,signal)=>{clear();done({code,signal,timedOut,stdout,stderr})});
 });}finally{clear();if(child.exitCode===null&&child.signalCode===null)kill('SIGKILL');}
}
const schemas=async pool=>(await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'release_business_%' ORDER BY nspname")).rows;
async function cleanupSchema(pool,stderr){
 // 强杀后的清理只认该固定子进程报告的随机自有schema，绝不枚举删除其它测试资源。
 const owned=[...stderr.matchAll(/STAGING_BUSINESS_PROGRESS (.*)/g)].map(match=>{try{return JSON.parse(match[1])}catch{return {}}}).find(row=>row.phase==='cleanup-safe')?.schema;
 if(/^release_business_[a-f0-9]{32}$/.test(owned??''))await pool.query(`DROP SCHEMA IF EXISTS ${owned} CASCADE`);
}
test('固定候选合同以真实原生进程生成文件、持久TaskRun并回收自有schema',async()=>{
 const env=environment(),pool=connection(env);let result;
 try{
  const before=await schemas(pool);result=await runCandidate(env);
  const {stdout,stderr,...exit}=result;
  expect(exit,'stdout:\n'+stdout+'\nstderr:\n'+stderr).toEqual({code:0,signal:null,timedOut:false});
  const lines=stdout.split('\n').filter(line=>line.startsWith('STAGING_BUSINESS_RECEIPT '));expect(lines).toHaveLength(1);
  const receipt=JSON.parse(lines[0].slice('STAGING_BUSINESS_RECEIPT '.length));
  expect(receipt).toMatchObject({status:'passed',git_sha:sha,task_status:'completed_no_pr',run_status:'success',artifact_verified:true,execution_stopped:true,external_services:'not_evaluated'});
  expect(receipt.artifact_sha256).toBe('e1f5ede6cc749ba3d641c8fdf448029cddea303ff644e7bfb301a2f0bbae5cb1');expect(receipt.task_id).not.toBe(receipt.run_id);
  expect(await schemas(pool)).toEqual(before);
 }finally{try{await cleanupSchema(pool,result?.stderr??'');}finally{await pool.end();}}
},40000);
test('候选表被占用必须有界失败、保留阶段诊断并实际清掉自有schema',async()=>{
 const env=environment(),pool=connection(env);let lock,result;
 try{
  const before=await schemas(pool);lock=await pool.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE public.tasks IN ACCESS EXCLUSIVE MODE');
  const started=Date.now();result=await runCandidate(env);
  expect(result.timedOut,result.stdout+result.stderr).toBe(false);
  expect(result.code,result.stdout+result.stderr).toBe(1);expect(Date.now()-started).toBeLessThan(10000);
  expect(result.stdout).not.toContain('STAGING_BUSINESS_RECEIPT ');
  expect(result.stderr).toContain('"phase":"clone-table","table":"tasks"');expect(result.stderr).toMatch(/lock timeout/);
  expect(result.stderr).toContain('"resource":"admin-pool"');expect(await schemas(pool)).toEqual(before);
 }finally{
  try{if(lock){await lock.query('ROLLBACK');lock.release();}await cleanupSchema(pool,result?.stderr??'');}finally{await pool.end();}
 }
},20000);

test('原生子进程挂起收到TERM后，原run取消且出生身份确认停止才清理',async()=>{
 const env=environment(),pool=connection(env);let result;
 try{
  const before=await schemas(pool);result=await runCandidate(env,{hang:true});
  expect(result.timedOut,result.stdout+result.stderr).toBe(false);expect(result.code,result.stdout+result.stderr).toBe(1);
  expect(result.stdout).not.toContain('STAGING_BUSINESS_RECEIPT ');
  const rows=[...result.stderr.matchAll(/STAGING_BUSINESS_PROGRESS (.*)/g)].map(match=>JSON.parse(match[1]));
  expect(rows.some(row=>row.phase==='cancel-native')).toBe(true);
  const stopped=rows.find(row=>row.phase==='execution-stopped');
  expect(stopped).toMatchObject({task_status:'cancelled',run_status:'cancelled'});
  for(const identity of [stopped.worker,stopped.child]){
   const observed=observeProcess(identity.pid,identity.birth);
   expect(['absent','reused'].includes(observed)||(observed==='matching'&&groupMembers(identity.pid)?.length===0)).toBe(true);
  }
  expect(existsSync(rows.find(row=>row.phase==='host-created').root)).toBe(false);
  expect(await schemas(pool)).toEqual(before);
 }finally{try{await cleanupSchema(pool,result?.stderr??'');}finally{await pool.end();}}
},40000);

test('候选数据库guard拒绝生产及缺少nightly身份的cecelia_test',async()=>{
 const {verifyStagingBusiness}=await import('../../../scripts/native-agent/staging-business.mjs');
 const env={...environment(),DB_NAME:'cecelia_test',GITHUB_ACTIONS:'true',GITHUB_JOB:'brain-integration',GITHUB_WORKFLOW:'Deep Regression',POSTGRES_INTEGRATION:'1'};
 for(const patch of [{DB_NAME:'cecelia'},{GITHUB_ACTIONS:undefined},{GITHUB_JOB:undefined},{GITHUB_WORKFLOW:undefined},{POSTGRES_INTEGRATION:undefined},{DB_HOST:'remote'}])await expect(verifyStagingBusiness({...env,...patch})).rejects.toThrow('candidate database required');
 await expect(verifyStagingBusiness(env)).rejects.toThrow('candidate runtime env must be process.env');
});
