import {afterEach,expect,it,vi} from 'vitest';
import {prepareNativeConsumerSelection} from './native-consumer-source-selection.js';
import {EXISTING_OPS_IDENTITIES} from './existing-ops-source.js';
import {readFixedExistingOpsGitFixture} from './__tests__/helpers/fixed-existing-ops-git-fixture.js';
const {revision,tree,entries,read}=readFixedExistingOpsGitFixture();
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
 clock();const options=source(),proof=await prepareNativeConsumerSelection(pool,q,options);
 expect(Date.now()).toBeGreaterThan(120000);expect(Date.now()).toBeLessThan(540000);
 expect(proof?.revision).toBe(revision);expect(proof.proof.consumers.every(c=>c.status==='verified')).toBe(true);
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
