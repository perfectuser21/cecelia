'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
// 以部署目录内完整受保护CJS库存为代码边界，普通lazy require不改变身份。
// 每次仍读取真实字节；新增、删除、篡改或不安全权限均不能继承旧指纹。
function runtimeConfigDigest(config){
 const deployedProfile=path.join(__dirname,'fleet-node-profiles.json');
 const profile=fs.existsSync(deployedProfile)?deployedProfile:path.resolve(__dirname,'../../config/fleet-node-profiles.json');
 const files=[profile,...fs.readdirSync(__dirname).filter(name=>name.endsWith('.cjs')).map(name=>path.join(__dirname,name))].sort();
 const code=files.map(file=>[path.basename(file),protectedFileDigest(file)]);
 return createHash('sha256').update(JSON.stringify({schema:'fleet-runtime-config/v1',config,code})).digest('hex');
}
function protectedFileDigest(file){let fd;try{fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const stat=fs.fstatSync(fd);if(!stat.isFile()||(stat.mode&0o022)||(stat.uid!==0&&stat.uid!==process.getuid?.()))throw Error('worker_runtime_code_unprotected');return createHash('sha256').update(fs.readFileSync(fd)).digest('hex');}finally{if(fd!==undefined)fs.closeSync(fd);}}
module.exports={runtimeConfigDigest,protectedFileDigest};
