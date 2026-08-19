// B-03: structure-gate 与 diff-gate 同一语义分流（跨端一致，不分叉）
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

const mkMap = (freshness) => async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: { cecelia: 'b' },
  freshness, affected_nodes: [], required_assertions: [],
});

const task = { id: 't', change_kind: 'code_change' };
const contract = {
  task_id: 't', change_kind: 'code_change', repo: 'cecelia', base_revision: 'b',
  contract_body: { affected_capabilities: [], required_assertions: [] },
};

const stale = await evaluateStructureGate({
  db: null, task, contract,
  mapClient: mkMap({ status: 'stale', reason_code: 'ttl_exceeded' }),
});
const unknown = await evaluateStructureGate({
  db: null, task, contract,
  mapClient: mkMap({ status: 'unknown', reason_code: 'impact_unknown' }),
});

const okStale = stale.gate === 'blocked' && stale.retryable === true && stale.reason === 'ttl_exceeded';
const okUnknown = unknown.gate === 'blocked' && unknown.retryable === false && unknown.httpStatus === 422;

if (!okStale || !okUnknown) {
  console.error('FAIL B-03: structure-gate 分流与 diff-gate 不一致');
  console.error(JSON.stringify({ stale, unknown }));
  process.exit(1);
}
console.log('OK B-03 structure-gate 同语义分流 stale→retryable:true/ttl_exceeded, unknown→retryable:false/422');
console.log(JSON.stringify({ stale: { retryable: stale.retryable, reason: stale.reason }, unknown: { retryable: unknown.retryable, httpStatus: unknown.httpStatus } }));
