import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
const REPO=/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/;
const SHA=/^[0-9a-f]{40}$/;
const HASH=/^[0-9a-f]{64}$/;
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
