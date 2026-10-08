import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
const REPO=/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/;
const SHA=/^[0-9a-f]{40}$/;
const HASH=/^[0-9a-f]{64}$/;
const TRUSTED_REPOS=new Set(['perfectuser21/cecelia','perfectuser21/zenithjoy-workspace']);
const trustedMainWitnesses=new WeakSet();
export const isTrustedConsumerSourceMainWitness=witness=>trustedMainWitnesses.has(witness);
export const validAssertionSourceRepo = repo => typeof repo==='string'&&REPO.test(repo);
export function sealedBrainConsumerDefinition(row) {
 return row?.source_repo==='perfectuser21/cecelia'&&SHA.test(row.source_commit)
  &&row.payload_sha256===stepSha256({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload})
  &&row.payload?.definition_scope==='consumer_evidence';
}
export function sealedConsumerVersion(row) {
 return sealedBrainConsumerDefinition(row)&&row.payload.source_set?.some(s=>s.repo===row.source_repo&&s.revision===row.source_commit);
}
// 仅消费不可变历史中已经准入的冻结来源。静态 extractor 的 verified 不构成准入。
export function hasFrozenConsumerSource(payload,repo,path) {
 if(payload?.definition_scope!=='consumer_evidence'||payload.source_scope!=='cecelia-factory'
  ||payload.source_set_admission?.status!=='verified'||payload.source_set_admission?.source_basis!=='trusted_main_history')return false;
 const sources=payload.source_set,bindings=payload.implementation_bindings;
 if(!Array.isArray(sources)||!sources.length||!Array.isArray(bindings)||!bindings.length)return false;
 if(sources.some(s=>!s||Object.keys(s).sort().join(',')!=='repo,revision'||!['perfectuser21/cecelia','perfectuser21/zenithjoy-workspace'].includes(s.repo)||!SHA.test(s.revision)))return false;
 if(new Set(sources.map(s=>s.repo+'@'+s.revision)).size!==sources.length)return false;
 if(payload.source_set_sha256!==stepSha256({source_set:sources,implementation_bindings:bindings}))return false;
 if(bindings.some(b=>!b||!sources.some(s=>s.repo===b.repo&&s.revision===b.revision)||!HASH.test(b.content_sha256)||b.digest!==`sha256:${b.content_sha256}`))return false;
 return bindings.some(b=>b.kind==='code'&&b.repo===repo&&b.path===path&&b.status==='verified'&&b.validation_scope==='consumer_source');
}
/** 收据验证不取代认证传输；collector必须从固定GitHub API实际读取这些对象。 */
export function validateConsumerSourceMainEvidence(witness) {
 try {
  const {source_set:sources,anchor,run,jobs,artifact,snapshot,main_history:history}=witness;
  if(anchor?.repo!=='perfectuser21/cecelia'||!SHA.test(anchor.revision)||!Array.isArray(sources)||!sources.length
    ||sources.some(s=>!s||Object.keys(s).sort().join(',')!=='repo,revision'||!['perfectuser21/cecelia','perfectuser21/zenithjoy-workspace'].includes(s.repo)||!SHA.test(s.revision))
    ||new Set(sources.map(s=>s.repo+'@'+s.revision)).size!==sources.length)return false;
  if(run?.repository?.full_name!==anchor.repo||run.name!=='Implementation impact'||run.path!=='.github/workflows/implementation-impact.yml'
    ||!['push','workflow_dispatch'].includes(run.event)||run.head_branch!=='main'||run.head_sha!==anchor.revision||run.status!=='completed'
    ||!Number.isSafeInteger(run.id)||run.id<=0||!Array.isArray(jobs)||!jobs.some(j=>j.name==='snapshot-main'&&j.status==='completed'&&j.conclusion==='success'))return false;
  if(artifact?.name!==`implementation-snapshot-${anchor.revision}`||artifact.expired!==false||artifact.workflow_run?.id!==run.id||artifact.workflow_run?.head_sha!==anchor.revision)return false;
  if(snapshot?.schema_version!==1||snapshot.repo!==anchor.repo||snapshot.revision!==anchor.revision||snapshot.status!=='verified'||!Array.isArray(snapshot.gaps)||snapshot.gaps.length)return false;
  const {snapshot_sha256,...body}=snapshot;if(snapshot_sha256!==stepSha256(body))return false;
  if(!Array.isArray(history)||history.length!==sources.length)return false;
  return sources.every(s=>history.filter(h=>h.repo===s.repo&&h.revision===s.revision).length===1&&history.some(h=>h.repo===s.repo&&h.revision===s.revision
    &&SHA.test(h.current_main)&&h.url===`https://api.github.com/repos/${s.repo}/compare/${s.revision}...${h.current_main}`
    &&['identical','ahead'].includes(h.comparison?.status)&&h.comparison.base_commit?.sha===s.revision&&h.comparison.merge_base_commit?.sha===s.revision));
 }catch{return false;}
}
/** 固定认证GitHub API；实际artifact内容、独立repo main历史均读回，不信文件名。 */
export async function readConsumerSourceMainWitness(input,{fetchFn=globalThis.fetch,resolveToken}={}) {
 const unknown=code=>({status:'unknown',admission:{status:'unknown'},gaps:[{code}]});
 const {anchor,source_set:sources,run_id:runId}=input||{};
 if(anchor?.repo!=='perfectuser21/cecelia'||!SHA.test(anchor.revision)||!Number.isSafeInteger(runId)||runId<=0
  ||!Array.isArray(sources)||!sources.length||sources.length>4||sources.some(s=>!s||Object.keys(s).sort().join(',')!=='repo,revision'||!TRUSTED_REPOS.has(s.repo)||!SHA.test(s.revision))
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
   if(!SHA.test(current))throw Error('CONSUMER_MAIN_SOURCE_UNKNOWN');
   const path=`${source.repo}/compare/${source.revision}...${current}`,comparison=await json(path);
   history.push({...source,current_main:current,url:`https://api.github.com/repos/${path}`,comparison});
  }
  const witness={source_set:sources,anchor,run,jobs:jobsResponse.jobs,artifact,snapshot,main_history:history};
  if(!validateConsumerSourceMainEvidence(witness))return unknown('CONSUMER_MAIN_EVIDENCE_UNKNOWN');
  const result={status:'verified',admission:{status:'verified',source_basis:'trusted_main_history'},witness};
  trustedMainWitnesses.add(result);return result;
 }catch{return unknown('CONSUMER_MAIN_SOURCE_UNAVAILABLE');}
}
