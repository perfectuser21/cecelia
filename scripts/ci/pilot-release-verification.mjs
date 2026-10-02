#!/usr/bin/env node
/** main固定快照的全部声明回归；独立于PR变更归属，不改变影响报告。 */
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateImplementationSnapshot} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import {buildPilotReleasePlan,assertPilotReleaseReport} from '../../packages/brain/src/lib/pilot-release-verification.js';
import {runRegisteredAssertions} from './implementation-gate.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const sha=v=>createHash('sha256').update(v).digest('hex');
export async function runPilotReleaseVerification({repoRoot,snapshot,outputDir,event,ref}){
 mkdirSync(outputDir,{recursive:true});const save=(name,data)=>writeFileSync(join(outputDir,name),JSON.stringify(data,null,2)+'\n');
 try{
  if(!['push','workflow_dispatch'].includes(event)||ref!=='refs/heads/main')fail('PILOT_RELEASE_MAIN_REQUIRED');
  const s=validateImplementationSnapshot(snapshot);
  if(s.status!=='verified'||s.gaps?.length)fail('PILOT_RELEASE_SNAPSHOT_UNKNOWN');
  if(![['zenithjoy','perfectuser21/zenithjoy-workspace'],['cecelia-kr','perfectuser21/cecelia']].some(([scope,repo])=>s.scope===scope&&s.repo===repo))fail('PILOT_RELEASE_SCOPE_UNSUPPORTED');
  const git=(...args)=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(git('rev-parse','HEAD')!==s.revision||git('rev-parse','refs/remotes/origin/main')!==s.revision||git('status','--porcelain=v1','--untracked-files=no'))fail('PILOT_RELEASE_SOURCE_MISMATCH');
  const report={...buildPilotReleasePlan({scope:s.scope,repo:s.repo,revision:s.revision,definitions:s.definitions,assertions:s.assertions}),snapshot_sha256:s.snapshot_sha256};
  save('head.json',{snapshot:s});save('report.json',report);assertPilotReleaseReport(report);
  for(const a of s.definitions.activities)for(const b of a.payload.implementation_bindings||[]){
   if(b.status!=='verified'||b.repo!==s.repo||b.revision!==s.revision||typeof b.path!=='string'||b.path.startsWith('/')||b.path.split('/').some(p=>!p||p==='..'||p==='.')||b.path.includes('\\'))fail('PILOT_RELEASE_COMPONENT_UNKNOWN');
   const bytes=execFileSync('git',['show',`${s.revision}:${b.path}`],{cwd:repoRoot,maxBuffer:16*1024*1024});
   if(b.digest!==`sha256:${sha(bytes)}`||!bytes.equals(readFileSync(resolve(repoRoot,b.path))))fail('PILOT_RELEASE_COMPONENT_CHANGED');
  }
  const assertions=await runRegisteredAssertions({repoRoot,source:report.source,required_assertions:report.required_assertions});
  const receipt={schema_version:1,purpose:'release_verification',actor:'pilot_release_verification',scope:'declared_pilot_regressions',source:report.source,snapshot_sha256:s.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,report_sha256:sha(JSON.stringify(report)),assertions,verdict:assertions.length===report.required_assertions.length&&assertions.every(a=>a.exit_code===0&&!a.error&&!a.signal)?'PASS':'FAIL',business_runtime_status:'not_evaluated',recorded_at:new Date().toISOString()};
  save('receipt.json',receipt);if(receipt.verdict!=='PASS')fail('PILOT_RELEASE_REGRESSION_FAILED');return {report,receipt};
 }catch(error){save('gap.json',{status:'unknown',stage:'pilot_release_verification',code:error.code||'PILOT_RELEASE_ERROR'});throw error;}
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 try{const options={};for(let i=2;i<process.argv.length;i+=2){const key={'--repo-root':'repoRoot','--snapshot':'snapshotPath','--output-dir':'outputDir','--event':'event','--ref':'ref'}[process.argv[i]];if(!key||!process.argv[i+1]||options[key])fail('PILOT_RELEASE_ARGUMENT_INVALID');options[key]=process.argv[i+1];}
  if(Object.keys(options).length!==5)fail('PILOT_RELEASE_ARGUMENT_MISSING');const body=JSON.parse(readFileSync(options.snapshotPath,'utf8'));await runPilotReleaseVerification({...options,snapshot:body.snapshot||body});
 }catch(error){process.stderr.write(`${error.code||'PILOT_RELEASE_ERROR'}\n`);process.exitCode=1;}
}
