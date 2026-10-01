'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFile,spawn}=require('node:child_process');
const {promisify}=require('node:util');
const {createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const {collectLinuxPoolProof}=require('./linux-pool-proof.cjs');
const {readInstalledFile}=require('./linux-pool-server.cjs');
const {readBounded}=require('./linux-resource-probe.cjs');
const HEX=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const ROOT='/var/lib/cecelia/pool-canary';
const fail=()=>{throw Error('linux_pool_canary_unconfirmed');};
const command=(file,args)=>promisify(execFile)(file,args,{shell:false,timeout:5000,maxBuffer:65536,
 env:{PATH:'/usr/bin:/bin',HOME:'/',DOCKER_HOST:'unix:///var/run/docker.sock'}});
function privateDirectory(directory,uid,boundary='/',create=true){
 const parent=path.dirname(directory);if(directory!==boundary&&directory!=='/')privateDirectory(parent,uid,boundary,false);
 try{const s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==uid||(s.mode&0o022))fail();}
 catch(error){if(error.code!=='ENOENT')throw error;if(!create)fail();fs.mkdirSync(directory,{mode:0o700});}
}
function journal(root,uid,{schemaVersion='linux-pool-canary-state/v1'}={}){
 privateDirectory(root,uid,uid===0?'/':root);
 const filename=nonce=>path.join(root,nonce+'.json');
 const read=nonce=>{let fd;try{
  fd=fs.openSync(filename(nonce),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.uid!==uid||(stat.mode&0o777)!==0o600||stat.nlink!==1||stat.size>131072)fail();
  const buffer=Buffer.alloc(stat.size+1),bytes=fs.readSync(fd,buffer,0,buffer.length,0);if(bytes!==stat.size)fail();
  const value=JSON.parse(buffer.subarray(0,bytes));if(value.nonce!==nonce||value.schema_version!==schemaVersion)fail();return value;
 }catch(error){if(error.code==='ENOENT')return null;throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}};
 const save=state=>{const dest=filename(state.nonce),temp=dest+'.'+randomUUID();let fd;try{
  fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,dest);
  const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}};
 return {read,save,assertNoPending(){for(const name of fs.readdirSync(root)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const state=read(name.slice(0,-5));if(!state?.cleanup_confirmed)fail();}}};
}
async function configuration(run){
 const fields=String((await run('/usr/bin/getent',['passwd','_cecelia'])).stdout).trim().split(':'),owner=Number(fields[2]);
 if(fields[0]!=='_cecelia'||!Number.isSafeInteger(owner)||owner<=0)fail();
 return {input:JSON.parse(readInstalledFile('/etc/cecelia/fleet-pool.json',{mode:0o600,owner,maxBytes:65536})),
  token:readInstalledFile('/etc/cecelia/fleet-worker.token',{mode:0o600,owner,maxBytes:64}),
  revision:readInstalledFile('/usr/local/libexec/cecelia/fleet-worker/revision',{mode:0o644,owner:0,maxBytes:41})};
}
async function identity({profile,token,revision,nonce,fetchFn=fetch}){
 const controller=new AbortController();let reader,timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(Error('linux_pool_canary_identity_unavailable'));},5000);});
 try{
  const host=profile.endpoint_host.includes(':')?'['+profile.endpoint_host+']':profile.endpoint_host;
  const response=await Promise.race([fetchFn(`http://${host}:5231/v1/pool/identity`,{method:'POST',redirect:'error',signal:controller.signal,
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({nonce})}),timeout]);
  if(!response.body?.getReader)fail();reader=response.body.getReader();const parts=[];let bytes=0;
  for(;;){const item=await Promise.race([reader.read(),timeout]);if(item.done)break;bytes+=item.value.byteLength;if(bytes>8192){controller.abort();void reader.cancel().catch(()=>{});fail();}parts.push(Buffer.from(item.value));}
  if(!response.ok)fail();const envelope=JSON.parse(Buffer.concat(parts).toString()),r=envelope.receipt;
  if(!r||!HEX.test(envelope.signature??'')||!timingSafeEqual(Buffer.from(envelope.signature,'hex'),createHmac('sha256',token).update(JSON.stringify(r)).digest())
   ||r.schema_version!=='linux-pool-identity/v1'||r.nonce!==nonce||r.machine_registry_id!==profile.machine_registry_id||r.machine_id!==profile.machine_id
   ||r.config_digest!==profile.config_digest||r.revision!==revision||r.execution!==false||!UUID.test(r.worker_boot_id??'')
   ||!Number.isFinite(Date.parse(r.observed_at))||Date.now()-Date.parse(r.observed_at)>10000||Date.parse(r.observed_at)-Date.now()>1000)fail();
  return r;
 }finally{clearTimeout(timer);controller.abort();}
}
function verifyObject(container,state){
 if(!container||!HEX.test(container.Id??'')||(state.container_id&&container.Id!==state.container_id)
  ||container.Name!=='/'+state.name||container.Image!==state.image_id||container.Config?.Image!==state.image_ref
  ||!Object.entries(state.labels).every(([k,v])=>container.Config?.Labels?.[k]===v)||typeof container.State?.Running!=='boolean')fail();
 return container;
}
function verifyBeforeStart(container,state){
 verifyObject(container,state);const h=container.HostConfig,l=state.limits;
 if(container.Config.User!=='65534:65534'||container.State.Running||!h||h.Privileged!==false||h.ReadonlyRootfs!==true||h.NetworkMode!=='none'
  ||h.CgroupParent!=='cecelia-workloads.slice'||!Array.isArray(container.Mounts)||container.Mounts.length
  ||JSON.stringify(h.CapDrop)!=='["ALL"]'||JSON.stringify(h.SecurityOpt)!=='["no-new-privileges"]'
  ||h.NanoCpus!==l.cpu*1e9||h.Memory!==l.memory||h.MemorySwap!==l.memory||h.PidsLimit!==l.pids
  ||['Binds','Devices','DeviceRequests','CapAdd'].some(k=>h[k]!=null&&(!Array.isArray(h[k])||h[k].length))
  ||['PidMode','UTSMode','UsernsMode','IpcMode'].some(k=>h[k]!=null&&!['','private'].includes(h[k])))fail();
}
function acquireCanaryInstallFence({filename='/run/cecelia/linux-pool.install.lock',nonce,uid=0,underFlock=false}){
 if(!underFlock||!HEX.test(nonce??''))fail();privateDirectory(path.dirname(filename),uid,uid===0?'/':path.dirname(filename));
 try{
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let stat,value;
  try{stat=fs.fstatSync(fd);if(!stat.isFile()||stat.uid!==uid||(stat.mode&0o777)!==0o600||stat.nlink!==1||stat.size>512)fail();value=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
  if(value.owner_kind!=='linux-pool-canary'||!HEX.test(value.nonce??''))fail();
  const current=fs.lstatSync(filename);if(current.dev!==stat.dev||current.ino!==stat.ino)fail();
  // 持有同一flock说明上次canary进程已退出；普通installer UUID锁绝不回收。
  fs.unlinkSync(filename);
 }catch(error){if(error.code!=='ENOENT')fail();}
 const fd=fs.openSync(filename,'wx',0o600);let owned;
 try{fs.writeFileSync(fd,JSON.stringify({owner_kind:'linux-pool-canary',nonce}));fs.fsyncSync(fd);owned=fs.fstatSync(fd);}finally{fs.closeSync(fd);}
 return ()=>{try{const current=fs.lstatSync(filename);if(current.dev===owned.dev&&current.ino===owned.ino)fs.unlinkSync(filename);}catch(error){if(error.code!=='ENOENT')throw error;}};
}
async function runLinuxPoolCanary({nonce},deps={}){
 if((deps.platform??process.platform)!=='linux'||(deps.getuid??process.getuid)()!==0||!deps.lockHeld||!HEX.test(nonce??''))fail();
 const run=deps.runCommand??command,read=deps.readText??readBounded,readlink=deps.readlink??fs.promises.readlink;
 if(!['/usr/lib/systemd/systemd','/lib/systemd/systemd'].includes(await readlink('/proc/1/exe')))fail();
 let host=false;try{await run('/usr/bin/systemd-detect-virt',['--container']);}catch(error){host=error.code===1&&String(error.stdout).trim()==='none';}if(!host)fail();
 for(const kind of ['cgroup','pid','mnt']){const parent=await readlink('/proc/1/ns/'+kind);if(!new RegExp('^'+kind+':\\[\\d+\\]$').test(parent)||await readlink('/proc/self/ns/'+kind)!==parent)fail();}
 const boot=String(await read('/proc/sys/kernel/random/boot_id')).trim();if(!UUID.test(boot))fail();
 const docker=async args=>(await run('/usr/bin/docker',args)).stdout;
 const daemon=async()=>{const value=JSON.parse(await docker(['info','--format','{{json .}}']));if(value.CgroupDriver!=='systemd'||value.CgroupVersion!=='2'||typeof value.ID!=='string'||!value.ID||value.ID.length>256)fail();return value.ID;};
 const daemonId=await daemon();
 const store=journal(deps.stateRoot??ROOT,deps.rootUid??0);let state=store.read(nonce);
 if(state?.envelope){
  if(state.cleanup_confirmed!==true||state.phase!=='complete'||state.envelope.receipt?.daemon_id!==daemonId)fail();
  const config=await(deps.loadConfiguration??(()=>configuration(run)))(),profile=validateLinuxPoolProfile(config.input),r=state.envelope.receipt;
  if(!profile.execution_budget_available||!HEX.test(config.token??'')||!r||r.nonce!==nonce||r.machine_registry_id!==profile.machine_registry_id
   ||r.config_digest!==profile.config_digest||r.revision!==config.revision||!HEX.test(state.envelope.signature??'')
   ||!timingSafeEqual(Buffer.from(state.envelope.signature,'hex'),createHmac('sha256',config.token).update(JSON.stringify(r)).digest())
   ||String(await read('/proc/sys/kernel/random/boot_id')).trim()!==r.host_boot_id)fail();
  const current=await identity({...config,profile,nonce,fetchFn:deps.fetchFn});if(current.worker_boot_id!==r.worker_boot_id)fail();return state.envelope;
 }
 if(state?.cleanup_confirmed)fail();
 const stable=async()=>{if(String(await read('/proc/sys/kernel/random/boot_id')).trim()!==boot||await daemon()!==daemonId)fail();};
 const inspect=async reference=>{try{const values=JSON.parse(await docker(['inspect','--type=container',reference]));if(!Array.isArray(values)||values.length!==1)fail();return values[0];}
  catch(error){if(error.code===1&&new RegExp('^Error(?: response from daemon)?: No such (?:container|object): '+reference+'$').test(String(error.stderr).trim()))return null;throw error;}};
 const cleanup=async()=>{
  if(state.daemon_id!==daemonId)fail();await stable();
  let object=await inspect(state.container_id??state.name);
  // 未拿到create结果时，按名称的单次absence不足以排除迟到创建；保留intent。
  if(!state.container_id){if(!object)fail();verifyObject(object,state);state.container_id=object.Id;store.save(state);}
  if(object){verifyObject(object,state);if(object.State.Running){await docker(['stop','--time','3',state.container_id]);object=await inspect(state.container_id);}
   if(object){verifyObject(object,state);if(object.State.Running)fail();try{await docker(['rm','--',state.container_id]);}catch{/* 以下精确absence为最终证据。 */}}}
  if(await inspect(state.container_id)!==null)fail();await stable();state.cleanup_confirmed=true;store.save(state);
 };
 if(state){
  if(state.schema_version!=='linux-pool-canary-state/v1'||state.name!=='cecelia-pool-canary-'+nonce||!state.labels
   ||state.labels['cecelia.pool.nonce']!==nonce||state.container_id!==null&&!HEX.test(state.container_id??''))fail();
  try{if(state.phase==='intent'&&state.container_id===null){state.cleanup_confirmed=true;}else await cleanup();state.phase='failed';store.save(state);}catch{state.phase='unconfirmed';try{store.save(state);}catch{}}
  fail(); // 恢复只清理，绝不重跑旧canary或给旧证据重新签当前时间。
 }
 store.assertNoPending();
 const config=await(deps.loadConfiguration??(()=>configuration(run)))();
 const profile=validateLinuxPoolProfile(config.input);if(!profile.execution_budget_available||!HEX.test(config.token??'')||!/^[a-f0-9]{40}$/.test(config.revision??''))fail();
 const worker=await identity({...config,profile,nonce,fetchFn:deps.fetchFn});
 const image=String(await docker(['image','inspect','--format','{{.Id}}',profile.canary_image])).trim();if(!/^sha256:[a-f0-9]{64}$/.test(image))fail();
 const limits={cpu:Math.min(0.25,profile.pool.cpu_cores),memory:Math.min(134217728,profile.pool.memory_bytes),pids:Math.min(32,profile.pool.pids_limit)};
 state={schema_version:'linux-pool-canary-state/v1',nonce,name:'cecelia-pool-canary-'+nonce,machine_registry_id:profile.machine_registry_id,
  config_digest:profile.config_digest,revision:config.revision,host_boot_id:boot,worker_boot_id:worker.worker_boot_id,daemon_id:daemonId,
  image_ref:profile.canary_image,image_id:image,limits,container_id:null,cleanup_confirmed:false,phase:'intent',started_at:new Date().toISOString(),
  labels:{'cecelia.pool.nonce':nonce,'cecelia.pool.machine':profile.machine_registry_id,'cecelia.pool.config':profile.config_digest,
   'cecelia.pool.revision':config.revision,'cecelia.pool.host-boot':boot,'cecelia.pool.worker-boot':worker.worker_boot_id}};
 store.assertNoPending();store.save(state);
 let createAttempted=false;
 try{
  await stable();await run('/usr/bin/systemctl',['start',profile.cgroup_parent]);
  const args=['create','--pull=never','--name',state.name,'--network=none','--read-only','--user=65534:65534','--cap-drop=ALL','--security-opt=no-new-privileges',
   '--cgroup-parent='+profile.cgroup_parent,'--cpus='+limits.cpu,'--memory='+limits.memory,'--memory-swap='+limits.memory,'--pids-limit='+limits.pids,'--log-driver=none','--restart=no'];
  for(const[k,v]of Object.entries(state.labels))args.push('--label',k+'='+v);
  state.phase='creating';store.save(state);createAttempted=true;
  const created=String(await docker([...args,'--entrypoint=/bin/sh',profile.canary_image,'-c','exec sleep 90'])).trim();if(!HEX.test(created))fail();
  state.container_id=created;state.phase='created';store.save(state);
  verifyBeforeStart(await inspect(created),state);await stable();
  const before=await identity({...config,profile,nonce,fetchFn:deps.fetchFn});if(before.worker_boot_id!==state.worker_boot_id)fail();
  state.phase='starting';store.save(state);await docker(['start',created]);
  const proof=await(deps.collectProof??collectLinuxPoolProof)({profile,expected:{container_id:created,name:state.name,labels:state.labels},deps:deps.proofDeps??{}});
  if(proof.pool_verified!==true||proof.execution!==false||proof.container_id!==created||proof.machine_registry_id!==state.machine_registry_id
   ||proof.config_digest!==state.config_digest||proof.host_boot_id!==boot||proof.daemon_id!==daemonId)fail();
  state.proof=proof;state.phase='proved';store.save(state);await cleanup();
  const after=await identity({...config,profile,nonce,fetchFn:deps.fetchFn});if(after.worker_boot_id!==state.worker_boot_id)fail();await stable();
  const receipt={schema_version:'linux-pool-canary/v1',nonce,machine_registry_id:state.machine_registry_id,machine_id:profile.machine_id,config_digest:state.config_digest,
   revision:state.revision,host_boot_id:boot,worker_boot_id:state.worker_boot_id,daemon_id:daemonId,container_id:created,image_id:image,
   started_at:state.started_at,completed_at:new Date().toISOString(),proof,execution:false,pool_verified:true,cleanup_confirmed:true};
  state.envelope={receipt,signature:createHmac('sha256',config.token).update(JSON.stringify(receipt)).digest('hex')};state.phase='complete';store.save(state);return state.envelope;
 }catch{
  delete state.envelope;if(!createAttempted)state.cleanup_confirmed=true;state.phase='unconfirmed';try{store.save(state);}catch{}
  try{if(!state.cleanup_confirmed)await cleanup();state.phase='failed';store.save(state);}catch{state.phase='unconfirmed';try{store.save(state);}catch{}}
  fail();
 }
}
// flock由内核随进程退出释放，崩溃不会留下需猜测PID归属的陈旧文件锁。
if(require.main===module){
 const args=process.argv.slice(2);
 (async()=>{
  if(process.platform!=='linux'||process.getuid()!==0||args[0]!=='--nonce'||!HEX.test(args[1]??'')||![2,3].includes(args.length))fail();
  if(args.length===2){
   privateDirectory('/run/cecelia',0);const lock='/run/cecelia/linux-pool.canary.lock';let fd;
   try{fd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==0||(s.mode&0o777)!==0o600||s.nlink!==1)fail();}finally{if(fd!==undefined)fs.closeSync(fd);}
   const child=spawn('/usr/bin/flock',['--nonblock','--conflict-exit-code','75',lock,process.execPath,__filename,...args,'--under-lock'],
    {stdio:'inherit',env:{PATH:'/usr/bin:/bin',HOME:'/'}});
   child.once('error',()=>{process.stderr.write('linux_pool_canary_unconfirmed\n');process.exitCode=1;});child.once('exit',code=>{process.exitCode=code===0?0:1;});return;
  }
  if(args[2]!=='--under-lock'||await fs.promises.readlink('/proc/'+process.ppid+'/exe')!=='/usr/bin/flock')fail();
  const release=acquireCanaryInstallFence({nonce:args[1],underFlock:true});
  try{const envelope=await runLinuxPoolCanary({nonce:args[1]},{lockHeld:true});process.stdout.write(JSON.stringify(envelope)+'\n');}finally{release();}
 })().catch(()=>{process.stderr.write('linux_pool_canary_unconfirmed\n');process.exitCode=1;});
}
module.exports={runLinuxPoolCanary,acquireCanaryInstallFence,createCanaryJournal:journal,readLinuxPoolIdentity:identity,assertCanaryDirectory:privateDirectory};
