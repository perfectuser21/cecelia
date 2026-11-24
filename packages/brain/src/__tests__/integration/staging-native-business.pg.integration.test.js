import {test,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const sha='a'.repeat(40);
test('固定候选合同以真实原生进程生成文件、持久TaskRun并回收自有schema',async()=>{
 const database=process.env.DB_NAME;
 expect(database).toBe('cecelia_scratch');
 expect(['127.0.0.1','localhost']).toContain(process.env.DB_HOST);
 const pool=new pg.Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||5432),user:process.env.DB_USER,password:process.env.DB_PASSWORD||'',database,max:1});
 try{
  const before=(await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'release_business_%' ORDER BY nspname")).rows;
  const script=fileURLToPath(new URL('../../../scripts/native-agent/staging-business.mjs',import.meta.url));
  const env={PATH:process.env.PATH,HOME:process.env.HOME,DB_NAME:database,DB_HOST:process.env.DB_HOST,DB_PORT:process.env.DB_PORT||'5432',DB_USER:process.env.DB_USER,DB_PASSWORD:process.env.DB_PASSWORD||'',NODE_ENV:'test',CI:'true',BRAIN_PREVIEW:'1',CECELIA_TICK_HARD_OFF:'1',EXPECTED_SHA:sha,GIT_SHA:sha};
  const child=spawn(process.execPath,[script],{env,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data});child.stderr.on('data',data=>{stderr+=data});
  const result=await new Promise((done,reject)=>{const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('owned candidate verification timeout'))},30000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',(code,signal)=>{clearTimeout(timer);done({code,signal})})});
  expect(result,stdout+stderr).toEqual({code:0,signal:null});
  const lines=stdout.split('\n').filter(line=>line.startsWith('STAGING_BUSINESS_RECEIPT '));expect(lines).toHaveLength(1);
  const receipt=JSON.parse(lines[0].slice('STAGING_BUSINESS_RECEIPT '.length));
  expect(receipt).toMatchObject({status:'passed',git_sha:sha,task_status:'completed_no_pr',run_status:'success',artifact_verified:true,execution_stopped:true,external_services:'not_evaluated'});
  expect(receipt.artifact_sha256).toBe('e1f5ede6cc749ba3d641c8fdf448029cddea303ff644e7bfb301a2f0bbae5cb1');
  expect(receipt.task_id).not.toBe(receipt.run_id);
  expect((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'release_business_%' ORDER BY nspname")).rows).toEqual(before);
 }finally{await pool.end()}
},40000);
