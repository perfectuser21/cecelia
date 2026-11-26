import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRuntime, ROOT} from './runtime.mjs';
import {fail, IMAGE} from './policy.mjs';
const SHA=/^[a-f0-9]{40}$/;
function current(snapshot){
  const containers=snapshot.containers.filter(x=>x.name==='/cecelia-node-brain');
  const container=containers.length===1?containers[0]:null;
  const images=container?snapshot.images.filter(x=>x.id===container.image_id):[];
  if(!container||typeof container.running!=='boolean'||!/^[a-f0-9]{64}$/.test(container.id)||images.length!==1||!IMAGE.test(images[0].id)||!SHA.test(images[0].git_sha??''))throw fail('DEPLOY_CURRENT_UNKNOWN');
  return {container_id:container.id,running:container.running,image_id:images[0].id,git_sha:images[0].git_sha};
}
// The caller holds the shared release flock across this check and every release side effect.
// Health may be broken during a forward repair; immutable Docker identity is authoritative here.
export async function assertReleaseOrder({repo,target,runtime}){
  if(!SHA.test(target??'')||!runtime)throw fail('DEPLOY_ORDER_UNKNOWN');
  const git=args=>execFileSync('git',['-C',repo,...args],{timeout:10000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_NO_REPLACE_OBJECTS:'1',GIT_OPTIONAL_LOCKS:'0'}}).toString().trim();
  return runtime.store.withLock(async lease=>{
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
  });
}
async function main(){try{
  const [repo,target]=process.argv.slice(2);if(!repo||!target||process.argv.length!==4)throw fail('DEPLOY_ORDER_UNKNOWN');
  const runtime=await createRuntime({root:process.env.CECELIA_IMAGE_RETENTION_DIR||ROOT});
  await assertReleaseOrder({repo,target,runtime});process.stdout.write('DEPLOY_ORDER_ACCEPTED\n');
}catch(error){process.stderr.write(`${error.code||'DEPLOY_ORDER_UNKNOWN'}\n`);process.exitCode=1;}}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)await main();
