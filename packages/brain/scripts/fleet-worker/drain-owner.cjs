'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const MARKER = '/var/run/cecelia/fleet-worker.drain';
const LABEL = 'com.perfect21.fleet-worker';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail = code => Error(code);
function createDrainOwner({marker=MARKER,runLaunchctl=args=>execFileSync('/bin/launchctl',args,{timeout:10000,stdio:'pipe'})}={}) {
  if (!path.isAbsolute(marker)) throw fail('drain_owner_path_invalid');
  const root=path.dirname(marker),lock=path.join(root,'.fleet-worker.drain.lock');
  function protectedStat(file,directory=false) {
    const s=fs.lstatSync(file);
    if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile())||(s.mode&0o022)||(s.uid!==0&&s.uid!==process.getuid()))throw fail('drain_owner_unconfirmed');
    return s;
  }
  function read(file) {
    let fd;
    try {
      fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const s=fs.fstatSync(fd);
      if(!s.isFile()||(s.mode&0o077)||s.size>4096||(s.uid!==0&&s.uid!==process.getuid()))throw fail('drain_owner_unconfirmed');
      return {stat:s,body:fs.readFileSync(fd,'utf8')};
    } finally {if(fd!==undefined)fs.closeSync(fd);}
  }
  function syncRoot() {const fd=fs.openSync(root,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  function exclusive(file,value) {
    const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncRoot();
  }
  const journal=owner=>path.join(root,`.fleet-worker.drain-owner-${owner}.json`);
  function releaseLock(held) {
    const current=protectedStat(lock,true);
    if(current.ino!==held.ino||current.dev!==held.dev)throw fail('drain_owner_lock_changed');
    fs.rmdirSync(lock);syncRoot();
  }
  function withLock(machine,owner,fn) {
    if(!['us-mac-m4','xian-mac-m1','xian-mac-m4'].includes(machine)||!UUID.test(owner??''))throw fail('drain_owner_request_invalid');
    fs.mkdirSync(root,{recursive:true,mode:0o755});protectedStat(root,true);
    try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')throw fail('drain_owner_busy');throw e;}
    const held=protectedStat(lock,true);
    try{return fn();}finally{releaseLock(held);}
  }
  function current(machine,owner) {
    let value;
    try{value=read(marker);}catch(e){if(e.code==='ENOENT')return null;throw fail('drain_owner_unconfirmed');}
    let content,receipt;
    try{content=JSON.parse(value.body);}catch{throw fail('drain_owner_unconfirmed');}
    if(content.schema!=='fleet-drain-owner/v1'||content.machine!==machine||content.owner!==owner)throw fail('drain_owner_mismatch');
    try{receipt=JSON.parse(read(journal(owner)).body);}catch{throw fail('drain_owner_unconfirmed');}
    if(receipt.owner!==owner||receipt.machine!==machine||receipt.inode!==value.stat.ino||receipt.device!==value.stat.dev||receipt.content!==value.body)throw fail('drain_owner_mismatch');
    return receipt;
  }
  function create(machine,owner) {
    exclusive(marker,{schema:'fleet-drain-owner/v1',machine,owner});
    const value=read(marker),receipt={machine,owner,inode:value.stat.ino,device:value.stat.dev,content:value.body};
    // 未完成journal的崩溃保持未知marker，后续不会冒领。
    exclusive(journal(owner),receipt);
    return receipt;
  }
  return {
    drain(machine,owner) {return withLock(machine,owner,()=>{
      const existing=current(machine,owner);if(existing)return {created:false,receipt:existing};
      const receipt=create(machine,owner);
      try{runLaunchctl(['bootout',`system/${LABEL}`]);}catch{/* 服务已不存在时marker仍有效。 */}
      return {created:true,receipt};
    });},
    undrain(machine,owner) {return withLock(machine,owner,()=>{
      const receipt=current(machine,owner);if(!receipt)return {released:false};
      // 合作锁覆盖身份检查、unlink及启动失败恢复；其它正常调用不能介入。
      fs.unlinkSync(marker);syncRoot();
      try{
        try{runLaunchctl(['print',`system/${LABEL}`]);}catch{runLaunchctl(['bootstrap','system','/Library/LaunchDaemons/com.perfect21.fleet-worker.plist']);}
        runLaunchctl(['kickstart','-k',`system/${LABEL}`]);
      }catch{
        fs.unlinkSync(journal(owner));create(machine,owner);
        throw fail('drain_launch_unconfirmed');
      }
      fs.unlinkSync(journal(owner));syncRoot();return {released:true,receipt};
    });},
    emergency(machine) {
      const owner=randomUUID();return withLock(machine,owner,()=>{
        try{protectedStat(marker);return {preserved:true};}catch(e){if(e.code!=='ENOENT')throw e;}
        return {created:true,receipt:create(machine,owner)};
      });
    },
  };
}
if(require.main===module) {
  try {
    const [operation,machine]=process.argv.slice(2);
    if(process.argv.length!==4||!['drain','undrain','emergency'].includes(operation))throw fail('drain_owner_request_invalid');
    // 生产CLI仅固定marker和launchctl；隔离测试才注入自属临时路径。
    const testing=process.env.NODE_ENV==='test';
    if(!testing&&process.env.FLEET_NODECTL_DRAIN_MARKER&&process.env.FLEET_NODECTL_DRAIN_MARKER!==MARKER)throw fail('drain_owner_path_invalid');
    if(!testing&&process.env.FLEET_NODECTL_LAUNCHCTL&&process.env.FLEET_NODECTL_LAUNCHCTL!=='/bin/launchctl')throw fail('drain_owner_path_invalid');
    const marker=testing?(process.env.FLEET_NODECTL_DRAIN_MARKER??MARKER):MARKER;
    const launchctl=testing?(process.env.FLEET_NODECTL_LAUNCHCTL??'/bin/launchctl'):'/bin/launchctl';
    const utility=createDrainOwner({marker,runLaunchctl:args=>execFileSync(launchctl,args,{timeout:10000,stdio:'pipe'})});
    console.log(JSON.stringify(utility[operation](machine,process.env.FLEET_NODECTL_DRAIN_OWNER)));
  }catch(e){console.error(/^drain_[a-z_]+$/.test(e.message)?e.message:'drain_owner_unconfirmed');process.exitCode=1;}
}
module.exports={createDrainOwner};
