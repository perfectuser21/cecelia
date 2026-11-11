'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function protectedText(file,depth=1){
 let directory=path.dirname(file);
 for(let i=0;i<depth;i++,directory=path.dirname(directory)){
  const d=fs.lstatSync(directory);if(!d.isDirectory()||d.isSymbolicLink()||d.uid!==process.getuid()||(d.mode&0o077))throw Error('activity_state_directory_unprotected');
 }
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)||s.nlink!==1||s.size>40*1024*1024)throw Error('activity_state_file_unprotected');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}
}
const protectedRead=(file,depth=1)=>JSON.parse(protectedText(file,depth));
function processBirth(pid){
 if(!Number.isSafeInteger(pid)||pid<1)return null;
 try{
  if(process.platform==='linux'){const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');return 'linux:'+stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];}
  if(process.platform!=='darwin')return null;
  // PROC_PIDTBSDINFO 提供微秒级实际出生时间，避免将复用 PID 视为原监督实例。
  const script="import ctypes,sys\nclass B(ctypes.Structure):\n _fields_=[('ids',ctypes.c_uint32*12),('comm',ctypes.c_char*16),('name',ctypes.c_char*32),('tail',ctypes.c_uint32*6),('sec',ctypes.c_uint64),('usec',ctypes.c_uint64)]\nb=B();n=ctypes.CDLL('/usr/lib/libproc.dylib').proc_pidinfo(int(sys.argv[1]),3,0,ctypes.byref(b),ctypes.sizeof(b))\nif n!=ctypes.sizeof(b):sys.exit(1)\nprint(str(b.sec)+':'+str(b.usec))";
  const r=spawnSync('/usr/bin/python3',['-I','-S','-c',script,String(pid)],{encoding:'utf8',timeout:2000,cwd:'/',env:{PATH:'/usr/bin:/bin',LANG:'C'}});
  return r.status===0?'darwin:'+r.stdout.trim():null;
 }catch{return null;}
}
const sameProcess=(pid,birth)=>typeof birth==='string'&&processBirth(pid)===birth;
function validResult(r,m){return r.protocol==='activity-supervisor-result/v1'&&r.nonce===m.nonce&&digest(r.binding)===digest(m.binding)&&r.deadline===m.deadline&&typeof r.transport?.stdout==='string'&&r.transport_sha256===digest(r.transport);}
module.exports={protectedText,protectedRead,processBirth,sameProcess,digest,validResult};
