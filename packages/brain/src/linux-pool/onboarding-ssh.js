import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateEnrollment} from '../node-onboarding/spec.js';
import {createPrivateOp} from './onboarding-credentials.js';
import {UUID,error,ONBOARDING_CONTROL_ROOT} from './deployment.js';
const fail=()=>error('linux_pool_ssh_unavailable');
export function runOnboardingCommand(command,args,{input='',timeoutMs=15000}={}){
 return new Promise((resolve,reject)=>{
  const child=execFile(command,args,{timeout:timeoutMs,maxBuffer:2*1024*1024,killSignal:'SIGKILL',
   env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/root',LC_ALL:'C'}},(err,stdout)=>err?reject(fail()):resolve(stdout));
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
/** 只传送镜像内的固定控制程序；request必须来自已登记接入任务，payload只由后台阶段机生成。 */
export function createOnboardingSSH({root=ONBOARDING_CONTROL_ROOT,pathRoot='/',owner=process.getuid?.()??0,
 run=runOnboardingCommand,readKey=ref=>createPrivateOp()(['read',ref]),source}={}){
 return async(machineId,input,payload,execution={})=>{
  let stage;
  try{
   if(!UUID.test(machineId??''))throw fail();const request=validateEnrollment(input);
   let parent=root;for(;;){const s=fs.lstatSync(parent);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==(pathRoot==='/'?0:owner)||(s.mode&0o022))throw fail();
    if(parent===pathRoot)break;const up=path.dirname(parent);if(up===parent)throw fail();parent=up;}
   stage=fs.mkdtempSync(path.join(root,'ssh-'+machineId+'-'));fs.chmodSync(stage,0o700);
   const key=path.join(stage,'key'),hosts=path.join(stage,'known_hosts'),candidate=path.join(stage,'candidate');
   const secret=await readKey(request.credential_ref);if(typeof secret!=='string'||!secret.trim()||Buffer.byteLength(secret)>65536)throw fail();
   fs.writeFileSync(key,secret,{mode:0o600,flag:'wx'});
   const scan=await run('/usr/bin/ssh-keyscan',['-T','12','-p',String(request.ssh_port),request.address]);
   const trusted=[];for(const line of scan.split('\n').filter(l=>l&&!l.startsWith('#')&&l.length<8192).slice(0,16)){
    fs.writeFileSync(candidate,line+'\n',{mode:0o600});const result=await run('/usr/bin/ssh-keygen',['-lf',candidate,'-E','sha256']);
    if(result.trim().split(/\s+/)[1]===request.host_key_fingerprint.replace(/=$/,''))trusted.push(line);
   }
   if(!trusted.length)throw fail();fs.writeFileSync(hosts,trusted.join('\n')+'\n',{mode:0o600,flag:'wx'});
   const program=execution.source??source??("__name__='cecelia_onboarding'\n"+['linux-pool-bootstrap.py','linux-onboarding-remote.py'].map(name=>
    fs.readFileSync(fileURLToPath(new URL('../../scripts/fleet-worker/'+name,import.meta.url)),'utf8')).join('\n'));
   if(typeof program!=='string'||!program||Buffer.byteLength(program)>1024*1024)throw fail();
   const data=Buffer.from(JSON.stringify({...payload,machine_registry_id:machineId,remote_source:program})).toString('base64');
   if(data.length>2*1024*1024)throw fail();
   const remote=(request.ssh_user==='root'?'':'/usr/bin/sudo -n ')+'/usr/bin/python3 -c \'import sys;exec(sys.stdin.readline())\'';
   const args=['-F','/dev/null','-T','-i',key,'-p',String(request.ssh_port),'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
    '-o','IdentityAgent=none','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+hosts,'-o','GlobalKnownHostsFile=/dev/null',
    '-o','ConnectTimeout=12','-o','ConnectionAttempts=1','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2',
    '-o','PasswordAuthentication=no','-o','KbdInteractiveAuthentication=no','-o','ClearAllForwardings=yes','-o','PermitLocalCommand=no',
    '-o','RequestTTY=no','-l',request.ssh_user,request.address,remote];
   const launcher="import sys,base64,json; p=json.loads(base64.b64decode(sys.stdin.readline())); exec(compile(p.pop('remote_source'),'linux-onboarding-remote.py','exec')); print(json.dumps(dispatch(p),separators=(',',':')))\n";
   return JSON.parse(await run('/usr/bin/ssh',args,{input:launcher+data+'\n',timeoutMs:240000}));
  }catch{throw fail();}finally{if(stage)fs.rmSync(stage,{recursive:true,force:true});}
 };
}
