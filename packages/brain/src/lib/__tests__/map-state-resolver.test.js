import { describe, expect, it } from 'vitest';

import {
  aggregateFeatureEvidence,
  aggregateMapStates,
  resolveEvidenceState,
  selectCurrentReceipt,
} from '../map-state-resolver.js';

const now = new Date('2026-08-11T12:00:00.000Z');
const revision = 'a'.repeat(40);

function snapshot(minutesAgo = 1, overrides = {}) {
  return {
    source_revision: revision,
    scanner_version: 'test-registry-v2',
    scanned_at: new Date(now.getTime() - minutesAgo * 60_000),
    row_count: 1,
    ...overrides,
  };
}

function receipt(verdict = 'PASS', overrides = {}) {
  return {
    verdict,
    source_repo: 'repo-a',
    source_sha: revision,
    assertion_revision: 2,
    completed_at: new Date(now.getTime() - 10_000),
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    approvedAnchor: true,
    targetExists: true,
    snapshot: snapshot(),
    receiptRequired: true,
    assertionRevision: 2,
    receipt: receipt(),
    now,
    ...overrides,
  };
}

describe('resolveEvidenceState', () => {
  it('当前 revision 的 PASS/FAIL 分别现算 green/red', () => {
    expect(resolveEvidenceState(evidence())).toMatchObject({
      status: 'green', reason_code: 'receipt_pass', source_revision: revision,
    });
    expect(resolveEvidenceState(evidence({ receipt: receipt('FAIL') }))).toMatchObject({
      status: 'red', reason_code: 'receipt_fail', source_revision: revision,
    });
  });

  it('无锚点或新鲜快照证明目标消失均为 gray，旧 cell_status 不具权威性', () => {
    expect(resolveEvidenceState(evidence({
      approvedAnchor: false,
      cell_status: 'green',
    }))).toMatchObject({ status: 'gray', reason_code: 'anchor_missing' });
    expect(resolveEvidenceState(evidence({ targetExists: false }))).toMatchObject({
      status: 'gray', reason_code: 'anchor_target_missing',
    });
  });

  it('显式不适用优先返回 not_applicable 与原因', () => {
    expect(resolveEvidenceState(evidence({
      notApplicableReason: '该验收域无共享入场语义',
      snapshot: null,
    }))).toMatchObject({
      status: 'not_applicable',
      reason_code: 'not_applicable',
      reason: '该验收域无共享入场语义',
    });
  });

  it('超过 15 分钟、revision 不可得或无效时 fail closed unknown', () => {
    expect(resolveEvidenceState(evidence({ snapshot: snapshot(16) }))).toMatchObject({
      status: 'unknown', reason_code: 'snapshot_stale',
    });
    expect(resolveEvidenceState(evidence({ snapshot: null }))).toMatchObject({
      status: 'unknown', reason_code: 'snapshot_missing',
    });
    expect(resolveEvidenceState(evidence({
      snapshot: snapshot(1, { source_revision: 'legacy-unknown' }),
    }))).toMatchObject({ status: 'unknown', reason_code: 'source_revision_legacy' });
  });

  it('receipt 缺失、assertion revision 或 source revision 不匹配均为 unknown', () => {
    expect(resolveEvidenceState(evidence({ receipt: null }))).toMatchObject({
      status: 'unknown', reason_code: 'receipt_missing',
    });
    expect(resolveEvidenceState(evidence({
      receipt: receipt('PASS', { assertion_revision: 1 }),
    }))).toMatchObject({ status: 'unknown', reason_code: 'assertion_revision_mismatch' });
    expect(resolveEvidenceState(evidence({
      receipt: receipt('PASS', { source_sha: 'b'.repeat(40) }),
    }))).toMatchObject({ status: 'unknown', reason_code: 'receipt_revision_mismatch' });
  });

  it('artifact 不要求 receipt 时，新鲜存在即可返回 green presence evidence', () => {
    expect(resolveEvidenceState(evidence({ receiptRequired: false, receipt: null }))).toMatchObject({
      status: 'green', reason_code: 'anchor_target_present',
    });
  });
});

describe('selectCurrentReceipt', () => {
  it('只在当前 assertion revision 内取 completed_at 最新记录，保留 mismatch 供 fail-closed', () => {
    const latestCurrent = receipt('FAIL', {
      completed_at: new Date(now.getTime() - 1_000),
    });
    const selected = selectCurrentReceipt([
      receipt('PASS', { assertion_revision: 1, completed_at: now }),
      receipt('PASS', { completed_at: new Date(now.getTime() - 20_000) }),
      latestCurrent,
    ], 2);
    expect(selected).toBe(latestCurrent);
    expect(selectCurrentReceipt([receipt('PASS', { assertion_revision: 1 })], 2))
      .toMatchObject({ assertion_revision: 1 });
  });
});

describe('aggregateMapStates', () => {
  it('按 red > unknown > all green > gray 聚合，全部不适用保持不适用', () => {
    expect(aggregateMapStates([{ status: 'green' }, { status: 'red' }])).toMatchObject({
      status: 'red', reason_code: 'child_red',
    });
    expect(aggregateMapStates([{ status: 'green' }, { status: 'unknown' }])).toMatchObject({
      status: 'unknown', reason_code: 'child_unknown',
    });
    expect(aggregateMapStates([{ status: 'green' }, { status: 'not_applicable' }]))
      .toMatchObject({ status: 'green', reason_code: 'children_green' });
    expect(aggregateMapStates([{ status: 'gray' }, { status: 'green' }])).toMatchObject({
      status: 'gray', reason_code: 'children_incomplete',
    });
    expect(aggregateMapStates([{ status: 'not_applicable' }])).toMatchObject({
      status: 'not_applicable', reason_code: 'children_not_applicable',
    });
    expect(aggregateMapStates([])).toMatchObject({
      status: 'gray', reason_code: 'children_missing',
    });
  });
});

describe('aggregateFeatureEvidence', () => {
  it('artifact 存在但没有当前 assertion receipt 时不得冒充 green', () => {
    expect(aggregateFeatureEvidence({
      artifactStates: [{ status: 'green', reason_code: 'anchor_target_present' }],
      assertionStates: [],
    })).toMatchObject({ status: 'unknown', reason_code: 'receipt_missing' });

    expect(aggregateFeatureEvidence({
      artifactStates: [{ status: 'green', reason_code: 'anchor_target_present' }],
      assertionStates: [{ status: 'green', reason_code: 'receipt_pass' }],
    })).toMatchObject({ status: 'green', reason_code: 'children_green' });
  });
});
