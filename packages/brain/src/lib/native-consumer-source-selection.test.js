import {afterAll,afterEach,expect,it,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readFixedExistingOpsGitFixture} from './__tests__/helpers/fixed-existing-ops-git-fixture.js';
const historical=readFixedExistingOpsGitFixture();
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const controllerPath='packages/brain/src/lib/native-consumer-source-selection.js';
const currentController=readFileSync(new URL('./native-consumer-source-selection.js',import.meta.url));
const fixture=mkdtempSync(join(tmpdir(),'native-selection-git-'));
const git=(...args)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false',...args],{
 cwd:fixture,encoding:'utf8',maxBuffer:32*1024*1024,
});
afterAll(()=>rmSync(fixture,{recursive:true,force:true}));
let prepareNativeConsumerSelection,EXISTING_OPS_IDENTITIES,readNativeConsumerRuntime;
try{
 // 只在本人私有克隆中替换当前被测控制器；16份collector保持历史字节，不授予当前候选资格。
 git('clone','--shared','--no-checkout',root,'.');
 git('-c','core.autocrlf=false','checkout','--detach',historical.revision);
 writeFileSync(join(fixture,controllerPath),currentController);
 git('add','--',controllerPath);
 git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','test: load current controller with consistent historical dependencies');
 symlinkSync(join(root,'node_modules'),join(fixture,'node_modules'),'dir');
 const load=path=>import(/* @vite-ignore */ pathToFileURL(join(fixture,'packages/brain/src/lib',path)).href);
 ({prepareNativeConsumerSelection}=await load('native-consumer-source-selection.js'));
 ({EXISTING_OPS_IDENTITIES}=await load('existing-ops-source.js'));
 ({readNativeConsumerRuntime}=await load('native-consumer-runtime.js'));
}catch(error){rmSync(fixture,{recursive:true,force:true});throw error;}
const revision=git('rev-parse','HEAD').trim(),tree=git('rev-parse','HEAD^{tree}').trim();
const entries=git('ls-tree','-rz','--full-tree',revision).split('\0').filter(Boolean).map(line=>{
 const [meta,path]=line.split('\t'),[mode,type,sha]=meta.split(' ');return {path,mode,type,sha};
});
const read=path=>git('show',`${revision}:${path}`);
const textCache=new Map(),q={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision};
const workflow=EXISTING_OPS_IDENTITIES[1].workflow_id;
const pool={query:async sql=>{
 if(sql.startsWith('SELECT * FROM map_scope_repositories'))return {rows:[{repo:q.repo,adapter_config:{}}]};
 if(sql.startsWith('SELECT * FROM workflow_definition_versions'))return {rows:['a','b'].map(id=>({id,workflow_id:workflow,payload:{definition_scope:'consumer_evidence',source_scope:q.scope}}))};
 if(sql.startsWith('SELECT * FROM workflows'))return {rows:[{id:workflow,current_definition_version_id:null}]};
 throw Error(`unexpected SQL ${sql}`);
}};
function clock(){
 vi.useFakeTimers();vi.setSystemTime(0);
 // Node 原生 AbortSignal.timeout 不由 Vitest 时钟驱动；仅换计时后端，保留调用方给出的真实预算。
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('Timeout','TimeoutError')),ms);return c.signal;});
}
function source(delay=200){
 const state={delay,calls:0};
 return {state,resolveToken:async()=> 'fixture-only',fetchFn:async(url,{signal})=>{
  signal.throwIfAborted();state.calls++;await vi.advanceTimersByTimeAsync(state.delay);signal.throwIfAborted();
  let value;
  if(url.endsWith(`/git/commits/${revision}`))value={sha:revision,tree:{sha:tree}};
  else if(url.endsWith(`/git/trees/${tree}?recursive=1`))value={sha:tree,truncated:false,tree:entries};
  else if(url.includes('/contents/')){
   const parsed=new URL(url),path=decodeURIComponent(parsed.pathname.split('/contents/')[1]);
   if(parsed.searchParams.get('ref')!==revision)throw Error('revision drift');
   if(!textCache.has(path))textCache.set(path,read(path));value=textCache.get(path);
  }else throw Error('unexpected source request');
  return {ok:true,json:async()=>value,text:async()=>value};
 }};
}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
it('已知历史Git fixture全proof经历超过120秒的逐请求延迟仍在540秒预算内完成',async()=>{
 const changed=currentController.equals(Buffer.from(historical.read(controllerPath)))?[]:[controllerPath];
 expect(git('diff','--name-only',historical.revision,revision).trim().split('\n').filter(Boolean)).toEqual(changed);
 expect(Buffer.from(read(controllerPath))).toEqual(currentController);
 const runtime=readNativeConsumerRuntime();expect(runtime.files).toHaveLength(16);
 expect(runtime.files.some(file=>file.path===controllerPath)).toBe(false);
 for(const file of runtime.files){
  expect(read(file.path)).toBe(historical.read(file.path));
  expect(createHash('sha256').update(read(file.path)).digest('hex')).toBe(file.sha256);
 }
 clock();const options=source(),proof=await prepareNativeConsumerSelection(pool,q,options);
 expect(Date.now()).toBeGreaterThan(120000);expect(Date.now()).toBeLessThan(540000);
 expect(proof?.revision).toBe(revision);expect(proof.tree).toBe(tree);expect(proof.proof.consumers.every(c=>c.status==='verified')).toBe(true);
 expect(options.state.calls).toBeGreaterThan(1000);
},60000);
it('超过有界540秒仍拒绝，失败不缓存，下一次同transport恢复可重新证明',async()=>{
 clock();const options=source(1000),first=await prepareNativeConsumerSelection(pool,q,options);
 expect(first).toBeNull();expect(Date.now()).toBe(540000);
 const failedCalls=options.state.calls;options.state.delay=1;
 const recovered=await prepareNativeConsumerSelection(pool,q,options);
 expect(recovered?.revision).toBe(revision);expect(options.state.calls).toBeGreaterThan(failedCalls);
 const completedCalls=options.state.calls;
 expect(await prepareNativeConsumerSelection(pool,q,options)).toBe(recovered);
 expect(options.state.calls).toBe(completedCalls);
},60000);
it('单个请求15秒预算仍生效，不因整体预算扩大而放任挂起请求',async()=>{
 clock();const options=source(16000);
 expect(await prepareNativeConsumerSelection(pool,q,options)).toBeNull();expect(options.state.calls).toBe(1);
},60000);
