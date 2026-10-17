import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import yaml from 'js-yaml';
import {expectedSourceRuntime,waitForSourceRuntime} from '../implementation-source-ready.mjs';
const legacyPaths=['source','runtime-source','build-source','build-envelopes','workspace-source'].map(n=>`packages/brain/src/lib/existing-ops-${n}.js`).sort();
const provenancePaths=['envelope','core-envelope','entry-envelopes','local-envelopes'].map(n=>`packages/brain/src/lib/existing-ops-provenance-${n}.js`).sort();
const priorPaths=[...legacyPaths,...provenancePaths].sort();
const stagePaths=['source','envelopes'].map(n=>`packages/brain/src/lib/existing-ops-stage-${n}.js`).sort();
const priorStagePaths=[...priorPaths,...stagePaths].sort();
const newCollectorPaths=['source','envelopes'].map(n=>`packages/brain/src/lib/existing-ops-native-evidence-${n}.js`).sort();
const paths=[...priorStagePaths,...newCollectorPaths].sort();
const root=mkdtempSync(join(tmpdir(),'source-ready-'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
git('init','-q');mkdirSync(join(root,'empty-hooks'));git('config','core.hooksPath',join(root,'empty-hooks'));git('config','user.email','test@example.invalid');git('config','user.name','Fixture');
for(const path of paths){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),`// fixed fixture ${path}\n`);}
git('add','.');git('commit','-qm','fixture');const revision=git('rev-parse','HEAD');
const expected={schema_version:1,repo:'perfectuser21/cecelia',files:paths.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}))};
const runtime=()=>({...structuredClone(expected),git_sha:'a'.repeat(40)});
test.after(()=>rmSync(root,{recursive:true,force:true}));
async function fixture(responses,run){
 const requests=[];let i=0;
 const server=createServer((req,res)=>{requests.push({method:req.method,url:req.url,auth:req.headers['x-internal-token']});const item=responses[Math.min(i++,responses.length-1)];res.writeHead(item.status??200,{'Content-Type':'application/json'});res.end(typeof item.body==='string'?item.body:JSON.stringify(item.body));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}`;
 try{await run(url,requests);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
function options(brainUrl){return {brainUrl,token:'test-only',repoRoot:root,revision,timeoutMs:100,intervalMs:10};}
function deps(extra={}){let time=0;return {readMain:async()=>revision,now:()=>time,sleep:async ms=>{time+=ms;},...extra};}
test('固定单提交Git读取十三文件；工作区未提交字节不作为可信指纹',()=>{
 const actual=expectedSourceRuntime({repoRoot:root,revision});assert.deepEqual(actual,expected);
 writeFileSync(join(root,paths[0]),'dirty bytes');assert.deepEqual(expectedSourceRuntime({repoRoot:root,revision}),expected);git('checkout','--',paths[0]);
});
test('已知旧5模块只能等待，新13模块匹配才真实HTTP就绪',async()=>{
 const old=runtime();old.files=old.files.filter(f=>legacyPaths.includes(f.path));
 await fixture([{body:old},{body:runtime()}],async(url,requests)=>{
  const result=await waitForSourceRuntime(options(url),deps());assert.equal(result.attempts,2);assert.equal(result.files.length,13);
  assert.ok(requests.every(r=>r.method==='GET'));
 });
});
test('已知旧5模块持续存在只能有界等待，不能凭旧指纹放行',async()=>{
 const old=runtime();old.files=old.files.filter(f=>legacyPaths.includes(f.path));
 await fixture([{body:old}],async(url,requests)=>{
  await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_TIMEOUT/);assert.equal(requests.length,10);
 });
});
for(const path of [...provenancePaths,...stagePaths])test(`新增依赖 ${path} 指纹错误不能宣布ready`,async()=>{
 const body=runtime();body.files.find(f=>f.path===path).sha256='0'.repeat(64);
 await fixture([{body}],async url=>await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_TIMEOUT/));
});
for(const [name,change] of [
 ['乱序',files=>files.reverse()],['重复',files=>{files[0]=files[1];return files;}],
 ['坏hash',files=>{files[0].sha256='oops';return files;}],
 ['未知第5路径',files=>{files[0].path=provenancePaths[0];return files;}],
 ['只剩4个',files=>files.slice(1)],
])test(`旧模块协议 ${name} 仍立即拒绝`,async()=>{
 const body=runtime();body.files=change(body.files.filter(f=>legacyPaths.includes(f.path)));
 await fixture([{body}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_RESPONSE_INVALID/);assert.equal(requests.length,1);});
});
test('新协议任意缺1文件的12模块子集也立即拒绝',async()=>{
 const body=runtime();body.files.pop();
 await fixture([{body}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_RESPONSE_INVALID/);assert.equal(requests.length,1);});
});
test('真实HTTP仅GET，旧部署指纹等待后匹配；不同build SHA可接受',async()=>{
 const old=runtime();old.files[0].sha256='0'.repeat(64);
 await fixture([{body:old},{body:runtime()}],async(url,requests)=>{
  const r=await waitForSourceRuntime(options(url),deps());assert.equal(r.status,'ready');assert.equal(r.attempts,2);assert.equal(r.runtime_git_sha,'a'.repeat(40));
  assert.deepEqual(requests.map(r=>[r.method,r.url,r.auth]),Array(2).fill(['GET','/api/brain/implementation-ci/runtime-source','test-only']));
 });
});
test('旧端点404及部署503只读等待后正常就绪',async()=>{
 await fixture([{status:404,body:{}},{status:503,body:{}},{body:runtime()}],async(url,requests)=>{
  assert.equal((await waitForSourceRuntime(options(url),deps())).attempts,3);assert.ok(requests.every(r=>r.method==='GET'));
 });
});
test('网络异常有界等待，不吞普通程序错误',async()=>{
 let calls=0;const fetchFn=async()=>{if(++calls===1)throw new TypeError('network');return new Response(JSON.stringify(runtime()));};
 assert.equal((await waitForSourceRuntime(options('http://localhost'),deps({fetchFn}))).attempts,2);
 await assert.rejects(waitForSourceRuntime(options('http://localhost'),deps({fetchFn:async()=>{throw Error('bug');}})),/SOURCE_READY_FETCH_ERROR/);
});
test('部署断连造成响应流中断时只读等待',async()=>{
 let calls=0;
 const fetchFn=async()=>++calls===1?{ok:true,text:async()=>{throw new TypeError('terminated');}}:new Response(JSON.stringify(runtime()));
 assert.equal((await waitForSourceRuntime(options('http://localhost'),deps({fetchFn}))).attempts,2);
});
for(const status of [401,403,409,429])test(`HTTP ${status}立即拒绝，不重试`,async()=>{
 await fixture([{status,body:{}}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_HTTP_ERROR/);assert.equal(requests.length,1);});
});
for(const [name,mutate] of [
 ['schema',b=>b.schema_version=2],['repo',b=>b.repo='foreign/repo'],['extra field',b=>b.proof='trusted'],
 ['duplicate path',b=>b.files[0]=b.files[1]],['extra path',b=>b.files.push({path:'secret',sha256:'0'.repeat(64)})],
 ['invalid digest',b=>b.files[0].sha256='oops'],['malicious path',b=>b.files[0].path='../secret'],['invalid build sha',b=>b.git_sha='main']
])test(`未知或恶意${name}响应立即拒绝`,async()=>{
 const b=runtime();mutate(b);await fixture([{body:b}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_RESPONSE_INVALID/);assert.equal(requests.length,1);});
});
test('缺省build SHA可以由匹配模块指纹证明就绪',async()=>{
 const b=runtime();b.git_sha=null;await fixture([{body:b}],async url=>assert.equal((await waitForSourceRuntime(options(url),deps())).runtime_git_sha,null));
});
for(const body of ['not-json','x'.repeat(65537)])test(`非法或超大响应拒绝(${body.length})`,async()=>{
 await fixture([{body}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_RESPONSE_INVALID/);assert.equal(requests.length,1);});
});
test('错误指纹持续存在时严格超时，全部请求只有GET',async()=>{
 const b=runtime();b.files[0].sha256='0'.repeat(64);
 await fixture([{body:b}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_TIMEOUT/);assert.equal(requests.length,10);assert.ok(requests.every(r=>r.method==='GET'));});
});
test('main在读取前或响应后移动都立即失败',async()=>{
 let calls=0;await fixture([{body:runtime()}],async(url,requests)=>{
  await assert.rejects(waitForSourceRuntime(options(url),deps({readMain:async()=> 'b'.repeat(40)})),/SOURCE_READY_MAIN_MOVED/);assert.equal(requests.length,0);
  await assert.rejects(waitForSourceRuntime(options(url),deps({readMain:async()=>++calls===1?revision:'b'.repeat(40)})),/SOURCE_READY_MAIN_MOVED/);assert.equal(requests.length,1);
 });
});
test('迟到的匹配响应不能越过硬截止时间',async()=>{
 let time=0;await assert.rejects(waitForSourceRuntime(options('http://localhost'),deps({now:()=>time,fetchFn:async()=>{time=101;return new Response(JSON.stringify(runtime()));}})),/SOURCE_READY_TIMEOUT/);
});
test('拒绝超60分钟预算及非固定HEAD',async()=>{
 await assert.rejects(waitForSourceRuntime({...options('http://localhost'),timeoutMs:3600001},deps()),/SOURCE_READY_INPUT_INVALID/);
 assert.throws(()=>expectedSourceRuntime({repoRoot:root,revision:'a'.repeat(40)}),/SOURCE_READY_CHECKOUT_MISMATCH/);
});

test('真实workflow保持原snapshot谓词与15/40分钟，独立只读就绪60分钟',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const ready=workflow.jobs['source-runtime-ready'],snapshot=workflow.jobs['snapshot-main'];
 const old="inputs.export_device_patrol_source_identity != true && github.event_name != 'pull_request' && github.ref == 'refs/heads/main'";
 assert.equal(ready.if,old);assert.equal(snapshot.if,old);assert.deepEqual(snapshot.needs,['source-runtime-ready']);
 assert.equal(ready['timeout-minutes'],60);assert.equal(snapshot['timeout-minutes'],15);assert.equal(workflow.jobs.gate['timeout-minutes'],40);
 const scopeStep=ready.steps.find(s=>s.id==='scope');assert.match(scopeStep.run,/echo "applicable=\$REQUIRED"/);
 const evaluate=(expression,context)=>Function('github','inputs','vars',`return (${expression.replace(/^\$\{\{ | \}\}$/g,'')})`)(context.github,context.inputs,context.vars);
 const context={github:{repository:'perfectuser21/cecelia',ref:'refs/heads/main',event_name:'push',sha:revision},inputs:{},vars:{}};
 for(const [name,patch,jobExpected,appExpected] of [
  ['self push',{},true,true],['self dispatch',{github:{event_name:'workflow_dispatch'}},true,true],
  ['PR',{github:{event_name:'pull_request'}},false,false],['device',{inputs:{export_device_patrol_source_identity:true}},false,true],
  ['crossrepo',{github:{repository:'foreign/repo'},inputs:{source_repo:'foreign/repo',tooling_revision:revision}},true,false],
  ['foreign source',{inputs:{source_repo:'foreign/repo'}},true,false],['other scope',{inputs:{scope:'cecelia-device-patrol'}},true,false],
  ['other head',{inputs:{head_revision:'a'.repeat(40)}},true,false],['other tooling',{inputs:{tooling_revision:'a'.repeat(40)}},true,false],
  ['other mode',{inputs:{mode:'release'}},true,false]
 ]){
  const c={github:{...context.github,...patch.github},inputs:{...patch.inputs},vars:{}};
  assert.equal(evaluate(ready.if,c),jobExpected,name);assert.equal(evaluate(snapshot.if,c),jobExpected,name);
  assert.equal(evaluate(scopeStep.env.REQUIRED,c),appExpected,name);
 }
 for(const step of ready.steps.filter(s=>s!==scopeStep))assert.ok(step.if.includes("steps.scope.outputs.applicable == 'true'"));
 assert.equal(ready.steps.find(s=>s.uses==='actions/checkout@v4').with.ref,'${{ github.sha }}');
 assert.ok(ready.steps.some(s=>s.run==='node tooling/scripts/ci/implementation-source-ready.mjs'));
});
test('固定Git输入可在真实depth1浅克隆运行',()=>{
 const clone=join(root,'shallow');execFileSync('git',['clone','--quiet','--depth','1',`file://${root}`,clone]);
 assert.equal(execFileSync('git',['rev-parse','--is-shallow-repository'],{cwd:clone,encoding:'utf8'}).trim(),'true');
 assert.deepEqual(expectedSourceRuntime({repoRoot:clone,revision}),expected);
});

