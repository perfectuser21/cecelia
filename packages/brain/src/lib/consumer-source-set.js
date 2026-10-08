import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';
const REPO=/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/;
const SHA=/^[0-9a-f]{40}$/;
const HASH=/^[0-9a-f]{64}$/;
export const validAssertionSourceRepo = repo => typeof repo==='string'&&REPO.test(repo);
export function sealedConsumerVersion(row) {
 return row?.source_repo==='perfectuser21/cecelia'&&SHA.test(row.source_commit)
  &&row.payload_sha256===stepSha256({source:{repo:row.source_repo,path:row.source_path,commit:row.source_commit},payload:row.payload})
  &&row.payload?.definition_scope==='consumer_evidence'
  &&row.payload.source_set?.some(s=>s.repo===row.source_repo&&s.revision===row.source_commit);
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
