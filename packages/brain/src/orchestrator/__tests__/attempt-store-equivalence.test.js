import { describe, expect, it, vi } from 'vitest';

import {
  createAttemptOwnershipEquivalenceSeam,
  createAttemptStore,
} from '../attempt-store.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const PREDECESSOR_GRANT_ID = '33333333-3333-4333-8333-333333333333';
const PREDECESSOR_RECEIPT_ID = '44444444-4444-4444-8444-444444444444';

function fixture(scenario) {
  const state = {
    id: ATTEMPT_ID,
    run_id: RUN_ID,
    role: 'evaluator',
    status: 'running',
    lease_owner: 'controller-authority:1',
    lease_generation: 7,
    result: null,
  };
  const pool = {
    query: vi.fn(async (sql, values) => {
      if (/SELECT \* FROM harness_attempts WHERE id=\$1/.test(sql)) {
        return { rows: [{ ...state }], rowCount: 1 };
      }
      if (/UPDATE harness_attempts/.test(sql)) {
        const owner = values[5];
        const generation = values[6];
        if (
          state.status === 'running'
          && owner === state.lease_owner
          && generation === state.lease_generation
        ) {
          state.status = values[1];
          state.result = values[2];
          return { rows: [{ ...state }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
  const attemptStore = createAttemptStore(pool);
  const result = {
    contract_version: '1.0',
    attempt_id: ATTEMPT_ID,
    status: 'completed',
    summary: 'ownership drill',
    artifacts: [],
    checks: [],
    decision: { outcome: 'PASS', reason: 'owner accepted' },
    error: null,
    provider_metadata: { provider: 'codex', session_id: 'session-1' },
  };
  const ownershipAuthority = {
    owner_service: 'kernel.controller.attempt_ownership',
    loadTarget: vi.fn(async () => ({
      attempt_id: ATTEMPT_ID,
      result,
      lease_owner: state.lease_owner,
      lease_generation: state.lease_generation,
      callback_owner: scenario === 'violation'
        ? 'foreign-controller:9'
        : state.lease_owner,
    })),
    snapshot: vi.fn(async () => ({
      status: state.status,
      result: state.result,
    })),
    loadPredecessorOwnershipBinding: vi.fn(async () => ({
      owner_service: 'kernel.controller.attempt_ownership',
      predecessor_grant_id: PREDECESSOR_GRANT_ID,
      predecessor_receipt_id: PREDECESSOR_RECEIPT_ID,
      denial_code: 'cross_session_callback_denied',
      evidence_ref:
        `db:kernel-equivalence-receipts/${PREDECESSOR_RECEIPT_ID}`,
    })),
  };
  const cell = {
    cell_id:
      `KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION::codex::${scenario}`,
    behavior_id: 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
    provider: 'codex',
    scenario,
    seam_id: 'kernel.controller.attempt_ownership',
    adapter_id: 'kernel.drill.controller_session_isolation.v1',
  };
  const grant = {
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    resource_id: `eq-${ATTEMPT_ID}`,
    resource_ref:
      `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/controller/case`,
  };
  const resource = {
    resource_id: grant.resource_id,
    resource_ref: grant.resource_ref,
    callback_owner: 'forged-controller',
    result: { status: 'forged' },
  };
  const effectSigner = {
    signEffectResult: vi.fn(async ({
      cell: signedCell,
      grant: signedGrant,
      observation,
      predecessor: signedPredecessor,
    }) => ({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      seam_id: signedCell.seam_id,
      adapter_id: signedCell.adapter_id,
      resource_id: signedGrant.resource_id,
      resource_ref: signedGrant.resource_ref,
      ...observation,
      predecessor: signedPredecessor,
      signature: 'test-signature',
    })),
  };
  return {
    state,
    pool,
    attemptStore,
    ownershipAuthority,
    cell,
    grant,
    resource,
    effectSigner,
    seam: createAttemptOwnershipEquivalenceSeam({
      attemptStore,
      ownershipAuthority,
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

describe('Attempt ownership equivalence seam', () => {
  it.each([
    ['normal', 'confirmed', 'single_controller_ownership_confirmed'],
    ['violation', 'denied', 'cross_session_callback_denied'],
    ['recovery', 'recovered', 'controller_ownership_recovered'],
  ])('executes the actual generation-fenced %s callback', async (
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
    expect(value.state.status).toBe(
      scenario === 'violation' ? 'running' : 'completed',
    );
    expect(value.ownershipAuthority.loadTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: {
          resource_id: value.resource.resource_id,
          resource_ref: value.resource.resource_ref,
        },
      }),
    );
    expect(value.ownershipAuthority.snapshot).toHaveBeenCalledTimes(2);
    expect(value.effectSigner.signEffectResult).toHaveBeenCalledWith(
      {
        cell: value.cell,
        grant: value.grant,
        observation: {
          observed_outcome: observedOutcome,
          effect_code: effectCode,
          before_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          after_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        predecessor: lineage,
      },
    );
  });

  it('rejects recovery not DB-bound to the verified denial receipt', async () => {
    const value = fixture('recovery');
    value.ownershipAuthority.loadPredecessorOwnershipBinding
      .mockResolvedValue({
        owner_service: value.cell.seam_id,
        predecessor_grant_id: PREDECESSOR_GRANT_ID,
        predecessor_receipt_id:
          '55555555-5555-4555-8555-555555555555',
        denial_code: 'cross_session_callback_denied',
        evidence_ref:
          `db:kernel-equivalence-receipts/${PREDECESSOR_RECEIPT_ID}`,
      });

    await expect(value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      predecessor: predecessor(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'attempt_ownership_recovery_unproven',
    });
    expect(value.state.status).toBe('running');
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('fails closed when ownership is ambiguous before callback execution', async () => {
    const value = fixture('normal');
    value.ownershipAuthority.loadTarget.mockResolvedValue({
      attempt_id: ATTEMPT_ID,
      result: value.state.result,
      lease_owner: null,
      lease_generation: 7,
      callback_owner: null,
    });

    await expect(value.seam.invoke({
      cell: value.cell,
      grant: value.grant,
      resource: value.resource,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      code: 'attempt_ownership_target_unavailable',
    });
    expect(value.pool.query).not.toHaveBeenCalled();
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('requires seam-owned signer and ownership authority ports', () => {
    const value = fixture('normal');
    expect(() => createAttemptOwnershipEquivalenceSeam({
      attemptStore: value.attemptStore,
      ownershipAuthority: value.ownershipAuthority,
    })).toThrowError(expect.objectContaining({
      code: 'seam_effect_signer_unavailable',
    }));
    expect(() => createAttemptOwnershipEquivalenceSeam({
      attemptStore: value.attemptStore,
      effectSigner: value.effectSigner,
    })).toThrowError(expect.objectContaining({
      code: 'attempt_ownership_authority_port_unavailable',
    }));
  });
});
