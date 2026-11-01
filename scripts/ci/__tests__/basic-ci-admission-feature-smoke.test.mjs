import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function fixture(t){const directory=mkdtempSync(join(tmpdir(),'ci-admission-smoke-contract-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return {directory,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:directory,TMPDIR:directory,GH_TOKEN:'synthetic-parent-secret-must-not-inherit',DB_PASSWORD:'synthetic-parent-database-must-not-inherit',NODE_OPTIONS:'--not-a-valid-node-flag'}};}
const run=env=>new Promise(resolve=>execFile('bash',['packages/brain/scripts/smoke/ci-admission-bootstrap-smoke.sh'],{cwd:root,env,timeout:60000,maxBuffer:4*1024*1024},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
function assertSmokeSuccess(result){
 assert.equal(result.error,null,result.stderr);assert.match(result.stdout,/# fail 0\b/);assert.match(result.stdout,/# skipped 0\b/);
 assert.ok(Number(/# tests (\d+)/.exec(result.stdout)?.[1])>=60);
}
test('feature smoke不能把真实Node全TODO的exit0当作成功',async t=>{
 const f=fixture(t),path=join(f.directory,'todo.test.mjs');writeFileSync(path,"import {test} from 'node:test';for(let i=0;i<60;i++)test('pending '+i,{todo:true},()=>{throw new Error('not executed successfully');});");
 const result=await new Promise(resolve=>execFile(process.execPath,['--test',path],{env:{PATH:f.env.PATH,HOME:f.directory},timeout:10000,maxBuffer:1024*1024},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 assert.equal(result.error,null);assert.match(result.stdout,/# pass 0\b/);assert.match(result.stdout,/# todo 60\b/);
 assert.throws(()=>assertSmokeSuccess(result));
});
test('feature smoke实际跑本地Git/原ZIP/opaque/发布与子进程合同，退出传播且退休36另走Brain入口',{timeout:90000},async t=>{
 const f=fixture(t),result=await run(f.env);assertSmokeSuccess(result);assert.equal(result.stdout.includes('五个显式退休仅产生候选'),false);assert.equal((result.stdout+result.stderr).includes(f.env.GH_TOKEN),false);
 const aggregate=readFileSync(join(root,'scripts/ci/__tests__/ci-admission-mechanisms.test.mjs'),'utf8');assert.equal(aggregate.includes("import './basic-verification-retirements.test.mjs'"),false);assert.ok(existsSync(join(root,'packages/brain/src/__tests__/ci-verification-retirement-contracts.test.js')));
});
for(const major of [26,22])test(`feature smoke边界：Node${major}${major===26?'执行前拒绝':'真实失败码原样传递与最小env'}`,async t=>{
 const f=fixture(t),bin=join(f.directory,'bin'),calls=join(f.directory,'calls'),environment=join(f.directory,'environment');mkdirSync(bin);
 writeFileSync(join(bin,'node'),`#!/bin/sh\nif [ "$1" = '-p' ]; then printf '%s\\n' '${major}'; exit 0; fi\nprintf '%s\\n' "$*" > '${calls}'\n/usr/bin/env > '${environment}'\nexit 17\n`,{mode:0o700});
 const result=await run({...f.env,PATH:bin+':'+f.env.PATH});assert.equal(result.error?.code,major===26?2:17);
 if(major===26){assert.match(result.stderr,/CI_ADMISSION_SMOKE_NODE22_REQUIRED/);assert.equal(existsSync(calls),false);}
 else{assert.match(readFileSync(calls,'utf8'),/^--test /);const text=readFileSync(environment,'utf8');assert.equal(text.includes(f.env.GH_TOKEN),false);assert.equal(text.includes(f.env.DB_PASSWORD),false);assert.equal(text.includes('NODE_OPTIONS='),false);assert.ok(!text.includes('HOME='+f.directory+'\n'));}
});
