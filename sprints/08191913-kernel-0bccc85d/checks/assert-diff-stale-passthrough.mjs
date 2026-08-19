// B-01: 瞬态 stale → evaluateDiffGate retryable:true 且透传具体 reason_code（非 mapper_stale 折叠）
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const mkMap = (freshness) => async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: { cecelia: 'b' },
  freshness, affected_nodes: [], required_assertions: [],
});

const r = await evaluateDiffGate({
  taskId: 't',
  mapClient: mkMap({ status: 'stale', reason_code: 'fact_snapshot_stale' }),
  headRevision: 'h',
  repo: 'cecelia',
});

const ok = r.gate === 'impact_unknown'
  && r.retryable === true
  && r.reason_code === 'fact_snapshot_stale'
  && r.reason !== 'mapper_stale';

if (!ok) {
  console.error('FAIL B-01: 瞬态 stale 未透传具体 reason_code / retryable 非 true');
  console.error(JSON.stringify(r));
  process.exit(1);
}
console.log('OK B-01 瞬态 stale 透传 reason_code=fact_snapshot_stale retryable:true');
console.log(JSON.stringify({ gate: r.gate, retryable: r.retryable, reason: r.reason, reason_code: r.reason_code }));
