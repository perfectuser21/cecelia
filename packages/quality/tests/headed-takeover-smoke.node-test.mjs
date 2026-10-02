import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fixture,root} from './fixtures/smoke-production-guard-fixture.mjs';
import {createServer} from 'node:http';

// 这里只验证真实shell/原生HTTP守卫/下游runner协议，PG行为另由真实PG入口验证。
const entry='src/__tests__/integration/headed-takeover.pg.integration.test.js';
const deviceEntry='src/__tests__/integration/device-lock-helpers.test.js';
async function transport(run){
 const temp=await mkdtemp(resolve(tmpdir(),'retire-smoke-transport-'));
 const log=resolve(temp,'runner.jsonl'),preload=resolve(temp,'runner.cjs');
 await writeFile(preload,`if(process.argv.some(a=>a.endsWith('/vitest.mjs'))){
 require('node:fs').appendFileSync(process.env.RETIRE_TEST_RUNNER_LOG,JSON.stringify({args:process.argv.slice(2),db:process.env.DB_NAME,url:process.env.TEST_DATABASE_URL,nodeEnv:process.env.NODE_ENV})+'\\n');
 if(process.env.RETIRE_TEST_DB_CHECKER){
  const result=require('node:child_process').spawnSync(process.execPath,[process.env.RETIRE_TEST_DB_CHECKER],{env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});
  process.exit(result.status??1);
 }
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
test('headed smoke默认未授权：守卫拒绝前零PG runner/零HTTP请求',async()=>{
 await transport(async({smoke,env,calls,requests})=>{
  const r=await smoke('headed-takeover',env);assert.equal(r.code,1,r.output);
  assert.deepEqual(await calls(),[]);assert.deepEqual(requests,[]);
 });
});
test('headed smoke实际原守卫核测试DB后执行唯一隔离PG入口，不受共享池满HTTP污染',async()=>{
 await transport(async({smoke,env,calls,requests})=>{
  const r=await smoke('headed-takeover',{...env,SMOKE_ALLOW_WRITE:'1'});assert.equal(r.code,0,r.output);
  const recorded=await calls();assert.equal(recorded.length,1);
  assert.deepEqual(recorded[0].args,['run','--config','vitest.integration.config.js',entry,deviceEntry,'--maxWorkers=1','--minWorkers=1']);
  assert.equal(recorded[0].url,'');assert.equal(recorded[0].db,'cecelia_test');assert.equal(recorded[0].nodeEnv,'test');
  assert.ok(requests.some(r=>r.url.endsWith('/health')));
  assert.ok(requests.every(r=>r.url.endsWith('/health')),'不向共享Brain创建任务或驱动全局tick；真实API在PG私有服务中');
 });
});
test('headed smoke隔离PG runner失败必须exit1，不将未验证终态标PASS',async()=>{
 await transport(async({smoke,env,calls})=>{
  const r=await smoke('headed-takeover',{...env,SMOKE_ALLOW_WRITE:'1',RETIRE_TEST_RUNNER_EXIT:'1'});
  assert.equal(r.code,1,r.output);assert.equal((await calls()).length,1);
 });
});
test('headed smoke显式生产DB拒绝，零PG runner/零业务HTTP请求',async()=>{
 await transport(async({smoke,env,calls,requests,info})=>{
  const production=structuredClone(info);production.Config.Env[1]='DB_NAME=cecelia';
  const r=await smoke('headed-takeover',{...env,SMOKE_ALLOW_WRITE:'1',DB_NAME:'cecelia'},production);
  assert.equal(r.code,1,r.output);assert.deepEqual(await calls(),[]);assert.deepEqual(requests,[]);
 });
});
test('headed smoke DB_*与容器绑定不一致拒绝，零PG runner',async()=>{
 await transport(async({smoke,env,calls})=>{
  const r=await smoke('headed-takeover',{...env,SMOKE_ALLOW_WRITE:'1',DB_NAME:'cecelia_scratch'});
  assert.equal(r.code,1,r.output);assert.match(r.output,/操作连接必须/);assert.deepEqual(await calls(),[]);
 });
});
test('headed smoke本地NODE_ENV=test不能授权cecelia_test，只有CI才允许该库',async()=>{
 await transport(async({smoke,env,calls})=>{
  const r=await smoke('headed-takeover',{...env,SMOKE_ALLOW_WRITE:'1',CI:'false',NODE_ENV:'test'});
  assert.equal(r.code,1,r.output);assert.match(r.output,/本地仅scratch/);assert.deepEqual(await calls(),[]);
 });
});
test('headed smoke本地只允许守卫已核scratch，成功运行同一唯一入口',async()=>{
 await transport(async({smoke,env,calls,info})=>{
  const scratch=structuredClone(info);scratch.Config.Env[1]='DB_NAME=cecelia_scratch';
  const r=await smoke('headed-takeover',{...env,SMOKE_ALLOW_WRITE:'1',CI:'false',DB_NAME:'cecelia_scratch'},scratch);
  assert.equal(r.code,0,r.output);const recorded=await calls();assert.equal(recorded.length,1);
  assert.equal(recorded[0].db,'cecelia_scratch');assert.equal(recorded[0].url,'');assert.ok(recorded[0].args.includes(entry));
 });
});

for(const [label,overrides,host,port] of [
 ['HOST/PORT均未设',{DB_HOST:undefined,DB_PORT:undefined},'localhost',5432],
 ['仅HOST显式',{DB_HOST:'127.0.0.1',DB_PORT:undefined},'127.0.0.1',5432],
 ['仅PORT显式',{DB_HOST:undefined,DB_PORT:'5432'},'localhost',5432],
])test(`headed smoke ${label}：实际同字节DB_DEFAULTS加载私有dotenv后仍绑定已核目标`,async()=>{
 const temp=await mkdtemp(resolve(tmpdir(),'retire-dotenv-target-'));
 try{
  await mkdir(resolve(temp,'packages/brain/src'),{recursive:true});
  await writeFile(resolve(temp,'package.json'),' {"type":"module"} ');
  await symlink(resolve(root,'node_modules'),resolve(temp,'node_modules'));
  // 仅复制生产配置模块源码；它只能读取自己私有的无凭据.env，不导入pg或连接网络。
  await writeFile(resolve(temp,'packages/brain/src/db-config.js'),await readFile(resolve(root,'packages/brain/src/db-config.js')));
  await writeFile(resolve(temp,'packages/.env'),'DB_HOST=example.invalid\nDB_PORT=15432\nDB_NAME=other_scratch\nTEST_DATABASE_URL=postgresql://example.invalid/other_scratch\n');
  const checker=resolve(temp,'check.mjs');
  await writeFile(checker,`import assert from 'node:assert/strict';
import {DB_DEFAULTS} from './packages/brain/src/db-config.js';
assert.deepEqual({host:DB_DEFAULTS.host,port:DB_DEFAULTS.port,database:DB_DEFAULTS.database},{host:${JSON.stringify(host)},port:${port},database:'cecelia_test'});
assert.equal(process.env.TEST_DATABASE_URL,'');
`);
  await transport(async({smoke,env,calls})=>{
   const r=await smoke('headed-takeover',{...env,...overrides,SMOKE_ALLOW_WRITE:'1',RETIRE_TEST_DB_CHECKER:checker});
   assert.equal(r.code,0,r.output);assert.equal((await calls()).length,1);
  });
 }finally{await rm(temp,{recursive:true,force:true});}
});
