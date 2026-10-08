#!/usr/bin/env node
/** 实际PR/main入口；中央连接只用于先前下载的快照，回归执行仅持scratch能力。 */
import { execFileSync } from 'node:child_process';
import { readFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectGovernanceEvidence,applyGovernanceCoverage } from './registry-lint.mjs';
import { runImplementationGate } from './implementation-gate.mjs';
import { collectAuxiliarySourceEvidence, auxiliaryOwnerPaths, applyAuxiliarySourceEvidence } from './implementation-auxiliary-evidence.mjs';
import { createImplementationScratch,importImplementationSnapshot,projectImplementationSnapshot,buildPrImplementationSnapshot } from './implementation-snapshot.mjs';
import { ciFailure,validateImplementationSnapshot } from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
import { canonicalRepoIdentity } from '../../packages/brain/src/lib/gp-assertion-command.js';
import { readImplementationImpact } from '../../packages/brain/src/lib/implementation-impact.js';
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const read=path=>{const data=JSON.parse(readFileSync(path,'utf8'));return data.snapshot||data;};
const save=(dir,name,data)=>writeFileSync(join(dir,name),JSON.stringify(data,null,2)+'\n');
export async function runImplementationPrGate({repoRoot,scope,base,head,mode,snapshotBase,snapshotHead,outputDir}){
  mkdirSync(outputDir,{recursive:true});let scratch,worktree,headWorktree,parent;
  try{
    if(!['pr','main'].includes(mode)||typeof scope!=='string'||!scope||![base,head].every(v=>typeof v==='string'&&/^[0-9a-f]{40}$/.test(v)))throw ciFailure('INPUT_INVALID');
    const repo=canonicalRepoIdentity(git(repoRoot,'remote','get-url','origin')).replace(/^github\.com\//,'');
    if(git(repoRoot,'rev-parse','HEAD')!==head||git(repoRoot,'status','--porcelain=v1','--untracked-files=no'))throw ciFailure('SOURCE_MISMATCH');
    git(repoRoot,'merge-base','--is-ancestor',base,head);
    const b=validateImplementationSnapshot(read(snapshotBase));let h=validateImplementationSnapshot(read(snapshotHead));
    if(b.scope!==scope||h.scope!==scope||b.repo!==repo||h.repo!==repo||b.revision!==base||mode==='main'&&h.revision!==head)
      throw ciFailure('SNAPSHOT_SOURCE_MISMATCH','snapshot必须匹配实际repo/base/head');
    scratch=await createImplementationScratch();
    parent=mkdtempSync(join(tmpdir(),'implementation-base-'));worktree=join(parent,'checkout');
    git(repoRoot,'worktree','add','--detach',worktree,base);
    headWorktree=join(parent,'head');git(repoRoot,'worktree','add','--detach',headWorktree,head);
    await importImplementationSnapshot(scratch.db,b);await projectImplementationSnapshot(scratch.db,b,worktree);
    await importImplementationSnapshot(scratch.db,h);
    if(mode==='pr'){h=await buildPrImplementationSnapshot(scratch.db,h,head,repoRoot);save(outputDir,'candidate.json',h);}
    await projectImplementationSnapshot(scratch.db,h,headWorktree);
    const changed_files=execFileSync('git',['diff','--no-renames','--name-only','-z',base,head,'--'],{cwd:repoRoot,encoding:'utf8'}).split('\0').filter(Boolean).map(path=>({path}));
    const source={repo,base_revision:base,head_revision:head};
    const auxiliary=collectAuxiliarySourceEvidence(repoRoot,source),owners=auxiliaryOwnerPaths(auxiliary);
    const queryPaths=[...changed_files,...owners.filter(p=>!changed_files.some(f=>f.path===p)).map(path=>({path}))];
    const report=await readImplementationImpact(scratch.db,{scope,...source,changed_files:queryPaths});
    // owner查询使用同一固定图/定义；PR真实diff仍保持原样，绝不把辅助关系写成import边。
    const ownerCoverage={};
    for(const side of ['base','head']){
      ownerCoverage[side]=owners.map(path=>report[side].file_coverage.find(f=>f.path===path)).filter(Boolean).map(({path,matched_paths,truncated})=>({path,matched_paths,truncated}));
      report[side].file_coverage=report[side].file_coverage.slice(0,changed_files.length);
    }
    report.source.changed_files=changed_files;
    const actualPaths=new Set(changed_files.map(f=>f.path));
    report.unclaimed_paths=report.unclaimed_paths.filter(f=>actualPaths.has(f.path));
    for(const gap of report.gaps)if(gap.code==='changed_file_unclaimed'&&!actualPaths.has(gap.path))gap.code='auxiliary_owner_unclaimed';
    applyAuxiliarySourceEvidence(report,auxiliary,ownerCoverage);
    report.ci_context={purpose:mode==='pr'?'admission_only':'release',base_snapshot_sha256:b.snapshot_sha256,head_snapshot_sha256:h.snapshot_sha256};
    applyGovernanceCoverage(report,collectGovernanceEvidence(repoRoot,report.source));
    save(outputDir,'report.json',report);
    const receipt=await runImplementationGate({repoRoot,report});receipt.purpose=report.ci_context.purpose;
    save(outputDir,'receipt.json',receipt);
    if(receipt.verdict!=='PASS')throw ciFailure('REGRESSION_FAILED');
    return {report,receipt};
  }catch(error){save(outputDir,'gap.json',{status:'unknown',stage:'snapshot_or_gate',code:error.code||'IMPLEMENTATION_CI_ERROR',message:error.message});throw error;}
  finally{
    if(scratch)await scratch.close();
    try{for(const checkout of [worktree,headWorktree].filter(Boolean))git(repoRoot,'worktree','remove','--force',checkout);}finally{if(parent)rmSync(parent,{recursive:true,force:true});}
  }
}
function parseArgs(args){
  const allowed={'--repo-root':'repoRoot','--scope':'scope','--base':'base','--head':'head','--mode':'mode','--snapshot-base':'snapshotBase','--snapshot-head':'snapshotHead','--output-dir':'outputDir'},options={};
  for(let i=0;i<args.length;i+=2){if(!allowed[args[i]]||!args[i+1]||options[allowed[args[i]]])throw ciFailure('ARGUMENT_INVALID');options[allowed[args[i]]]=args[i+1];}
  if(Object.values(allowed).some(k=>!options[k]))throw ciFailure('ARGUMENT_MISSING');
  options.repoRoot=realpathSync(options.repoRoot);options.outputDir=resolve(options.outputDir);return options;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1])){
  runImplementationPrGate(parseArgs(process.argv.slice(2))).then(({receipt})=>process.stdout.write(`${receipt.purpose}: ${receipt.verdict}\n`))
    .catch(error=>{process.stderr.write(`${error.code||'IMPLEMENTATION_CI_ERROR'}: ${error.message}\n`);process.exitCode=1;});
}
