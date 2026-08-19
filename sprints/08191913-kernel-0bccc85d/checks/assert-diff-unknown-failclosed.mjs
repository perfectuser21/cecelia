// DoD 冻结 oracle — B-02：确定性 unknown → diff-gate fail-closed（retryable:false）且透传具体 reason_code
// 真执行断言（L2）：真调 evaluateDiffGate，只注入 mapClient（Mapper HTTP 外部边界，本 sprint 未改）。
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const mapClient = async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: {},
  freshness: { status: 'unknown', reason_code: 'impact_unknown' },
  affected_nodes: [], required_assertions: [],
});

const r = await evaluateDiffGate({ taskId: 't-b02', mapClient, headRevision: 'h', repo: 'cecelia' });
const ok = r.gate === 'impact_unknown'
  && r.retryable === false
  && r.reason_code === 'impact_unknown'
  && r.reason !== 'mapper_stale';
if (!ok) {
  console.error('FAIL B-02 确定性 unknown 未 fail-closed 或未透传 reason_code:', JSON.stringify(r));
  process.exit(1);
}
console.log('OK B-02 确定性 unknown → fail-closed retryable:false 透传 reason_code=impact_unknown', JSON.stringify(r));
