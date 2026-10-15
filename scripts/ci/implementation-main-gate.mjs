/** 官方 main 的双来源验证；消费固定 bundle，不创建 PR candidate 或业务 release。 */
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalRepoIdentity} from '../../packages/brain/src/lib/gp-assertion-command.js';
import {extractImplementationAdmissionSnapshots} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import {collectImplementationPrEvidence} from './implementation-pr-gate.mjs';
import {resolveScopedImplementationReports,runScopedImplementationGate} from './implementation-multi-scope.mjs';
const scopes=['cecelia-kr','cecelia-factory'];
const fail=code=>{throw Object.assign(Error(code),{code});};
const save=(root,name,value)=>writeFileSync(join(root,name),JSON.stringify(value,null,2)+'\n');
export async function runImplementationMainGate(options){
 const {repoRoot,scope,base,head,mode,snapshotBase,snapshotHead,outputDir,mainScopes}=options;
 mkdirSync(outputDir,{recursive:true});
 try{
  let request;try{request=JSON.parse(mainScopes);}catch{fail('IMPLEMENTATION_MAIN_SCOPES_INVALID');}
  if(mode!=='main'||scope!=='cecelia-kr'||!request||Object.keys(request).sort().join(',')!=='schema_version,scopes'||request.schema_version!==1||JSON.stringify(request.scopes)!==JSON.stringify(scopes))fail('IMPLEMENTATION_MAIN_SCOPES_INVALID');
  const git=(...args)=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
  const repo=canonicalRepoIdentity(git('remote','get-url','origin')).replace(/^github\.com\//,'');
  if(repo!=='perfectuser21/cecelia')fail('IMPLEMENTATION_MAIN_REPO_INVALID');
  if(![base,head].every(v=>typeof v==='string'&&/^[0-9a-f]{40}$/.test(v))||base===head||git('rev-parse','HEAD')!==head||git('status','--porcelain=v1','--untracked-files=no'))fail('IMPLEMENTATION_MAIN_SOURCE_MISMATCH');
  git('merge-base','--is-ancestor',base,head);
  const inputs={};
  for(const [side,file,revision] of [['base',snapshotBase,base],['head',snapshotHead,head]]){
   const data=JSON.parse(readFileSync(file,'utf8'));
   inputs[side]=extractImplementationAdmissionSnapshots(data.snapshot||data,scopes);
   if(inputs[side].some(s=>s.repo!==repo||s.revision!==revision))fail('IMPLEMENTATION_MAIN_SNAPSHOT_SOURCE_MISMATCH');
  }
  const reports=[];
  for(const [index,target] of scopes.entries()){
   const dir=join(outputDir,target);mkdirSync(dir,{recursive:true});
   save(dir,'base.json',inputs.base[index]);save(dir,'head.json',inputs.head[index]);
   const {report}=await collectImplementationPrEvidence({repoRoot,scope:target,base,head,mode:'main',snapshotBase:join(dir,'base.json'),snapshotHead:join(dir,'head.json'),outputDir:dir});
   reports.push(report);
  }
  const changed_files=execFileSync('git',['diff','--no-renames','--name-only','-z',base,head,'--'],{cwd:repoRoot,encoding:'utf8'}).split('\0').filter(Boolean).map(path=>({path}));
  const resolution=resolveScopedImplementationReports({source:{repo,base_revision:base,head_revision:head,changed_files},expectedScopes:scopes,reports,purpose:'main_verification'});
  save(outputDir,'report.json',resolution);
  const receipt=await runScopedImplementationGate({repoRoot,evidence:resolution.evidence});
  receipt.resolution_sha256=resolution.resolution_sha256;save(outputDir,'receipt.json',receipt);
  if(receipt.verdict!=='PASS')fail('IMPLEMENTATION_MAIN_REGRESSION_FAILED');
  return {report:resolution,receipt};
 }catch(error){save(outputDir,'gap.json',{status:'unknown',stage:'scoped_main',code:error.code||'IMPLEMENTATION_MAIN_ERROR',message:error.message});throw error;}
}
