'use strict';
const fs=require('node:fs/promises');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {readBounded}=require('./linux-resource-probe.cjs');
const {parseCpuMax,parsePsi}=require('./linux-cgroup.cjs');
const ROOT='/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/';
const MARKERS=['/var/run/cecelia/fleet-worker.drain','/run/cecelia/linux-pool.install.lock'];
const fail=()=>{throw Error('script_local_resources_unavailable');};
function createLinuxScriptLaunchGate({workerBootId,configDigest,readConfigDigest,readText=readBounded,readlink=fs.readlink,
 lstat=fs.lstat,statfs=p=>fs.statfs(p,{bigint:true}),run=promisify(execFile)}={}) {
 if(typeof readConfigDigest!=='function')fail();
 const command=(c,a)=>run(c,a,{shell:false,timeout:5000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',HOME:'/',DOCKER_HOST:'unix:///var/run/docker.sock'}});
 async function maintenance(){
  for(const marker of MARKERS){try{await lstat(marker);fail();}catch(e){if(e.code!=='ENOENT')fail();}}
  if(await readConfigDigest()!==configDigest)fail();
 }
 async function check(r){
  await maintenance();
  if(r.identity.worker_boot_id!==workerBootId||r.expected.worker_boot_id!==workerBootId)fail();
  if((await readText('/proc/sys/kernel/random/boot_id')).trim()!==r.expected.host_boot_id)fail();
  if(!['/usr/lib/systemd/systemd','/lib/systemd/systemd'].includes(await readlink('/proc/1/exe')))fail();
  for(const kind of ['cgroup','pid','mnt']){const ns=await readlink('/proc/1/ns/'+kind);
   if(!new RegExp('^'+kind+':\\[\\d+\\]$').test(ns)||await readlink('/proc/self/ns/'+kind)!==ns)fail();}
  let host=false;try{await command('/usr/bin/systemd-detect-virt',['--container']);}
  catch(e){host=e.code===1&&String(e.stdout).trim()==='none';}if(!host)fail();
  const info=JSON.parse((await command('/usr/bin/docker',['info','--format','{{json .}}'])).stdout);
  if(info.ID!==r.daemon_id||info.CgroupDriver!=='systemd'||info.CgroupVersion!=='2')fail();
  const names=['cpu.max','memory.max','memory.swap.max','pids.max','memory.current','pids.current','cpu.pressure','memory.pressure'];
  const values=Object.fromEntries(await Promise.all(names.map(async n=>[n,(await readText(ROOT+n)).trim()])));
  if(parseCpuMax(values['cpu.max'],2)!==r.pool.pool.cpu_cores)fail();
  const integer=n=>{if(!/^\d+$/.test(values[n]))fail();const v=Number(values[n]);if(!Number.isSafeInteger(v))fail();return v;};
  if(integer('memory.max')!==r.pool.pool.memory_bytes||integer('memory.swap.max')!==0||integer('pids.max')!==r.pool.pool.pids_limit
   ||integer('memory.current')+r.profile.memoryBytes>r.pool.pool.memory_bytes||integer('pids.current')+r.profile.pidsLimit>r.pool.pool.pids_limit)fail();
  for(const kind of ['cpu','memory']){const psi=parsePsi(values[kind+'.pressure']);if(!psi.some||psi.some.avg10>=90)fail();}
  const mem=(await readText('/proc/meminfo')).match(/^MemAvailable:\s+(\d+) kB$/m);
  if(!mem||!Number.isSafeInteger(Number(mem[1]))||Number(mem[1])*1024<r.profile.memoryBytes)fail();
  for(const directory of ['/var/lib/docker','/var/lib/cecelia/script-runtime']){
   const s=await statfs(directory);if(!['bsize','blocks','bfree','bavail'].every(k=>typeof s[k]==='bigint'&&s[k]>=0n)
    ||s.bsize===0n||s.blocks===0n||s.bavail>s.bfree||s.bfree>s.blocks||s.bavail*s.bsize<1073741824n
    ||(s.blocks-s.bfree)*100n>(s.blocks-s.bfree+s.bavail)*90n)fail();
  }
  await maintenance();
 }
 return async r=>{let timer;try{await Promise.race([check(r),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),10000);})]);}
  catch{fail();}finally{clearTimeout(timer);}};
}
module.exports={createLinuxScriptLaunchGate};
