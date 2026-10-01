'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { isIP } = require('node:net');
const { createHash } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
// US是调度节点；不能靠改名称或网页role解除稳定设备身份上的禁止执行约束。
const SCHEDULER_ONLY_IDS = new Set(['1a379d80-ad36-47d3-88ba-e545ab299a54']);
const fail = code => { throw Error(code); };
const invalid = () => fail('linux_pool_profile_invalid');
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value,key))) invalid();
}
function validateLinuxPoolProfile(input) {
  exactKeys(input,['schema_version','machine_registry_id','machine_id','role','endpoint_host','docker_host','pool','canary_image']);
  exactKeys(input.pool,['cpu_cores','memory_bytes','pids_limit']);
  const {cpu_cores:cpu,memory_bytes:memory,pids_limit:pids}=input.pool;
  if (input.schema_version!==1 || !UUID.test(input.machine_registry_id)
    || !/^[a-z][a-z0-9-]{1,62}$/.test(input.machine_id) || !['worker','scheduler'].includes(input.role)
    || typeof input.endpoint_host!=='string' || !isIP(input.endpoint_host)
    || ['0.0.0.0','::','::1','127.0.0.1'].includes(input.endpoint_host)
    || input.docker_host!=='unix:///var/run/docker.sock'
    || typeof input.canary_image!=='string' || input.canary_image.length>256
    || !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(input.canary_image)
    || !Number.isFinite(cpu) || cpu<0 || cpu>1024 || (cpu!==0 && cpu<0.01)
    || !Number.isInteger(cpu*1000)
    || !Number.isSafeInteger(memory) || memory<0 || (memory!==0 && memory<67108864)
    || !Number.isSafeInteger(pids) || pids<16 || pids>65536) invalid();
  const profile={schema_version:1,machine_registry_id:input.machine_registry_id,machine_id:input.machine_id,
    role:input.role,endpoint_host:input.endpoint_host,docker_host:input.docker_host,
    pool:Object.freeze({cpu_cores:cpu,memory_bytes:memory,pids_limit:pids}),canary_image:input.canary_image};
  const schedulerOnly=SCHEDULER_ONLY_IDS.has(profile.machine_registry_id)||profile.role==='scheduler';
  return Object.freeze({...profile,cgroup_parent:'cecelia-workloads.slice',data_root:'/var/lib/cecelia/fleet-worker',
    config_digest:createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
    scheduler_only:schedulerOnly,execution_budget_available:!schedulerOnly&&cpu>0&&memory>0});
}
function loadLinuxPoolProfile(filename,{uid=process.getuid()}={}) {
  let fd;
  try {
    if(typeof filename!=='string'||!path.isAbsolute(filename)) fail('linux_pool_profile_untrusted');
    const parent=fs.lstatSync(path.dirname(filename));
    if(!parent.isDirectory()||parent.isSymbolicLink()||![0,uid].includes(parent.uid)||(parent.mode&0o022)) fail('linux_pool_profile_untrusted');
    fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const before=fs.fstatSync(fd,{bigint:true});
    if(!before.isFile()||![0n,BigInt(uid)].includes(before.uid)||(before.mode&0o777n)!==0o600n||before.size>65536n) fail('linux_pool_profile_untrusted');
    const buffer=Buffer.alloc(65537),count=fs.readSync(fd,buffer,0,buffer.length,0);
    const after=fs.fstatSync(fd,{bigint:true}),current=fs.lstatSync(filename,{bigint:true});
    if(count>65536||current.isSymbolicLink()||current.dev!==before.dev||current.ino!==before.ino
      ||after.size!==before.size||after.mtimeNs!==before.mtimeNs||BigInt(count)!==after.size) fail('linux_pool_profile_untrusted');
    let decoded;try{decoded=JSON.parse(buffer.subarray(0,count).toString('utf8'));}catch{invalid();}
    return validateLinuxPoolProfile(decoded);
  } catch(error) {
    if(error.message==='linux_pool_profile_invalid') throw error;
    fail('linux_pool_profile_untrusted');
  } finally {if(fd!==undefined)fs.closeSync(fd);}
}
function renderLinuxUnits(profile) {
  // 重建合同，不接受调用方伪造派生授权位。
  const input=Object.fromEntries(['schema_version','machine_registry_id','machine_id','role','endpoint_host','docker_host','pool','canary_image'].map(key=>[key,profile?.[key]]));
  const verified=validateLinuxPoolProfile(input);
  if(verified.scheduler_only) fail('linux_scheduler_only');
  if(!verified.execution_budget_available) fail('linux_pool_budget_unavailable');
  return Object.freeze({
    slice:`[Unit]\nDescription=Cecelia isolated workload pool\n[Slice]\nCPUAccounting=yes\nCPUQuota=${verified.pool.cpu_cores*100}%\nMemoryAccounting=yes\nMemoryMax=${verified.pool.memory_bytes}\nMemorySwapMax=0\nTasksAccounting=yes\nTasksMax=${verified.pool.pids_limit}\n`,
    service:'[Unit]\nDescription=Cecelia Linux pool verifier\nAfter=docker.service network.target\nRequires=docker.service\n[Service]\nType=simple\nUser=_cecelia\nGroup=_cecelia\nExecStart=/usr/local/libexec/cecelia/toolchain/bin/node /usr/local/libexec/cecelia/fleet-worker/linux-pool-server.cjs\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=yes\nProtectSystem=strict\nProtectHome=yes\nReadWritePaths=/var/lib/cecelia/fleet-worker\nUMask=0077\n[Install]\nWantedBy=multi-user.target\n',
  });
}
module.exports={validateLinuxPoolProfile,loadLinuxPoolProfile,renderLinuxUnits};
