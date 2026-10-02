'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
// 指纹来自进程已加载的实际配置与受保护代码，不接受HTTP请求自报配置。
function runtimeConfigDigest(config){
 const deployedProfile=path.join(__dirname,'fleet-node-profiles.json');
 const profile=fs.existsSync(deployedProfile)?deployedProfile:path.resolve(__dirname,'../../config/fleet-node-profiles.json');
 const files=[profile,...Object.keys(require.cache).filter(file=>path.dirname(file)===__dirname&&file.endsWith('.cjs'))].sort();
 const code=files.map(file=>[path.basename(file),protectedFileDigest(file)]);
 return createHash('sha256').update(JSON.stringify({schema:'fleet-runtime-config/v1',config,code})).digest('hex');
}
function protectedFileDigest(file){let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);if(!stat.isFile()||(stat.mode&0o022)||(stat.uid!==0&&stat.uid!==process.getuid?.()))throw Error('worker_runtime_code_unprotected');return createHash('sha256').update(fs.readFileSync(fd)).digest('hex');}finally{if(fd!==undefined)fs.closeSync(fd);}}
module.exports={runtimeConfigDigest,protectedFileDigest};
