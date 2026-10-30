/** 已独立准入并合并的 main，仅在隔离 scratch 编译来源；不更新中央登记或部署状态。 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync,renameSync,mkdirSync,mkdtempSync,rmSync,readFileSync,cpSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import yaml from 'js-yaml';
import {fixedLocalGit,readFixedLocalGitBlob} from './fixed-local-git.mjs';
import {readNativeConsumerRuntime} from '../../packages/brain/src/lib/native-consumer-runtime.js';
import {stepSha256} from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {extractImplementationAdmissionSnapshots,validateImplementationSnapshot,exportImplementationSnapshot} from '../../packages/brain/src/lib/implementation-ci-snapshot.js';
const REPO='perfectuser21/cecelia',SHA=/^[0-9a-f]{40}$/;
export const RECOVERY_BRIDGE=Object.freeze({baseline:'f63efa7d82a8f9f9f0084b85a70e562f0a499c7e',directBase:'706f2e834afef562f4690a44e7fd1e3c80f25c83',pr:6591,prHead:'f99b83a656d73a1378dcaaa83b3865280f9a9652'});
export const RECOVERY_SOURCE_BRIDGE=Object.freeze({baseline:'e3a01021ee7100b83d8ed5a0be219d0b543b5dff',directBase:'061a8a1784ffd02fdf1e3071390b2036e70d9395',pr:6705,prHead:'ccb91741f947b0bd864ea01f38aed85af15adcf8'});
const recoveryBridge=(base,directBase)=>[RECOVERY_BRIDGE,RECOVERY_SOURCE_BRIDGE].find(b=>b.baseline===base&&b.directBase===directBase);
const REVIEWED_DEPLOYS=new Set([
 'a77963695be92a5e55f6a5260c283d1d18ce6ce7398be8915d39ea49380e059e', // 旧生产脚本
 '6858cc545b52fc20c15c401161cb73cec3fbbf96abf59762255507961cfe945b', // drain P1 固定候选
]);
const COLLECTORS=readNativeConsumerRuntime().files.map(f=>f.path);
const ALLOWED=new Set([...COLLECTORS,'.implementation-source-relations.json','scripts/brain-deploy.sh',
 'tests/packages/brain/post-deploy-selfcheck-contract.test.js',
 'packages/brain/src/__tests__/claude-channel-retired.reader-tuples.test.js',
 'packages/brain/src/lib/__tests__/workspace-ci-source-bundle.test.js',
 'scripts/smoke/gate3-brain-deploy-smoke.sh',
 'packages/brain/scripts/smoke/factory-f2-deploy-smoke.sh','tests/regression/gate3-sha-truth/sha-account.test.sh',
 '.github/workflows/implementation-impact.yml','.github/workflows/ci.yml',
 'scripts/ci/implementation-source-ready.mjs','scripts/ci/implementation-main-snapshot.mjs',
 'scripts/ci/implementation-source-recovery.mjs','scripts/ci/implementation-main-gate.mjs',
 'scripts/ci/implementation-pr-gate.mjs','scripts/ci/implementation-snapshot.mjs',
 'packages/brain/package.json','packages/brain/VERSION','packages/brain/package-lock.json','package-lock.json','.brain-versions','DEFINITION.md']);
const fail=code=>{throw Object.assign(Error(code),{code});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>fixedLocalGit(root,args,{encoding:'utf8'}).trim();
const blob=(root,revision,path)=>readFixedLocalGitBlob(root,{revision,path});
const github=async endpoint=>JSON.parse(execFileSync('gh',['api',endpoint],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));
export function recoveryRuntimeAt(repoRoot,revision){
 if(!SHA.test(revision))fail('SOURCE_RECOVERY_REVISION_INVALID');
 return {schema_version:1,repo:REPO,files:COLLECTORS.map(path=>({path,sha256:digest(blob(repoRoot,revision,path))}))};
}
export function validateSourceDelta(repoRoot,base,head){
 const changed=git(repoRoot,'diff','--name-only',base,head,'--').split('\n').filter(Boolean);
 if(!changed.length||changed.some(p=>!ALLOWED.has(p)&&!/^scripts\/ci\/__tests__\/[a-z0-9-]+\.test\.mjs$/.test(p)&&!/^packages\/brain\/src\/(?:lib\/)?__tests__\/(?:existing-ops-|implementation-source-recovery)[a-z0-9.-]+\.test\.js$/.test(p)))fail('SOURCE_RECOVERY_OPERATIONAL_CHANGE');
 if(changed.includes('scripts/brain-deploy.sh')&&!REVIEWED_DEPLOYS.has(digest(blob(repoRoot,head,'scripts/brain-deploy.sh'))))fail('SOURCE_RECOVERY_DEPLOY_GUARD_UNREVIEWED');
 // 版本文件只能改版本，不能借 source-only 更换运行依赖或启动命令。
 for(const path of changed.filter(p=>p.endsWith('package.json')||p.endsWith('package-lock.json'))){
  const strip=x=>{delete x.version;if(path==='packages/brain/package.json')delete x.cecelia_source_only;for(const p of ['', 'packages/brain'])if(x.packages?.[p])delete x.packages[p].version;return x;};
  if(JSON.stringify(strip(JSON.parse(blob(repoRoot,base,path))))!==JSON.stringify(strip(JSON.parse(blob(repoRoot,head,path)))))fail('SOURCE_RECOVERY_DEPENDENCIES_CHANGED');
 }
 const bootstrapBase='e3a01021ee7100b83d8ed5a0be219d0b543b5dff';
 for(const path of ['packages/brain/VERSION','.brain-versions'])if((changed.includes(path)||base===bootstrapBase)&&blob(repoRoot,head,path).toString().trim()!==JSON.parse(blob(repoRoot,head,'packages/brain/package.json')).version)fail('SOURCE_RECOVERY_VERSION_INVALID');
 if(changed.includes('packages/brain/package.json')&&JSON.parse(blob(repoRoot,head,'packages/brain/package.json')).cecelia_source_only!==true)fail('SOURCE_RECOVERY_DEPLOY_GUARD_MISSING');
 if(base===bootstrapBase&&digest(blob(repoRoot,head,'scripts/check-version-sync.sh'))!=='23cea4c3a95ec8f2e13d8191fad20622cfe6268a5bda1885f4758ee92845f89f')fail('SOURCE_RECOVERY_VERSION_GUARD_UNREVIEWED');
 if(changed.includes('.github/workflows/ci.yml')){
  const ciPath='.github/workflows/ci.yml',before=yaml.load(blob(repoRoot,base,ciPath).toString()),after=yaml.load(blob(repoRoot,head,ciPath).toString());
  const checkouts=before.jobs?.['lint-auto-merge-decision']?.steps?.filter(s=>s.uses==='actions/checkout@v4');
  if(checkouts?.length!==1)fail('SOURCE_RECOVERY_CI_CHANGE_INVALID');
  checkouts[0].with={...(checkouts[0].with||{}),'fetch-depth':0};
  if(JSON.stringify(before)!==JSON.stringify(after))fail('SOURCE_RECOVERY_CI_CHANGE_INVALID');
 }
 const path='.github/workflows/implementation-impact.yml';
 if(changed.includes(path)||base===bootstrapBase){
  const reviewed=base===RECOVERY_SOURCE_BRIDGE.directBase?'4e59206bd6dd08b77ea3a59e0feb44a2371ffc0fa9139b81f67e64a0169a9cf9':'231892f86050742912681feba690d1cb71891f6d15183bb65299489a943cd912';
  if(digest(blob(repoRoot,head,path))!==reviewed)fail('SOURCE_RECOVERY_WORKFLOW_UNREVIEWED');
 }
 const before=yaml.load(blob(repoRoot,base,path).toString()),after=yaml.load(blob(repoRoot,head,path).toString());
 if(changed.includes(path)){
  const original="${{ vars.IMPLEMENTATION_INFRA_ADMISSION == 'true' && github.repository == 'perfectuser21/cecelia' && (inputs.scope || vars.IMPLEMENTATION_MAP_SCOPE || 'cecelia-kr') == 'cecelia-kr' && 'true' || 'false' }}";
  const guarded="${{ inputs.source_baseline_recovery != true && vars.IMPLEMENTATION_INFRA_ADMISSION == 'true' && github.repository == 'perfectuser21/cecelia' && (inputs.scope || vars.IMPLEMENTATION_MAP_SCOPE || 'cecelia-kr') == 'cecelia-kr' && 'true' || 'false' }}";
  if(base===RECOVERY_SOURCE_BRIDGE.directBase){
   const oldBase="${{ inputs.base_revision || github.event.pull_request.base.sha || github.event.before }}";
   const recoveredBase="${{ inputs.base_revision || (github.event_name == 'pull_request' && github.event.pull_request.base.sha == '061a8a1784ffd02fdf1e3071390b2036e70d9395' && github.event.pull_request.head.ref == 'cp-10301020-source-pr-link' && github.event.pull_request.head.repo.full_name == 'perfectuser21/cecelia' && 'e3a01021ee7100b83d8ed5a0be219d0b543b5dff' || github.event.pull_request.base.sha) || github.event.before }}";
   if(before.jobs.gate.env?.INFRA_ADMISSION!==guarded||after.jobs.gate.env?.INFRA_ADMISSION!==guarded||before.jobs.gate.env?.BASE!==oldBase||after.jobs.gate.env?.BASE!==recoveredBase)fail('SOURCE_RECOVERY_PR_GATE_CHANGED');
   before.jobs.gate.env.BASE=recoveredBase;
  }else{
   if(before.jobs.gate.env?.INFRA_ADMISSION!==original||after.jobs.gate.env?.INFRA_ADMISSION!==guarded)fail('SOURCE_RECOVERY_PR_GATE_CHANGED');
   before.jobs.gate.env.INFRA_ADMISSION=guarded;
  }
 }
 if(JSON.stringify(before.jobs.gate)!==JSON.stringify(after.jobs.gate))fail('SOURCE_RECOVERY_PR_GATE_CHANGED');
 return changed;
}
function executionContext(){
 return {eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,runId:process.env.GITHUB_RUN_ID,event:process.env.GITHUB_EVENT_PATH?JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')):null};
}
async function readRecoveryArtifact(artifact){
 const bytes=execFileSync('gh',['api',`repos/${REPO}/actions/artifacts/${artifact.id}/zip`],{maxBuffer:1024*1024,timeout:30000,stdio:['ignore','pipe','pipe']});
 if(artifact.digest!==`sha256:${digest(bytes)}`)fail('SOURCE_RECOVERY_GAP_DIGEST_INVALID');
 const dir=mkdtempSync(join(tmpdir(),'recovery-gap-'));
 try{
  const file=join(dir,'gap.zip');writeFileSync(file,bytes);
  if(execFileSync('unzip',['-Z1',file],{encoding:'utf8',maxBuffer:4096}).trim()!=='gap.json')fail('SOURCE_RECOVERY_GAP_CONTENT_INVALID');
  return JSON.parse(execFileSync('unzip',['-p',file,'gap.json'],{encoding:'utf8',maxBuffer:65536}));
 }finally{rmSync(dir,{recursive:true,force:true});}
}
async function verifyMergedPull({revision,parent,allowMissingBase=false},{api,readArtifact}){
 const pulls=await api(`repos/${REPO}/commits/${revision}/pulls`);
 if(!Array.isArray(pulls)||pulls.length!==1)fail('SOURCE_RECOVERY_MERGE_UNPROVEN');
 const pr=await api(`repos/${REPO}/pulls/${pulls[0].number}`);
 if(!pr?.merged||pr.merge_commit_sha!==revision||pr.base?.sha!==parent||pr.base?.ref!=='main'||pr.base.repo?.full_name!==REPO||pr.head?.repo?.full_name!==REPO||!SHA.test(pr.head.sha))fail('SOURCE_RECOVERY_MERGE_UNPROVEN');
 const checks=await api(`repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`);
 if(!Array.isArray(checks?.check_runs)||checks.total_count!==checks.check_runs.length||checks.total_count>100)fail('SOURCE_RECOVERY_CHECKS_INCOMPLETE');
 const protection=await api(`repos/${REPO}/branches/main/protection/required_status_checks`);
 if(protection?.strict!==true||!Array.isArray(protection.contexts)||!protection.contexts.length||protection.contexts.some(n=>typeof n!=='string'||!n))fail('SOURCE_RECOVERY_PROTECTION_UNAVAILABLE');
 const impacts=checks.check_runs.filter(c=>c.name==='Implementation impact gate');
 if(impacts.length!==1)fail('SOURCE_RECOVERY_PR_CI_UNPROVEN');
 const impact=impacts[0],missing=allowMissingBase&&impact.conclusion==='failure';
 if(checks.check_runs.some(c=>c.head_sha!==pr.head.sha||c.status!=='completed'||(!['success','skipped'].includes(c.conclusion)&&!(missing&&c===impact))))fail('SOURCE_RECOVERY_PR_CI_UNPROVEN');
 for(const name of new Set([...protection.contexts,...(missing?[]:['Implementation impact gate'])])){
  const matches=checks.check_runs.filter(c=>c.name===name),appId=protection.checks?.find(c=>c.context===name)?.app_id;
  if(appId!=null&&appId!==-1&&matches[0]?.app?.id!==appId)fail('SOURCE_RECOVERY_CHECK_APP_MISMATCH');
  if(matches.length!==1||matches[0].app?.slug!=='github-actions'||matches[0].status!=='completed'||matches[0].conclusion!=='success')fail('SOURCE_RECOVERY_PR_CI_UNPROVEN');
 }
 const match=impact.details_url?.match(/^https:\/\/github\.com\/perfectuser21\/cecelia\/actions\/runs\/(\d+)\/job\/(\d+)$/);
 if(!match||impact.app?.slug!=='github-actions')fail('SOURCE_RECOVERY_IMPACT_ORIGIN_INVALID');
 const run=await api(`repos/${REPO}/actions/runs/${match[1]}`),result=missing?'failure':'success';
 // GitHub 会在 PR 合并后把旧 Actions run 的 pull_requests 置空；非空时仍须精确匹配。
 const linked=run?.pull_requests;
 if(run?.id!==Number(match[1])||run?.status!=='completed'||run.conclusion!==result||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1||run.event!=='pull_request'||run.path!=='.github/workflows/implementation-impact.yml'||run.head_sha!==pr.head.sha||run.repository?.full_name!==REPO||run.head_repository?.full_name!==REPO||!Array.isArray(linked)||(linked.length>0&&!linked.some(p=>p.number===pr.number&&p.base?.sha===parent&&p.head?.sha===pr.head.sha)))fail('SOURCE_RECOVERY_IMPACT_ORIGIN_INVALID');
 const job=await api(`repos/${REPO}/actions/jobs/${match[2]}`);
 if(job?.id!==Number(match[2])||job.run_id!==Number(match[1])||job.run_attempt!==run.run_attempt||job.head_sha!==pr.head.sha||job.status!=='completed'||job.conclusion!==result||job.name!==impact.name||job.check_run_url!==impact.url||impact.url!==`https://api.github.com/repos/${REPO}/check-runs/${impact.id}`)fail('SOURCE_RECOVERY_IMPACT_JOB_INVALID');
 let gapProof=null;
 if(missing){
  const failed=job.steps?.filter(s=>s.conclusion==='failure');
  if(failed?.length!==1||failed[0].name!=='下载固定SHA中央bundle（PR无中央写凭据）'||job.steps.find(s=>s.name==='实际变更影响与固定回归')?.conclusion!=='skipped')fail('SOURCE_RECOVERY_GAP_JOB_INVALID');
  const listing=await api(`repos/${REPO}/actions/runs/${run.id}/artifacts?per_page=100`);
  if(!Array.isArray(listing?.artifacts)||listing.total_count!==listing.artifacts.length||listing.total_count>100)fail('SOURCE_RECOVERY_GAP_ARTIFACT_INVALID');
  const artifacts=listing.artifacts.filter(a=>a.name===`implementation-evidence-${pr.head.sha}`&&!a.expired);
  if(artifacts.length!==1||artifacts[0].workflow_run?.id!==run.id||artifacts[0].workflow_run?.head_sha!==pr.head.sha)fail('SOURCE_RECOVERY_GAP_ARTIFACT_INVALID');
  const created=Date.parse(artifacts[0].created_at),started=Date.parse(job.started_at),completed=Date.parse(job.completed_at);
  if(![created,started,completed].every(Number.isFinite)||created<started||created>completed)fail('SOURCE_RECOVERY_GAP_ATTEMPT_MISMATCH');
  const gap=await readArtifact(artifacts[0]);
  if(Object.keys(gap).sort().join(',')!=='base_revision,code,head_revision,stage,status'||gap.code!=='IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING'||gap.status!=='unknown'||gap.stage!=='snapshot_download'||gap.base_revision!==parent||gap.head_revision!==pr.head.sha)fail('SOURCE_RECOVERY_GAP_NOT_BASE_MISSING');
  gapProof={...gap,artifact_id:artifacts[0].id,artifact_digest:artifacts[0].digest};
 }
 return {pr_number:pr.number,pr_head:pr.head.sha,impact_run_id:run.id,impact_job_id:job.id,impact_run_attempt:run.run_attempt,required_checks:protection.contexts,impact_status:missing?'missing_direct_base':'success',gap:gapProof};
}
export async function verifyRecoveryAuthority({repoRoot,base,head},{github:api=github,readArtifact=readRecoveryArtifact,context=executionContext()}={}){
 if(!SHA.test(base)||!SHA.test(head)||base===head||git(repoRoot,'rev-parse','HEAD')!==head)fail('SOURCE_RECOVERY_SOURCE_MISMATCH');
 const directBase=git(repoRoot,'rev-parse',`${head}^1`),bridged=directBase!==base;
 const bridgeIdentity=bridged?recoveryBridge(base,directBase):null;
 if(bridged&&(!bridgeIdentity||git(repoRoot,'rev-parse',`${directBase}^1`)!==base))fail('SOURCE_RECOVERY_BRIDGE_INVALID');
 if(git(repoRoot,'status','--porcelain=v1','--untracked-files=no'))fail('SOURCE_RECOVERY_DIRTY_SOURCE');
 const origin=git(repoRoot,'remote','get-url','origin');
 if(![`https://github.com/${REPO}.git`,`https://github.com/${REPO}`,`git@github.com:${REPO}.git`].includes(origin))fail('SOURCE_RECOVERY_REPO_MISMATCH');
 if((await api(`repos/${REPO}/commits/main`))?.sha!==head)fail('SOURCE_RECOVERY_MAIN_MOVED');
 let bridge=null;
 if(bridged){
  assertRecoveryDispatch({...context,head});
  bridge=await verifyMergedPull({revision:directBase,parent:base},{api,readArtifact});
  if(bridge.pr_number!==bridgeIdentity.pr||bridge.pr_head!==bridgeIdentity.prHead)fail('SOURCE_RECOVERY_BRIDGE_INVALID');
 }
if(JSON.parse(blob(repoRoot,head,'packages/brain/package.json')).cecelia_source_only!==true||!REVIEWED_DEPLOYS.has(digest(blob(repoRoot,head,'scripts/brain-deploy.sh'))))fail('SOURCE_RECOVERY_DEPLOY_GUARD_MISSING');
 const proof=await verifyMergedPull({revision:head,parent:directBase,allowMissingBase:bridged},{api,readArtifact});
 const changed_files=validateSourceDelta(repoRoot,directBase,head);
 return {schema_version:1,purpose:'admission_source_only',repo:REPO,base_revision:base,baseline_revision:base,direct_base_revision:directBase,head_revision:head,...proof,bridge,reviewed_head:bridged?context.event.inputs.source_reviewed_head:null,changed_files};
}
export async function inspectRecoveryRuntime({repoRoot,base,head,brainUrl,token},{fetchFn=globalThis.fetch}={}){
 if(!token||!SHA.test(head))fail('SOURCE_RECOVERY_INPUT_INVALID');
 let origin;try{origin=new URL(brainUrl);}catch{fail('SOURCE_RECOVERY_URL_INVALID');}
 if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail('SOURCE_RECOVERY_URL_INVALID');
 const response=await fetchFn(new URL('/api/brain/implementation-ci/runtime-source',origin),{method:'GET',redirect:'error',headers:{'X-Internal-Token':token},signal:AbortSignal.timeout(15000)});
 if(!response.ok)fail('SOURCE_RECOVERY_RUNTIME_UNAVAILABLE');
 const text=await response.text();if(text.length>65536)fail('SOURCE_RECOVERY_RUNTIME_INVALID');
 let runtime;try{runtime=JSON.parse(text);}catch{fail('SOURCE_RECOVERY_RUNTIME_INVALID');}
 const expected=recoveryRuntimeAt(repoRoot,base);
 if(!runtime||Object.keys(runtime).sort().join(',')!=='files,git_sha,repo,schema_version'||runtime.repo!==REPO||runtime.schema_version!==1||!SHA.test(runtime.git_sha)||JSON.stringify(runtime.files)!==JSON.stringify(expected.files))fail('SOURCE_RECOVERY_RUNTIME_MISMATCH');
 return {schema_version:1,status:'source_only',runtime_status:'not_deployed',repo:REPO,base_revision:base,revision:head,runtime,observed_at:new Date().toISOString()};
}
export function sealRecoveryBundle(snapshot,proof){
 if(snapshot.status!=='verified'||snapshot.gaps?.length||snapshot.revision!==proof.head_revision)fail('SOURCE_RECOVERY_SNAPSHOT_UNKNOWN');
 if(snapshot.scope==='cecelia-factory'&&snapshot.execution_status!=='unknown')fail('SOURCE_RECOVERY_EXECUTION_PROMOTION');
 const {snapshot_sha256:_old,...body}=structuredClone(snapshot);
 body.source_baseline={...proof,purpose:'admission_source_only',runtime_status:'not_deployed'};
 if(body.admission_companion){
  const {companion_sha256:_hash,...companion}=body.admission_companion;
  companion.snapshot=sealRecoveryBundle(companion.snapshot,proof);
  body.admission_companion={...companion,companion_sha256:stepSha256(companion)};
 }
 return {...body,snapshot_sha256:stepSha256(body)};
}
export function assertRecoveryPurpose(snapshot,mode){
 if(snapshot?.source_baseline&&mode!=='pr')fail('SOURCE_RECOVERY_RELEASE_FORBIDDEN');
 if(snapshot?.source_baseline&&(snapshot.source_baseline.purpose!=='admission_source_only'||snapshot.source_baseline.runtime_status!=='not_deployed'||snapshot.source_baseline.head_revision!==snapshot.revision))fail('SOURCE_RECOVERY_PROVENANCE_INVALID');
}
export function assertRecoveryDispatch({eventName,ref,event,runId,head}){
 if(eventName!=='workflow_dispatch'||ref!=='refs/heads/main'||![true,'true'].includes(event?.inputs?.source_baseline_recovery)||!/^\d+$/.test(String(runId||'')))fail('SOURCE_RECOVERY_DISPATCH_REQUIRED');
 if(head&&event.inputs.source_reviewed_head!==head)fail('SOURCE_RECOVERY_REVIEW_HEAD_MISMATCH');
}
export function verifyRecoveryGateProof({repoRoot,base,head,inputs,context}){
 assertRecoveryDispatch({...context,head});
 const directBase=git(repoRoot,'rev-parse',`${head}^1`);
 if(directBase!==base&&(!recoveryBridge(base,directBase)||git(repoRoot,'rev-parse',`${directBase}^1`)!==base))fail('SOURCE_RECOVERY_BRIDGE_INVALID');
 const changed=validateSourceDelta(repoRoot,directBase,head),actual=recoveryRuntimeAt(repoRoot,head);
 for(const s of inputs.head){
  assertRecoveryPurpose(s,'pr');const p=s.source_baseline;
  if(!p||p.repo!==REPO||p.base_revision!==base||p.direct_base_revision!==directBase||p.head_revision!==head||p.recovery_run_id!==String(context.runId)||p.base_snapshot_sha256!==inputs.base[0].snapshot_sha256||JSON.stringify(p.changed_files)!==JSON.stringify(changed)||JSON.stringify(p.compiled_runtime.files)!==JSON.stringify(actual.files)||JSON.stringify(p.production_runtime.files)!==JSON.stringify(recoveryRuntimeAt(repoRoot,base).files))fail('SOURCE_RECOVERY_PROVENANCE_INVALID');
 }
 if(JSON.stringify(inputs.head[0].source_baseline)!==JSON.stringify(inputs.head[1].source_baseline))fail('SOURCE_RECOVERY_PROVENANCE_INVALID');
}
export async function compileRecoveryCandidate({repoRoot,head,baseline}){
 const inputs=extractImplementationAdmissionSnapshots(baseline.snapshot||baseline,['cecelia-kr','cecelia-factory']);
 const {createImplementationScratch,importImplementationSnapshot,projectImplementationSnapshot,buildPrImplementationSnapshot}=await import('./implementation-snapshot.mjs');
 const base=inputs[0].revision;
 if(!SHA.test(base)||inputs.some(input=>input.revision!==base))fail('SOURCE_RECOVERY_BASE_INVALID');
 const checkout=mkdtempSync(join(tmpdir(),'source-recovery-base-'));let scratch,candidate;
 try{
  fixedLocalGit(repoRoot,['clone','--shared','--no-checkout','--quiet',repoRoot,checkout],{localClone:true});
  fixedLocalGit(checkout,['checkout','--quiet','--detach',base]);
  scratch=await createImplementationScratch();
  for(const input of inputs)await importImplementationSnapshot(scratch.db,input);
  // 与正式PR入口相同：固定基线的来源、图和manifest必须先在scratch完整投影。
  for(const input of inputs)await projectImplementationSnapshot(scratch.db,input,checkout);
  // 使用同一固定clone切至候选；来源定义、图和manifest全部对齐后重新导出。
  fixedLocalGit(checkout,['checkout','--quiet','--detach',head]);
  for(const input of [inputs[1],inputs[0]]){
   const built=await buildPrImplementationSnapshot(scratch.db,input,head,checkout);
   await projectImplementationSnapshot(scratch.db,built,checkout);
  }
  candidate=await exportImplementationSnapshot(scratch.db,{scope:inputs[0].scope,repo:inputs[0].repo,revision:head});
  extractImplementationAdmissionSnapshots(candidate,['cecelia-kr','cecelia-factory']);
 }finally{try{await scratch?.close();}finally{rmSync(checkout,{recursive:true,force:true});}}
 return candidate;
}
export async function publishRecoveryBaseline({repoRoot,base,head,brainUrl,token,output,baseline,readiness},{github:api=github,verifyAuthority=verifyRecoveryAuthority,inspectRuntime=inspectRecoveryRuntime,fetchFn=globalThis.fetch,compile=compileRecoveryCandidate,runGate=async options=>(await import('./implementation-main-gate.mjs')).runImplementationMainGate(options)}={}){
 const authority=await verifyAuthority({repoRoot,base,head},{github:api});
 const runtime=await inspectRuntime({repoRoot,base,head,brainUrl,token});
 if(readiness.status!=='source_only'||readiness.runtime_status!=='not_deployed'||readiness.base_revision!==base||readiness.revision!==head||JSON.stringify(readiness.runtime)!==JSON.stringify(runtime.runtime))fail('SOURCE_RECOVERY_READINESS_MISMATCH');
 const inputs=extractImplementationAdmissionSnapshots(baseline.snapshot||baseline,['cecelia-kr','cecelia-factory']);
 if(inputs.some(s=>s.revision!==base||s.repo!==REPO||s.source_baseline))fail('SOURCE_RECOVERY_BASE_INVALID');
 const readCentral=async()=>{
  const url=new URL('/api/brain/implementation-ci/snapshot',brainUrl);
  url.search=new URLSearchParams({scope:'cecelia-kr',repo:REPO,revision:base});
  const response=await fetchFn(url,{method:'GET',redirect:'error',headers:{'X-Internal-Token':token},signal:AbortSignal.timeout(15000)});
  if(!response.ok)fail('SOURCE_RECOVERY_CENTRAL_UNAVAILABLE');
  const current=await response.json();extractImplementationAdmissionSnapshots(current.snapshot||current,['cecelia-kr','cecelia-factory']);
  if(current.snapshot?.snapshot_sha256!==inputs[0].snapshot_sha256)fail('SOURCE_RECOVERY_CENTRAL_CHANGED');
 };
 await readCentral();
 const candidate=await compile({repoRoot,base,head,baseline});
 const proof={...authority,recovery_run_id:String(process.env.GITHUB_RUN_ID||''),base_snapshot_sha256:inputs[0].snapshot_sha256,production_runtime:runtime.runtime,compiled_runtime:readNativeConsumerRuntime(),runtime_status:'not_deployed'};
 const actual=recoveryRuntimeAt(repoRoot,head);if(JSON.stringify(actual.files)!==JSON.stringify(proof.compiled_runtime.files))fail('SOURCE_RECOVERY_COMPILER_MISMATCH');
 const snapshot=sealRecoveryBundle(candidate,proof);validateImplementationSnapshot(snapshot);
 const privateDir=mkdtempSync(join(tmpdir(),'source-recovery-verification-'));
 try{
  writeFileSync(join(privateDir,'base.json'),JSON.stringify(baseline));writeFileSync(join(privateDir,'head.json'),JSON.stringify({snapshot}));
  const gate=await runGate({repoRoot,scope:'cecelia-kr',base,head,mode:'main',snapshotBase:join(privateDir,'base.json'),snapshotHead:join(privateDir,'head.json'),outputDir:join(privateDir,'verification'),mainScopes:JSON.stringify({schema_version:1,scopes:['cecelia-kr','cecelia-factory']})});
  if(gate?.receipt?.verdict!=='PASS')fail('SOURCE_RECOVERY_FULL_GATE_FAILED');
 }finally{
  const evidence=join(privateDir,'verification');if(existsSync(evidence)){mkdirSync(join(output,'diagnostics'),{recursive:true});cpSync(evidence,join(output,'diagnostics/source-only-verification'),{recursive:true});}
  rmSync(privateDir,{recursive:true,force:true});
 }
 const after=await inspectRuntime({repoRoot,base,head,brainUrl,token});
 if(JSON.stringify(runtime.runtime)!==JSON.stringify(after.runtime))fail('SOURCE_RECOVERY_RUNTIME_CHANGED');
 await readCentral();
 if((await api(`repos/${REPO}/commits/main`))?.sha!==head)fail('SOURCE_RECOVERY_MAIN_MOVED');
 if(['base','head'].some(name=>existsSync(join(output,`${name}.json`))))fail('SOURCE_RECOVERY_OUTPUT_EXISTS');
 mkdirSync(output,{recursive:true});
 for(const [name,value]of [['base',baseline],['head',{snapshot}]]){const temporary=join(output,`.${name}.validated.tmp`);writeFileSync(temporary,JSON.stringify(value)+'\n');renameSync(temporary,join(output,`${name}.json`));}
 return {schema_version:1,status:'source_only',runtime_status:'not_deployed',purpose:'admission_source_only',head_revision:head,snapshot_sha256:snapshot.snapshot_sha256};
}
