import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {error,HEX} from './deployment.js';
const FILES=['linux-pool-installer.cjs','linux-pool-profile.cjs','linux-pool-proof.cjs','linux-pool-server.cjs','linux-pool-canary.cjs','linux-resource-probe.cjs','linux-cgroup.cjs',
 'linux-script-canary.cjs','linux-script-service.cjs','linux-script-launch-gate.cjs','linux-script-runtime.cjs','linux-script-docker.cjs','linux-script-permit.cjs','linux-script-bridge.cjs','script-runner.cjs'];
const source=name=>fs.readFileSync(fileURLToPath(new URL('../../scripts/fleet-worker/'+name,import.meta.url)),'utf8');
const bundled=()=>({files:Object.fromEntries(FILES.map(name=>[name,source(name)])),program:"__name__='cecelia_onboarding'\n"+['linux-pool-bootstrap.py','linux-onboarding-remote.py'].map(source).join('\n')});
const LIMIT=1024*1024,hash=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
/** 首次副作用前把镜像工件保存到root私有缓存。后续镜像升级只读取原工件，不换源码或安装intent。 */
export function createOnboardingArtifacts({root='/root/.credentials/fleet-control',revision=process.env.GIT_SHA,load=bundled,owner=process.getuid?.()??0,pathRoot='/'}={}){
 const fail=()=>{throw error('linux_pool_artifact_unavailable');},directory=path.join(root,'artifacts');
 function parents(){let p=root;for(;;){const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==owner||(s.mode&0o022))fail();if(p===pathRoot)break;const up=path.dirname(p);if(up===p)fail();p=up;}
  try{fs.mkdirSync(directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=fs.lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==owner||(s.mode&0o777)!==0o700)fail();
 }
 function read(rev,digest){let fd;try{
  if(!/^[a-f0-9]{40}$/.test(rev??'')||!HEX.test(digest??''))fail();parents();
  const file=path.join(directory,rev+'.json');fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==owner||(s.mode&0o777)!==0o600||s.size>LIMIT)fail();
  const buffer=Buffer.alloc(LIMIT+1),n=fs.readSync(fd,buffer,0,buffer.length,0);if(n!==s.size||n>LIMIT)fail();
  const data=JSON.parse(buffer.subarray(0,n).toString());if(data.revision!==rev||hash(data)!==digest)fail();
  return {...data,digest};
 }catch{fail();}finally{if(fd!==undefined)fs.closeSync(fd);}}
 function capture(){let fd,temp;try{
  if(!/^[a-f0-9]{40}$/.test(revision??''))fail();const data={revision,...load()},digest=hash(data),raw=JSON.stringify(data);
  if(Buffer.byteLength(raw)>LIMIT||typeof data.program!=='string'||!data.program||!data.files||Object.keys(data.files).sort().join(',')!==[...FILES].sort().join(',')||Object.values(data.files).some(s=>typeof s!=='string'||Buffer.byteLength(s)>262144))fail();
  parents();temp=path.join(directory,'.'+revision+'.'+randomUUID());fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  try{fs.linkSync(temp,path.join(directory,revision+'.json'));}catch(e){if(e.code!=='EEXIST')throw e;}
  fs.unlinkSync(temp);temp=null;const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  return read(revision,digest);
 }catch{fail();}finally{if(fd!==undefined)fs.closeSync(fd);if(temp)fs.unlinkSync(temp);}}
 return {capture,read};
}
