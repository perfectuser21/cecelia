import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {loadNativeAgentSettings} from './native-agent-settings.js';
import {resolvePrimaryWorkerId,resolveMachineId,sshTargetFor} from '../machine-registry.js';
import {SSH_BASE_ARGS} from './ssh-args.js';
const safePath=p=>typeof p==='string'&&p.startsWith('/')&&path.posix.normalize(p)===p&&/^\/[A-Za-z0-9._/-]+$/.test(p)&&!p.split('/').includes('..');
export async function resolveNativeAgentHost(env=process.env){
 const settings=loadNativeAgentSettings(env);
 if(!safePath(settings.release_root))throw Error('native_agent_unconfigured');
 const {computeBundleDigest}=await import('../../scripts/native-agent/bundle.mjs');
 const digest=computeBundleDigest(fileURLToPath(new URL('../../',import.meta.url)));
 if(env.BRAIN_NATIVE_AGENT_BUNDLE_SHA256&&env.BRAIN_NATIVE_AGENT_BUNDLE_SHA256!==digest)throw Error('native_agent_bundle_mismatch');
 const release=settings.release_root+'/'+digest;
 const host={machine_id:resolveMachineId(settings.machine_id??resolvePrimaryWorkerId()),bundle_sha256:digest,
  cli_path:release+'/scripts/native-agent/cli.mjs',config_path:release+'/operator-config.json'};
 sshTargetFor(host.machine_id);
 if(env.BRAIN_NATIVE_AGENT_CLI_PATH&&env.BRAIN_NATIVE_AGENT_CLI_PATH!==host.cli_path||env.BRAIN_NATIVE_AGENT_CONFIG_PATH&&env.BRAIN_NATIVE_AGENT_CONFIG_PATH!==host.config_path)throw Error('native_agent_release_path_mismatch');
 return host;
}
export function nativeAgentTransport(host,request,{spawnFn=spawn,timeoutMs=20000}={}){
 if(!safePath(host.cli_path)||!safePath(host.config_path)||!/^([a-f0-9]{64})$/.test(host.bundle_sha256??''))throw Error('native_agent_transport_invalid');
 const target=sshTargetFor(host.machine_id);
 return new Promise((resolve,reject)=>{
  const child=spawnFn('ssh',[...SSH_BASE_ARGS,target,`node '${host.cli_path}' '${host.config_path}' '${host.bundle_sha256}'`],{stdio:['pipe','pipe','pipe']});
  child.stdout.setEncoding('utf8');
  let output='',error='',settled=false;
  const finish=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(value);};
  const timer=setTimeout(()=>{child.kill('SIGTERM');finish(Error('native_agent_transport_unconfirmed'));},timeoutMs);
  child.stdout.on('data',x=>{output+=x;if(Buffer.byteLength(output)>4*1024*1024){child.kill('SIGTERM');finish(Error('native_agent_transport_unconfirmed'));}});
  child.stderr.on('data',x=>{if(error.length<2048)error+=x;});
  child.once('error',()=>finish(Error('native_agent_transport_unconfirmed')));
  child.once('close',()=>{try{finish(null,JSON.parse(output));}catch{finish(Error('native_agent_transport_unconfirmed'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
 });
}
