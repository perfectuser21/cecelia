#!/usr/bin/env node
/** 显式多来源快照→完整原生报告→联合准入；不创建业务运行release。 */
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonicalRepoIdentity} from '../../packages/brain/src/lib/gp-assertion-command.js';
import {collectImplementationPrEvidence} from './implementation-pr-gate.mjs';
import {resolveScopedImplementationReports,runScopedImplementationGate} from './implementation-multi-scope.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const save=(root,name,value)=>writeFileSync(join(root,name),JSON.stringify(value,null,2)+'\n');
export async function runImplementationMultiPrGate({repoRoot,base,head,mode,scopes,outputDir}){
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
  const fields={'--repo-root':'repoRoot','--base':'base','--head':'head','--mode':'mode','--scopes-file':'scopesFile','--output-dir':'outputDir'},options={};
  for(let i=0;i<args.length;i+=2){if(!fields[args[i]]||!args[i+1]||options[fields[args[i]]])fail('IMPACT_MULTISCOPE_ARGUMENT_INVALID');options[fields[args[i]]]=args[i+1];}
  if(Object.values(fields).some(k=>!options[k]))fail('IMPACT_MULTISCOPE_ARGUMENT_MISSING');
  options.repoRoot=realpathSync(options.repoRoot);options.outputDir=resolve(options.outputDir);
  options.scopes=JSON.parse(readFileSync(options.scopesFile,'utf8'));return options;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1]))runImplementationMultiPrGate(parseImplementationMultiArgs(process.argv.slice(2)))
  .then(({receipt})=>process.stdout.write(`admission_only: ${receipt.verdict}\n`))
  .catch(error=>{process.stderr.write(`${error.code||'IMPACT_MULTISCOPE_ERROR'}: ${error.message}\n`);process.exitCode=1;});
