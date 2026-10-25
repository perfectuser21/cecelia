import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {bundle} from './fixtures/admission-bundle.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const head='a'.repeat(40),repo='perfectuser21/cecelia';
async function transportRun(t,{phase='headers',delay=2000,cleanupFailure=false,cleanupOnly=false,primaryUndefined=false,lateBody=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'publisher-transport-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const calls=[];let missing=true;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const q=req.method==='POST'?JSON.parse(raw):Object.fromEntries(new URL(req.url,'http://fixture').searchParams);
  calls.push({method:req.method,...q,received_at:Date.now()});
  const value=req.method==='POST'?{snapshot:bundle(head).snapshot.admission_companion.snapshot}:bundle(head,{childMissing:missing});
  const text=JSON.stringify(value);
  if(req.method!=='POST'){res.writeHead(200,{'content-type':'application/json'});res.end(text);return;}
  if(cleanupFailure){req.socket.destroy();return;}
  const send=()=>{missing=false;if(phase==='headers')res.writeHead(200,{'content-type':'application/json'});res.end(phase==='body'?text.slice(1):text);};
  if(phase==='body'){res.writeHead(200,{'content-type':'application/json'});res.write(text.slice(0,1));}
  const timer=setTimeout(send,delay);res.once('close',()=>clearTimeout(timer));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const options={brainUrl:`http://127.0.0.1:${server.address().port}`,token:'isolated-test-token',scope:'cecelia-kr',repo,base:head,head,output:join(dir,'evidence')};
 // 独立child压缩旧运输期限与原signal；真实socket/timer，不改生产预算或全局环境。
 const childSource=`
 import {appendFileSync} from 'node:fs';
 import {Agent,setGlobalDispatcher} from ${JSON.stringify(pathToFileURL(join(root,'node_modules/undici/index.js')).href)};
 import {publishMainSnapshots} from ${JSON.stringify(pathToFileURL(join(root,'scripts/ci/implementation-main-snapshot.mjs')).href)};
 const legacy=new Agent({headersTimeout:100,bodyTimeout:100});setGlobalDispatcher(legacy);
 const timeout=AbortSignal.timeout.bind(AbortSignal);let timerSequence=0;
 const timerEvent=(id,kind)=>appendFileSync(${JSON.stringify(join(dir,'timers.jsonl'))},JSON.stringify({id,kind,at:Date.now()})+'\\n');
 AbortSignal.timeout=ms=>{const signal=timeout(ms===600000?10000:ms),id=++timerSequence;timerEvent(id,'armed');signal.addEventListener('abort',()=>timerEvent(id,'abort'),{once:true});return signal;};
 const close=Agent.prototype.close,destroy=Agent.prototype.destroy;
 const record=value=>appendFileSync(${JSON.stringify(join(dir,'cleanup.jsonl'))},JSON.stringify(value)+'\\n');
 Agent.prototype.close=function(...args){if(this===legacy||args.length)return close.apply(this,args);record('close');return ${cleanupFailure||cleanupOnly||primaryUndefined}?Promise.reject(new Error('cleanup-only')):close.call(this);};
 Agent.prototype.destroy=function(...args){if(this===legacy||args.length)return destroy.apply(this,args);record('destroy');return destroy.apply(this,args).then(()=>{if(${cleanupFailure||cleanupOnly||primaryUndefined})throw new Error('cleanup-only');});};
 try{await publishMainSnapshots(${JSON.stringify(options)},{readMain:()=>${JSON.stringify(head)},...(${primaryUndefined}?{fetchFn:async()=>{throw undefined;}}:${lateBody}?{fetchFn:async(url,options)=>{const response=await fetch(url,options);if(options.method!=='POST')return response;return {status:response.status,ok:response.ok,text:async()=>{const text=await response.text();timerEvent(2,'body-read');const keepAlive=setTimeout(()=>{},15000);try{if(!options.signal.aborted)await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));}finally{clearTimeout(keepAlive);}return text;}};}}:{})});console.log('PUBLISHED');}
 catch(e){console.error(JSON.stringify({name:e?.name,code:e?.code,cause:e?.cause?.code,is_undefined:e===undefined}));process.exitCode=1;}
 finally{await close.call(legacy);}
 `;
 const path=join(dir,'child.mjs');writeFileSync(path,childSource);
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.once('error',reject);
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('fixture child exceeded 18 seconds'));},18000);
  child.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
 });
 const cleanup=existsSync(join(dir,'cleanup.jsonl'))?readFileSync(join(dir,'cleanup.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
 const timers=existsSync(join(dir,'timers.jsonl'))?readFileSync(join(dir,'timers.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
 const failurePath=join(dir,'evidence/diagnostics/failure.json');
 const failure=existsSync(failurePath)?JSON.parse(readFileSync(failurePath)):null;
 t.diagnostic(JSON.stringify({phase,delay,code:result.code,calls:calls.map(c=>({method:c.method,scope:c.scope})),cleanup,timers,operation:failure?.operation,exception:failure?.exception}));
 return {...result,dir,calls,cleanup,timers};
}
for(const phase of ['headers','body'])test(`真实运输${phase}慢于旧期限但早于总deadline仍发布一次`,async t=>{
 const r=await transportRun(t,{phase});assert.equal(r.code,0,r.stderr);
 assert.equal(r.calls.filter(c=>c.method==='POST').length,1);
 assert.deepEqual(r.calls.filter(c=>c.method==='POST').map(c=>c.scope),['cecelia-factory']);
 const proof=JSON.parse(readFileSync(join(r.dir,'evidence/diagnostics/publication.json')));
 assert.equal(proof.status,'verified');assert.deepEqual(proof.admission_scopes,['cecelia-kr','cecelia-factory']);
 assert.ok(existsSync(join(r.dir,'evidence/base.json')));assert.ok(existsSync(join(r.dir,'evidence/head.json')));
});
for(const phase of ['headers','body'])test(`真实运输${phase}超过总deadline仍UNKNOWN且不重发`,async t=>{
 const r=await transportRun(t,{phase,delay:12000});assert.notEqual(r.code,0);
 assert.equal(r.calls.filter(c=>c.method==='POST').length,1);
 const failure=JSON.parse(readFileSync(join(r.dir,'evidence/diagnostics/failure.json')));
 assert.equal(failure.operation.post_outcome,'UNKNOWN');
 assert.equal(failure.operation.body_read_completed,false);assert.deepEqual(r.cleanup,['destroy']);
 assert.ok(r.timers.some(e=>e.id===2&&e.kind==='abort'),'本POST的真实总deadline须触发');
 assert.ok(['TimeoutError','AbortError'].includes(failure.exception.name),JSON.stringify(failure));
 assert.equal(existsSync(join(r.dir,'evidence/base.json')),false);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});
test('真实POST连接中断时资源清理异常不覆盖primary错误或重试',async t=>{
 const r=await transportRun(t,{cleanupFailure:true});assert.notEqual(r.code,0);
 assert.equal(r.calls.filter(c=>c.method==='POST').length,1);assert.doesNotMatch(r.stderr,/cleanup-only/);
 const failure=JSON.parse(readFileSync(join(r.dir,'evidence/diagnostics/failure.json')));
 assert.equal(failure.exception.cause.code,'UND_ERR_SOCKET');assert.equal(failure.operation.post_outcome,'UNKNOWN');
 assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});

test('成功请求的close失败经destroy释放并拒发布，不伪成功',async t=>{
 const r=await transportRun(t,{cleanupOnly:true,delay:0});assert.notEqual(r.code,0);
 assert.equal(r.calls.filter(c=>c.method==='POST').length,1);assert.deepEqual(r.cleanup,['close','destroy']);
 assert.equal(existsSync(join(r.dir,'evidence/base.json')),false);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});
test('primary throw undefined仍原样保留，destroy失败不替换它',async t=>{
 const r=await transportRun(t,{primaryUndefined:true});assert.notEqual(r.code,0);
 assert.match(r.stderr,/"is_undefined":true/);assert.deepEqual(r.cleanup,['destroy']);assert.deepEqual(r.calls,[]);
 assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});

test('完整读体后才报告超时须保留body完成事实但UNKNOWN不发布',async t=>{
 const r=await transportRun(t,{lateBody:true,delay:0});assert.notEqual(r.code,0);
 assert.equal(r.calls.filter(c=>c.method==='POST').length,1);
 assert.ok(r.timers.some(e=>e.id===2&&e.kind==='body-read'));assert.ok(r.timers.some(e=>e.id===2&&e.kind==='abort'));
 const failure=JSON.parse(readFileSync(join(r.dir,'evidence/diagnostics/failure.json')));
 assert.equal(failure.operation.body_read_completed,true);assert.equal(failure.operation.post_outcome,'UNKNOWN');
 assert.equal(existsSync(join(r.dir,'evidence/base.json')),false);assert.equal(existsSync(join(r.dir,'evidence/head.json')),false);
});
