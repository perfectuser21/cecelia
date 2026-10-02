'use strict';
const fs=require('node:fs');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const {createHash,createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const {createCanaryJournal,readLinuxPoolIdentity,assertCanaryDirectory}=require('./linux-pool-canary.cjs');
const {readInstalledFile}=require('./linux-pool-server.cjs');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const {collectLinuxScriptProof}=require('./linux-pool-proof.cjs');
const {createLinuxScriptBridgeClient}=require('./linux-script-bridge.cjs');
const {signLinuxScriptPermit}=require('./linux-script-permit.cjs');
const HEX=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=()=>{throw Error('linux_script_canary_unconfirmed');};
const run=(c,a)=>promisify(execFile)(c,a,{shell:false,timeout:5000,maxBuffer:65536});
async function configuration(){
 const read=(p,mode,owner,maxBytes)=>readInstalledFile(p,{mode,owner,maxBytes});
 const deployment=JSON.parse(read('/etc/cecelia/script-runtime.json',0o600,0,65536));
 const pool=JSON.parse(read('/etc/cecelia/script-pool.json',0o600,0,65536));
 if(hash(pool)!==hash(deployment.pool))fail();
 const fields=String((await run('/usr/bin/getent',['passwd','_cecelia'])).stdout).trim().split(':'),uid=Number(fields[2]);
 if(fields[0]!=='_cecelia'||!Number.isSafeInteger(uid)||uid<=0)fail();
 return {deployment,key:read('/etc/cecelia/script-execution.key',0o600,0,64),workerToken:read('/etc/cecelia/fleet-worker.token',0o600,uid,64)};
}
async function runLinuxScriptCanary({nonce,cleanupReceipt=false},deps={}){
 if((deps.platform??process.platform)!=='linux'||(deps.getuid??process.getuid)()!==0||!deps.lockHeld||!HEX.test(nonce??''))fail();
 const load=deps.loadConfiguration??configuration,config=structuredClone(await load()),d=config.deployment,p=validateLinuxPoolProfile(d.pool);
 if(!HEX.test(config.key??'')||!HEX.test(config.workerToken??'')||config.key===config.workerToken)fail();
 const binding=hash(config),store=createCanaryJournal(deps.stateRoot??'/var/lib/cecelia/script-canary',deps.rootUid??0,{schemaVersion:'linux-script-canary-state/v1',maxBytes:2*1024*1024});
 let state=store.read(nonce);
 if(state?.envelope){if(state.config_binding!==binding)fail();return state.envelope;}
 const client=deps.client??createLinuxScriptBridgeClient(),collect=deps.collectProof??collectLinuxScriptProof;
 const identity=()=> (deps.identity??readLinuxPoolIdentity)({profile:p,token:config.workerToken,revision:d.revision,nonce});
 const pause=deps.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
 const cleanupConfirmed=()=>Array.isArray(state.cases)&&state.cases.length>0&&state.cases.length<=32&&state.cases.every(r=>{
  if(r.attempted===false)return r.container_id===null&&r.cleanup==null;
  const c=r.cleanup;
  return r.attempted===true&&(r.container_id===null||HEX.test(r.container_id??''))&&c?.status==='cleaned'
   &&c.absent===true&&c.tombstoned===true&&UUID.test(c.challenge??'')&&c.container_id===r.container_id
   &&Object.entries(r.identity).every(([k,v])=>c[k]===v);
 });
 async function call(action,r,extras={}){
  const body={...r.identity,...extras,request_nonce:randomUUID()},permit=signLinuxScriptPermit({key:config.key,expected:r.expected,action,body});
  const reply=await client[action]({...body,permit}),e=reply.envelope,receipt=e?.receipt;
  if(!receipt||!HEX.test(e.signature??'')||!timingSafeEqual(Buffer.from(e.signature,'hex'),createHmac('sha256',config.key).update(JSON.stringify(receipt)).digest())
   ||receipt.request_nonce!==body.request_nonce||Object.entries(r.identity).some(([k,v])=>receipt[k]!==v)||reply.status!==200)fail();
  return receipt;
 }
 async function clean(r){
  if(!r.attempted||r.cleanup)return;
  if(!r.container_id){
   try{const found=await call('inspect',r);if(found.container_id!==null&&!HEX.test(found.container_id??''))fail();r.container_id=found.container_id;store.save(state);}
   catch{/* 只允许继续请求认证cancel；inspect失败本身绝不算缺失证明。 */}
  }
  const challenge=randomUUID(),receipt=await call('cancel',r,{container_id:r.container_id,challenge});
  if(receipt.container_id!==r.container_id||receipt.status!=='cleaned'||receipt.absent!==true||receipt.tombstoned!==true||receipt.challenge!==challenge)fail();
  r.cleanup=receipt;state.cleanup_confirmed=cleanupConfirmed();store.save(state);
 }
 if(state){
  for(const r of state.cases)try{await clean(r);}catch{/* 未决资源保持占位。 */}
  const confirmed=cleanupConfirmed();if(state.cleanup_confirmed!==confirmed){state.cleanup_confirmed=confirmed;store.save(state);}
  if(cleanupReceipt&&confirmed){
   if(!state.cleanup_envelope){const e=state.cases[0].expected;
    const receipt={schema_version:'linux-script-canary-cleanup/v1',nonce,machine_id:state.cases[0].identity.machine_id,
     ...Object.fromEntries(['machine_registry_id','pool_config_digest','revision','host_boot_id','worker_boot_id','daemon_id','execution_version_id'].map(k=>[k,e[k]])),
     started_at:state.started_at,completed_at:new Date().toISOString(),execution:false,cleanup_confirmed:true,
     cases:state.cases.map(r=>({identity:r.identity,profile_digest:r.expected.profile_digest,container_id:r.container_id,not_started:!r.attempted,cleanup:r.cleanup??null}))};
    state.cleanup_envelope={receipt,signature:createHmac('sha256',config.key).update(JSON.stringify(receipt)).digest('hex')};store.save(state);
   }return state.cleanup_envelope;
  }fail();
 }
 if(!p.execution_budget_available||d.execution_enabled!==true||!d.profiles||Array.isArray(d.profiles)
  ||Object.keys(d.profiles).length<1||Object.keys(d.profiles).length>32)fail();
 const entries=Object.entries(d.profiles);if(entries.some(([id,e])=>! /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)||!UUID.test(e.execution_version_id??'')||!UUID.test(e.execution_grant_id??'')
  ||e.execution_version_id!==entries[0][1].execution_version_id))fail();
 store.assertNoPending();
 if((await identity()).worker_boot_id!==d.worker_boot_id)fail();
 state={schema_version:'linux-script-canary-state/v1',nonce,config_binding:binding,cleanup_confirmed:false,started_at:new Date().toISOString(),cases:entries.map(([id,entry])=>{
  const reservation=randomUUID(),job={profile:id,cmd:`printf '%s\\n' '${nonce}:${id}'; sleep 8`,timeout_sec:20,env:{}};
  const bound={reservation_id:reservation,intent_id:randomUUID(),launch_generation:1,machine_id:p.machine_id,owner_key:'script-'+reservation+'-a1',
   config_digest:hash({job,profile_digest:hash(entry.profile)}),worker_id:p.machine_id,worker_boot_id:d.worker_boot_id,execution_version_id:entry.execution_version_id,execution_grant_id:entry.execution_grant_id,profile_id:id};
  const expected={machine_registry_id:p.machine_registry_id,pool_config_digest:p.config_digest,revision:d.revision,host_boot_id:d.host_boot_id,worker_boot_id:d.worker_boot_id,
   daemon_id:d.daemon_id,execution_version_id:entry.execution_version_id,execution_grant_id:entry.execution_grant_id,profile_digest:hash(entry.profile)};
  return {identity:bound,expected,profile:entry.profile,job,attempted:false,container_id:null};
 })};store.save(state);
 try{
  for(const r of state.cases){
   r.attempted=true;state.cleanup_confirmed=false;store.save(state);
   const started=await call('start',r,{job:r.job});if(!HEX.test(started.container_id??'')||started.status!=='running')fail();r.container_id=started.container_id;store.save(state);
   r.proof=await collect({profile:d.pool,scriptProfile:r.profile,identity:r.identity,containerId:r.container_id,expectedHostBootId:d.host_boot_id,expectedDaemonId:d.daemon_id});
   if(r.proof?.schema_version!=='linux-script-proof/v1'||r.proof.execution!==false||r.proof.script_verified!==true||hash(r.proof.identity)!==hash(r.identity)
    ||r.proof.container_id!==r.container_id||r.proof.profile_digest!==r.expected.profile_digest||r.proof.host_boot_id!==d.host_boot_id||r.proof.daemon_id!==d.daemon_id
    ||r.proof.machine_registry_id!==p.machine_registry_id||r.proof.config_digest!==p.config_digest)fail();
   const deadline=Date.now()+15000;let found;
   do{found=await call('inspect',r);if(found.status==='exited')break;if(Date.now()>deadline)fail();await pause(100);}while(true);
   r.terminal=found.terminal;if(r.terminal?.exit_code!==0||r.terminal.timed_out===true||r.terminal.stdout!==nonce+':'+r.identity.profile_id+'\n'||r.terminal.stderr!=='')fail();
   await clean(r);
  }
  if(hash(await load())!==binding||(await identity()).worker_boot_id!==d.worker_boot_id||!state.cleanup_confirmed)fail();
  const receipt={schema_version:'linux-script-canary/v1',nonce,machine_registry_id:p.machine_registry_id,machine_id:p.machine_id,pool_config_digest:p.config_digest,
   revision:d.revision,host_boot_id:d.host_boot_id,worker_boot_id:d.worker_boot_id,daemon_id:d.daemon_id,execution_version_id:entries[0][1].execution_version_id,
   execution:false,script_adapter_verified:true,cleanup_confirmed:true,started_at:state.started_at,completed_at:new Date().toISOString(),
   cases:state.cases.map(r=>({identity:r.identity,profile_digest:r.expected.profile_digest,container_id:r.container_id,proof:r.proof,terminal:r.terminal,cleanup:r.cleanup}))};
  state.envelope={receipt,signature:createHmac('sha256',config.key).update(JSON.stringify(receipt)).digest('hex')};store.save(state);return state.envelope;
 }catch{for(const r of state.cases)try{await clean(r);}catch{/* 不猜测消失，不删除未知容器。 */}fail();}
}
if(require.main===module){
 (async()=>{
  if(process.platform!=='linux'||process.getuid()!==0)fail();const a=process.argv.slice(2),cleanupReceipt=a[2]==='--cleanup-receipt';if(cleanupReceipt)a.splice(2,1);
  if(a[0]!=='--nonce'||!HEX.test(a[1]??'')||![2,3].includes(a.length))fail();
  if(a.length===2){
   assertCanaryDirectory('/run/cecelia',0);const lock='/run/cecelia/linux-script-canary.flock';let fd;
   try{fd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o777)!==0o600||s.nlink!==1)fail();}finally{if(fd!==undefined)fs.closeSync(fd);}
   const child=spawn('/usr/bin/flock',['--nonblock',lock,process.execPath,__filename,...a,...(cleanupReceipt?['--cleanup-receipt']:[]),'--under-lock'],{stdio:'inherit',env:{PATH:'/usr/bin:/bin',HOME:'/'}});
   child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});return;}
  if(a[2]!=='--under-lock'||await fs.promises.readlink('/proc/'+process.ppid+'/exe')!=='/usr/bin/flock')fail();
  const value=await runLinuxScriptCanary({nonce:a[1],cleanupReceipt},{lockHeld:true});process.stdout.write(JSON.stringify(value)+'\n');
 })().catch(()=>{process.stderr.write('linux_script_canary_unconfirmed\n');process.exitCode=1;});
}
module.exports={runLinuxScriptCanary};
