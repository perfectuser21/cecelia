/** PR专用官方CI基线读取；现存坏证据绝不返回missing或换旧产物。 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {stepSha256 as hash} from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {verifyCiAdmissionAuthority,ciAuthorityProof,ciAuthorityDocument} from './ci-admission-authority.mjs';
import {authorizeCiAdmissionEnvelope} from './ci-admission-envelope.mjs';
import {unpackCiAdmissionArchive} from './ci-admission-archive.mjs';
const PREFIX='repos/perfectuser21/cecelia/actions',positive=n=>Number.isSafeInteger(n)&&n>0;
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
export async function readCiAdmissionBaseline({revision,repoRoot,controlRoot},deps={}){
 need(/^[a-f0-9]{40}$/.test(revision||''),'CI_ADMISSION_BASELINE_INPUT');
 const call=async(path,binary=false)=>{
  try{
   const adapter=binary?deps.download:deps.api;
   if(adapter)return await adapter(path);
   const result=execFileSync('gh',['api','--hostname','github.com',path],{encoding:binary?undefined:'utf8',timeout:15000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});return binary?result:JSON.parse(result);
  }catch(error){if(error.code?.startsWith('CI_ADMISSION_'))throw error;need(false,'CI_ADMISSION_API_ERROR');}
 };
 const name=`implementation-ci-admission-baseline-${revision}`,list=await call(`${PREFIX}/artifacts?name=${name}&per_page=100`);
 need(Array.isArray(list?.artifacts)&&Number.isInteger(list.total_count)&&list.total_count===list.artifacts.length&&list.total_count<=100,'CI_ADMISSION_LIST_INCOMPLETE');
 need(list.artifacts.every(a=>a?.name===name&&typeof a.expired==='boolean'),'CI_ADMISSION_ARTIFACT_INVALID');
 const candidates=list.artifacts.filter(a=>!a.expired);if(!candidates.length)return null;
 need(candidates.every(a=>positive(a.id)&&Number.isFinite(Date.parse(a.created_at)))&&new Set(candidates.map(a=>a.id)).size===candidates.length,'CI_ADMISSION_ARTIFACT_AMBIGUOUS');
 candidates.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id-a.id);
 const listed=candidates[0],meta=await call(`${PREFIX}/artifacts/${listed.id}`);
 for(const key of ['id','name','expired','digest','size_in_bytes','created_at','workflow_run'])need(hash(meta?.[key])===hash(listed[key]),'CI_ADMISSION_ARTIFACT_CHANGED');
 need(positive(meta.workflow_run?.id)&&/^[a-f0-9]{40}$/.test(meta.workflow_run.head_sha||'')&&meta.workflow_run.head_branch==='main'
  &&positive(meta.size_in_bytes)&&meta.size_in_bytes<=16*1024*1024&&/^sha256:[a-f0-9]{64}$/.test(meta.digest||''),'CI_ADMISSION_ARTIFACT_INVALID');
 const zipPath=`${PREFIX}/artifacts/${meta.id}/zip`,bytes=await call(zipPath,true);
 need(Buffer.isBuffer(bytes)&&bytes.length===meta.size_in_bytes&&`sha256:${createHash('sha256').update(bytes).digest('hex')}`===meta.digest,'CI_ADMISSION_ARTIFACT_DIGEST');
 const {envelope}=unpackCiAdmissionArchive(bytes),run=await call(`${PREFIX}/runs/${meta.workflow_run.id}`);
 need(envelope?.ci_source_revision===revision&&envelope.ci_control_revision===meta.workflow_run.head_sha&&positive(envelope.ci_authority?.ci?.run_id),'CI_ADMISSION_ARTIFACT_DOCUMENT');
 const authority=await verifyCiAdmissionAuthority({repoRoot,sourceRevision:revision,controlRevision:meta.workflow_run.head_sha,sourceRunId:envelope.ci_authority.ci.run_id,
  publisher:{runId:meta.workflow_run.id,attempt:run.run_attempt,artifactCreatedAt:meta.created_at},artifactId:meta.id},
 {api:path=>call(path),download:path=>path===zipPath?bytes:call(path,true)});
 const official=ciAuthorityDocument(authority),capability=await authorizeCiAdmissionEnvelope(official,{authority,controlRoot});
 return {envelope:official,capability,archive:bytes,artifact:ciAuthorityProof(authority).artifact,scopeHashes:Object.fromEntries(official.ci_scopes.map(s=>[s.ci_scope_key,s.ci_document_sha256]))};
}
