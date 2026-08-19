// DoD 冻结 oracle — B-01：瞬态 stale → diff-gate retryable:true 且透传具体 reason_code（非 mapper_stale 折叠）
// 真执行断言（L2）：真调 evaluateDiffGate，只注入 mapClient（Mapper HTTP 外部边界，本 sprint 未改）。
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';

const mapClient = async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: {},
  freshness: { status: 'stale', reason_code: 'fact_snapshot_stale' },
  affected_nodes: [], required_assertions: [],
});

const r = await evaluateDiffGate({ taskId: 't-b01', mapClient, headRevision: 'h', repo: 'cecelia' });
const ok = r.gate === 'impact_unknown'
  && r.retryable === true
  && r.reason_code === 'fact_snapshot_stale'
  && r.reason !== 'mapper_stale';
if (!ok) {
  console.error('FAIL B-01 瞬态 stale 未透传具体 reason_code（或被折叠成 mapper_stale）:', JSON.stringify(r));
  process.exit(1);
}
console.log('OK B-01 瞬态 stale → retryable:true 透传 reason_code=fact_snapshot_stale', JSON.stringify(r));
