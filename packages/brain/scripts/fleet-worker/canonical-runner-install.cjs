'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createDrainOwner}=require('./drain-owner.cjs');
const MARKER='/var/run/cecelia/fleet-worker.drain';
function restoreCanonicalRunner(machine,expected,owner,{marker=MARKER,run=spawnSync}={}) {
  if(machine!=='xian-mac-m4'||!/^[0-9a-f]{64}$/.test(expected??''))throw Error('canonical_runner_request_invalid');
  return createDrainOwner({marker}).withOwned(machine,owner,()=>{
    const descriptors=[];
    try {
      for(const file of [marker,path.join(path.dirname(marker),'.fleet-worker.drain.lock')])descriptors.push(fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW));
      // 固定入口与节点；真实描述符绑定同一marker及合作锁，直到子进程结束。
      const result=run('/bin/bash',[path.join(__dirname,'install-fleet-worker.sh'),machine,'--apply','--restore-canonical-runner',expected],{
        env:{...process.env,FLEET_NODECTL_DRAIN_OWNER:owner},stdio:['inherit','inherit','inherit',...descriptors],timeout:600000,
      });
      if(result.error||result.signal||result.status!==0)throw Error('canonical_runner_install_failed');
      return {installed:true};
    } finally {for(const fd of descriptors)fs.closeSync(fd);}
  });
}
if(require.main===module) {
  try {
    if(process.getuid()!==0||process.argv.length!==4)throw Error('canonical_runner_root_required');
    restoreCanonicalRunner(process.argv[2],process.argv[3],process.env.FLEET_NODECTL_DRAIN_OWNER);
  } catch(e) {console.error(/^canonical_runner_[a-z_]+$|^drain_[a-z_]+$/.test(e.message)?e.message:'canonical_runner_install_failed');process.exitCode=1;}
}
module.exports={restoreCanonicalRunner};
