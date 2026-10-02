'use strict';
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const runFile=promisify(execFile);
const IMAGE='sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=()=>Error('worker_baseline_unconfirmed');
const PROGRAM=`const fs=require('fs'),cp=require('child_process');
const version=f=>cp.execFileSync(f,['--version'],{encoding:'utf8',timeout:1500,maxBuffer:8192}).trim();
fs.accessSync('/workspace/.git');const p='/tmp/baseline-'+process.pid;fs.writeFileSync(p,'owned');fs.unlinkSync(p);
let readonly=false;try{fs.writeFileSync('/baseline-root-write','blocked')}catch(e){readonly=e.code==='EROFS'||e.code==='EACCES'}if(!readonly)throw Error('root writable');
console.log(JSON.stringify({node:process.version,git:version('git'),codex:version('codex'),workspace:true,sandbox:true}));`;
function createBaselineProbe({root,gate,machineId,repoRoot,getConfigDigest,workspaceBase=path.dirname(root),runCommand=runFile,assertLocalResources=async()=>{}}){
 if(!['us-mac-m4','xian-mac-m1','xian-mac-m4'].includes(machineId)||!path.isAbsolute(root)||!path.isAbsolute(repoRoot)||!path.isAbsolute(workspaceBase))throw fail();
 fs.mkdirSync(root,{recursive:true,mode:0o700});const rootStat=fs.lstatSync(root);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o077)||(rootStat.uid!==0&&rootStat.uid!==process.getuid?.()))throw fail();
 fs.mkdirSync(workspaceBase,{recursive:true,mode:0o755});
 const filename=path.join(root,'baseline-owner.json');
 function read(){let fd;try{fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);if(!stat.isFile()||(stat.mode&0o077)||stat.size>65536)throw fail();return JSON.parse(fs.readFileSync(fd,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw fail();}finally{if(fd!==undefined)fs.closeSync(fd);}}
 function write(value){const temp=path.join(root,`.baseline-${process.pid}.tmp`);let fd;try{fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{if(fd!==undefined)fs.closeSync(fd);}fs.renameSync(temp,filename);const dir=fs.openSync(root,fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 const prior=read();if(prior&&prior.cleanup?.confirmed!==true)gate.setMaintenancePending(true);
 async function inspect(id,command){try{return JSON.parse((await command('docker',['inspect','--',id])).stdout)[0];}catch(e){if(/no such (object|container)/i.test(String(e.stderr)))return null;throw fail();}}
 async function cleanup(record,command){const info=await inspect(record.container_id??record.container_name,command);
  if(info){if(info.Config?.Labels?.['cecelia.baseline.owner']!==record.request_nonce||info.Image!==record.image_id||!/^[a-f0-9]{64}$/.test(info.Id))throw fail();
   record.container_id=info.Id;if(info.State?.Running)await command('docker',['stop','--time','1','--',info.Id]);await command('docker',['rm','--',info.Id]);
   if(await inspect(info.Id,command))throw fail();}
  const parent=path.join(workspaceBase,`cecelia-baseline-${record.request_nonce}`),workspace=path.join(parent,'worktree');
  if(record.workspace_parent!==parent||record.workspace_path!==workspace)throw fail();
  let stat;try{stat=fs.lstatSync(parent);}catch(e){if(e.code!=='ENOENT')throw fail();}
  if(stat){if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.uid!==0&&stat.uid!==process.getuid?.())||(record.workspace_inode===undefined||stat.ino!==record.workspace_inode||stat.dev!==record.workspace_device))throw fail();
   if(record.worktree_attempted){const listed=String((await command('git',['worktree','list','--porcelain'],{cwd:repoRoot})).stdout);if(listed.split('\n').includes(`worktree ${workspace}`))await command('git',['worktree','remove','--force',workspace],{cwd:repoRoot});const again=String((await command('git',['worktree','list','--porcelain'],{cwd:repoRoot})).stdout);if(again.split('\n').includes(`worktree ${workspace}`))throw fail();fs.rmSync(parent,{recursive:true});}
   else fs.rmdirSync(parent);
  }
  record.workspace_cleanup={confirmed:true,absent:true,workspace_path:workspace};
  return {confirmed:true,absent:true,container_id:record.container_id??null};
 }
 return {async cleanup(input){
  if(Object.keys(input??{}).sort().join(',')!=='expected_boot_id,expected_config_digest,owner_nonce,request_nonce'||typeof input.request_nonce!=='string'||!UUID.test(input.request_nonce??'')||input.expected_boot_id!==gate.snapshot().boot_id||input.expected_config_digest!==getConfigDigest())throw fail();
  const record=read();if(typeof input.owner_nonce!=='string'||!record||record.request_nonce!==input.owner_nonce||record.machine_id!==machineId||record.image_id!==IMAGE||record.container_name!==`cecelia-baseline-${record.request_nonce}`)throw fail();
  return gate.withMaintenance(async()=>{const command=(f,a,extra={})=>runCommand(f,a,{...extra,encoding:'utf8',shell:false,timeout:3000,maxBuffer:65536});record.cleanup=await cleanup(record,command);record.observed_at=new Date().toISOString();write(record);gate.setMaintenancePending(false);return {schema_version:'fleet-baseline-cleanup/v1',machine_id:machineId,request_nonce:input.request_nonce,owner_nonce:record.request_nonce,boot_id:gate.snapshot().boot_id,config_digest:getConfigDigest(),cleanup:record.cleanup,observed_at:record.observed_at};},true).catch(()=>{throw fail();});
 },async run(input){
  if(Object.keys(input??{}).sort().join(',')!=='expected_activity_revision,expected_boot_id,expected_config_digest,expected_image_digest,request_nonce'||typeof input.request_nonce!=='string'||!UUID.test(input.request_nonce??'')
   ||input.expected_activity_revision!==gate.snapshot().activity_revision||input.expected_image_digest!==IMAGE||input.expected_boot_id!==gate.snapshot().boot_id||input.expected_config_digest!==getConfigDigest())throw fail();
  return gate.withMaintenance(async()=>{
   const deadline=Date.now()+15000;
   const command=(file,args,extra={})=>{const left=deadline-Date.now();if(left<=0)throw fail();return runCommand(file,args,{...extra,encoding:'utf8',shell:false,timeout:Math.min(4000,left),maxBuffer:65536});};
   await assertLocalResources();const image=JSON.parse((await command('docker',['image','inspect',IMAGE])).stdout)[0];if(image?.Id!==IMAGE)throw fail();
   const osVersion=String((await command('sw_vers',['-productVersion'])).stdout).trim();if(!/^\d+\.\d+\.\d+$/.test(osVersion))throw fail();
   const record={schema_version:'fleet-baseline-proof/v1',machine_id:machineId,request_nonce:input.request_nonce,boot_id:input.expected_boot_id,config_digest:input.expected_config_digest,
    activity_revision_before:input.expected_activity_revision,image_id:image.Id,image_digest:IMAGE,os_version:osVersion,container_name:`cecelia-baseline-${input.request_nonce}`,workspace_parent:path.join(workspaceBase,`cecelia-baseline-${input.request_nonce}`),workspace_path:path.join(workspaceBase,`cecelia-baseline-${input.request_nonce}`,'worktree'),worktree_attempted:false,cleanup:{confirmed:false}};
   write(record);gate.setMaintenancePending(true);let succeeded=false;
   try{
    fs.mkdirSync(record.workspace_parent,{mode:0o755});const parent=fs.lstatSync(record.workspace_parent);record.workspace_inode=parent.ino;record.workspace_device=parent.dev;write(record);record.worktree_attempted=true;write(record);
    await command('git',['worktree','add','--detach','--no-checkout',record.workspace_path,'HEAD'],{cwd:repoRoot});
    const created=await command('docker',['create','--name',record.container_name,'--label',`cecelia.baseline.owner=${input.request_nonce}`,'--network=none','--cpus=0.5','--memory=128m','--memory-swap=128m','--pids-limit=64','--read-only','--tmpfs=/tmp:rw,noexec,nosuid,size=8m','--user=1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges','--log-driver=none','--env','HOME=/tmp','--mount',`type=bind,src=${record.workspace_path},dst=/workspace,readonly`,'--entrypoint=node',IMAGE,'-e',PROGRAM]);
    record.container_id=String(created.stdout).trim();if(!/^[a-f0-9]{64}$/.test(record.container_id))throw fail();write(record);
    const info=await inspect(record.container_id,command);
    if(info?.Id!==record.container_id||info.Image!==IMAGE||info.Config?.Labels?.['cecelia.baseline.owner']!==input.request_nonce||info.HostConfig?.NanoCpus!==500000000||info.HostConfig.Memory!==134217728||info.HostConfig.MemorySwap!==134217728||info.HostConfig.PidsLimit!==64||info.HostConfig.NetworkMode!=='none'||info.HostConfig.ReadonlyRootfs!==true||info.Mounts?.length!==1||info.Mounts[0].Type!=='bind'||info.Mounts[0].RW!==false||info.Mounts[0].Source!==record.workspace_path||info.Mounts[0].Destination!=='/workspace')throw fail();
    record.tools=JSON.parse((await command('docker',['start','--attach','--',record.container_id])).stdout);const exited=await inspect(record.container_id,command);
    if(exited?.State?.Running!==false||exited.State.ExitCode!==0||record.tools.workspace!==true||record.tools.sandbox!==true)throw fail();succeeded=true;
   }catch{throw fail();}finally{
    try{record.cleanup=await cleanup(record,(f,a,extra={})=>runCommand(f,a,{...extra,encoding:'utf8',shell:false,timeout:3000,maxBuffer:65536}));record.observed_at=new Date().toISOString();write(record);gate.setMaintenancePending(false);}catch{write(record);}
   }
   if(!succeeded||record.cleanup.confirmed!==true||input.expected_boot_id!==gate.snapshot().boot_id||input.expected_config_digest!==getConfigDigest()||!gate.snapshot().draining)throw fail();
   return record;
  }).then(record=>({...record,activity_revision_after:gate.snapshot().activity_revision})).catch(()=>{throw fail();});
 }};
}
module.exports={createBaselineProbe};
