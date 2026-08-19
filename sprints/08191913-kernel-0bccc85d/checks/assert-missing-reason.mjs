// DoD 冻结 oracle — B-04：边界 — freshness 缺 reason 细分字段（只有 status）→ 保守 fallback，不静默丢/不误 fail-closed
// 规则：status:'stale' 且无 reason_code → 保守瞬态 retryable:true，reason fallback 'mapper_stale'（有具体值才透传，不静默丢真值）
//       status:'unknown' 且无 reason_code → 仍 fail-closed retryable:false，reason fallback 'impact_unknown'
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const mk = (freshness) => async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: {},
  freshness, affected_nodes: [], required_assertions: [],
});

const staleNoCode = await evaluateDiffGate({ taskId: 't-b04a', mapClient: mk({ status: 'stale' }), headRevision: 'h', repo: 'cecelia' });
const unknownNoCode = await evaluateDiffGate({ taskId: 't-b04b', mapClient: mk({ status: 'unknown' }), headRevision: 'h', repo: 'cecelia' });

const staleOk = staleNoCode.gate === 'impact_unknown' && staleNoCode.retryable === true
  && (staleNoCode.reason === 'mapper_stale' || staleNoCode.reason_code === 'mapper_stale');
const unknownOk = unknownNoCode.gate === 'impact_unknown' && unknownNoCode.retryable === false
  && (unknownNoCode.reason === 'impact_unknown' || unknownNoCode.reason_code === 'impact_unknown');
if (!staleOk || !unknownOk) {
  console.error('FAIL B-04 缺 reason_code 时 fallback 语义错误:',
    'staleNoCode=', JSON.stringify(staleNoCode), 'unknownNoCode=', JSON.stringify(unknownNoCode));
  process.exit(1);
}
console.log('OK B-04 缺 reason_code：stale→retryable:true fallback mapper_stale / unknown→retryable:false fallback impact_unknown');
