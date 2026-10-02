import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fixture} from './fixtures/smoke-production-guard-fixture.mjs';
import {createServer} from 'node:http';

// 这里只验证真实shell/原生HTTP守卫/下游runner协议，PG行为另由真实PG入口验证。
const entry='src/__tests__/integration/retired-harness-dispatch.pg.integration.test.js';
async function transport(run){
 const temp=await mkdtemp(resolve(tmpdir(),'retire-smoke-transport-'));
 const log=resolve(temp,'runner.jsonl'),preload=resolve(temp,'runner.cjs');
 await writeFile(preload,`if(process.argv.some(a=>a.endsWith('/vitest.mjs'))){
 require('node:fs').appendFileSync(process.env.RETIRE_TEST_RUNNER_LOG,JSON.stringify({args:process.argv.slice(2),db:process.env.DB_NAME,url:process.env.TEST_DATABASE_URL,nodeEnv:process.env.NODE_ENV})+'\\n');
 process.exit(Number(process.env.RETIRE_TEST_RUNNER_EXIT));
 }`);
 const requests=[];
 const server=createServer((req,res)=>{
  requests.push({method:req.method,url:req.url});req.resume();req.on('end',()=>{
   res.setHeader('content-type','application/json');
   if(req.url.endsWith('/health'))res.end(JSON.stringify({local_execution:{role:'executor'}}));
   else if(req.url.endsWith('/tick'))res.end(JSON.stringify({dispatched:false,reason:'pool_c_full',budget:{taskPool:{budget:4,used:4,available:0}}}));
   else res.end(JSON.stringify({id:'00000000-0000-0000-0000-000000000001',status:'queued'}));
  });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await fixture(async f=>{
  const info=structuredClone(f.info);info.Config.Env[2]=`BRAIN_PORT=${server.address().port}`;
  await run({...f,info,requests,smoke:(script,overrides={},dockerInfo=info)=>f.smoke(script,{...overrides,BRAIN_URL:`http://127.0.0.1:${server.address().port}`},dockerInfo),env:{NODE_OPTIONS:`--require=${preload}`,RETIRE_TEST_RUNNER_LOG:log,RETIRE_TEST_RUNNER_EXIT:'0',RETIRE_SMOKE_MAX_WAIT_SEC:'0',DB_HOST:'localhost',DB_PORT:'5432',DB_NAME:'cecelia_test',CI:'true',TEST_DATABASE_URL:'postgresql://example.invalid/other_scratch'},calls:async()=>{try{return (await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);}catch(error){if(error.code==='ENOENT')return [];throw error;}}});
 });}
 finally{await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
}
test('retire smoke默认未授权：守卫拒绝前零PG runner/零HTTP请求',async()=>{
 await transport(async({smoke,env,calls,requests})=>{
  const r=await smoke('retire-harness-planner',env);assert.equal(r.code,1,r.output);
  assert.deepEqual(await calls(),[]);assert.deepEqual(requests,[]);
 });
});
test('retire smoke实际原守卫核测试DB后执行唯一隔离PG入口，不受共享池满HTTP污染',async()=>{
 await transport(async({smoke,env,calls,requests})=>{
  const r=await smoke('retire-harness-planner',{...env,SMOKE_ALLOW_WRITE:'1'});assert.equal(r.code,0,r.output);
  const recorded=await calls();assert.equal(recorded.length,1);
  assert.deepEqual(recorded[0].args,['run','--config','vitest.integration.config.js',entry,'--maxWorkers=1','--minWorkers=1']);
  assert.equal(recorded[0].url,'');assert.equal(recorded[0].db,'cecelia_test');assert.equal(recorded[0].nodeEnv,'test');
  assert.ok(requests.some(r=>r.url.endsWith('/health')));
  assert.ok(requests.every(r=>r.url.endsWith('/health')),'不向共享Brain创建任务或驱动全局tick；真实API在PG私有服务中');
 });
});
test('retire smoke隔离PG runner失败必须exit1，不将未验证终态标PASS',async()=>{
 await transport(async({smoke,env,calls})=>{
  const r=await smoke('retire-harness-planner',{...env,SMOKE_ALLOW_WRITE:'1',RETIRE_TEST_RUNNER_EXIT:'1'});
  assert.equal(r.code,1,r.output);assert.equal((await calls()).length,1);
 });
});
test('retire smoke显式生产DB拒绝，零PG runner/零业务HTTP请求',async()=>{
 await transport(async({smoke,env,calls,requests,info})=>{
  const production=structuredClone(info);production.Config.Env[1]='DB_NAME=cecelia';
  const r=await smoke('retire-harness-planner',{...env,SMOKE_ALLOW_WRITE:'1',DB_NAME:'cecelia'},production);
  assert.equal(r.code,1,r.output);assert.deepEqual(await calls(),[]);assert.deepEqual(requests,[]);
 });
});
test('retire smoke DB_*与容器绑定不一致拒绝，零PG runner',async()=>{
 await transport(async({smoke,env,calls})=>{
  const r=await smoke('retire-harness-planner',{...env,SMOKE_ALLOW_WRITE:'1',DB_NAME:'cecelia_scratch'});
  assert.equal(r.code,1,r.output);assert.deepEqual(await calls(),[]);
 });
});
test('retire smoke本地NODE_ENV=test不能授权cecelia_test，只有CI才允许该库',async()=>{
 await transport(async({smoke,env,calls})=>{
  const r=await smoke('retire-harness-planner',{...env,SMOKE_ALLOW_WRITE:'1',CI:'false',NODE_ENV:'test'});
  assert.equal(r.code,1,r.output);assert.deepEqual(await calls(),[]);
 });
});
