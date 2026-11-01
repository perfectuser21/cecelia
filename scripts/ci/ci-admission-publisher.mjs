#!/usr/bin/env node
/** CI-only publisher：先验官方main CI，再离线重建；不读取live/中央或发布生产资格。 */
import {readFileSync,mkdirSync,writeFileSync,realpathSync,rmSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCiAdmissionAuthority} from './ci-admission-authority.mjs';
import {createCiAdmissionEnvelope} from './ci-admission-envelope.mjs';
import {runCiAdmissionWorker} from './ci-admission-worker-runner.mjs';
import {fixedLocalGit} from './fixed-local-git.mjs';
const REPO='perfectuser21/cecelia',need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
function checkouts(o){for(const [root,revision] of [[o.sourceRoot,o.sourceRevision],[o.controlRoot,o.controlRevision]])need(
 fixedLocalGit(root,['rev-parse','HEAD'],{encoding:'utf8'}).trim()===revision&&!fixedLocalGit(root,['status','--porcelain=v1','--untracked-files=no'],{encoding:'utf8'}).trim(),'CI_ADMISSION_PUBLISHER_CHECKOUT');}
export async function publishCiAdmissionBaseline(options,deps={}){
 const o=options,w=o.event?.workflow_run;
 need(o.repository===REPO&&o.eventName==='workflow_run'&&o.event?.action==='completed'&&w?.id===o.sourceRunId&&w.head_sha===o.sourceRevision
  &&w.event==='push'&&w.head_branch==='main'&&w.status==='completed'&&w.conclusion==='success'&&w.repository?.full_name===REPO&&w.head_repository?.full_name===REPO,'CI_ADMISSION_PUBLISHER_EVENT');
 checkouts(o);
 const authOptions={repoRoot:o.controlRoot,sourceRevision:o.sourceRevision,controlRevision:o.controlRevision,sourceRunId:o.sourceRunId,
  publisher:{runId:o.publisherRunId,attempt:o.publisherAttempt,phase:'publishing'}};
 await verifyCiAdmissionAuthority(authOptions,deps);
 const draft=await (deps.runWorker||runCiAdmissionWorker)(o);checkouts(o);
 // 网络/执行隔离结束后重新读取真实官方身份；不能沿用过期预检。
 const authority=await verifyCiAdmissionAuthority(authOptions,deps),envelope=await createCiAdmissionEnvelope({authority,controlRoot:o.controlRoot,draft});
 const output=resolve(o.outputDir);mkdirSync(output,{mode:0o700});
 try{writeFileSync(join(output,'ci-admission.json'),JSON.stringify(envelope)+'\n',{mode:0o600,flag:'wx'});
  writeFileSync(join(output,'assertions.json'),JSON.stringify(envelope.ci_assertions)+'\n',{mode:0o600,flag:'wx'});
 }catch(error){rmSync(output,{recursive:true,force:true});throw error;}
 return {published:true,purpose:'ci_admission_only',source_revision:o.sourceRevision,control_revision:o.controlRevision,envelope_sha256:envelope.ci_envelope_sha256};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);need(args.length===3,'CI_ADMISSION_PUBLISHER_ARGUMENTS');
 const e=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
 publishCiAdmissionBaseline({sourceRoot:resolve(args[0]),controlRoot:resolve(args[1]),outputDir:resolve(args[2]),repository:process.env.GITHUB_REPOSITORY,
  eventName:process.env.GITHUB_EVENT_NAME,event:e,sourceRunId:e.workflow_run?.id,sourceRevision:e.workflow_run?.head_sha,controlRevision:process.env.GITHUB_SHA,
  publisherRunId:Number(process.env.GITHUB_RUN_ID),publisherAttempt:Number(process.env.GITHUB_RUN_ATTEMPT)}).then(result=>{if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`published=${result.published===true?'true':'false'}\n`);process.stdout.write(JSON.stringify(result)+'\n');}).catch(error=>{process.stderr.write((error.message||error.code||'CI_ADMISSION_PUBLISHER_FAILED')+'\n');process.exitCode=1;});
}
