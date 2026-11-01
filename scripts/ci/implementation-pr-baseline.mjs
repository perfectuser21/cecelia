#!/usr/bin/env node
/** 原生PR缺精确快照时，沿真实第一父链选择最近官方基线；原工具执行完整累积差分。 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL,fileURLToPath} from 'node:url';
const REPO='perfectuser21/cecelia',SHA=/^[a-f0-9]{40}$/,SCOPES=['cecelia-kr','cecelia-factory'];
const digest=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const need=(ok,code)=>{if(!ok)fail(code);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
const timestamp=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const git=(root,...args)=>{
 const output=execFileSync('git',['--no-replace-objects',...args],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:16*1024*1024,env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))),GIT_NO_REPLACE_OBJECTS:'1',GIT_GRAFT_FILE:'/dev/null',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
 return args.includes('-z')?output:output.trim();
};
function samePr(pr,base,head){
 return pr?.base?.sha===base&&pr.base.ref==='main'&&pr.base.repo?.full_name===REPO
  &&pr.head?.sha===head&&pr.head.repo?.full_name===REPO;
}
/** 注入接缝仅供测试；CLI没有base/head/证据覆盖参数。 */
export async function resolvePrBaseline(options,deps={}){
 const {repoRoot,toolingRoot,repository,eventName,event,toolingRevision,maxDepth=64}=options;
 need(repository===REPO&&eventName==='pull_request'&&positive(event?.number),'PR_BASELINE_EVENT_INVALID');
 const original=event.pull_request?.base?.sha,head=event.pull_request?.head?.sha;
 need(SHA.test(original||'')&&SHA.test(head||'')&&samePr(event.pull_request,original,head),'PR_BASELINE_EVENT_INVALID');
 need(toolingRevision===original,'PR_BASELINE_TOOLING_MISMATCH');
 need(positive(maxDepth)&&maxDepth<=64,'PR_BASELINE_DEPTH_INVALID');
 const runGit=deps.git||git;
 need(runGit(toolingRoot,'rev-parse','HEAD')===original&&runGit(repoRoot,'rev-parse','HEAD')===head,'PR_BASELINE_CHECKOUT_MISMATCH');
 need(!runGit(repoRoot,'status','--porcelain=v1','--untracked-files=no')&&!runGit(toolingRoot,'status','--porcelain=v1','--untracked-files=no'),'PR_BASELINE_DIRTY_SOURCE');
 need(/^https:\/\/github\.com\/perfectuser21\/cecelia(?:\.git)?$|^git@github\.com:perfectuser21\/cecelia(?:\.git)?$/.test(runGit(repoRoot,'remote','get-url','origin')),'PR_BASELINE_REPOSITORY_MISMATCH');
 runGit(repoRoot,'merge-base','--is-ancestor',original,head);
 const deadline=Date.now()+120000;let requests=0;
 const call=async(path,binary=false)=>{
  need(++requests<=128&&Date.now()<deadline,'PR_BASELINE_REQUEST_BUDGET');
  try{
   const result=await (binary?deps.download:deps.api)?.(path);
   if(result!==undefined)return result;
   const bytes=execFileSync('gh',['api','--hostname','github.com',path],{encoding:binary?undefined:'utf8',timeout:Math.max(1,Math.min(15000,deadline-Date.now())),maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
   return binary?bytes:JSON.parse(bytes);
  }catch(error){if(error.code?.startsWith('PR_BASELINE_'))throw error;fail('PR_BASELINE_API_FAILED');}
 };
 const prefix=`repos/${REPO}/actions`;
 need(samePr(await call(`repos/${REPO}/pulls/${event.number}`),original,head),'PR_BASELINE_PR_CHANGED');
 const chain=runGit(repoRoot,'rev-list','--first-parent',`--max-count=${maxDepth}`,original).split('\n').filter(Boolean);
 need(chain[0]===original&&chain.every(r=>SHA.test(r)),'PR_BASELINE_CHAIN_INVALID');
 const evidence=[];
 for(const revision of chain){
  const name=`implementation-snapshot-${revision}`;
  const list=await call(`${prefix}/artifacts?name=${name}&per_page=100`);
  need(Array.isArray(list?.artifacts)&&Number.isInteger(list.total_count)&&list.total_count===list.artifacts.length&&list.total_count<=100,'PR_BASELINE_LIST_INCOMPLETE');
  need(list.artifacts.every(a=>a?.name===name&&typeof a.expired==='boolean'),'PR_BASELINE_ARTIFACT_INVALID');
  const candidates=list.artifacts.filter(a=>!a.expired);
  if(!candidates.length){evidence.push({revision,status:'missing',expired_artifact_ids:list.artifacts.map(a=>a.id)});continue;}
  need(candidates.every(a=>timestamp(a.created_at)&&positive(a.id)),'PR_BASELINE_ARTIFACT_INVALID');
  candidates.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id);
  const listed=candidates[0],artifact=await call(`${prefix}/artifacts/${listed.id}`);
  need(['id','head_sha','head_branch','repository_id','head_repository_id'].every(k=>artifact.workflow_run?.[k]===listed.workflow_run?.[k])&&artifact.id===listed.id&&artifact.digest===listed.digest&&artifact.created_at===listed.created_at,'PR_BASELINE_ARTIFACT_CHANGED');
  need(artifact.name===name&&artifact.expired===false&&positive(artifact.workflow_run?.id)
   &&artifact.workflow_run.head_sha===revision&&artifact.workflow_run.head_branch==='main'
   &&positive(artifact.workflow_run.repository_id)&&artifact.workflow_run.repository_id===artifact.workflow_run.head_repository_id
   &&/^sha256:[a-f0-9]{64}$/.test(artifact.digest||'')&&positive(artifact.size_in_bytes)&&artifact.size_in_bytes<=16*1024*1024,'PR_BASELINE_ARTIFACT_INVALID');
  const runId=artifact.workflow_run.id,run=await call(`${prefix}/runs/${runId}`);
  need(run.id===runId&&run.head_sha===revision&&run.head_branch==='main'&&['push','workflow_dispatch'].includes(run.event)
   &&run.path==='.github/workflows/implementation-impact.yml'&&run.repository?.full_name===REPO&&run.head_repository?.full_name===REPO
   &&run.repository.id===artifact.workflow_run.repository_id&&run.head_repository.id===artifact.workflow_run.head_repository_id
   &&positive(run.run_attempt)&&run.run_attempt<=10,'PR_BASELINE_ORIGIN_INVALID');
  const providers=[];
  for(let attempt=run.run_attempt;attempt>=1;attempt--){
   const jobs=await call(`${prefix}/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
   need(Array.isArray(jobs?.jobs)&&jobs.total_count===jobs.jobs.length&&jobs.total_count<=100,'PR_BASELINE_JOBS_INCOMPLETE');
   for(const job of jobs.jobs)if(job.name==='snapshot-main'&&job.status==='completed'&&job.conclusion==='success'
     &&job.run_id===runId&&job.run_attempt===attempt&&positive(job.id)&&timestamp(job.started_at)&&timestamp(job.completed_at)
     &&Date.parse(job.started_at)<=Date.parse(artifact.created_at)&&Date.parse(artifact.created_at)<=Date.parse(job.completed_at))providers.push({attempt,job_id:job.id});
  }
  need(providers.length===1,'PR_BASELINE_PROVIDER_INVALID');
  const bytes=await call(`${prefix}/artifacts/${artifact.id}/zip`,true);
  need(Buffer.isBuffer(bytes)&&bytes.length===artifact.size_in_bytes&&`sha256:${digest(bytes)}`===artifact.digest,'PR_BASELINE_DIGEST_MISMATCH');
  const body=(deps.unpack||unpackOfficialBaselineArchive)(bytes);
  let validated;
  try{validated=await (deps.validateBundle||((value)=>validateBundle(value,toolingRoot)))(body);}catch{fail('PR_BASELINE_SNAPSHOT_INVALID');}
  need(validated.revision===revision,'PR_BASELINE_SNAPSHOT_IDENTITY');
  evidence.push({revision,status:'selected',artifact_id:artifact.id,artifact_digest:artifact.digest,run_id:runId,...providers[0]});
  const changed_files=runGit(repoRoot,'diff','--no-renames','--name-only','-z',revision,head,'--').split('\0').filter(Boolean).sort();
  const resolution={schema_version:1,purpose:'admission_only',status:'selected',repo:REPO,pr_number:event.number,
   original_pr_base_revision:original,effective_base_revision:revision,tooling_revision:original,head_revision:head,
   chain:evidence,base_snapshot_sha256:validated.snapshot_sha256,scope_hashes:validated.scope_hashes,changed_files,
   business_runtime_status:'not_evaluated'};
  return {body,resolution};
 }
 fail('PR_BASELINE_ANCESTOR_NOT_FOUND');
}
export function unpackOfficialBaselineArchive(bytes){
 const root=mkdtempSync(join(tmpdir(),'pr-baseline-zip-'));
 try{
  const path=join(root,'snapshot.zip');writeFileSync(path,bytes,{mode:0o600});
  const text=execFileSync('python3',['-I','-c',`import zipfile,sys,pathlib,stat
with zipfile.ZipFile(sys.argv[1]) as z:
 entries=z.infolist(); names=[x.filename for x in entries]
 assert len(entries)<=1024 and len(names)==len(set(names)) and names.count('head.json')==1
 assert sum(x.file_size for x in entries)<=16*1024*1024
 for x in entries:
  p=pathlib.PurePosixPath(x.filename)
  assert not p.is_absolute() and '..' not in p.parts and '\\\\' not in x.filename
  assert not stat.S_ISLNK(x.external_attr>>16)
 sys.stdout.buffer.write(z.read('head.json'))`,path],{encoding:'utf8',timeout:10000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  return JSON.parse(text);
 }catch{fail('PR_BASELINE_ARCHIVE_INVALID');}finally{rmSync(root,{recursive:true,force:true});}
}
async function validateBundle(body,toolingRoot){
 const api=await import(pathToFileURL(join(toolingRoot,'packages/brain/src/lib/implementation-ci-snapshot.js')));
 need(!body?.error&&body?.snapshot,'PR_BASELINE_SNAPSHOT_INVALID');
 const snapshot=api.validateImplementationSnapshot(body.snapshot);
 need(snapshot.repo===REPO&&snapshot.scope===SCOPES[0]&&snapshot.status==='verified'&&!snapshot.gaps.length,'PR_BASELINE_SNAPSHOT_INVALID');
 const scopes=api.extractImplementationAdmissionSnapshots(snapshot,SCOPES);
 need(scopes.length===2&&scopes.every((s,i)=>s.scope===SCOPES[i]&&s.repo===REPO&&s.revision===snapshot.revision&&s.status==='verified'&&!s.gaps.length),'PR_BASELINE_SCOPE_INVALID');
 return {revision:snapshot.revision,snapshot_sha256:snapshot.snapshot_sha256,scope_hashes:Object.fromEntries(scopes.map(s=>[s.scope,s.snapshot_sha256]))};
}
async function main(){
 const fields={'--repo-root':'repoRoot','--tooling-root':'toolingRoot','--input-dir':'inputDir','--output-dir':'outputDir'},args=process.argv.slice(2),options={};
 for(let i=0;i<args.length;i+=2){need(fields[args[i]]&&args[i+1]&&!options[fields[args[i]]],'PR_BASELINE_ARGUMENT_INVALID');options[fields[args[i]]]=resolve(args[i+1]);}
 need(Object.values(fields).every(k=>options[k]),'PR_BASELINE_ARGUMENT_MISSING');
 mkdirSync(options.outputDir,{recursive:true});
 try{
  const result=await resolvePrBaseline({...options,repository:process.env.GITHUB_REPOSITORY,eventName:process.env.GITHUB_EVENT_NAME,
   event:JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),toolingRevision:process.env.TOOLING_REVISION});
  for(const [side,name] of [['base','base.json'],['head','head.json']]){const directory=join(options.inputDir,side);mkdirSync(directory,{recursive:true});writeFileSync(join(directory,name),JSON.stringify(result.body)+'\n');}
  writeFileSync(join(options.outputDir,'baseline-resolution.json'),JSON.stringify(result.resolution,null,2)+'\n');
  process.stdout.write(result.resolution.effective_base_revision+'\n');
 }catch(error){writeFileSync(join(options.outputDir,'baseline-resolution.failure.json'),JSON.stringify({status:'unknown',code:error.code||'PR_BASELINE_ERROR'})+'\n');throw error;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===realpathSync(process.argv[1]))main().catch(error=>{process.stderr.write((error.code||'PR_BASELINE_ERROR')+'\n');process.exitCode=1;});
