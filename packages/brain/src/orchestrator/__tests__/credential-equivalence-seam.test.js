import { describe, expect, it, vi } from 'vitest';
import {
  createCredentialGuardEquivalenceSeam,
} from '../credential-broker.js';
import { sha256Canonical } from '../../lib/kernel-equivalence-receipts.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';
const NONCE = '44444444-4444-4444-8444-444444444444';
const RESOURCE_ID = '55555555-5555-4555-8555-555555555555';
const SEAM_ID = 'kernel.credential.attempt_lease';
const ADAPTER_ID = 'kernel.drill.credential_guard.v1';

function cell(scenario = 'normal') {
  const expected = {
    normal: {
      expected_outcome: 'confirmed',
      effect_code: 'credential_lease_issued',
    },
    violation: {
      expected_outcome: 'denied',
      effect_code: 'credential_lease_denied',
    },
    recovery: {
      expected_outcome: 'recovered',
      effect_code: 'credential_lease_refreshed',
    },
  }[scenario];
  return {
    cell_id: `KERNEL-P0-02-CREDENTIAL-GUARD::codex::${scenario}`,
    behavior_id: 'KERNEL-P0-02-CREDENTIAL-GUARD',
    provider: 'codex',
    scenario,
    seam_id: SEAM_ID,
    adapter_id: ADAPTER_ID,
    expected,
  };
}

function grant(scenario = 'normal') {
  return {
    grant_id: GRANT_ID,
    nonce: NONCE,
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    resource_id: RESOURCE_ID,
    resource_ref: `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/credential`,
    seam_id: SEAM_ID,
    adapter_id: ADAPTER_ID,
    scenario,
  };
}

function predecessor() {
  return Object.freeze({
    grant: Object.freeze({
      ...grant('violation'),
      cell_id: 'KERNEL-P0-02-CREDENTIAL-GUARD::codex::violation',
    }),
    receipt: Object.freeze({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      receipt_id: '66666666-6666-4666-8666-666666666666',
      cell_id: 'KERNEL-P0-02-CREDENTIAL-GUARD::codex::violation',
      observed_outcome: 'denied',
      effect_code: 'credential_lease_denied',
    }),
  });
}

function fixture(scenario = 'normal') {
  const request = Object.freeze({
    attemptId: ATTEMPT_ID,
    runId: RUN_ID,
    resourceId: RESOURCE_ID,
    resourceRef: grant(scenario).resource_ref,
    provider: 'codex',
    accountId: 'team4',
    machineId: 'xian-mac-m4',
    leaseOwner: `kernel-controller:${RUN_ID}`,
    leaseGeneration: scenario === 'recovery' ? 8 : 7,
    deadlineAt: '2026-07-28T13:00:00.000Z',
    ...(scenario === 'violation'
      ? { machineId: 'untrusted-host' }
      : {}),
  });
  const issued = Object.freeze({
    contract_version: 'provider-credential-envelope/v2',
    credential_ref: '77777777-7777-4777-8777-777777777777',
    delivery_nonce: '88888888-8888-4888-8888-888888888888',
    attempt_id: ATTEMPT_ID,
    run_id: RUN_ID,
    provider: 'codex',
    account_id: 'team4',
    machine_id: 'xian-mac-m4',
    lease_owner: `kernel-controller:${RUN_ID}`,
    lease_generation: request.leaseGeneration,
    issued_at: '2026-07-28T12:00:00.000Z',
    expires_at: '2026-07-28T12:01:00.000Z',
    payload_hash: `sha256:${'a'.repeat(64)}`,
    payload: 'must-not-enter-observation',
    signature: `hmac-sha256:${'b'.repeat(64)}`,
  });
  const broker = {
    issue: vi.fn(async () => {
      if (scenario === 'violation') {
        throw new Error('credential_machine_not_allowed');
      }
      return issued;
    }),
  };
  const snapshots = [
    { state: 'absent', lease_generation: scenario === 'recovery' ? 7 : null },
    {
      state: scenario === 'violation' ? 'absent' : 'issued',
      lease_generation: scenario === 'violation' ? null : request.leaseGeneration,
      payload_hash: scenario === 'violation' ? null : issued.payload_hash,
    },
  ];
  const credentialAuthority = {
    owner_service: SEAM_ID,
    loadIssueRequest: vi.fn(async () => request),
    snapshot: vi.fn(async () => snapshots.shift()),
    confirmDenial: vi.fn(async ({ error }) => (
      error?.message === 'credential_machine_not_allowed'
    )),
    confirmRefresh: vi.fn(async ({ envelope, predecessor: previous }) => (
      envelope.lease_generation === 8
      && previous?.receipt?.effect_code === 'credential_lease_denied'
    )),
    cancel: vi.fn(async () => ({ confirmed: true })),
    cleanup: vi.fn(async () => ({ confirmed: true })),
  };
  const effectSigner = {
    signEffectResult: vi.fn(async (input) => ({
      schema_version: 'kernel-equivalence-effect-receipt/v1',
      receipt_id: '99999999-9999-4999-8999-999999999999',
      grant_id: input.grant.grant_id,
      nonce: input.grant.nonce,
      resource_id: input.grant.resource_id,
      resource_ref: input.grant.resource_ref,
      seam_id: SEAM_ID,
      adapter_id: ADAPTER_ID,
      ...input.observation,
      signature: 'signed',
    })),
  };
  return {
    broker,
    credentialAuthority,
    effectSigner,
    seam: createCredentialGuardEquivalenceSeam({
      credentialBroker: broker,
      credentialAuthority,
      effectSigner,
    }),
    issued,
  };
}

