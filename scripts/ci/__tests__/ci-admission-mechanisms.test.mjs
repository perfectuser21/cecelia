// 旧Core过渡入口：标准Node文件隔离；parent统一发现基础文件后删除本driver。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const names=['feature-smoke','archive','artifact','authority','builder','envelope','impact-workflow','infra','inputs',
 'legacy','publisher','resolver','scratch-import','scratch','seed','skill-cache','worker','workflow'];
const files=names.map(name=>`scripts/ci/__tests__/basic-ci-admission-${name}.test.mjs`);
function accepted(result){
 assert.equal(result.error,null);assert.equal(result.timedOut,false);
 assert.equal(result.code,0,result.stderr);assert.equal(result.signal,null);
 const summary={};
 for(const field of ['tests','pass','fail','cancelled','skipped','todo']){
  const matches=[...result.stdout.matchAll(new RegExp(`^# ${field} (\\d+)$`,'gm'))];
  assert.equal(matches.length,1,'exact child summary '+field);summary[field]=Number(matches[0][1]);
  assert.equal(summary[field],field==='tests'||field==='pass'?148:0,'child '+field);
 }
 return summary;
}
async function runFiles(t,paths,timeoutMs=120000){
 const temporary=mkdtempSync(join(tmpdir(),'ci-contract-child-'));
 let child;
 try{
  return await new Promise(resolve=>{
   const env={...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary};
   // 新的标准Node runner必须脱离父runner内部上下文，不能把148文件当递归而不执行。
   delete env.NODE_TEST_CONTEXT;
   child=spawn(process.execPath,['--test','--test-concurrency=4',...paths],{
    cwd:root,detached:true,env,stdio:['ignore','pipe','pipe'],
   });
   let stdout='',stderr='',error=null,timedOut=false;
   const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')error=e.message;}};
   const cancel=()=>{error='outer test cancelled';kill();};
   t.signal.addEventListener('abort',cancel,{once:true});
   const timer=setTimeout(()=>{timedOut=true;kill();},timeoutMs);
   const collect=field=>chunk=>{
    if(field==='stdout')stdout+=chunk;else stderr+=chunk;
    if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>8*1024*1024){error='child output limit';kill();}
   };
   child.stdout.on('data',collect('stdout'));child.stderr.on('data',collect('stderr'));
   child.once('error',e=>{error=e.message;});
   child.once('close',(code,signal)=>{
    kill(); // 正常runner退出也须回收同一私有PGID的unref后代。
    clearTimeout(timer);t.signal.removeEventListener('abort',cancel);
    resolve({code,signal,stdout,stderr,error,timedOut});
   });
  });
 }finally{rmSync(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:20});}
}
test('真实隔离子进程执行18文件148合同，拒绝失败、TODO、signal和超时',{timeout:150000},async t=>{
 assert.equal(files.length,18);assert.equal(new Set(files).size,18);
 const actual=await runFiles(t,files);
 t.diagnostic('ACTUAL_CONTRACT_CHILD_TAP\n'+actual.stdout+actual.stderr);
 t.diagnostic(JSON.stringify({kind:'actual_contract_child',summary:accepted(actual)}));
 assert.throws(()=>accepted({...actual,code:1}));assert.throws(()=>accepted({...actual,signal:'SIGTERM'}));
 const directory=mkdtempSync(join(tmpdir(),'ci-contract-refusal-'));t.after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:20}));
 for(const kind of ['failure','todo']){
  const path=join(directory,kind+'.test.mjs');
  writeFileSync(path,`import {test} from 'node:test';for(let i=0;i<148;i++)test('guard '+i,${kind==='todo'?'{todo:true}':'{}'},()=>{${kind==='failure'?"if(i===147)throw Error('actual failure');":''}});`);
  const rejected=await runFiles(t,[path]);
  t.diagnostic(JSON.stringify({kind:'actual_refusal_child',case:kind,code:rejected.code,signal:rejected.signal}));
  if(kind==='todo')assert.equal(rejected.code,0);else assert.equal(rejected.code,1);
  assert.throws(()=>accepted(rejected));
 }
 const hang=join(directory,'hang.test.mjs');writeFileSync(hang,"import {test} from 'node:test';setInterval(()=>{},1000);test('blocked',()=>new Promise(()=>{}));");
 const timed=await runFiles(t,[hang],300);assert.equal(timed.timedOut,true);assert.equal(timed.signal,'SIGKILL');assert.throws(()=>accepted(timed));
});

test('正常完成后清理本人进程组内unref孙进程，不遗留后台任务',{timeout:5000},async t=>{
 const directory=mkdtempSync(join(tmpdir(),'ci-contract-orphan-')),pidFile=join(directory,'child.pid');let pid;
 t.after(()=>{if(pid)try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}rmSync(directory,{recursive:true,force:true});});
 const path=join(directory,'owner.test.mjs');
 writeFileSync(path,`import {test} from 'node:test';import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();writeFileSync(${JSON.stringify(pidFile)},String(child.pid));for(let i=0;i<148;i++)test('owned '+i,()=>{});`);
 const result=await runFiles(t,[path]);accepted(result);pid=Number(readFileSync(pidFile,'utf8'));assert.ok(Number.isInteger(pid)&&pid>0);
 const alive=()=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
 for(let i=0;i<50&&alive();i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(alive(),false,'runner完成后本人同PGID孙进程必须被回收');
});
