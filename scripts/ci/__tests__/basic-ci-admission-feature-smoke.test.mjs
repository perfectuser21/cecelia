import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {cruise} from 'dependency-cruiser';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function readSmokeAllowlist(require=createRequire(import.meta.url)){
 const target=require.resolve('../../../packages/quality/smoke-allowlist.txt');
 const extension=Object.getOwnPropertyDescriptor(require.extensions,'.txt'),cache=Object.getOwnPropertyDescriptor(require.cache,target);
 try{
  Object.defineProperty(require.extensions,'.txt',{configurable:true,writable:true,enumerable:true,value:(module,filename)=>{
   assert.equal(filename,target,'SMOKE_ALLOWLIST_DATA_TARGET');module.exports=readFileSync(filename,'utf8');
  }});
  delete require.cache[target];return require('../../../packages/quality/smoke-allowlist.txt');
 }finally{
  if(extension)Object.defineProperty(require.extensions,'.txt',extension);else delete require.extensions['.txt'];
  if(cache)Object.defineProperty(require.cache,target,cache);else delete require.cache[target];
 }
}
function assertAllowlistLoaderRestoration(t){
 const f=fixture(t),target=join(f.directory,'packages/quality/smoke-allowlist.txt'),other=join(f.directory,'other.txt');mkdirSync(dirname(target),{recursive:true});
 const text='globalThis.__ciSmokeAllowlistExecuted=true;';writeFileSync(target,text);writeFileSync(other,'other data');
 const local=createRequire(join(f.directory,'scripts/ci/__tests__/fixture.mjs'));
 const originalExtension=Object.getOwnPropertyDescriptor(local.extensions,'.txt'),originalCache=Object.getOwnPropertyDescriptor(local.cache,target);
 try{
  Object.defineProperty(local.extensions,'.txt',{value:()=>{throw Error('prior loader must not run');},writable:true,enumerable:false,configurable:true});
  Object.defineProperty(local.cache,target,{value:{exports:'prior cache'},writable:true,enumerable:false,configurable:true});
  const extension=Object.getOwnPropertyDescriptor(local.extensions,'.txt'),cache=Object.getOwnPropertyDescriptor(local.cache,target);
  assert.equal(readSmokeAllowlist(local),text);assert.equal(globalThis.__ciSmokeAllowlistExecuted,undefined);
  const redirected=()=>local(other);Object.assign(redirected,{resolve:local.resolve,extensions:local.extensions,cache:local.cache});
  assert.throws(()=>readSmokeAllowlist(redirected),/SMOKE_ALLOWLIST_DATA_TARGET/);
  assert.deepEqual(Object.getOwnPropertyDescriptor(local.extensions,'.txt'),extension);assert.deepEqual(Object.getOwnPropertyDescriptor(local.cache,target),cache);
 }finally{
  if(originalExtension)Object.defineProperty(local.extensions,'.txt',originalExtension);else delete local.extensions['.txt'];
  if(originalCache)Object.defineProperty(local.cache,target,originalCache);else delete local.cache[target];delete local.cache[other];delete globalThis.__ciSmokeAllowlistExecuted;
 }
}
const entries=text=>text.split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#'));
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'ci-admission-smoke-contract-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return {directory,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:directory,TMPDIR:directory,GH_TOKEN:'synthetic-parent-secret-must-not-inherit',DB_PASSWORD:'synthetic-parent-database-must-not-inherit',NODE_OPTIONS:'--not-a-valid-node-flag'}};}
const run=env=>new Promise(resolve=>execFile('bash',[env.SMOKE_DIR?'packages/quality/scripts/run-smoke-ratchet.sh':'packages/brain/scripts/smoke/ci-admission-bootstrap-smoke.sh'],{cwd:root,env,timeout:60000,maxBuffer:4*1024*1024},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
function assertSmokeSuccess(result){
 assert.equal(result.error,null,result.stderr);assert.match(result.stdout,/# fail 0\b/);assert.match(result.stdout,/# skipped 0\b/);
 const count=Number(/^# tests (\d+)$/m.exec(result.stdout)?.[1]);assert.ok(count>=60);
 assert.equal(Number(/^# pass (\d+)$/m.exec(result.stdout)?.[1]),count);
 for(const field of ['cancelled','todo'])assert.match(result.stdout,new RegExp('^# '+field+' 0$','m'));
}
test('feature smoke不能把真实Node全TODO的exit0当作成功',async t=>{
 const f=fixture(t),path=join(f.directory,'todo.test.mjs');writeFileSync(path,"import {test} from 'node:test';for(let i=0;i<60;i++)test('pending '+i,{todo:true},()=>{throw new Error('not executed successfully');});");
 const result=await new Promise(resolve=>execFile(process.execPath,['--test',path],{env:{PATH:f.env.PATH,HOME:f.directory},timeout:10000,maxBuffer:1024*1024},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 assert.equal(result.error,null);assert.match(result.stdout,/# pass 0\b/);assert.match(result.stdout,/# todo 60\b/);
 assert.throws(()=>assertSmokeSuccess(result));
});
test('feature smoke实际跑本地Git/原ZIP/opaque/发布与子进程合同，退出传播且退休36另走Brain入口',{timeout:90000},async t=>{
 const name='ci-admission-bootstrap-smoke.sh';
 assert.equal(entries(readSmokeAllowlist()).filter(line=>line===name).length,1);
 for(const list of ['smoke-denylist.txt','smoke-debt.txt'])assert.equal(entries(readFileSync(join(root,'packages/quality',list),'utf8')).includes(name),false);
 assertAllowlistLoaderRestoration(t);
 const reader='scripts/ci/__tests__/basic-ci-admission-feature-smoke.test.mjs';
 const graph=await cruise([reader],{baseDir:root,doNotFollow:{path:'node_modules'},exclude:{path:'node_modules'}}),out=typeof graph.output==='string'?JSON.parse(graph.output):graph.output;
 assert.ok(out.modules.some(m=>m.source===reader&&m.dependencies.some(d=>!d.couldNotResolve&&resolve(root,d.resolved)===resolve(root,'packages/quality/smoke-allowlist.txt'))));
 const f=fixture(t),smokeDir=join(f.directory,'ratchet-only');mkdirSync(smokeDir);
 // 私有ratchet输入目录仅调用真实脚本，避免本地执行其它线上smoke。
 const actual=join(root,'packages/brain/scripts/smoke',name);writeFileSync(join(smokeDir,name),"#!/bin/bash\nexec bash '"+actual.replaceAll("'","'\\''")+"'\n",{mode:0o700});
 const result=await run({...f.env,SMOKE_DIR:smokeDir});assertSmokeSuccess(result);assert.match(result.stdout,/GATE PASSED/);assert.match(result.stdout,/UNREGISTERED:\s+0/);assert.equal(result.stdout.includes('五个显式退休仅产生候选'),false);assert.equal((result.stdout+result.stderr).includes(f.env.GH_TOKEN),false);
 assert.equal(readFileSync(join(root,'scripts/ci/__tests__/implementation-main-snapshot.test.mjs'),'utf8').includes("import './ci-admission-mechanisms.test.mjs'"),false);
 assert.equal(existsSync(join(root,'packages/brain/src/__tests__/ci-admission-baseline-contracts.test.js')),false);
 const {relations}=createRequire(import.meta.url)('../../../.implementation-source-relations.json');
 assert.equal(relations.some(row=>row.path==='packages/brain/src/__tests__/ci-admission-baseline-contracts.test.js'),false);
 const aggregate=readFileSync(join(root,'scripts/ci/__tests__/ci-admission-mechanisms.test.mjs'),'utf8');assert.equal(aggregate.includes("import './basic-verification-retirements.test.mjs'"),false);assert.ok(existsSync(join(root,'packages/brain/src/__tests__/ci-verification-retirement-contracts.test.js')));
});
for(const major of [26,22])test(`feature smoke边界：Node${major}${major===26?'执行前拒绝':'真实失败码原样传递与最小env'}`,async t=>{
 const f=fixture(t),bin=join(f.directory,'bin'),calls=join(f.directory,'calls'),environment=join(f.directory,'environment');mkdirSync(bin);
 writeFileSync(join(bin,'node'),`#!/bin/sh\nif [ "$1" = '-p' ]; then printf '%s\\n' '${major}'; exit 0; fi\nprintf '%s\\n' "$*" > '${calls}'\n/usr/bin/env > '${environment}'\nexit 17\n`,{mode:0o700});
 const result=await run({...f.env,PATH:bin+':'+f.env.PATH});assert.equal(result.error?.code,major===26?2:17);
 if(major===26){assert.match(result.stderr,/CI_ADMISSION_SMOKE_NODE22_REQUIRED/);assert.equal(existsSync(calls),false);}
 else{assert.deepEqual(readFileSync(calls,'utf8').trim().split(' '),['--test',...['archive','artifact','authority','envelope','inputs','publisher','skill-cache','worker'].map(name=>'scripts/ci/__tests__/basic-ci-admission-'+name+'.test.mjs')]);const text=readFileSync(environment,'utf8');assert.equal(text.includes(f.env.GH_TOKEN),false);assert.equal(text.includes(f.env.DB_PASSWORD),false);assert.equal(text.includes('NODE_OPTIONS='),false);assert.ok(!text.includes('HOME='+f.directory+'\n'));}
});
