import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
const REPO=/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/;
const SHA=/^[0-9a-f]{40}$/;
const HASH=/^[0-9a-f]{64}$/;
const isSha=value=>typeof value==='string'&&SHA.test(value);
const isHash=value=>typeof value==='string'&&HASH.test(value);
const TRUSTED_REPOS=new Set(['perfectuser21/cecelia','perfectuser21/zenithjoy-workspace']);
const trustedMainWitnesses=new WeakSet();
function sealedReceipt(value){
 const body=JSON.parse(JSON.stringify(value));
 const freeze=v=>{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;};
 return freeze(body);
}
export const isTrustedConsumerSourceMainWitness=witness=>trustedMainWitnesses.has(witness);
export const validAssertionSourceRepo = repo => typeof repo==='string'&&REPO.test(repo);
export async function consumerSourceAdmissionScope(db) {
 const name=(await db.query('SELECT current_database() name')).rows[0]?.name;
 return {allowScratch:name==='cecelia_scratch'||name==='cecelia_test'&&process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'};
}
export function sealedBrainConsumerDefinition(row) {
 return row?.source_repo==='perfectuser21/cecelia'&&isSha(row.source_commit)
  &&row.payload_sha256===stepSha256({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload})
  &&row.payload?.definition_scope==='consumer_evidence';
}
export function sealedConsumerVersion(row) {
 return sealedBrainConsumerDefinition(row)&&row.payload.source_set?.some(s=>s.repo===row.source_repo&&s.revision===row.source_commit);
}
// 仅消费不可变历史中已经准入的冻结来源。静态 extractor 的 verified 不构成准入。
export function hasFrozenConsumerSource(payload,repo,path,{allowScratch=false}={}) {
 const admission=payload?.source_set_admission;
 const trusted=admission?.source_basis==='trusted_main_history';
 const scratch=allowScratch&&admission?.source_basis==='scratch_candidate'&&admission.purpose==='admission_only';
 if(payload?.definition_scope!=='consumer_evidence'||payload.source_scope!=='cecelia-factory'
  ||admission?.status!=='verified'||(!trusted&&!scratch))return false;
 const sources=payload.source_set,bindings=payload.implementation_bindings;
 if(!Array.isArray(sources)||!sources.length||!Array.isArray(bindings)||!bindings.length)return false;
 if(sources.some(s=>!s||Object.keys(s).sort().join(',')!=='repo,revision'||!['perfectuser21/cecelia','perfectuser21/zenithjoy-workspace'].includes(s.repo)||!isSha(s.revision)))return false;
 if(new Set(sources.map(s=>s.repo+'@'+s.revision)).size!==sources.length)return false;
 if(payload.source_set_sha256!==stepSha256({source_set:sources,implementation_bindings:bindings}))return false;
 if(bindings.some(b=>!b||!sources.some(s=>s.repo===b.repo&&s.revision===b.revision)||!isHash(b.content_sha256)||b.digest!==`sha256:${b.content_sha256}`))return false;
 return bindings.some(b=>b.kind==='code'&&b.repo===repo&&b.path===path&&b.status==='verified'&&b.validation_scope==='consumer_source');
}
/** 收据验证不取代认证传输；collector必须从固定GitHub API实际读取这些对象。 */
export function validateConsumerSourceMainEvidence(witness) {
 try {
  const {source_set:sources,anchor,run,jobs,artifact,snapshot,main_history:history}=witness;
  if(anchor?.repo!=='perfectuser21/cecelia'||!isSha(anchor.revision)||!Array.isArray(sources)||!sources.length
    ||sources.some(s=>!s||Object.keys(s).sort().join(',')!=='repo,revision'||!['perfectuser21/cecelia','perfectuser21/zenithjoy-workspace'].includes(s.repo)||!isSha(s.revision))
    ||new Set(sources.map(s=>s.repo+'@'+s.revision)).size!==sources.length)return false;
  if(run?.repository?.full_name!==anchor.repo||run.name!=='Implementation impact'||run.path!=='.github/workflows/implementation-impact.yml'
    ||!['push','workflow_dispatch'].includes(run.event)||run.head_branch!=='main'||run.head_sha!==anchor.revision||run.status!=='completed'
    ||!Number.isSafeInteger(run.id)||run.id<=0||!Array.isArray(jobs)||!jobs.some(j=>j.name==='snapshot-main'&&j.status==='completed'&&j.conclusion==='success'))return false;
  if(artifact?.name!==`implementation-snapshot-${anchor.revision}`||artifact.expired!==false||artifact.workflow_run?.id!==run.id||artifact.workflow_run?.head_sha!==anchor.revision)return false;
  if(snapshot?.schema_version!==1||snapshot.repo!==anchor.repo||snapshot.revision!==anchor.revision||snapshot.status!=='verified'||!Array.isArray(snapshot.gaps)||snapshot.gaps.length)return false;
  const {snapshot_sha256,...body}=snapshot;if(snapshot_sha256!==stepSha256(body))return false;
  if(!Array.isArray(history)||history.length!==sources.length)return false;
  return sources.every(s=>history.filter(h=>h.repo===s.repo&&h.revision===s.revision).length===1&&history.some(h=>h.repo===s.repo&&h.revision===s.revision
    &&isSha(h.current_main)&&h.url===`https://api.github.com/repos/${s.repo}/compare/${s.revision}...${h.current_main}`
    &&['identical','ahead'].includes(h.comparison?.status)&&h.comparison.base_commit?.sha===s.revision&&h.comparison.merge_base_commit?.sha===s.revision));
 }catch{return false;}
}
/** 固定认证GitHub API；实际artifact内容、独立repo main历史均读回，不信文件名。 */
export async function readConsumerSourceMainWitness(input,{fetchFn=globalThis.fetch,resolveToken}={}) {
 const unknown=code=>({status:'unknown',admission:{status:'unknown'},gaps:[{code}]});
 const {anchor,source_set:sources,run_id:runId}=input||{};
 if(anchor?.repo!=='perfectuser21/cecelia'||!isSha(anchor.revision)||!Number.isSafeInteger(runId)||runId<=0
  ||!Array.isArray(sources)||!sources.length||sources.length>4||sources.some(s=>!s||Object.keys(s).sort().join(',')!=='repo,revision'||!TRUSTED_REPOS.has(s.repo)||!isSha(s.revision))
  ||new Set(sources.map(s=>s.repo+'@'+s.revision)).size!==sources.length)return unknown('CONSUMER_MAIN_INPUT_INVALID');
 try {
  const token=await (resolveToken||((await import('../harness-credentials.js')).resolveGitHubToken))();
  const request=async(path,accept='application/vnd.github+json')=>{
   const response=await fetchFn(`https://api.github.com/repos/${path}`,{redirect:'error',headers:{Accept:accept,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('CONSUMER_MAIN_SOURCE_UNAVAILABLE');return response;
  };
  const json=async path=>(await request(path)).json();
  const run=await json(`${anchor.repo}/actions/runs/${runId}`);
  const jobsResponse=await json(`${anchor.repo}/actions/runs/${runId}/jobs?per_page=100`);
  const artifactsResponse=await json(`${anchor.repo}/actions/runs/${runId}/artifacts?per_page=100`);
  if(jobsResponse.total_count>100||artifactsResponse.total_count>100)throw Error('CONSUMER_MAIN_EVIDENCE_TRUNCATED');
  const artifacts=artifactsResponse.artifacts?.filter(a=>a.name===`implementation-snapshot-${anchor.revision}`&&!a.expired);
  if(artifacts?.length!==1)throw Error('CONSUMER_MAIN_ARTIFACT_UNKNOWN');
  const artifact=artifacts[0];
  if(!Number.isSafeInteger(artifact.id)||artifact.id<=0)throw Error('CONSUMER_MAIN_ARTIFACT_UNKNOWN');
  // GitHub 的 archive API 仅把下载重定向到签名存储URL；第二跳不发送GitHub凭据。
  const redirect=await fetchFn(`https://api.github.com/repos/${anchor.repo}/actions/artifacts/${artifact.id}/zip`,{redirect:'manual',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  if(redirect.status!==302)throw Error('CONSUMER_MAIN_ARCHIVE_UNKNOWN');
  const location=new URL(redirect.headers.get('location'));
  if(location.protocol!=='https:'||location.username||location.password
    ||!(/\.blob\.core\.windows\.net$|\.actions\.githubusercontent\.com$|\.githubusercontent\.com$/).test(location.hostname))throw Error('CONSUMER_MAIN_ARCHIVE_ORIGIN_INVALID');
  const archive=await fetchFn(location.href,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!archive.ok||Number(archive.headers.get('content-length'))>16*1024*1024)throw Error('CONSUMER_MAIN_ARCHIVE_UNKNOWN');
  const bytes=Buffer.from(await archive.arrayBuffer());if(!bytes.length||bytes.length>16*1024*1024)throw Error('CONSUMER_MAIN_ARCHIVE_UNKNOWN');
  const {default:unzipper}=await import('unzipper');const directory=await unzipper.Open.buffer(bytes);
  if(directory.files.some(f=>f.path.startsWith('/')||f.path.split('/').some(p=>p==='..')||f.uncompressedSize>16*1024*1024))throw Error('CONSUMER_MAIN_ARCHIVE_INVALID');
  const files=directory.files.filter(f=>f.type==='File'&&(f.path==='head.json'||f.path.endsWith('/head.json')));
  if(files.length!==1)throw Error('CONSUMER_MAIN_ARTIFACT_CONTENT_UNKNOWN');
  const content=await files[0].buffer();if(content.length>16*1024*1024)throw Error('CONSUMER_MAIN_ARTIFACT_CONTENT_UNKNOWN');
  const wrapper=JSON.parse(content.toString('utf8')),snapshot=wrapper.snapshot||wrapper;
  const history=[];
  for(const source of sources){
   const current=(await (await request(`${source.repo}/commits/main`,'application/vnd.github.sha')).text()).trim();
   if(!isSha(current))throw Error('CONSUMER_MAIN_SOURCE_UNKNOWN');
   const path=`${source.repo}/compare/${source.revision}...${current}`,comparison=await json(path);
   history.push({...source,current_main:current,url:`https://api.github.com/repos/${path}`,comparison});
  }
  const witness={source_set:sources,anchor,run,jobs:jobsResponse.jobs,artifact,snapshot,main_history:history};
  if(!validateConsumerSourceMainEvidence(witness))return {...unknown('CONSUMER_MAIN_EVIDENCE_UNKNOWN'),diagnostics:{
   run:{id:run.id,name:run.name,path:run.path,event:run.event,head_sha:run.head_sha,head_branch:run.head_branch,status:run.status,repository:run.repository?.full_name},
   snapshot:{repo:snapshot.repo,revision:snapshot.revision,status:snapshot.status,schema_version:snapshot.schema_version,gaps:snapshot.gaps,digest_valid:snapshot.snapshot_sha256===stepSha256((({snapshot_sha256,...body})=>body)(snapshot))},
   artifact:{name:artifact.name,workflow_run:artifact.workflow_run,expired:artifact.expired},
   jobs:jobsResponse.jobs?.filter(j=>j.name==='snapshot-main').map(j=>({name:j.name,status:j.status,conclusion:j.conclusion})),
   main_history:history.map(h=>({repo:h.repo,revision:h.revision,current_main:h.current_main,status:h.comparison?.status,base_sha:h.comparison?.base_commit?.sha,merge_base_sha:h.comparison?.merge_base_commit?.sha}))}};
  const result=sealedReceipt({status:'verified',admission:{status:'verified',source_basis:'trusted_main_history'},witness});
  trustedMainWitnesses.add(result);return result;
 }catch{return unknown('CONSUMER_MAIN_SOURCE_UNAVAILABLE');}
}
const trustedWorkspaceConsumerSources=new WeakSet();
export const isTrustedWorkspaceConsumerSource=proof=>trustedWorkspaceConsumerSources.has(proof);
/** 唯一生产core的实际动态消费者；core未合入/不可加载时保持UNKNOWN。 */
export async function collectWorkspaceConsumerSourceSet(input,{fetchFn=globalThis.fetch,resolveToken}={}) {
 const unknown=code=>({status:'unknown',admission:{status:'unknown'},gaps:[{code}],executable:false});
 const {workspace,brain,identity,anchor,run_id:runId}=input||{};
 if(workspace?.repo!=='perfectuser21/zenithjoy-workspace'||!isSha(workspace.revision)||brain?.repo!=='perfectuser21/cecelia'
  ||!Array.isArray(brain.revisions)||!brain.revisions.length||brain.revisions.length>2||brain.revisions.some(r=>!isSha(r))
  ||new Set(brain.revisions).size!==brain.revisions.length||anchor?.repo!=='perfectuser21/cecelia'||!isSha(anchor.revision))return unknown('CONSUMER_CORE_INPUT_INVALID');
 let extract;
 try{({extractWorkspaceCiSourceBundle:extract}=await import('./workspace-ci-source-bundle.js'));}
 catch{return unknown('CONSUMER_CORE_UNAVAILABLE');}
 try{
  const token=await (resolveToken||((await import('../harness-credentials.js')).resolveGitHubToken))();
  const allowed=[workspace,...brain.revisions.map(revision=>({repo:brain.repo,revision}))];
  const readSource=async({repo,revision,path})=>{
   if(!allowed.some(s=>s.repo===repo&&s.revision===revision)||typeof path!=='string'||path.length>1024||path.startsWith('/')
     ||/[\\\0?#]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('CONSUMER_SOURCE_IDENTITY_INVALID');
   const url=`https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${revision}`;
   const response=await fetchFn(url,{redirect:'error',headers:{Accept:'application/vnd.github.raw',Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('CONSUMER_SOURCE_UNAVAILABLE');const bytes=Buffer.from(await response.arrayBuffer());
   if(!bytes.length||bytes.length>1024*1024)throw Error('CONSUMER_SOURCE_BYTES_INVALID');return bytes;
  };
  const proof=await extract({workspace,brain,identity,readSource});
  if(proof.status!=='verified'||proof.gaps?.length||proof.consumer?.status!=='verified')return {...unknown('CONSUMER_CORE_SOURCE_UNKNOWN'),source_gaps:proof.gaps};
  const witness=await readConsumerSourceMainWitness({anchor,source_set:proof.source_set,run_id:runId},{fetchFn,resolveToken:async()=>token});
  if(!isTrustedConsumerSourceMainWitness(witness))return {...unknown('CONSUMER_MAIN_EVIDENCE_UNKNOWN'),source_gaps:witness.gaps,diagnostics:witness.diagnostics};
  const result=sealedReceipt({...proof,registry_source:anchor,admission:{status:'verified',source_basis:'trusted_main_history',snapshot_sha256:witness.witness.snapshot.snapshot_sha256,run_id:runId},main_evidence:witness.witness});
  trustedWorkspaceConsumerSources.add(result);return result;
 }catch{return unknown('CONSUMER_CORE_SOURCE_UNAVAILABLE');}
}
/** 只供真实F3受信refresh在registry锁内append使用；旧payload不原地改写。 */
export function freezeFactoryWorkspaceConsumerPayload(payload,proof,anchor) {
 const fail=code=>{throw Object.assign(Error(code),{code,status:422});};
 if(!isTrustedWorkspaceConsumerSource(proof)||proof.status!=='verified'||proof.admission?.status!=='verified'
   ||!validateConsumerSourceMainEvidence(proof.main_evidence)||proof.registry_source?.repo!==anchor?.repo||proof.registry_source?.revision!==anchor?.revision)fail('CONSUMER_MAIN_SOURCE_UNKNOWN');
 return freezeConsumerPayload(payload,proof,anchor,'trusted_main_history');
}
function freezeConsumerPayload(payload,proof,anchor,basis) {
 const fail=code=>{throw Object.assign(Error(code),{code,status:422});};
 if(anchor.repo!=='perfectuser21/cecelia'||payload?.activity_id!=='0466016e-6d9f-4325-aeb4-d8bc70424a48'
  ||proof.consumer?.activity_id!==payload.activity_id||payload.definition_key!=='factory_f3_ops.step_1'
  ||payload.definition_scope!=='consumer_evidence'||payload.source_scope!=='cecelia-factory'||payload.contract?.executable!==false
  ||!Array.isArray(payload.steps)||payload.steps.length||!Array.isArray(payload.implementation_bindings))fail('CONSUMER_FACTORY_IDENTITY_UNKNOWN');
 const native=payload.implementation_bindings;
 if(!native.length||native.some(b=>b.repo!==anchor.repo||b.revision!==anchor.revision||b.status!=='verified'
  ||b.validation_scope!=='consumer_source'||!isHash(b.content_sha256)||b.digest!==`sha256:${b.content_sha256}`))fail('CONSUMER_REGISTRY_ANCHOR_SOURCE_UNKNOWN');
 const bindings=new Map();
 for(const binding of [...native,...proof.consumer.bindings]){
  const key=JSON.stringify([binding.repo,binding.revision,binding.path]);
  if(bindings.has(key)&&stepSha256(bindings.get(key))!==stepSha256(binding))fail('CONSUMER_SOURCE_BINDING_CONFLICT');
  bindings.set(key,binding);
 }
 const implementation_bindings=[...bindings.values()];
 const source_set=[...new Map([...proof.source_set,anchor].map(s=>[`${s.repo}@${s.revision}`,{repo:s.repo,revision:s.revision}])).values()];
 const result={...payload,implementation_bindings,source_set,registry_source:{...anchor},
  source_set_sha256:stepSha256({source_set,implementation_bindings}),
  source_set_admission:{status:'verified',source_basis:basis,purpose:basis==='scratch_candidate'?'admission_only':'consumer_source_only',...(basis==='trusted_main_history'?{run_id:proof.admission.run_id,snapshot_sha256:proof.admission.snapshot_sha256}:{})},
  input_relations:[...(payload.input_relations||[]),...proof.consumer.input_relations],verification:{runtime_status:'not_evaluated'}};
 return sealedReceipt(result);
}

const scratchWorkspaceConsumerSources=new WeakSet();
/** 候选只在实际隔离库提取；此凭据不能用于生产，也不能通过序列化重放。 */
export async function collectScratchWorkspaceConsumerSourceSet(db,input,{readSource}={}) {
 const unknown=code=>({status:'unknown',admission:{status:'unknown'},gaps:[{code}],executable:false});
 if(!(await consumerSourceAdmissionScope(db)).allowScratch)return unknown('CONSUMER_SCRATCH_REQUIRED');
 const {workspace,brain,identity,anchor}=input||{};
 if(workspace?.repo!=='perfectuser21/zenithjoy-workspace'||!isSha(workspace.revision)
  ||brain?.repo!=='perfectuser21/cecelia'||!Array.isArray(brain.revisions)||!brain.revisions.length||brain.revisions.length>2
  ||brain.revisions.some(r=>!isSha(r))||new Set(brain.revisions).size!==brain.revisions.length
  ||anchor?.repo!==brain.repo||!isSha(anchor.revision)||typeof readSource!=='function')return unknown('CONSUMER_CORE_INPUT_INVALID');
 try{
  const {extractWorkspaceCiSourceBundle:extract}=await import('./workspace-ci-source-bundle.js');
  const proof=await extract({workspace,brain,identity,readSource});
  if(proof.status!=='verified'||proof.gaps?.length||proof.consumer?.status!=='verified')return {...unknown('CONSUMER_CORE_SOURCE_UNKNOWN'),source_gaps:proof.gaps};
  const result=sealedReceipt({...proof,registry_source:anchor,admission:{status:'verified',source_basis:'scratch_candidate',purpose:'admission_only'}});
  scratchWorkspaceConsumerSources.add(result);return result;
 }catch{return unknown('CONSUMER_CORE_SOURCE_UNAVAILABLE');}
}
export function freezeScratchFactoryWorkspaceConsumerPayload(payload,proof,anchor) {
 if(!scratchWorkspaceConsumerSources.has(proof)||proof.status!=='verified'||proof.admission?.status!=='verified'
  ||proof.admission.source_basis!=='scratch_candidate'||proof.admission.purpose!=='admission_only'
  ||proof.registry_source?.repo!==anchor?.repo||proof.registry_source?.revision!==anchor?.revision)
  throw Object.assign(Error('CONSUMER_SCRATCH_SOURCE_UNKNOWN'),{code:'CONSUMER_SCRATCH_SOURCE_UNKNOWN',status:422});
 return freezeConsumerPayload(payload,proof,anchor,'scratch_candidate');
}
