/** GitHub官方CI成功与受保护main控制域；证明能力不可序列化或由JSON重建。 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {stepSha256 as hash} from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {unpackCiAdmissionArchive} from './ci-admission-archive.mjs';
import {readFixedLocalGitBlob} from './fixed-local-git.mjs';
const REPO='perfectuser21/cecelia',PREFIX=`repos/${REPO}`,SHA=/^[a-f0-9]{40}$/;
const legacyDiagnostics=new WeakSet();
const LEGACY_CI_RECIPE='91eb26e207d3f15cf810fe1dec4e9137d0f31d1c8004f7938ded7cb7112335e2';
const proofs=new WeakMap(),documents=new WeakMap(),positive=n=>Number.isSafeInteger(n)&&n>0;
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
const time=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const environment=()=>({...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))),GIT_NO_REPLACE_OBJECTS:'1',GIT_GRAFT_FILE:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'});
function git(root,...args){return execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null',...args],{cwd:root,env:environment(),encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024}).trim();}
export function ciAuthorityProof(capability){
 need(proofs.has(capability),'CI_ADMISSION_AUTHORITY_REQUIRED');return structuredClone(proofs.get(capability));
}
export function ciAuthorityDocument(capability){need(documents.has(capability),'CI_ADMISSION_ARTIFACT_BOUND_REQUIRED');return structuredClone(documents.get(capability));}
export function isLegacyCiPublicationDiagnostic(value){return legacyDiagnostics.has(value);}
export async function verifyCiAdmissionAuthority(options,deps={}){return verifyAuthority(options,deps,false);}
// Only an in-flight publisher may classify this exact old recipe. This is never source/artifact authority.
export async function verifyCiAdmissionPublicationAuthority(options,deps={}){
 need(options?.publisher?.phase==='publishing'&&options.artifactId===undefined,'CI_ADMISSION_PUBLICATION_PHASE_REQUIRED');
 return verifyAuthority(options,deps,true);
}
async function verifyAuthority({repoRoot,sourceRevision,controlRevision,sourceRunId,publisher,artifactId},deps,publication){
 need(SHA.test(sourceRevision||'')&&SHA.test(controlRevision||'')&&positive(sourceRunId),'CI_ADMISSION_AUTHORITY_INPUT');
 if(publisher)need(positive(publisher.runId)&&positive(publisher.attempt)
  &&Object.keys(publisher).every(k=>['runId','attempt','artifactCreatedAt','phase'].includes(k))
  &&[undefined,'publishing'].includes(publisher.phase),'CI_ADMISSION_PUBLISHER_INPUT');
 if(artifactId!==undefined)need(positive(artifactId)&&publisher&&publisher.phase===undefined,'CI_ADMISSION_ARTIFACT_INPUT');
 const deadline=Date.now()+120000;let requests=0;
 const call=async(path,binary=false)=>{
  need(++requests<=32&&Date.now()<deadline,'CI_ADMISSION_AUTHORITY_BUDGET');
  try{
   const adapter=binary?deps.download:deps.api;
   const bytes=adapter?await adapter(path):execFileSync('gh',['api','--hostname','github.com',path],{
    encoding:binary?undefined:'utf8',timeout:Math.min(15000,Math.max(1,deadline-Date.now())),maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe'],
   });const result=adapter||binary?bytes:JSON.parse(bytes);
   need(Date.now()<deadline,'CI_ADMISSION_AUTHORITY_BUDGET');return result;
  }catch(error){if(error.code?.startsWith('CI_ADMISSION_'))throw error;throw Object.assign(Error('CI_ADMISSION_API_ERROR'),{code:'CI_ADMISSION_API_ERROR'});}
 };
 const main=await call(`${PREFIX}/branches/main`);
 const repository=await call(PREFIX);
 need(repository?.full_name===REPO&&positive(repository.id),'CI_ADMISSION_REPOSITORY');
 need(main?.protected===true&&SHA.test(main.commit?.sha||''),'CI_ADMISSION_PROTECTED_MAIN_REQUIRED');
 let chain;
 try{
  need(/^https:\/\/github\.com\/perfectuser21\/cecelia(?:\.git)?$|^git@github\.com:perfectuser21\/cecelia(?:\.git)?$/.test(git(repoRoot,'remote','get-url','origin')),'CI_ADMISSION_REPOSITORY');
  // worker期间main可继续前移。仅补官方第一父元数据，不fetch/切换固定source或control。
  const prefix=[],seen=new Set();let revision=main.commit.sha;
  for(;;){
   let local=false;try{git(repoRoot,'cat-file','-e',revision+'^{commit}');local=true;}catch{}
   if(local){chain=[...prefix,...git(repoRoot,'rev-list','--first-parent',revision).split('\n')];break;}
   need(prefix.length<16&&!seen.has(revision),'CI_ADMISSION_MAIN_CHAIN');seen.add(revision);
   const commit=await call(`${PREFIX}/git/commits/${revision}`);
   need(commit?.sha===revision&&Array.isArray(commit.parents)&&commit.parents.length>0
    &&commit.parents.every(p=>SHA.test(p?.sha||'')),'CI_ADMISSION_MAIN_CHAIN');
   prefix.push(revision);revision=commit.parents[0].sha;
  }
 }catch(error){if(error.code?.startsWith('CI_ADMISSION_'))throw error;need(false,'CI_ADMISSION_MAIN_CHAIN');}
 need(chain.includes(controlRevision)&&chain.includes(sourceRevision)&&chain.indexOf(controlRevision)<=chain.indexOf(sourceRevision),'CI_ADMISSION_MAIN_CHAIN');
 const checkRun=async({runId,revision,path,name,event,attempt,artifactCreatedAt,phase})=>{
  const run=await call(`${PREFIX}/actions/runs/${runId}`);
  const publishing=phase==='publishing';
  need(run?.id===runId&&run.head_sha===revision&&run.head_branch==='main'&&run.event===event
   &&run.repository?.full_name===REPO&&run.head_repository?.full_name===REPO
   &&run.repository.id===repository.id&&run.head_repository.id===repository.id
   &&positive(run.run_attempt)&&run.run_attempt<=10&&(!attempt||run.run_attempt===attempt)
   &&run.path===path&&positive(run.workflow_id)&&positive(run.check_suite_id)
   &&(publishing?run.status==='in_progress':run.status==='completed'&&run.conclusion==='success'),'CI_ADMISSION_RUN_INVALID');
  const workflow=await call(`${PREFIX}/actions/workflows/${run.workflow_id}`);
  need(workflow?.id===run.workflow_id&&workflow.path===path&&workflow.state==='active','CI_ADMISSION_WORKFLOW_INVALID');
  const result={run_id:runId,attempt:run.run_attempt,workflow_id:run.workflow_id,workflow_path:path,head_revision:revision};
  if(publishing)return result;
  const jobs=await call(`${PREFIX}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`);
  need(Array.isArray(jobs?.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.total_count<=100,'CI_ADMISSION_JOBS_INCOMPLETE');
  const matches=jobs.jobs.filter(j=>j.name===name);
  need(matches.length===1,'CI_ADMISSION_PROVIDER_AMBIGUOUS');const job=matches[0];
  need(positive(job.id)&&job.run_id===runId&&job.run_attempt===run.run_attempt&&job.head_sha===revision
   &&job.status==='completed'&&job.conclusion==='success'&&time(job.started_at)&&time(job.completed_at)
   &&Date.parse(job.started_at)<=Date.parse(job.completed_at),'CI_ADMISSION_JOB_INVALID');
  const checkPrefix=`https://api.github.com/${PREFIX}/check-runs/`,id=job.check_run_url?.startsWith(checkPrefix)?Number(job.check_run_url.slice(checkPrefix.length)):NaN;
  need(positive(id),'CI_ADMISSION_CHECK_LINK_INVALID');
  const check=await call(`${PREFIX}/check-runs/${id}`);
  need(check?.id===id&&check.url===job.check_run_url&&check.name===name&&check.head_sha===revision
   &&check.status==='completed'&&check.conclusion==='success'&&check.app?.id===15368&&check.app.slug==='github-actions'
   &&check.check_suite?.id===run.check_suite_id&&check.details_url===`https://github.com/${REPO}/actions/runs/${runId}/job/${job.id}`,'CI_ADMISSION_CHECK_INVALID');
  if(artifactCreatedAt!==undefined)need(time(artifactCreatedAt)&&Date.parse(job.started_at)<=Date.parse(artifactCreatedAt)&&Date.parse(artifactCreatedAt)<=Date.parse(job.completed_at),'CI_ADMISSION_ARTIFACT_PROVIDER_TIME');
  return {...result,job_id:job.id,check_run_id:id,app_id:15368};
 };
 let legacy=false;
 if(publication){
  try{legacy=createHash('sha256').update(readFixedLocalGitBlob(repoRoot,{revision:sourceRevision,path:'.github/workflows/ci.yml'},{deadline})).digest('hex')===LEGACY_CI_RECIPE;}catch{legacy=false;}
 }
 const ci=await checkRun({runId:sourceRunId,revision:sourceRevision,path:'.github/workflows/ci.yml',name:legacy?'ci-passed':'源码保底通过',event:'push'});
 const provider=publisher?await checkRun({runId:publisher.runId,revision:controlRevision,path:'.github/workflows/ci-admission-baseline.yml',name:'ci-admission-baseline',event:'workflow_run',...publisher}):null;
 if(legacy){
  const diagnostic=Object.freeze({schema:'cecelia.ci-publication-diagnostic/v1',kind:'legacy_ci_not_applicable',published:false,
   purpose:'ci_publication_diagnostic_only',source_revision:sourceRevision,control_revision:controlRevision,legacy_ci_recipe_sha256:LEGACY_CI_RECIPE,
   source_run_id:ci.run_id,source_job_id:ci.job_id,source_check_run_id:ci.check_run_id,app_id:ci.app_id,publisher_run_id:provider.run_id,publisher_attempt:provider.attempt});
  legacyDiagnostics.add(diagnostic);return diagnostic;
 }
 let artifact=null,document;
 if(artifactId!==undefined){
  const meta=await call(`${PREFIX}/actions/artifacts/${artifactId}`);
  need(meta?.id===artifactId&&meta.name===`implementation-ci-admission-baseline-${sourceRevision}`&&meta.expired===false
   &&meta.workflow_run?.id===publisher.runId&&meta.workflow_run.head_sha===controlRevision&&meta.workflow_run.head_branch==='main'
   &&meta.workflow_run.repository_id===repository.id&&meta.workflow_run.head_repository_id===repository.id
   &&meta.created_at===publisher.artifactCreatedAt&&/^sha256:[a-f0-9]{64}$/.test(meta.digest||'')
   &&positive(meta.size_in_bytes)&&meta.size_in_bytes<=16*1024*1024,'CI_ADMISSION_ARTIFACT_INVALID');
  const bytes=await call(`${PREFIX}/actions/artifacts/${artifactId}/zip`,true);
  need(Buffer.isBuffer(bytes)&&bytes.length===meta.size_in_bytes&&`sha256:${createHash('sha256').update(bytes).digest('hex')}`===meta.digest,'CI_ADMISSION_ARTIFACT_DIGEST');
  const unpacked=unpackCiAdmissionArchive(bytes);document=unpacked.envelope;
  need(document?.ci_source_revision===sourceRevision&&document.ci_control_revision===controlRevision&&document.ci_authority?.ci?.run_id===sourceRunId
   &&document.ci_authority?.publisher?.run_id===publisher.runId&&hash(document.ci_assertions)===hash(unpacked.assertions),'CI_ADMISSION_ARTIFACT_DOCUMENT');
  artifact={id:meta.id,digest:meta.digest,size_in_bytes:meta.size_in_bytes,created_at:meta.created_at,workflow_run:meta.workflow_run,document_sha256:hash(document)};
 }
 const capability=Object.freeze(Object.create(null));
 proofs.set(capability,{schema:'cecelia.ci-admission-authority/v1',repository:REPO,source_revision:sourceRevision,control_revision:controlRevision,protected_main:main.commit.sha,ci,publisher:provider,artifact});
 if(document)documents.set(capability,document);
 return capability;
}
