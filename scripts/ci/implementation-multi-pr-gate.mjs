#!/usr/bin/env node
/** 显式多来源快照→完整原生报告→联合准入；不创建业务运行release。 */
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,realpathSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalRepoIdentity} from '../../packages/brain/src/lib/gp-assertion-command.js';
import {collectImplementationPrEvidence,collectImplementationPrEvidenceInScratch} from './implementation-pr-gate.mjs';
import {buildVerificationInputContext,readVerificationConsumerGraphFacts} from './implementation-verification-context.mjs';
import {nonExecutableChangeKind} from './implementation-verification-inputs.mjs';
import {resolveScopedImplementationReports,runScopedImplementationGate} from './implementation-multi-scope.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const save=(root,name,value)=>writeFileSync(join(root,name),JSON.stringify(value,null,2)+'\n');
/** typed输出只允许报告/回执；原ZIP/memory view不能以legacy快照形式逸出。 */
export function assertCiAdmissionOutputFiles(root){
 const scopes=['cecelia-kr','cecelia-factory','cecelia-infra'],files=['report.json','receipt.json','gap.json'];
 const legacy=value=>value&&typeof value==='object'&&(value.schema_version===1&&typeof value.scope==='string'&&typeof value.snapshot_sha256==='string'||Object.values(value).some(legacy));
 const walk=(directory,depth)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){
  const path=join(directory,entry.name);
  if(entry.isDirectory()){if(depth!==0||!scopes.includes(entry.name))fail('IMPACT_MULTISCOPE_ADMISSION_OUTPUT_INVALID');walk(path,1);continue;}
  if(!entry.isFile()||!files.includes(entry.name))fail('IMPACT_MULTISCOPE_ADMISSION_OUTPUT_INVALID');
  let body;try{body=JSON.parse(readFileSync(path,'utf8'));}catch{fail('IMPACT_MULTISCOPE_ADMISSION_OUTPUT_INVALID');}
  if(legacy(body))fail('IMPACT_MULTISCOPE_ADMISSION_OUTPUT_INVALID');
 }};walk(root,0);return true;
}
/** handle只能由可信resolver+原ZIP认证创建；此入口仍实际投影并运行原三scope断言。 */
export async function runImplementationCiAdmissionHandleGate({repoRoot,toolingRoot,base,head,mode,outputDir},handle){
 if(mode!=='pr')fail('IMPACT_MULTISCOPE_ADMISSION_ONLY');
 const {inspectCiAdmissionInputs,withCiAdmissionInputsScratch}=await import('./ci-admission-inputs.mjs');
 const metadata=inspectCiAdmissionInputs(handle);
 if(metadata.source.repo!=='perfectuser21/cecelia'||metadata.source.base_revision!==base||metadata.source.head_revision!==head
  ||JSON.stringify(metadata.scopes)!=='["cecelia-kr","cecelia-factory","cecelia-infra"]')fail('IMPACT_MULTISCOPE_ADMISSION_SOURCE_MISMATCH');
 mkdirSync(outputDir,{recursive:true});
 return withCiAdmissionInputsScratch(handle,async({db,snapshots,source,provenance})=>{
  if(JSON.stringify(snapshots.map(s=>s.scope))!==JSON.stringify(metadata.scopes))fail('IMPACT_MULTISCOPE_SCOPE_MISMATCH');
  const reports=[];
  for(const snapshot of snapshots){
   const {report}=await collectImplementationPrEvidenceInScratch({repoRoot,toolingRoot,toolingRevision:provenance.tooling_revision,base,head,mode,scope:snapshot.scope,
    snapshotBase:snapshot,snapshotHead:snapshot,db,outputDir:join(outputDir,snapshot.scope)});reports.push(report);
  }
  assertCiAdmissionOutputFiles(outputDir);
  const actualSource=reports[0].source,input=reports[0].verification_input_evidence,retirements=reports[0].verification_retirement_candidates,entries=reports[0].verification_retirement_entry_evidence;
  if(!input||reports.some(r=>r.verification_input_evidence?.verification_inputs_sha256!==input.verification_inputs_sha256
   ||r.verification_retirement_candidates?.retirement_candidates_sha256!==retirements?.retirement_candidates_sha256||r.verification_retirement_entry_evidence?.retirement_entry_candidates_sha256!==entries?.retirement_entry_candidates_sha256))fail('IMPACT_MULTISCOPE_VERIFICATION_DISCOVERY_MISMATCH');
  const paths=actualSource.changed_files.map(c=>c.path).filter(path=>nonExecutableChangeKind(path)||retirements?.rows.some(r=>r.path===path));
  const graphs=paths.length?await readVerificationConsumerGraphFacts(db,{source:actualSource,paths,reports}):undefined;
  const context=buildVerificationInputContext({source:actualSource,evidence:input,reports,raw_consumer_graph_facts:graphs,retirement_candidates:retirements,retirement_entry_evidence:entries});
  const resolution=resolveScopedImplementationReports({source:actualSource,expectedScopes:metadata.scopes,reports,verification_input_context:context});
  save(outputDir,'report.json',resolution);
  const receipt=await runScopedImplementationGate({repoRoot,evidence:resolution.evidence,verificationDb:db,verificationToolingRoot:toolingRoot,verificationToolingRevision:provenance.tooling_revision});
  receipt.resolution_sha256=resolution.resolution_sha256;receipt.ci_admission_provenance=provenance;save(outputDir,'receipt.json',receipt);
  assertCiAdmissionOutputFiles(outputDir);
  if(receipt.verdict!=='PASS')fail('IMPACT_MULTISCOPE_REGRESSION_FAILED');
  return {report:resolution,receipt};
 });
}
export async function runImplementationMultiPrGate({repoRoot,base,head,mode,scopes,outputDir,toolingRoot,ciAdmissionInputDir}){
  if(toolingRoot!==undefined||ciAdmissionInputDir!==undefined){
   mkdirSync(outputDir,{recursive:true});
   try{
    if(mode!=='pr'||scopes!==undefined||!toolingRoot||!ciAdmissionInputDir)fail('IMPACT_MULTISCOPE_ADMISSION_INPUT_INVALID');
    const {loadCiAdmissionInputs}=await import('./ci-admission-inputs.mjs');
    const handle=await loadCiAdmissionInputs({inputDir:ciAdmissionInputDir,repoRoot,toolingRoot,mode});
    return await runImplementationCiAdmissionHandleGate({repoRoot,toolingRoot,base,head,mode,outputDir},handle);
   }catch(error){save(outputDir,'gap.json',{status:'unknown',stage:'ci_admission_scoped',code:error.code||'IMPACT_MULTISCOPE_ERROR',message:error.message});throw error;}
  }
  mkdirSync(outputDir,{recursive:true});
  try{
    if(mode!=='pr')fail('IMPACT_MULTISCOPE_ADMISSION_ONLY');
    if(!Array.isArray(scopes)||!scopes.length||scopes.some(s=>!s||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(s.scope)||!s.snapshotBase||!s.snapshotHead)||
      new Set(scopes.map(s=>s.scope)).size!==scopes.length)fail('IMPACT_MULTISCOPE_SCOPES_INVALID');
    if(![base,head].every(v=>typeof v==='string'&&/^[0-9a-f]{40}$/.test(v)))fail('IMPACT_MULTISCOPE_SOURCE_MISMATCH');
    const git=(...args)=>execFileSync('git',args,{cwd:repoRoot,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
    if(git('rev-parse','HEAD')!==head||git('status','--porcelain=v1','--untracked-files=no'))fail('IMPACT_MULTISCOPE_SOURCE_MISMATCH');
    git('merge-base','--is-ancestor',base,head);
    const repo=canonicalRepoIdentity(git('remote','get-url','origin')).replace(/^github\.com\//,'');
    const changed_files=execFileSync('git',['diff','--no-renames','--name-only','-z',base,head,'--'],{cwd:repoRoot,encoding:'utf8'}).split('\0').filter(Boolean).map(path=>({path}));
    const reports=[];
    for(const input of scopes){
      const {report}=await collectImplementationPrEvidence({repoRoot,base,head,mode,...input,outputDir:join(outputDir,input.scope)});
      reports.push(report);
    }
    const resolution=resolveScopedImplementationReports({source:{repo,base_revision:base,head_revision:head,changed_files},expectedScopes:scopes.map(s=>s.scope),reports});
    save(outputDir,'report.json',resolution);
    const receipt=await runScopedImplementationGate({repoRoot,evidence:resolution.evidence});
    receipt.resolution_sha256=resolution.resolution_sha256;
    save(outputDir,'receipt.json',receipt);
    if(receipt.verdict!=='PASS')fail('IMPACT_MULTISCOPE_REGRESSION_FAILED');
    return {report:resolution,receipt};
  }catch(error){save(outputDir,'gap.json',{status:'unknown',stage:'scoped_admission',code:error.code||'IMPACT_MULTISCOPE_ERROR',message:error.message});throw error;}
}
export function parseImplementationMultiArgs(args){
  const fields={'--repo-root':'repoRoot','--base':'base','--head':'head','--mode':'mode','--scopes-file':'scopesFile','--tooling-root':'toolingRoot','--ci-admission-input-dir':'ciAdmissionInputDir','--output-dir':'outputDir'},options={};
  for(let i=0;i<args.length;i+=2){if(!fields[args[i]]||!args[i+1]||options[fields[args[i]]])fail('IMPACT_MULTISCOPE_ARGUMENT_INVALID');options[fields[args[i]]]=args[i+1];}
  const typed=options.toolingRoot!==undefined||options.ciAdmissionInputDir!==undefined;
  const required=['repoRoot','base','head','mode','outputDir',...(typed?['toolingRoot','ciAdmissionInputDir']:['scopesFile'])];
  if(required.some(k=>!options[k]))fail('IMPACT_MULTISCOPE_ARGUMENT_MISSING');
  if(typed&&(options.scopesFile!==undefined||options.mode!=='pr'))fail('IMPACT_MULTISCOPE_ADMISSION_INPUT_INVALID');
  if(typed){options.toolingRoot=realpathSync(options.toolingRoot);options.ciAdmissionInputDir=realpathSync(options.ciAdmissionInputDir);}
  options.repoRoot=realpathSync(options.repoRoot);options.outputDir=resolve(options.outputDir);
  if(!typed)options.scopes=JSON.parse(readFileSync(options.scopesFile,'utf8'));return options;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1]))runImplementationMultiPrGate(parseImplementationMultiArgs(process.argv.slice(2)))
  .then(({receipt})=>process.stdout.write(`admission_only: ${receipt.verdict}\n`))
  .catch(error=>{process.stderr.write(`${error.code||'IMPACT_MULTISCOPE_ERROR'}: ${error.message}\n`);process.exitCode=1;});
