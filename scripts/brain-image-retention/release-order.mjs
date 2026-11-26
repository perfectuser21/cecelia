import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRuntime, ROOT} from './runtime.mjs';
import {fail, IMAGE} from './policy.mjs';
const SHA=/^[a-f0-9]{40}$/;
export const RELEASE_ORDER_LOCK_WAIT_MS=120000;
// Only acquisition BUSY may retry. A callback error must never repeat release work.
async function releaseOrderLock(store,callback,{lockWaitMs,signal,onWait,onAcquired}){
  if(!Number.isFinite(lockWaitMs)||lockWaitMs<0||lockWaitMs>RELEASE_ORDER_LOCK_WAIT_MS)throw fail('DEPLOY_ORDER_UNKNOWN');
  const deadline=performance.now()+lockWaitMs;
  let announced=false;
  const check=()=>{
    if(signal?.aborted)throw fail('DEPLOY_ORDER_CANCELLED');
    if(performance.now()>=deadline)throw Object.assign(fail('DEPLOY_ORDER_LOCK_TIMEOUT'),{wait_ms:lockWaitMs});
  };
  for(;;){
    check();let entered=false;
    try{return await store.withLock(async lease=>{check();entered=true;onAcquired?.();return callback(lease);});}
    catch(error){if(entered||error.code!=='IMAGE_RETENTION_BUSY')throw error;}
    check();if(!announced){announced=true;onWait?.();}
    try{await delay(Math.min(100,Math.max(0,deadline-performance.now())),undefined,{signal});}
    catch(error){if(signal?.aborted)throw fail('DEPLOY_ORDER_CANCELLED');throw error;}
  }
}
function current(snapshot){
  const containers=snapshot.containers.filter(x=>x.name==='/cecelia-node-brain');
  const container=containers.length===1?containers[0]:null;
  const images=container?snapshot.images.filter(x=>x.id===container.image_id):[];
  if(!container||typeof container.running!=='boolean'||!/^[a-f0-9]{64}$/.test(container.id)||images.length!==1||!IMAGE.test(images[0].id)||!SHA.test(images[0].git_sha??''))throw fail('DEPLOY_CURRENT_UNKNOWN');
  return {container_id:container.id,running:container.running,image_id:images[0].id,git_sha:images[0].git_sha};
}
// The caller holds the shared release flock across this check and every release side effect.
// Health may be broken during a forward repair; immutable Docker identity is authoritative here.
export async function assertReleaseOrder({repo,target,runtime,lockWaitMs=RELEASE_ORDER_LOCK_WAIT_MS,signal,onWait,onAcquired}){
  if(!SHA.test(target??'')||!runtime)throw fail('DEPLOY_ORDER_UNKNOWN');
  const git=args=>execFileSync('git',['-C',repo,...args],{timeout:10000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1',GIT_OPTIONAL_LOCKS:'0'}}).toString().trim();
  return releaseOrderLock(runtime.store,async lease=>{
    const before=current(await runtime.docker.snapshot(lease));
    try{for(const sha of [before.git_sha,target])if(git(['rev-parse','--verify',`${sha}^{commit}`])!==sha)throw Error();}
    catch{throw fail('DEPLOY_ORDER_UNKNOWN');}
    try{git(['merge-base','--is-ancestor',target,'refs/remotes/origin/main']);}
    catch(error){if(error.status===1)throw fail('DEPLOY_TARGET_UNMERGED');throw fail('DEPLOY_ORDER_UNKNOWN');}
    try{git(['merge-base','--is-ancestor',before.git_sha,target]);}
    catch(error){if(error.status===1)throw fail('DEPLOY_TARGET_STALE');throw fail('DEPLOY_ORDER_UNKNOWN');}
    const after=current(await runtime.docker.snapshot(lease));
    if(JSON.stringify(before)!==JSON.stringify(after))throw fail('DEPLOY_CURRENT_CHANGED');
    await lease.assertHeld();return before;
  },{lockWaitMs,signal,onWait,onAcquired});
}
async function main(){
 const controller=new AbortController(),cancel=()=>controller.abort();
 const removeSignals=()=>{process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);};
 process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
 try{
  const [repo,target]=process.argv.slice(2);if(!repo||!target||process.argv.length!==4)throw fail('DEPLOY_ORDER_UNKNOWN');
  const runtime=await createRuntime({root:process.env.CECELIA_IMAGE_RETENTION_DIR||ROOT});
  await assertReleaseOrder({repo,target,runtime,signal:controller.signal,onAcquired:removeSignals,onWait:()=>process.stderr.write(`DEPLOY_ORDER_LOCK_WAIT budget_ms=${RELEASE_ORDER_LOCK_WAIT_MS}\n`)});process.stdout.write('DEPLOY_ORDER_ACCEPTED\n');
}catch(error){process.stderr.write(`${error.code||'DEPLOY_ORDER_UNKNOWN'}${error.wait_ms===undefined?'':` budget_ms=${error.wait_ms}`}\n`);process.exitCode=1;}finally{removeSignals();}}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)await main();
