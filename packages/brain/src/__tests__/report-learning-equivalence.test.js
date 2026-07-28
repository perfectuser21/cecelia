import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  _resetAutoLearningState,
  createReportLearningEquivalenceSeam,
} from '../auto-learning.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const EFFECT_RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const STALE_EFFECT_RECEIPT_ID =
  '44444444-4444-4444-8444-444444444444';
const PREDECESSOR_GRANT_ID =
  '55555555-5555-4555-8555-555555555555';
const PREDECESSOR_RECEIPT_ID =
  '66666666-6666-4666-8666-666666666666';
const ARTIFACT_SHA = 'a'.repeat(40);
const EFFECT_RECEIPT_SHA256 = 'b'.repeat(64);
const NOW = '2026-07-28T08:00:00.000Z';

function fixture(scenario) {
  const state = {
    report: null,
    learning: null,
  };
  const evidence = scenario === 'violation'
    ? {
      resource_id: `eq-${ATTEMPT_ID}`,
      resource_ref: `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/closure/case`,
      attempt_id: ATTEMPT_ID,
      effect_receipt_id: STALE_EFFECT_RECEIPT_ID,
      effect_receipt_sha256: 'c'.repeat(64),
      artifact_sha: ARTIFACT_SHA,
      verified_at: '2026-07-28T06:00:00.000Z',
      expires_at: '2026-07-28T07:00:00.000Z',
      report_args: {
        initiativeId: `initiative-${scenario}`,
        title: `closure ${scenario}`,
        reportKind: 'success',
      },
      learning_input: {
        title: `Report closure ${scenario}`,
        category: 'delivery_insight',
        content: `Effect evidence closure ${scenario}`,
        triggerEvent: 'kernel_report_learning_closure',
        metadata: { source: 'equivalence-drill' },
      },
    }
    : {
      resource_id: `eq-${ATTEMPT_ID}`,
      resource_ref: `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/closure/case`,
      attempt_id: ATTEMPT_ID,
      effect_receipt_id: EFFECT_RECEIPT_ID,
      effect_receipt_sha256: EFFECT_RECEIPT_SHA256,
      artifact_sha: ARTIFACT_SHA,
      verified_at: '2026-07-28T07:59:00.000Z',
      expires_at: '2026-07-28T08:01:00.000Z',
      report_args: {
        initiativeId: `initiative-${scenario}`,
        title: `closure ${scenario}`,
        reportKind: 'success',
      },
      learning_input: {
        title: `Report closure ${scenario}`,
        category: 'delivery_insight',
        content: `Effect evidence closure ${scenario}`,
        triggerEvent: 'kernel_report_learning_closure',
        metadata: { source: 'equivalence-drill' },
      },
    };
  const reportDeps = {
    dbQuery: vi.fn(async (_sql, params) => {
      state.report = JSON.parse(params[2]);
      return { rows: [], rowCount: 1 };
    }),
  };
  const learningPool = {
    query: vi.fn(async (sql, params) => {
      if (/SELECT id FROM learnings/.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      if (/INSERT INTO learnings/.test(sql)) {
        state.learning = {
          id: `learning-${scenario}`,
          metadata: JSON.parse(params[4]),
        };
        return {
          rows: [{
            id: state.learning.id,
            title: params[0],
          }],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  const closureAuthority = {
    owner_service: 'kernel.closure.report_learning',
    now: vi.fn(() => new Date(NOW)),
    loadEvidence: vi.fn(async () => ({ ...evidence })),
    snapshot: vi.fn(async () => ({
      report: state.report && {
        effect_receipt_id: state.report.effect_receipt_id,
        effect_receipt_sha256: state.report.effect_receipt_sha256,
        artifact_sha: state.report.effect_artifact_sha,
      },
      learning: state.learning && {
        id: state.learning.id,
        effect_receipt_id:
          state.learning.metadata.effect_receipt_id,
        effect_receipt_sha256:
          state.learning.metadata.effect_receipt_sha256,
        artifact_sha: state.learning.metadata.effect_artifact_sha,
      },
    })),
    loadPredecessorEvidenceBinding: vi.fn(async () => ({
      owner_service: 'kernel.closure.report_learning',
      predecessor_grant_id: PREDECESSOR_GRANT_ID,
      predecessor_receipt_id: PREDECESSOR_RECEIPT_ID,
      denial_code: 'stale_effect_closure_denied',
      evidence_ref:
        `db:kernel-equivalence-receipts/${PREDECESSOR_RECEIPT_ID}`,
      stale_effect_receipt_id: STALE_EFFECT_RECEIPT_ID,
      refreshed_effect_receipt_id: EFFECT_RECEIPT_ID,
    })),
  };
  const cell = {
    cell_id: `KERNEL-P1-11-REPORT-LEARNING-CLOSURE::codex::${scenario}`,
    behavior_id: 'KERNEL-P1-11-REPORT-LEARNING-CLOSURE',
    provider: 'codex',
    scenario,
    seam_id: 'kernel.closure.report_learning',
    adapter_id: 'kernel.drill.report_learning_closure.v1',
  };
  const grant = {
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    artifact_sha: ARTIFACT_SHA,
    resource_id: evidence.resource_id,
    resource_ref: evidence.resource_ref,
  };
  const forgedSpawn = vi.fn();
  const forgedLearning = vi.fn();
  const resource = {
    resource_id: grant.resource_id,
    resource_ref: grant.resource_ref,
    effect_receipt_id: 'forged-effect-receipt',
    expires_at: '2099-01-01T00:00:00.000Z',
    spawnReport: forgedSpawn,
    createLearning: forgedLearning,
  };
  const effectSigner = {
    signEffectResult: vi.fn(async ({
      cell: signedCell,
      grant: signedGrant,
      observation,
      predecessor,
    }) => ({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      seam_id: signedCell.seam_id,
      adapter_id: signedCell.adapter_id,
      resource_id: signedGrant.resource_id,
      resource_ref: signedGrant.resource_ref,
      ...observation,
      predecessor,
      signature: 'test-signature',
    })),
  };

  return {
    state,
    evidence,
    reportDeps,
    learningPool,
    closureAuthority,
    cell,
    grant,
    resource,
    effectSigner,
    forgedSpawn,
    forgedLearning,
    seam: createReportLearningEquivalenceSeam({
      reportDeps,
      learningPool,
      closureAuthority,
      effectSigner,
    }),
  };
}

function predecessor() {
  return {
    grant: { grant_id: PREDECESSOR_GRANT_ID },
    receipt: { receipt_id: PREDECESSOR_RECEIPT_ID },
  };
}

beforeEach(() => {
  _resetAutoLearningState();
});

describe('report-learning equivalence seam', () => {
  it.each([
    ['normal', 'confirmed', 'report_learning_closure_confirmed'],
    ['violation', 'denied', 'stale_effect_closure_denied'],
    ['recovery', 'recovered', 'refreshed_effect_closure_confirmed'],
  ])('executes the actual %s closure path', async (
    scenario,
    observedOutcome,
    effectCode,
  ) => {
    const value = fixture(scenario);
    const lineage = scenario === 'recovery' ? predecessor() : null;

    const receipt = await value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      predecessor: lineage,
      signal: new AbortController().signal,
    });

    expect(receipt).toMatchObject({
      observed_outcome: observedOutcome,
      effect_code: effectCode,
      signature: 'test-signature',
    });
    expect(value.closureAuthority.loadEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: {
          resource_id: value.resource.resource_id,
          resource_ref: value.resource.resource_ref,
        },
      }),
    );
    expect(value.forgedSpawn).not.toHaveBeenCalled();
    expect(value.forgedLearning).not.toHaveBeenCalled();
    expect(value.effectSigner.signEffectResult).toHaveBeenCalledWith({
      cell: value.cell,
      grant: value.grant,
      observation: {
        observed_outcome: observedOutcome,
        effect_code: effectCode,
        before_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        after_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      predecessor: lineage,
    });

    if (scenario === 'violation') {
      expect(value.reportDeps.dbQuery).not.toHaveBeenCalled();
      expect(value.learningPool.query).not.toHaveBeenCalled();
      expect(value.state).toEqual({ report: null, learning: null });
    } else {
      expect(value.reportDeps.dbQuery).toHaveBeenCalledTimes(1);
      expect(value.learningPool.query).toHaveBeenCalledTimes(2);
      expect(value.state.report).toMatchObject({
        effect_receipt_id: EFFECT_RECEIPT_ID,
        effect_receipt_sha256: EFFECT_RECEIPT_SHA256,
        effect_artifact_sha: ARTIFACT_SHA,
      });
      expect(value.state.learning.metadata).toMatchObject({
        effect_receipt_id: EFFECT_RECEIPT_ID,
        effect_receipt_sha256: EFFECT_RECEIPT_SHA256,
        effect_artifact_sha: ARTIFACT_SHA,
      });
    }
  });

  it.each([
    ['missing', null],
    ['stale', { expires_at: '2026-07-28T07:59:59.000Z' }],
  ])('prevents a green closure when effect evidence is %s', async (
    _label,
    evidenceOverride,
  ) => {
    const value = fixture('normal');
    value.closureAuthority.loadEvidence.mockResolvedValue(
      evidenceOverride === null
        ? null
        : { ...value.evidence, ...evidenceOverride },
    );

    await expect(value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'report_learning_effect_evidence_unavailable',
    });
    expect(value.reportDeps.dbQuery).not.toHaveBeenCalled();
    expect(value.learningPool.query).not.toHaveBeenCalled();
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('rejects recovery not DB-bound to the verified stale denial', async () => {
    const value = fixture('recovery');
    value.closureAuthority.loadPredecessorEvidenceBinding
      .mockResolvedValue({
        owner_service: value.cell.seam_id,
        predecessor_grant_id: PREDECESSOR_GRANT_ID,
        predecessor_receipt_id: PREDECESSOR_RECEIPT_ID,
        denial_code: 'stale_effect_closure_denied',
        evidence_ref:
          `db:kernel-equivalence-receipts/${PREDECESSOR_RECEIPT_ID}`,
        stale_effect_receipt_id: STALE_EFFECT_RECEIPT_ID,
        refreshed_effect_receipt_id: STALE_EFFECT_RECEIPT_ID,
      });

    await expect(value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      predecessor: predecessor(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'report_learning_recovery_unproven',
    });
    expect(value.reportDeps.dbQuery).not.toHaveBeenCalled();
    expect(value.learningPool.query).not.toHaveBeenCalled();
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('refuses to sign when both actual writes are not authoritatively visible', async () => {
    const value = fixture('normal');
    value.closureAuthority.snapshot
      .mockResolvedValueOnce({ report: null, learning: null })
      .mockResolvedValueOnce({
        report: {
          effect_receipt_id: EFFECT_RECEIPT_ID,
          effect_receipt_sha256: EFFECT_RECEIPT_SHA256,
          artifact_sha: ARTIFACT_SHA,
        },
        learning: null,
      });

    await expect(value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'report_learning_closure_unconfirmed',
    });
    expect(value.reportDeps.dbQuery).toHaveBeenCalledTimes(1);
    expect(value.learningPool.query).toHaveBeenCalledTimes(2);
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('requires seam-owned signer, authority, and actual closure stores', () => {
    const value = fixture('normal');
    expect(() => createReportLearningEquivalenceSeam({
      reportDeps: value.reportDeps,
      learningPool: value.learningPool,
      closureAuthority: value.closureAuthority,
    })).toThrowError(expect.objectContaining({
      code: 'seam_effect_signer_unavailable',
    }));
    expect(() => createReportLearningEquivalenceSeam({
      reportDeps: value.reportDeps,
      learningPool: value.learningPool,
      effectSigner: value.effectSigner,
    })).toThrowError(expect.objectContaining({
      code: 'report_learning_authority_port_unavailable',
    }));
    expect(() => createReportLearningEquivalenceSeam({
      closureAuthority: value.closureAuthority,
      effectSigner: value.effectSigner,
    })).toThrowError(expect.objectContaining({
      code: 'report_learning_closure_store_unavailable',
    }));
  });
});
