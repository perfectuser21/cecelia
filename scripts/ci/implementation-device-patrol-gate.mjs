/** 窄巡查准入：固定Git字节+中央身份+真实回归。不会伪报手机业务已运行。 */
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {PATROL_SCOPE,PATROL_REPO,PATROL_PATH,PATROL_PREFIX,PATROL_ASSERTION,sha,canonical,validatePatrolContract,validatePatrolSnapshot,patrolSourceProof} from '../../packages/brain/src/lib/device-patrol-admission.js';
const fail=code=>{throw Object.assign(Error(code),{code});};
const git=(root,...args)=>execFileSync('git',args,{cwd:root,maxBuffer:32*1024*1024});
const read=(root,revision,path)=>git(root,'show',`${revision}:${path}`);
const exists=(root,revision,path)=>{try{return !!git(root,'ls-tree','-z',revision,'--',path).length;}catch{return false;}};
const save=(root,name,value)=>writeFileSync(join(root,name),JSON.stringify(value,null,2)+'\n');
const REVIEW_TEST='scripts/ci/__tests__/pr-review-thinking.test.mjs';
const governancePaths=new Set(['.gitleaksignore','.github/workflows/pr-review.yml',REVIEW_TEST,'.github/workflows/phone-account-patrol.yml','.github/workflows/scripts/smoke/phone-account-patrol-smoke.sh','.github/workflows/scripts/smoke-baseline.txt','.github/workflows/implementation-impact.yml','scripts/ci/__tests__/implementation-impact-workflow.test.mjs','scripts/ci/__tests__/pilot-release-workflow.test.mjs']);
const projectDoc=path=>/^\.(?:prd|dod)-cp-10101635-phone-account-patrol\.md$/.test(path)||path==='docs/learnings/cp-10101635-phone-account-patrol.md';
function contractProof(root,revision,registration,{emptyAllowed=false}={}){
 if(!exists(root,revision,PATROL_PATH)){
  const treeSha=git(root,'rev-parse',`${revision}^{tree}`).toString().trim();
  if(!emptyAllowed||revision===registration.provenance.base_revision&&treeSha!==registration.provenance.base_tree_sha||git(root,'ls-tree','-rz','--name-only',revision).toString().split('\0').some(p=>p.startsWith(PATROL_PREFIX)))fail('PATROL_EMPTY_BASE_UNPROVEN');
  return {revision,kind:'verified_scope_absent',tree_sha:treeSha,absence_proof:'actual_complete_git_tree',bindings:[],auxiliary:[]};
 }
 const contract=validatePatrolContract(JSON.parse(read(root,revision,PATROL_PATH))),registered=registration.source.contract;
 for(const w of contract.workflows){const original=registered.workflows.find(r=>r.id===w.id);if(!original||original.key!==w.key||w.activities.length!==original.activities.length||w.activities.some((a,i)=>a.id!==original.activities[i].id||a.key!==original.activities[i].key))fail('PATROL_REGISTERED_IDENTITY_CHANGED');}
 return {...patrolSourceProof(contract,revision,path=>read(root,revision,path)),kind:'fixed_git_source'};
}
function runAssertion(root,path){
 const env={PATH:`${dirname(process.execPath)}:${process.platform==='darwin'?'/opt/homebrew/bin:':''}/usr/bin:/bin:/usr/sbin:/sbin`,CI:'true',NODE_ENV:'test',LANG:'C.UTF-8',PYTHONDONTWRITEBYTECODE:'1'};
 const result=spawnSync(process.execPath,['--test',path],{cwd:root,env,encoding:'utf8',timeout:300000,maxBuffer:16*1024*1024});
 return {assertion_ref:`node --test ${path}`,test_sha256:sha(readFileSync(join(root,path))),exit_code:result.status,error:result.error?.code||result.signal||null,stdout_sha256:sha(result.stdout||''),stderr_sha256:sha(result.stderr||'')};
}
/** CI配置消费必须真实校验；新配置不得把检查改成可跳过或continue-on-error。 */
export function validatePatrolSecretIgnore(before,after,readLine){
 if(!after.startsWith(before))fail('PATROL_SECRET_IGNORE_CHANGED');
 const added=after.slice(before.length).split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
 if(added.length!==1)fail('PATROL_SECRET_IGNORE_SCOPE');
 const match=/^([a-f0-9]{40}):scripts\/phone-account-patrol\/test_deploy\.py:generic-api-key:7$/.exec(added[0]);if(!match)fail('PATROL_SECRET_IGNORE_SCOPE');
 const sourceLine=readLine(match[1],'scripts/phone-account-patrol/test_deploy.py',7).trim();
 const exact="good = {key: '66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff' for key in ['single_workflow_id', 'batch_workflow_id', 'schedule_id', 'project_id']}";
 if(sourceLine!==exact)fail('PATROL_SECRET_IGNORE_NOT_PUBLIC_IDENTITY');return {fingerprint:added[0],historical_line_sha256:sha(sourceLine)};
}
function governanceProof(root,base,head,path){
 const bytes=read(root,head,path),text=bytes.toString();let extra={};
 if(path==='.gitleaksignore')extra=validatePatrolSecretIgnore(read(root,base,path).toString(),text,(revision,file,line)=>{git(root,'merge-base','--is-ancestor',revision,head);return read(root,revision,file).toString().split('\n')[line-1]||'';});
 if(path.endsWith('.yml')&&(/continue-on-error:\s*true/.test(text)||/allow_failure|skip.check|--no-verify/.test(text)))fail('PATROL_GOVERNANCE_FAIL_OPEN');
 if(path==='.github/workflows/scripts/smoke-baseline.txt'){
  const before=read(root,base,path).toString().trim().split('\n'),after=text.trim().split('\n');
  if(after.length!==before.length+1||before.some(line=>!after.includes(line))||!after.includes('phone-account-patrol-smoke.sh'))fail('PATROL_SMOKE_BASELINE_CHANGED');
 }
 if(path==='.github/workflows/pr-review.yml'&&(!text.includes('thinking')||!text.includes('disabled')||!text.includes('4096')||!text.includes('exit 1')))fail('PATROL_REVIEW_CONTRACT_CHANGED');
 if(path==='.github/workflows/phone-account-patrol.yml'&&(!text.includes('unittest')||!text.includes('compileall')))fail('PATROL_CI_REGRESSION_MISSING');
 if(path==='.github/workflows/scripts/smoke/phone-account-patrol-smoke.sh'&&(!text.includes('unittest')||!text.includes('compileall')||!text.includes('set -e')))fail('PATROL_SMOKE_CHECK_MISSING');
 return {...extra,path,kind:projectDoc(path)?'project_document':'verification_governance',owner:'开发交付治理',capability_id:'ec4eb591-e064-4886-a7b6-4452cdf333d2',head_sha256:sha(bytes),base_sha256:exists(root,base,path)?sha(read(root,base,path)):null};
}
export async function runDevicePatrolGate(options){
 const {repoRoot,base,head,outputDir,snapshotBase,snapshotHead,mode}=options;mkdirSync(outputDir,{recursive:true});
 try{
  if(!['pr','main'].includes(mode)||options.scope!==PATROL_SCOPE||!/^[a-f0-9]{40}$/.test(base)||!/^[a-f0-9]{40}$/.test(head)||git(repoRoot,'rev-parse','HEAD').toString().trim()!==head||git(repoRoot,'status','--porcelain=v1','--untracked-files=no').length)fail('PATROL_SOURCE_MISMATCH');
  const remote=git(repoRoot,'remote','get-url','origin').toString().trim();if(!remote.endsWith(`${PATROL_REPO}.git`)&&!remote.endsWith(PATROL_REPO))fail('PATROL_REPO_MISMATCH');
  git(repoRoot,'merge-base','--is-ancestor',base,head);
  const unwrap=path=>{const value=JSON.parse(readFileSync(path));return validatePatrolSnapshot(value.snapshot||value);};
  const baseline=unwrap(snapshotBase),candidate=unwrap(snapshotHead),registration=baseline.registration;
  if(![base,registration.provenance.base_revision].includes(baseline.revision)||baseline.registration_sha256!==candidate.registration_sha256||baseline.registration_sha256!==sha(JSON.stringify(canonical(registration)))||registration.source.source_sha256!==sha(JSON.stringify(canonical((({source_sha256,...body})=>body)(registration.source)))))fail('PATROL_REGISTRATION_CONFLICT');
  git(repoRoot,'merge-base','--is-ancestor',registration.provenance.introduced_revision,head);
  const original=contractProof(repoRoot,registration.provenance.introduced_revision,registration);if(original.source_sha256!==registration.source.source_sha256)fail('PATROL_INTRODUCED_BYTES_MISMATCH');
  const before=contractProof(repoRoot,base,registration,{emptyAllowed:true}),after=contractProof(repoRoot,head,registration);
  const changed_files=git(repoRoot,'diff','--no-renames','--name-only','-z',base,head,'--').toString().split('\0').filter(Boolean);
  const paths=new Set([...before.bindings,...after.bindings].map(b=>b.path)),auxiliary=new Set([...before.auxiliary,...after.auxiliary].map(a=>a.path)),governance=[],coverage=[];
  for(const path of changed_files){
   if(paths.has(path))coverage.push({path,kind:'code',bindings:after.bindings.filter(b=>b.path===path)});
   else if(auxiliary.has(path))coverage.push({path,kind:path===PATROL_PATH?'fixed_definition':'auxiliary',head_sha256:exists(repoRoot,head,path)?sha(read(repoRoot,head,path)):null});
   else if(governancePaths.has(path)||projectDoc(path)){const proof=governanceProof(repoRoot,base,head,path);governance.push(proof);coverage.push(proof);}
   else fail(`PATROL_CHANGED_FILE_UNCLAIMED:${path}`);
  }
  const assertions=[runAssertion(repoRoot,PATROL_ASSERTION.replace('node --test ',''))];
  if(governance.some(g=>g.path==='.github/workflows/pr-review.yml'||g.path===REVIEW_TEST))assertions.push(runAssertion(repoRoot,REVIEW_TEST));
  if(governance.some(g=>g.path==='.github/workflows/implementation-impact.yml'))assertions.push(runAssertion(repoRoot,'scripts/ci/__tests__/implementation-impact-workflow.test.mjs'),runAssertion(repoRoot,'scripts/ci/__tests__/pilot-release-workflow.test.mjs'));
  if(git(repoRoot,'rev-parse','HEAD').toString().trim()!==head||git(repoRoot,'status','--porcelain=v1','--untracked-files=no').length)fail('PATROL_SOURCE_CHANGED_DURING_TEST');
  const report={schema_version:1,scope:PATROL_SCOPE,purpose:mode==='pr'?'admission_only':'source_release',source:{repo:PATROL_REPO,base_revision:base,head_revision:head,changed_files},registration_sha256:baseline.registration_sha256,base:before,head:after,file_coverage:coverage,governance_evidence:governance,unclaimed_paths:[],mapping_status:'verified',business_runtime_status:'not_evaluated'};
  save(outputDir,'report.json',report);const receipt={schema_version:1,source:report.source,purpose:report.purpose,actor:'implementation_ci_gate',report_sha256:sha(JSON.stringify(canonical(report))),verdict:assertions.every(a=>a.exit_code===0&&!a.error)?'PASS':'FAIL',assertions,business_runtime_status:'not_evaluated'};save(outputDir,'receipt.json',receipt);
  if(receipt.verdict!=='PASS')fail('PATROL_REGRESSION_FAILED');return {report,receipt};
 }catch(error){save(outputDir,'gap.json',{status:'unknown',code:error.code||'PATROL_ADMISSION_ERROR',message:error.message});throw error;}
}
