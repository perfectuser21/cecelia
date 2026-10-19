/** Read-only, bounded SSH sessions retain existing remote lock FDs through DB COMMIT. */
import { spawn } from 'node:child_process';
import { FAILURE_PROBE_SOURCE as source } from './commander-failure-probe-source.js';
import { SSH_BASE_ARGS } from './ssh-args.js';
import { sshTargetFor, resolvePrimaryWorkerId } from '../machine-registry.js';
import { requireCommander } from './commander-v2-contract.js';
const command='env -i HOME="$HOME" PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" python3 -I -u -c '+"'import base64;exec(compile(base64.b64decode(\""+Buffer.from(source).toString('base64')+"\"),\"brain-failure-probe\",\"exec\"))'";
const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
export async function openFailureProbe(target,input,spawnFn=spawn,via=null){
 requireCommander(typeof target==='string'&&/^[a-zA-Z0-9_.@-]+$/.test(target),'probe target非法');
 requireCommander(via===null||/^[a-zA-Z0-9_.@-]+$/.test(via),'probe relay非法');
 const remote=via?'ssh '+SSH_BASE_ARGS.map(quote).join(' ')+' '+quote(target)+' '+quote(command):command;
 const child=spawnFn('ssh',[...SSH_BASE_ARGS,via??target,remote],{stdio:['pipe','pipe','pipe']});
 let buffer='',bytes=0,pending=[],queue=[],dead=null;
 const fail=error=>{dead=error;for(const p of pending.splice(0))p.reject(error);};
 const timer=setTimeout(()=>{fail(Error('failure_probe_timeout'));child.kill();},55000);timer.unref?.();
 child.stdout.on('data',chunk=>{
  bytes+=chunk.length;if(bytes>4*1024*1024){fail(Error('failure_probe_response_too_large'));child.kill();return;}
  buffer+=chunk.toString();let at;
  while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);try{const value=JSON.parse(line);if(pending.length)pending.shift().resolve(value);else queue.push(value);}catch{fail(Error('failure_probe_invalid_response'));child.kill();}}
 });
 child.stderr.resume();
 child.on('error',fail);
 const closed=new Promise(resolve=>child.on('close',code=>{clearTimeout(timer);fail(Error('failure_probe_closed'));resolve({code});}));
 function next(){if(dead)return Promise.reject(dead);if(queue.length)return Promise.resolve(queue.shift());return new Promise((resolve,reject)=>pending.push({resolve,reject}));}
 child.stdin.on('error',fail);
 child.stdin.write(JSON.stringify(input)+'\n');
 try{
  const observation=await next();
  return {observation,async recheck(){child.stdin.write('validate\n');return next();},async release(committed=false){child.stdin.end(committed?'committed\n':'abort\n');const outcome=await closed;if(outcome.code!==0&&!committed)throw Error('failure_probe_aborted');},assertAlive(){if(dead)throw dead;}};
 }catch(error){child.stdin.end('abort\n');await closed;throw Object.assign(Error('failure_probe_failed'),{cause:error});}
}
export async function failureProbeSessions(control){
 const e=control.envelope,r=e.contract.resources,workerTarget=sshTargetFor(resolvePrimaryWorkerId());
 requireCommander(control.execution_location?.ssh_target===workerTarget&&control.execution_location.run_directory===`~/wf-agent-runs/${e.run_id}`,'冻结执行位置不符');
 requireCommander(['xian-m1','xian-m4'].includes(r?.machine)&&/^[A-Za-z0-9]+$/.test(r?.device_serial??'')&&/^[-a-zA-Z0-9_.]+$/.test(r?.profile??''),'仅已登记手机资源');
 let worker,controller;
 try{
  worker=await openFailureProbe(workerTarget,{mode:'worker',envelope:e,cleanup_deadline_ms:Date.parse(e.cleanup_deadline_at)});
  // Explicit registered controller aliases only; no request host or shell fragments.
  controller=await openFailureProbe(r.machine,{mode:'controller',host:r.machine,profile:r.profile,serial:r.device_serial},spawn,workerTarget);
  return {observation:{...worker.observation,controller:controller.observation},async recheck(){const [a,b]=await Promise.all([worker.recheck(),controller.recheck()]);return {...a,controller:b};},assertAlive(){worker.assertAlive();controller.assertAlive();},async release(committed){await Promise.allSettled([worker.release(committed),controller.release(committed)]);}};
 }catch(error){await Promise.allSettled([worker?.release(false),controller?.release(false)]);throw error;}
}
