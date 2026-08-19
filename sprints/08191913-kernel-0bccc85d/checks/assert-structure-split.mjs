// DoD 冻结 oracle — B-03：structure-gate 与 diff-gate 同一语义分流策略（判变端/终验端不分叉）
// 真执行断言（L2）：真调 evaluateStructureGate（db:null，走 freshness 早退分支），只注入 mapClient。
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

const task = { id: 't-b03', change_kind: 'code_change' };
const contract = {
  task_id: 't-b03', change_kind: 'code_change', repo: 'cecelia', base_revision: 'b',
  contract_body: { affected_capabilities: [], required_assertions: [] },
};
const mk = (freshness) => async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: { cecelia: 'b' },
  freshness, affected_nodes: [], required_assertions: [],
});

const stale = await evaluateStructureGate({ db: null, task, contract, mapClient: mk({ status: 'stale', reason_code: 'ttl_exceeded' }) });
const unknown = await evaluateStructureGate({ db: null, task, contract, mapClient: mk({ status: 'unknown', reason_code: 'impact_unknown' }) });

const staleOk = stale.gate === 'blocked' && stale.retryable === true
  && stale.reason === 'ttl_exceeded' && stale.reason !== 'mapper_stale';
const unknownOk = unknown.gate === 'blocked' && unknown.retryable === false
  && (unknown.reason === 'impact_unknown' || unknown.reason_code === 'impact_unknown');
if (!staleOk || !unknownOk) {
  console.error('FAIL B-03 structure-gate 语义分流与 diff-gate 不一致:',
    'stale=', JSON.stringify(stale), 'unknown=', JSON.stringify(unknown));
  process.exit(1);
}
console.log('OK B-03 structure-gate 同语义分流 stale→retryable:true(ttl_exceeded) / unknown→retryable:false(impact_unknown)');
