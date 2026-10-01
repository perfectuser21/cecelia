const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash,createHmac,randomUUID}=require('node:crypto');
const {runLinuxScriptCanary}=require('./linux-script-canary.cjs');
const {verifyLinuxScriptPermit}=require('./linux-script-permit.cjs');
const {fixture}=require('./linux-script-test-fixture.cjs');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const {createCanaryJournal}=require('./linux-pool-canary.cjs');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const roots=[];afterEach(()=>{for(const p of roots.splice(0))fs.rmSync(p,{recursive:true,force:true});});
function setup(){
 const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'ls-canary-'));roots.push(root);
 const key='b'.repeat(64),nonce='c'.repeat(64),calls=[];let lost=false,removeFailure=false;
 const deployment={pool:f.record.pool,revision:'d'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:f.record.identity.worker_boot_id,
  daemon_id:f.record.daemon_id,execution_enabled:true,profiles:{safe:{profile:f.record.profile,image_id:f.record.image_id,execution_version_id:f.record.identity.execution_version_id,execution_grant_id:f.record.identity.execution_grant_id}}};
 const config={deployment,key,workerToken:'e'.repeat(64)};
 const expected={machine_registry_id:f.record.pool.machine_registry_id,pool_config_digest:validateLinuxPoolProfile(f.record.pool).config_digest,revision:deployment.revision,
  host_boot_id:deployment.host_boot_id,worker_boot_id:deployment.worker_boot_id,daemon_id:deployment.daemon_id,
  execution_version_id:f.record.identity.execution_version_id,execution_grant_id:f.record.identity.execution_grant_id,profile_digest:hash(f.record.profile)};
 let state=null;
 const client=Object.fromEntries(['start','inspect','cancel'].map(action=>[action,async input=>{
  const {permit,...body}=input;verifyLinuxScriptPermit({key,expected,action,body,permit});calls.push(action);
  if(action==='start'){state={...body,status:'running',container_id:'a'.repeat(64)};if(lost)throw Error('response lost');}
  if(action==='inspect')state={...state,status:'exited',terminal:{exit_code:0,stdout:state?.job?.cmd.split("'")[3]+'\n',stderr:'',timed_out:false}};
  if(action==='cancel'){if(removeFailure)throw Error('cleanup unknown');state={...state,...body,status:'cleaned',absent:true,tombstoned:true};}
  const receipt={...state,request_nonce:body.request_nonce};return {status:200,envelope:{receipt,signature:createHmac('sha256',key).update(JSON.stringify(receipt)).digest('hex')}};
 }]));
 const deps={platform:'linux',getuid:()=>0,lockHeld:true,stateRoot:root,rootUid:process.getuid(),loadConfiguration:()=>config,client,
  identity:async()=>({worker_boot_id:deployment.worker_boot_id}),sleep:async()=>{},collectProof:async input=>({schema_version:'linux-script-proof/v1',execution:false,script_verified:true,
   machine_registry_id:expected.machine_registry_id,config_digest:expected.pool_config_digest,host_boot_id:expected.host_boot_id,daemon_id:expected.daemon_id,
   container_id:input.containerId,identity:input.identity,profile_digest:expected.profile_digest})};
 return {root,nonce,key,calls,config,deps,set lost(v){lost=v;},set removeFailure(v){removeFailure=v;}};
}
describe('真实受限adapter专用canary编排',()=>{
 it('写盘与读取使用同一边界，超限不覆盖已有可读日志',()=>{
  const x=setup(),store=createCanaryJournal(x.root,process.getuid(),{maxBytes:256}),state={schema_version:'linux-pool-canary-state/v1',nonce:x.nonce,cleanup_confirmed:true};
  store.save(state);expect(()=>store.save({...state,extra:'x'.repeat(256)})).toThrow();expect(store.read(x.nonce)).toEqual(state);
 });
 it('最大32个profile完成后journal可重读，同nonce不重启且新nonce可验收',async()=>{
  const x=setup(),entry=x.config.deployment.profiles.safe;
  x.config.deployment.profiles=Object.fromEntries(Array.from({length:32},(_,n)=>['safe'+n,entry]));
  const first=await runLinuxScriptCanary({nonce:x.nonce},x.deps);expect(first.receipt.cases).toHaveLength(32);
  expect(fs.statSync(path.join(x.root,x.nonce+'.json')).size).toBeGreaterThan(131072);
  expect(await runLinuxScriptCanary({nonce:x.nonce},x.deps)).toEqual(first);expect(x.calls.filter(a=>a==='start')).toHaveLength(32);
  expect((await runLinuxScriptCanary({nonce:'f'.repeat(64)},x.deps)).receipt.cases).toHaveLength(32);
 });
 it('持久意图→真实脚本入口→独立宿主证明→实际输出→精确清理后才签回执',async()=>{
  const x=setup(),envelope=await runLinuxScriptCanary({nonce:x.nonce},x.deps);
  expect(x.calls).toEqual(['start','inspect','cancel']);expect(envelope.receipt).toMatchObject({schema_version:'linux-script-canary/v1',nonce:x.nonce,execution:false,script_adapter_verified:true,cleanup_confirmed:true});
  expect(envelope.receipt.cases[0].terminal.stdout).toBe(x.nonce+':safe\n');
  expect(envelope.signature).toBe(createHmac('sha256',x.key).update(JSON.stringify(envelope.receipt)).digest('hex'));
  expect(JSON.stringify(envelope)).not.toContain(x.key);
  const disk=JSON.parse(fs.readFileSync(path.join(x.root,x.nonce+'.json')));expect(disk.cleanup_confirmed).toBe(true);expect(JSON.stringify(disk)).not.toContain(x.key);
  await runLinuxScriptCanary({nonce:x.nonce},x.deps);expect(x.calls.filter(a=>a==='start')).toHaveLength(1);
 });
 it('启动回执丢失即清理已知身份，原nonce不重新跑；清理未知阻止新nonce',async()=>{
  const x=setup();x.lost=true;x.removeFailure=true;await expect(runLinuxScriptCanary({nonce:x.nonce},x.deps)).rejects.toThrow('linux_script_canary_unconfirmed');
  await expect(runLinuxScriptCanary({nonce:'f'.repeat(64)},x.deps)).rejects.toThrow();expect(x.calls.filter(a=>a==='start')).toHaveLength(1);
  x.removeFailure=false;x.config.deployment.execution_enabled=false;x.config.deployment.profiles={};
  await expect(runLinuxScriptCanary({nonce:x.nonce},x.deps)).rejects.toThrow();expect(x.calls.filter(a=>a==='start')).toHaveLength(1);
  expect(JSON.parse(fs.readFileSync(path.join(x.root,x.nonce+'.json'))).cleanup_confirmed).toBe(true);
 });
 it('启动未抵达也按认证取消建立墓碑；不因inspect缺失就伪造清理证明',async()=>{
  const x=setup();x.deps.client.start=async()=>{x.calls.push('start');throw Error('not delivered');};
  await expect(runLinuxScriptCanary({nonce:x.nonce},x.deps)).rejects.toThrow();
  expect(x.calls).toContain('cancel');expect(JSON.parse(fs.readFileSync(path.join(x.root,x.nonce+'.json'))).cleanup_confirmed).toBe(true);
 });
 it('错误宿主证明、输出、root签名或过程中配置换代都不能签成功',async()=>{
  for(const kind of ['proof','output','signature','configuration']){
   const x=setup();if(kind==='proof')x.deps.collectProof=async()=>({});
   if(kind==='configuration'){const collect=x.deps.collectProof;x.deps.collectProof=async input=>{const result=await collect(input);x.config.deployment.revision='f'.repeat(40);return result;};}
   if(kind==='output'||kind==='signature'){const inspect=x.deps.client.inspect;x.deps.client.inspect=async b=>{const result=await inspect(b);if(kind==='output'){result.envelope.receipt.terminal.stdout='wrong';result.envelope.signature=createHmac('sha256',x.key).update(JSON.stringify(result.envelope.receipt)).digest('hex');}else result.envelope.signature='f'.repeat(64);return result;};}
   await expect(runLinuxScriptCanary({nonce:x.nonce},x.deps)).rejects.toThrow('linux_script_canary_unconfirmed');
  }
 });
 it('非root/无锁/nonce非法零script调用',async()=>{
  for(const patch of [{getuid:()=>501},{lockHeld:false},{platform:'darwin'}]){const x=setup();await expect(runLinuxScriptCanary({nonce:x.nonce},{...x.deps,...patch})).rejects.toThrow();expect(x.calls).toEqual([]);}
 });
});
