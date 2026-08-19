// B-04: 边界 — freshness 缺 reason_code（只 status）→ 保守 fallback，不静默丢/不误判
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const mkMap = (freshness) => async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: { cecelia: 'b' },
  freshness, affected_nodes: [], required_assertions: [],
});

const staleNoCode = await evaluateDiffGate({
  taskId: 't', mapClient: mkMap({ status: 'stale' }), headRevision: 'h', repo: 'cecelia',
});
const unknownNoCode = await evaluateDiffGate({
  taskId: 't', mapClient: mkMap({ status: 'unknown' }), headRevision: 'h', repo: 'cecelia',
});

const okStale = staleNoCode.retryable === true && staleNoCode.reason === 'mapper_stale';
const okUnknown = unknownNoCode.retryable === false && unknownNoCode.reason === 'impact_unknown';

if (!okStale || !okUnknown) {
  console.error('FAIL B-04: 缺 reason_code 时 fallback 语义错误');
  console.error(JSON.stringify({ staleNoCode, unknownNoCode }));
  process.exit(1);
}
console.log('OK B-04 缺 reason_code：staleNoCode→retryable:true(mapper_stale), unknownNoCode→retryable:false(impact_unknown)');
console.log(JSON.stringify({
  staleNoCode: { retryable: staleNoCode.retryable, reason: staleNoCode.reason },
  unknownNoCode: { retryable: unknownNoCode.retryable, reason: unknownNoCode.reason },
}));
