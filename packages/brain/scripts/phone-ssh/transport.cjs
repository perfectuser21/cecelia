'use strict';
const {spawn}=require('node:child_process');
const {targetValid}=require('./protocol.cjs');
const KNOWN_HOSTS='/etc/cecelia/phone-ssh/known_hosts';
const HUB_COMMAND='/opt/homebrew/bin/node /opt/cecelia/phone-ssh/hub.cjs';
const RUNNER_COMMAND='/opt/homebrew/bin/python3 /opt/cecelia/phone-ssh/runner.py';
function sshArgs(target,command){
 if(!targetValid(target)||![HUB_COMMAND,RUNNER_COMMAND].includes(command))throw Error('phone_endpoint_invalid');
 return ['-F','/dev/null','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',`UserKnownHostsFile=${KNOWN_HOSTS}`,
  '-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','ForwardAgent=no','-o','ClearAllForwardings=yes',
  '-o','PermitLocalCommand=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=5',
  '-o','ServerAliveInterval=2','-o','ServerAliveCountMax=2','-l',target.user,'-p',String(target.port),'--',target.host,command];
}
function runSsh(file,args,input,{timeoutMs=10000,maxBytes=65536,spawnProcess=spawn,signal}={}){
 if(file!=='/usr/bin/ssh'||typeof input!=='string'||Buffer.byteLength(input)>16384)throw Error('phone_transport_invalid');
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Error('phone_ssh_cancelled'));return;}
  const child=spawnProcess(file,args,{shell:false,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C',...(process.env.HOME?{HOME:process.env.HOME}:{}),...(process.env.SSH_AUTH_SOCK?{SSH_AUTH_SOCK:process.env.SSH_AUTH_SOCK}:{})}});
  let done=false,total=0;const chunks=[];
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){child.kill('SIGKILL');reject(Error(error));}else resolve(result);};
  const abort=()=>finish('phone_ssh_cancelled');
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>finish('phone_ssh_timeout'),timeoutMs);
  child.on('error',()=>finish('phone_ssh_unavailable'));
  child.stdin.on('error',()=>finish('phone_ssh_stdin_unavailable'));
  child.stdout.on('data',chunk=>{total+=chunk.length;if(total>maxBytes)finish('phone_ssh_reply_oversized');else chunks.push(chunk);});
  child.stderr.on('data',chunk=>{total+=chunk.length;if(total>maxBytes)finish('phone_ssh_reply_oversized');});
  child.on('close',code=>finish(null,{code,stdout:Buffer.concat(chunks).toString('utf8')}));
  child.stdin.end(input);
 });
}
module.exports={sshArgs,runSsh,HUB_COMMAND,RUNNER_COMMAND};
