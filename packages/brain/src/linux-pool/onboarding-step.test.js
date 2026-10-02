import {it,expect} from 'vitest';
import {randomUUID,createHmac} from 'node:crypto';
import {createLinuxOnboardingStep} from './onboarding-step.js';
function setup(){
 const id=randomUUID(),task={id:randomUUID()},machine={id,name:'new-linux',metadata:{role:'worker',onboarding:{request:{address:'100.64.0.2'}},node_health:{os:'linux',observed_at:new Date().toISOString(),resources:{cpu_cores:4,memory_total_bytes:8*2**30}}}};
 let state={phase:'probe',nonce:'a'.repeat(64),intent_id:randomUUID(),revision:'b'.repeat(40),expected_version_id:null},creates=0;const calls=[];
 const save=async s=>{state=structuredClone(s);};
 const ssh=async(_id,_request,p)=>{calls.push(p.action);if(p.action==='probe')return {machine_registry_id:id,nonce:p.nonce,image:p.image,image_id:'sha256:'+'c'.repeat(64),os:'linux',observed_at:new Date().toISOString(),resources:{cpu_cores:4,memory_total_bytes:8*2**30}};
  if(p.action==='bootstrap'){const receipt={schema_version:'linux-onboarding-install/v1',nonce:p.nonce,machine_registry_id:id,host_boot_id:randomUUID(),daemon_id:'daemon',image_id:'sha256:'+'c'.repeat(64),image:p.pool.canary_image,observed_at:new Date().toISOString(),intent_id:p.intent_id,revision:p.revision,worker_boot_id:randomUUID(),pool:p.pool,installed:true,execution:false,os:'linux',resources:{cpu_cores:4,memory_total_bytes:8*2**30}};return {receipt,signature:createHmac('sha256','f'.repeat(64)).update(JSON.stringify(receipt)).digest('hex')};}
  if(p.action==='runtime')return {written:true,execution:false,nonce:p.nonce};return {receipt:{cleanup_confirmed:true},signature:'f'.repeat(64)};};
 const deps={recover:async()=>false,pool:{query:async()=>({rows:[]})},ssh,credentials:async(_id,prior,persist)=>{creates++;await persist({phase:'creating'});return {item_id:'a'.repeat(26),worker_credential_file:'/etc/worker',execution_credential_file:'/etc/key'};},
  readSecret:p=>p==='/etc/worker'?'e'.repeat(64):'f'.repeat(64),artifacts:{capture:()=>({revision:state.revision,digest:'6'.repeat(64),files:{'module.cjs':'trusted'},program:'fixed program'}),read:()=>({files:{'module.cjs':'trusted'},program:'fixed program'})},
  writer:{pool:()=>({policy_digest:'1'.repeat(64)}),runtime:()=>({policy_digest:'2'.repeat(64)})},
  poolAuthorization:{challenge:async()=>({id:randomUUID(),nonce:'c'.repeat(64)}),attest:async()=>({id:randomUUID()}),activate:async()=>({execution:false,execution_version_id:randomUUID()})},
  runtimeAuthorization:{prepare:async()=>({id:randomUUID(),nonce:'d'.repeat(64),runtime_configuration:{worker_boot_id:'bound'},execution_version_id:randomUUID(),grant_ids:{shell:randomUUID()}}),activate:async()=>({execution:true,authorization_state:'active',execution_version_id:randomUUID(),expires_at:new Date(Date.now()+86400000).toISOString()})}};
 return {id,task,machine,save,calls,deps,get state(){return state;},get creates(){return creates;}};
}
it('从观测自动推进到真实授权服务；仅最后active可完成，内部nonce/version无需浏览器输入',async()=>{
 const x=setup(),step=createLinuxOnboardingStep(x.deps);const phases=[];
 for(let i=0;i<15&&x.state.phase!=='active';i++){phases.push(x.state.phase);await step(x.task,x.machine,x.state,x.save);}
 expect(x.state.phase).toBe('active');expect(x.state.active.execution).toBe(true);expect(x.creates).toBe(1);
 expect(x.calls).toEqual(['probe','bootstrap','pool_canary','runtime','script_canary']);expect(phases).toContain('pool_ready');expect(phases).toContain('script_activate');
 expect(JSON.stringify(x.state)).not.toContain('e'.repeat(64));expect(JSON.stringify(x.state)).not.toContain('f'.repeat(64)+'f');
});
it('首次SSH之前绑定当前镜像工件，旧队列revision不能搭配新源码冒充旧安装',async()=>{
 const x=setup(),revision='9'.repeat(40),artifact={revision,digest:'8'.repeat(64),files:{'module.cjs':'fixed source'},program:'fixed remote program'};
 x.deps.artifacts={capture:()=>artifact,read:()=>artifact};const ssh=x.deps.ssh;
 x.deps.ssh=async(...args)=>{expect(x.state.revision).toBe(revision);expect(x.state.artifact_digest).toBe(artifact.digest);return ssh(...args);};
 await createLinuxOnboardingStep(x.deps)(x.task,x.machine,x.state,x.save);
});
it('已有安装intent后即使镜像换代也使用缓存工件与远端程序，缺缓存不尝试新源码',async()=>{
 const x=setup(),step=createLinuxOnboardingStep(x.deps);await step(x.task,x.machine,x.state,x.save);await step(x.task,x.machine,x.state,x.save);
 const prior=structuredClone(x.state),ssh=x.deps.ssh,old={files:{'module.cjs':'old fixed source'},program:'old fixed remote'};
 x.deps.artifacts={capture:()=>{throw Error('do not recapture');},read:(revision,digest)=>{expect(revision).toBe(prior.revision);expect(digest).toBe(prior.artifact_digest);return old;}};
 x.deps.ssh=async(...args)=>{expect(args[2].revision).toBe(prior.revision);expect(args[2].sources).toEqual(old.files);expect(args[3].source).toBe(old.program);return ssh(...args);};
 await createLinuxOnboardingStep(x.deps)(x.task,x.machine,x.state,x.save);expect(x.state.phase).toBe('deployment');
 await x.save(prior);x.deps.artifacts.read=()=>{throw Error('linux_pool_artifact_unavailable');};const before=x.calls.length;
 await expect(createLinuxOnboardingStep(x.deps)(x.task,x.machine,x.state,x.save)).rejects.toThrow();expect(x.calls).toHaveLength(before);expect(x.state.intent_id).toBe(prior.intent_id);
});
it('SSH安装未知保留同一intent/phase重读；错误回签零部署写入',async()=>{
 const x=setup(),step=createLinuxOnboardingStep(x.deps);await step(x.task,x.machine,x.state,x.save);await step(x.task,x.machine,x.state,x.save);
 const before=structuredClone(x.state);x.deps.ssh=async()=>{throw Error('unknown');};
 await expect(createLinuxOnboardingStep(x.deps)(x.task,x.machine,x.state,x.save)).rejects.toThrow();expect(x.state).toEqual(before);
 x.deps.ssh=async()=>({receipt:{installed:true},signature:'a'.repeat(64)});
 await expect(createLinuxOnboardingStep(x.deps)(x.task,x.machine,x.state,x.save)).rejects.toThrow('linux_pool_installation_unconfirmed');expect(x.state.phase).toBe('bootstrap');
});
it('任务JSONB重排后仍下发原序列化profile，许可digest不能变代',async()=>{
 const x=setup();const config={profiles:{shell:{profile:{image:'pinned',cpus:1,memoryBytes:256}}}};
 x.deps.runtimeAuthorization.prepare=async()=>({id:randomUUID(),nonce:'d'.repeat(64),runtime_configuration:config});
 const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
 let state={...x.state,phase:'script_prepare'};const save=async s=>{state=sort(s);};
 const step=createLinuxOnboardingStep(x.deps);await step(x.task,x.machine,state,save);
 x.deps.ssh=async(_id,_r,p)=>{expect(JSON.stringify(p.configuration)).toBe(JSON.stringify(config));return {written:true,execution:false,nonce:state.nonce};};
 await createLinuxOnboardingStep(x.deps)(x.task,x.machine,state,save);
});
it('续验撤销后等旧预约精确释放，不触安装或canary；未知占位不得自动释放',async()=>{
 const x=setup();let occupied=true,revokes=0;
 x.deps.pool.query=async()=>({rows:occupied?[{id:randomUUID()}]:[]});x.deps.runtimeAuthorization.retire=async()=>{revokes++;};
 await x.save({...x.state,phase:'renew_revoke',previous_runtime_id:randomUUID()});const step=createLinuxOnboardingStep(x.deps);
 await step(x.task,x.machine,x.state,x.save);expect(revokes).toBe(1);expect(x.state.phase).toBe('renew_wait');
 await step(x.task,x.machine,x.state,x.save);expect(x.state.phase).toBe('renew_wait');expect(x.calls).toEqual([]);
 occupied=false;await step(x.task,x.machine,x.state,x.save);expect(x.state.phase).toBe('refresh_installation');
});
it('过期挑战仅在恢复服务已验签精确清理后重建，未知保留原挑战',async()=>{
 const x=setup();await x.save({...x.state,phase:'script_activate',runtime_json:JSON.stringify({id:randomUUID()}),script_envelope_json:'{}'});
 const before=structuredClone(x.state);x.deps.recover=async()=>{throw Error('unconfirmed');};
 await expect(createLinuxOnboardingStep(x.deps)(x.task,x.machine,x.state,x.save)).rejects.toThrow();expect(x.state).toEqual(before);
 x.deps.recover=async()=>true;await createLinuxOnboardingStep(x.deps)(x.task,x.machine,x.state,x.save);
 expect(x.state.phase).toBe('script_prepare');expect(x.state.runtime_json).toBe(null);expect(x.calls).toEqual([]);
});