describe('Kernel credential guard equivalence seam', () => {
  it.each(['normal', 'violation', 'recovery'])(
    'uses the real broker and signs only server-owned %s observations',
    async (scenario) => {
      const value = fixture(scenario);
      const targetCell = cell(scenario);
      const targetGrant = grant(scenario);
      const previous = scenario === 'recovery' ? predecessor() : null;

      const receipt = await value.seam.invoke({
        cell: targetCell,
        grant: targetGrant,
        resource: {
          resource_id: RESOURCE_ID,
          resource_ref: targetGrant.resource_ref,
          loadIssueRequest: () => ({ machineId: 'caller-controlled' }),
          snapshot: () => ({ payload: 'caller-controlled' }),
        },
        predecessor: previous,
        signal: AbortSignal.timeout(1_000),
      });

      expect(value.broker.issue).toHaveBeenCalledOnce();
      expect(value.credentialAuthority.loadIssueRequest).toHaveBeenCalledOnce();
      expect(value.credentialAuthority.snapshot).toHaveBeenCalledTimes(2);
      expect(receipt).toMatchObject({
        observed_outcome: targetCell.expected.expected_outcome,
        effect_code: targetCell.expected.effect_code,
      });
      const signed = value.effectSigner.signEffectResult.mock.calls[0][0];
      expect(signed).toEqual({
        cell: targetCell,
        grant: targetGrant,
        observation: {
          observed_outcome: targetCell.expected.expected_outcome,
          effect_code: targetCell.expected.effect_code,
          before_hash: sha256Canonical({
            state: 'absent',
            lease_generation: scenario === 'recovery' ? 7 : null,
          }),
          after_hash: sha256Canonical({
            state: scenario === 'violation' ? 'absent' : 'issued',
            lease_generation:
              scenario === 'violation'
                ? null
                : scenario === 'recovery' ? 8 : 7,
            payload_hash:
              scenario === 'violation'
                ? null
                : value.issued.payload_hash,
          }),
        },
        predecessor: previous,
      });
      expect(JSON.stringify(signed)).not.toContain(value.issued.payload);
    },
  );

  it('fails closed when violation denial is not confirmed by server authority', async () => {
    const value = fixture('violation');
    value.credentialAuthority.confirmDenial.mockResolvedValue(false);

    await expect(value.seam.invoke({
      cell: cell('violation'),
      grant: grant('violation'),
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: grant('violation').resource_ref,
      },
      predecessor: null,
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({ code: 'credential_denial_unconfirmed' });
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('fails closed when recovery is not bound to the verified predecessor', async () => {
    const value = fixture('recovery');
    value.credentialAuthority.confirmRefresh.mockResolvedValue(false);

    await expect(value.seam.invoke({
      cell: cell('recovery'),
      grant: grant('recovery'),
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: grant('recovery').resource_ref,
      },
      predecessor: predecessor(),
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({ code: 'credential_refresh_unconfirmed' });
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });

  it('requires exact server-owned authority and grant resource binding', async () => {
    const value = fixture();
    expect(() => createCredentialGuardEquivalenceSeam({
      credentialBroker: value.broker,
      effectSigner: value.effectSigner,
      credentialAuthority: {
        ...value.credentialAuthority,
        owner_service: 'caller',
      },
    })).toThrow('credential_equivalence_authority_unavailable');

    await expect(value.seam.invoke({
      cell: cell(),
      grant: grant(),
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: 'equivalence-drill/other',
      },
      predecessor: null,
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({ code: 'credential_equivalence_resource_invalid' });
    expect(value.broker.issue).not.toHaveBeenCalled();
  });

  it.each([
    ['runId', { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    ['attemptId', {
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }],
    ['resourceId', { resourceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    ['resourceRef', { resourceRef: 'equivalence-drill/forged' }],
  ])('fails closed when the authority request mismatches grant %s', async (
    _label,
    override,
  ) => {
    const value = fixture();
    value.credentialAuthority.loadIssueRequest.mockResolvedValue({
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      resourceId: RESOURCE_ID,
      resourceRef: grant().resource_ref,
      provider: 'codex',
      accountId: 'team4',
      machineId: 'xian-mac-m4',
      leaseOwner: `kernel-controller:${RUN_ID}`,
      leaseGeneration: 7,
      deadlineAt: '2026-07-28T13:00:00.000Z',
      ...override,
    });

    await expect(value.seam.invoke({
      cell: cell(),
      grant: grant(),
      resource: {
        resource_id: RESOURCE_ID,
        resource_ref: grant().resource_ref,
      },
      predecessor: null,
      signal: AbortSignal.timeout(1_000),
    })).rejects.toMatchObject({
      code: 'credential_equivalence_authority_binding_invalid',
    });
    expect(value.broker.issue).not.toHaveBeenCalled();
    expect(value.effectSigner.signEffectResult).not.toHaveBeenCalled();
  });
});
