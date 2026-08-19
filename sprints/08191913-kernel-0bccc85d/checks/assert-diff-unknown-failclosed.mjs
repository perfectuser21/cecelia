// B-02: 确定性 unknown → evaluateDiffGate fail-closed（retryable:false）且透传 reason_code
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const mkMap = (freshness) => async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: { cecelia: 'b' },
  freshness, affected_nodes: [], required_assertions: [],
});

const r = await evaluateDiffGate({
  taskId: 't',
  mapClient: mkMap({ status: 'unknown', reason_code: 'impact_unknown' }),
  headRevision: 'h',
  repo: 'cecelia',
});

const ok = r.gate === 'impact_unknown'
  && r.retryable === false
  && r.reason_code === 'impact_unknown';

if (!ok) {
  console.error('FAIL B-02: 确定性 unknown 未 fail-closed / reason_code 未透传');
  console.error(JSON.stringify(r));
  process.exit(1);
}
console.log('OK B-02 确定性 unknown fail-closed retryable:false reason_code=impact_unknown');
console.log(JSON.stringify({ gate: r.gate, retryable: r.retryable, reason: r.reason, reason_code: r.reason_code }));
