/** 巡查首次身份来自工具仓库可信main；不伪造源仓库旧SHA下的workflow run。 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PATROL_SCOPE,PATROL_REPO,validatePatrolSnapshot} from '../../packages/brain/src/lib/device-patrol-admission.js';
const REPO='perfectuser21/cecelia',BASE='73bd094ae34ecccb1514b09fd4fec8733b846769',INTRO='f0923e5396bade1986ba5452e766cabb5f4a30b3';
const fail=()=>{throw Error('PATROL_BASELINE_ORIGIN_INVALID');};
export function validatePatrolBaselineRun(run,tooling){
 if(!/^[a-f0-9]{40}$/.test(tooling)||run.head_sha!==tooling||run.head_branch!=='main'||run.event!=='workflow_dispatch'||run.path!=='.github/workflows/implementation-impact.yml'||run.conclusion!=='success'||run.repository?.full_name!==REPO||run.head_repository?.full_name!==REPO)fail();return run;
}
export function downloadPatrolBaseline(tooling,output,{execute=execFileSync}={}){
 const json=path=>JSON.parse(execute('gh',['api',`repos/${REPO}/${path}`],{encoding:'utf8'}));
 const current=json('git/ref/heads/main').object.sha,compare=json(`compare/${tooling}...${current}`);
 if(!['ahead','identical'].includes(compare.status)||compare.merge_base_commit?.sha!==tooling)fail();
 const artifact=json(`actions/artifacts?name=device-patrol-admission-${BASE}&per_page=100`).artifacts.filter(a=>!a.expired&&a.workflow_run?.head_sha===tooling&&a.workflow_run?.head_branch==='main').sort((a,b)=>b.id-a.id)[0];
 if(!artifact)throw Error('PATROL_BASELINE_ARTIFACT_MISSING');
 validatePatrolBaselineRun(json(`actions/runs/${artifact.workflow_run.id}`),tooling);
 const zip=execute('gh',['api',`repos/${REPO}/actions/artifacts/${artifact.id}/zip`],{maxBuffer:16*1024*1024});
 if(!artifact.digest||artifact.digest!==`sha256:${createHash('sha256').update(zip).digest('hex')}`)throw Error('PATROL_BASELINE_ARTIFACT_DIGEST_MISMATCH');
 mkdirSync(output,{recursive:true});const zipPath=join(output,'trusted-baseline.zip');writeFileSync(zipPath,zip);
 try{
  const snapshot=JSON.parse(execute('unzip',['-p',zipPath,'head.json'],{encoding:'utf8',maxBuffer:16*1024*1024}));
  const identity=validatePatrolSnapshot(snapshot.snapshot||snapshot);
  if(identity.scope!==PATROL_SCOPE||identity.repo!==PATROL_REPO||identity.revision!==BASE||identity.registration.provenance.base_revision!==BASE||identity.registration.provenance.introduced_revision!==INTRO)fail();
  for(const side of ['base','head']){mkdirSync(join(output,side),{recursive:true});writeFileSync(join(output,side,side==='base'?'base.json':'head.json'),JSON.stringify(snapshot));}
  writeFileSync(join(output,'patrol-baseline-origin.json'),JSON.stringify({repo:REPO,tooling_revision:tooling,workflow_run_id:artifact.workflow_run.id,artifact_id:artifact.id,digest:artifact.digest,registration_sha256:identity.registration_sha256}));
  return identity;
 }finally{rmSync(zipPath,{force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){try{downloadPatrolBaseline(process.argv[2],process.argv[3]);}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}}