test('精确历史9模块只等待，13完整匹配才ready',async()=>{const old=runtime();old.files=old.files.filter(f=>priorPaths.includes(f.path));await fixture([{body:old},{body:runtime()}],async(url,requests)=>{const r=await waitForSourceRuntime(options(url),deps());assert.equal(r.attempts,2);assert.equal(r.files.length,13);assert.ok(requests.every(x=>x.method==='GET'));});});
test('精确历史9持续存在到硬截止不能ready',async()=>{const old=runtime();old.files=old.files.filter(f=>priorPaths.includes(f.path));await fixture([{body:old}],async url=>assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_TIMEOUT/));});
for(const mutate of [f=>f.reverse(),f=>{f[0]=f[1];return f;},f=>f.slice(1),f=>{f[0].sha256='bad';return f;},f=>{f[0].path=stagePaths[0];return f;}])test('未知历史9变体立即拒绝',async()=>{const b=runtime();b.files=mutate(b.files.filter(x=>priorPaths.includes(x.path)));await fixture([{body:b}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(options(url),deps()),/SOURCE_READY_RESPONSE_INVALID/);assert.equal(requests.length,1);});});

// 独立13文件固定Git fixture，不借当前实现的身份数组生成期望。
const nativeEvidencePaths=['source','envelopes'].map(n=>`packages/brain/src/lib/existing-ops-native-evidence-${n}.js`).sort();
const completePaths=[...priorStagePaths,...nativeEvidencePaths].sort();
const futureRoot=mkdtempSync(join(tmpdir(),'source-ready-native-'));
const futureGit=(...args)=>execFileSync('git',args,{cwd:futureRoot,encoding:'utf8'}).trim();
futureGit('init','-q');mkdirSync(join(futureRoot,'no-hooks'));futureGit('config','core.hooksPath',join(futureRoot,'no-hooks'));futureGit('config','user.email','test@example.invalid');futureGit('config','user.name','Fixture');
for(const path of completePaths){mkdirSync(dirname(join(futureRoot,path)),{recursive:true});writeFileSync(join(futureRoot,path),`// independent native fixture ${path}\n`);}
futureGit('add','.');futureGit('commit','-qm','native 13 fixed fixture');
const futureRevision=futureGit('rev-parse','HEAD');
const futureExpected={schema_version:1,repo:'perfectuser21/cecelia',files:completePaths.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(futureRoot,path))).digest('hex')}))};
const futureRuntime=()=>({...structuredClone(futureExpected),git_sha:'a'.repeat(40)});
const futureOptions=url=>({...options(url),repoRoot:futureRoot,revision:futureRevision});
const futureDeps=()=>deps({readMain:async()=>futureRevision});
test.after(()=>rmSync(futureRoot,{recursive:true,force:true}));
test('native evidence固定Git完整13路径及实际hash，dirty工作区不能冒指纹',()=>{
 assert.deepEqual(expectedSourceRuntime({repoRoot:futureRoot,revision:futureRevision}),futureExpected);
 writeFileSync(join(futureRoot,nativeEvidencePaths[0]),'dirty actual module');
 try{assert.deepEqual(expectedSourceRuntime({repoRoot:futureRoot,revision:futureRevision}),futureExpected);}finally{futureGit('checkout','--',nativeEvidencePaths[0]);}
});
test('native evidence精确历史11只能pending，实际新13全部匹配才ready',async()=>{
 const old=futureRuntime();old.files=old.files.filter(f=>priorStagePaths.includes(f.path));
 await fixture([{body:old},{body:futureRuntime()}],async(url,requests)=>{
  const r=await waitForSourceRuntime(futureOptions(url),futureDeps());assert.equal(r.attempts,2);assert.equal(r.files.length,13);assert.deepEqual(r.files,futureExpected.files);assert.ok(requests.every(q=>q.method==='GET'));
 });
});
test('native evidence精确历史11持续存在到硬截止只能超时不能ready',async()=>{
 const old=futureRuntime();old.files=old.files.filter(f=>priorStagePaths.includes(f.path));
 await fixture([{body:old}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(futureOptions(url),futureDeps()),/SOURCE_READY_TIMEOUT/);assert.equal(requests.length,10);});
});
for(const path of nativeEvidencePaths)test(`native evidence13中新增${path} hash错误只等待不得ready`,async()=>{
 const body=futureRuntime();body.files.find(f=>f.path===path).sha256='0'.repeat(64);
 await fixture([{body}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(futureOptions(url),futureDeps()),/SOURCE_READY_TIMEOUT/);assert.equal(requests.length,10);});
});
for(const [name,mutate] of [
 ['未知11含新增路径',f=>f.filter(x=>![legacyPaths[0],legacyPaths[1]].includes(x.path))],
 ['未知12仅缺一个新增',f=>f.filter(x=>x.path!==nativeEvidencePaths[0])],
 ['旧11乱序',f=>f.filter(x=>priorStagePaths.includes(x.path)).reverse()],
 ['旧11重复路径',f=>{const x=f.filter(y=>priorStagePaths.includes(y.path));x[0]=x[1];return x;}],
])test(`native evidence ${name}必须立即拒绝而非pending或ready`,async()=>{
 const body=futureRuntime();body.files=mutate(body.files);
 await fixture([{body}],async(url,requests)=>{await assert.rejects(waitForSourceRuntime(futureOptions(url),futureDeps()),/SOURCE_READY_RESPONSE_INVALID/);assert.equal(requests.length,1);});
});
