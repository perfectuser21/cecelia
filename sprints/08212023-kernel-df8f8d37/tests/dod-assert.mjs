/**
 * DoD BEHAVIOR 可执行 oracle（Sprint 08212023-kernel-df8f8d37）。
 * 每条 [BEHAVIOR] 的 manual:bash 命令跑本文件一个场景，import 真实 gate 代码断言。
 * 禁 mock 边合规：调用真实 evaluateDiffGate / gateReceipt，仅注入外层 DB/Mapper 桩。
 * 用法：node sprints/08212023-kernel-df8f8d37/tests/dod-assert.mjs <scenario>
 */
import assert from 'node:assert/strict';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { gateReceipt } from '../../../packages/brain/src/impact-contract/harness-gates.js';

const db = {
  query: async () => ({
    rows: [{
      id: 'c1', repo: 'cecelia', change_kind: 'bugfix', base_revision: 'base',
      manifest_digest: null, projection_digest: null,
      contract_body: { affected_capabilities: [{ capability_id: 'impact-contract' }], required_assertions: [] },
    }],
  }),
};
const gate = (freshness) => evaluateDiffGate({
  db, taskId: 't', repo: 'cecelia', headRevision: 'head',
  mapClient: async () => ({ freshness }),
});

const cases = {
  deterministic_mismatch: async () => {
    const r = await gate({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    assert.equal(r.gate, 'impact_unknown');
    assert.equal(r.reason_code, 'projection_revision_mismatch');
    assert.equal(r.reason, 'projection_revision_mismatch');
    assert.equal(r.retryable, false);
  },
  deterministic_unknown_status: async () => {
    const r = await gate({ status: 'unknown', reason_code: 'capability_not_in_active_projection' });
    assert.equal(r.reason_code, 'capability_not_in_active_projection');
    assert.equal(r.retryable, false);
  },
  transient_fact_stale: async () => {
    const r = await gate({ status: 'stale', reason_code: 'fact_snapshot_stale' });
    assert.equal(r.reason_code, 'fact_snapshot_stale');
    assert.equal(r.retryable, true);
  },
  transient_null: async () => {
    const r = await gate({ status: 'stale' });
    assert.equal(r.reason_code ?? null, null);
    assert.equal(r.retryable, true);
    assert.equal(r.reason, 'mapper_stale');
  },
  unknown_code_failclosed: async () => {
    // Invariant [失败不降级]：未知非 null reason_code 默认按确定性 fail-closed。
    const r = await gate({ status: 'stale', reason_code: 'some_unregistered_reason_code' });
    assert.equal(r.reason_code, 'some_unregistered_reason_code');
    assert.equal(r.retryable, false);
  },
  receipt_passthrough: async () => {
    const r = await gate({ status: 'stale', reason_code: 'projection_revision_mismatch' });
    const rc = gateReceipt('diff', r);
    assert.equal(rc.reason, 'projection_revision_mismatch');
    assert.equal(rc.reason_code, 'projection_revision_mismatch');
    assert.equal(rc.retryable, false);
    assert.equal(`deny:impact:${rc.reason ?? 'unknown'}`, 'deny:impact:projection_revision_mismatch');
  },
};

const scenario = process.argv[2];
const fn = cases[scenario];
if (!fn) { console.error('unknown scenario:', scenario); process.exit(2); }
await fn();
console.log('OK', scenario);
