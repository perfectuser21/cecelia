// TDD 红证 — Diff Impact Gate 透传 reason_code 并 fail-closed 出口
// generator 用（vitest 红绿），非 evaluator oracle。真调 gate（不 mock 被改的边），仅注入 mapClient（Mapper HTTP 外部边界）。
import { describe, it, expect } from 'vitest';
import { evaluateDiffGate } from '../../../packages/brain/src/impact-contract/diff-gate.js';
import { evaluateStructureGate } from '../../../packages/brain/src/impact-contract/structure-gate.js';

const mkMap = (freshness: unknown) => async () => ({
  manifest_digest: 'm', projection_digest: 'p', fact_revisions: { cecelia: 'b' },
  freshness, affected_nodes: [], required_assertions: [],
});

describe('Diff Impact Gate 非 fresh 语义分流 [BEHAVIOR]', () => {
  it('瞬态 stale 透传具体 reason_code 且 retryable:true 非 mapper_stale', async () => {
    const r = await evaluateDiffGate({ taskId: 't', mapClient: mkMap({ status: 'stale', reason_code: 'fact_snapshot_stale' }), headRevision: 'h', repo: 'cecelia' });
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(true);
    expect(r.reason_code).toBe('fact_snapshot_stale');
    expect(r.reason).not.toBe('mapper_stale');
  });

  it('确定性 unknown fail-closed retryable:false 且透传 reason_code', async () => {
    const r = await evaluateDiffGate({ taskId: 't', mapClient: mkMap({ status: 'unknown', reason_code: 'impact_unknown' }), headRevision: 'h', repo: 'cecelia' });
    expect(r.gate).toBe('impact_unknown');
    expect(r.retryable).toBe(false);
    expect(r.reason_code).toBe('impact_unknown');
  });

  it('缺 reason_code 时保守：stale→retryable:true fallback；unknown→retryable:false fallback', async () => {
    const stale = await evaluateDiffGate({ taskId: 't', mapClient: mkMap({ status: 'stale' }), headRevision: 'h', repo: 'cecelia' });
    const unknown = await evaluateDiffGate({ taskId: 't', mapClient: mkMap({ status: 'unknown' }), headRevision: 'h', repo: 'cecelia' });
    expect(stale.retryable).toBe(true);
    expect(unknown.retryable).toBe(false);
  });
});

describe('Structure Gate 与 Diff Gate 同语义分流（跨端一致）[BEHAVIOR]', () => {
  const task = { id: 't', change_kind: 'code_change' };
  const contract = { task_id: 't', change_kind: 'code_change', repo: 'cecelia', base_revision: 'b', contract_body: { affected_capabilities: [], required_assertions: [] } };

  it('structure-gate stale 透传 reason_code 且 retryable:true', async () => {
    const r = await evaluateStructureGate({ db: null, task, contract, mapClient: mkMap({ status: 'stale', reason_code: 'ttl_exceeded' }) });
    expect(r.gate).toBe('blocked');
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe('ttl_exceeded');
  });

  it('structure-gate unknown fail-closed retryable:false', async () => {
    const r = await evaluateStructureGate({ db: null, task, contract, mapClient: mkMap({ status: 'unknown', reason_code: 'impact_unknown' }) });
    expect(r.gate).toBe('blocked');
    expect(r.retryable).toBe(false);
  });
});
