import { describe, expect, it, vi } from 'vitest';
import {
  SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
  createSecurityEquivalenceAdapters,
  createSecurityEquivalenceCleanupVerifiers,
} from '../kernel-equivalence-security-adapters.js';
import { createCleanupEvidence } from '../kernel-equivalence-runtime-registry.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';

function cell(descriptor, scenario = 'normal') {
  return {
    cell_id: `${descriptor.behavior_id}::codex::${scenario}`,
    behavior_id: descriptor.behavior_id,
    provider: 'codex',
    scenario,
    seam_id: descriptor.seam_id,
    adapter_id: descriptor.adapter_id,
    isolation: {
      resource_prefix: 'equivalence-drill/{run_id}/{attempt_id}/security/',
    },
  };
}

function grant(descriptor) {
  const prefix = `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/security/`;
  return {
    grant_id: '44444444-4444-4444-8444-444444444444',
    nonce: '55555555-5555-4555-8555-555555555555',
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    resource_id: RESOURCE_ID,
    resource_prefix: prefix,
    resource_ref: `${prefix}resource`,
    seam_id: descriptor.seam_id,
    adapter_id: descriptor.adapter_id,
  };
}

function fixture() {
  const seams = Object.fromEntries(
    SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS.map((descriptor) => [
      descriptor.seam_id,
      {
        owner_service: descriptor.seam_id,
        invoke: vi.fn(async ({ cell: targetCell, grant: targetGrant }) => ({
          schema_version: 'kernel-equivalence-effect-receipt/v1',
          receipt_id: '66666666-6666-4666-8666-666666666666',
          grant_id: targetGrant.grant_id,
          nonce: targetGrant.nonce,
          resource_id: targetGrant.resource_id,
          resource_ref: targetGrant.resource_ref,
          seam_id: targetCell.seam_id,
          adapter_id: targetCell.adapter_id,
          signature: 'signed',
        })),
        cancel: vi.fn(async () => ({ confirmed: true })),
        cleanup: vi.fn(async () => ({ confirmed: true })),
      },
    ]),
  );
  const isolation = {
    owner_service: 'kernel.equivalence.isolation',
    capability_id: 'kernel-equivalence-isolation-writer',
    prepare: vi.fn(async ({ authorization }) => ({
      resource_id: authorization.resource_id,
      resource_ref: authorization.resource_ref,
    })),
    cancel: vi.fn(async () => ({ confirmed: true })),
    cleanup: vi.fn(async () => ({ completed: true })),
  };
  const inspector = {
    owner_service: 'kernel.equivalence.cleanup_inspector',
    capability_id: 'kernel-equivalence-cleanup-reader',
    inspect: vi.fn(async () => ({
      exists: false,
      residue: [],
      evidence_ref: `cleanup-observation:${'a'.repeat(64)}`,
    })),
  };
  return { seams, isolation, inspector };
}

describe('Kernel security equivalence adapters', () => {
  it('registers the five non-release security behaviors as server-owned adapters', () => {
    const value = fixture();
    const adapters = createSecurityEquivalenceAdapters(value);
    expect(SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS).toHaveLength(5);
    expect(adapters).toHaveLength(5);
    expect(adapters.map((adapter) => adapter.adapter_id).sort()).toEqual(
      SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS
        .map((descriptor) => descriptor.adapter_id)
        .sort(),
    );
    for (const adapter of adapters) {
      expect(Object.keys(adapter).sort()).toEqual([
        'adapter_id',
        'cancel',
        'cleanup',
        'invokeActualSeam',
        'observe',
        'owner_service',
        'prepare',
      ]);
    }
  });

  it.each(SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS)(
    'runs $behavior_id through isolation and its actual seam',
    async (descriptor) => {
      const value = fixture();
      const adapter = createSecurityEquivalenceAdapters(value)
        .find((entry) => entry.adapter_id === descriptor.adapter_id);
      const targetCell = cell(descriptor);
      const targetGrant = grant(descriptor);
      const registerCompensation = vi.fn();
      const signal = AbortSignal.timeout(1_000);
      const prepared = await adapter.prepare({
        cell: targetCell,
        grant: targetGrant,
        predecessor: null,
        signal,
        registerCompensation,
      });
      const seamOutput = await adapter.invokeActualSeam({
        cell: targetCell,
        grant: targetGrant,
        predecessor: null,
        prepared,
        signal,
      });
      const receipt = await adapter.observe(seamOutput, {
        cell: targetCell,
        grant: targetGrant,
        signal,
      });

      expect(value.isolation.prepare).toHaveBeenCalledOnce();
      expect(registerCompensation).toHaveBeenCalledWith(prepared.resource);
      expect(value.seams[descriptor.seam_id].invoke).toHaveBeenCalledWith({
        cell: targetCell,
        grant: targetGrant,
        resource: prepared.resource,
        predecessor: null,
        signal,
      });
      expect(receipt.signature).toBe('signed');
    },
  );

  it('passes only the runtime-verified predecessor into recovery seam', async () => {
    const descriptor = SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0];
    const value = fixture();
    const adapter = createSecurityEquivalenceAdapters(value)[0];
    const targetCell = cell(descriptor, 'recovery');
    const targetGrant = grant(descriptor);
    const predecessor = Object.freeze({
      grant: Object.freeze({ grant_id: 'previous' }),
      receipt: Object.freeze({ receipt_id: 'previous' }),
    });
    const prepared = await adapter.prepare({
      cell: targetCell,
      grant: targetGrant,
      predecessor,
      signal: AbortSignal.timeout(1_000),
      registerCompensation: vi.fn(),
    });
    await adapter.invokeActualSeam({
      cell: targetCell,
      grant: targetGrant,
      predecessor,
      prepared,
      signal: AbortSignal.timeout(1_000),
    });
    expect(value.seams[descriptor.seam_id].invoke.mock.calls[0][0].predecessor)
      .toBe(predecessor);
  });

  it('rejects caller-controlled resources and invalid seam ownership', async () => {
    const descriptor = SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0];
    const value = fixture();
    value.seams[descriptor.seam_id].owner_service = 'caller';
    expect(() => createSecurityEquivalenceAdapters(value))
      .toThrow('security_adapter_actual_seam_unavailable');

    const clean = fixture();
    clean.isolation.prepare.mockResolvedValue({
      resource_id: RESOURCE_ID,
      resource_ref: 'equivalence-drill/other',
    });
    const adapter = createSecurityEquivalenceAdapters(clean)[0];
    await expect(adapter.prepare({
      cell: cell(descriptor),
      grant: grant(descriptor),
      signal: AbortSignal.timeout(1_000),
      registerCompensation: vi.fn(),
    })).rejects.toMatchObject({ code: 'security_adapter_prepared_resource_invalid' });
  });

  it('builds independent cleanup verifiers with exact evidence references', async () => {
    const value = fixture();
    const adapters = createSecurityEquivalenceAdapters(value);
    const verifiers = createSecurityEquivalenceCleanupVerifiers({
      inspector: value.inspector,
      isolationCapabilityId: value.isolation.capability_id,
    });
    expect(verifiers).toHaveLength(adapters.length);
    for (const verifier of verifiers) {
      const adapter = adapters.find((entry) => entry.adapter_id === verifier.adapter_id);
      expect(verifier.owner_service).not.toBe(adapter.owner_service);
      const descriptor = SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS.find(
        (entry) => entry.adapter_id === adapter.adapter_id,
      );
      const context = {
        cell: cell(descriptor),
        grant: {
          grant_id: '44444444-4444-4444-8444-444444444444',
          resource_id: RESOURCE_ID,
          resource_ref: `equivalence-drill/${RUN_ID}/resource`,
        },
        prepared: {
          resource: {
            resource_id: RESOURCE_ID,
            resource_ref: `equivalence-drill/${RUN_ID}/resource`,
          },
        },
        compensations: [],
        cleanup: { confirmed: true },
      };
      const result = await verifier.verifyCleanup(context);
      expect(result).toEqual({
        confirmed: true,
        evidence: createCleanupEvidence(context),
      });
    }
  });

  it('rejects cleanup inspection that reuses the mutation capability', () => {
    const value = fixture();
    expect(() => createSecurityEquivalenceCleanupVerifiers({
      inspector: {
        ...value.inspector,
        capability_id: value.isolation.capability_id,
      },
      isolationCapabilityId: value.isolation.capability_id,
    })).toThrow('security_cleanup_inspection_unavailable');
  });

  it('attempts isolation cleanup even when seam cleanup fails', async () => {
    const descriptor = SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0];
    const value = fixture();
    value.seams[descriptor.seam_id].cleanup.mockRejectedValue(
      new Error('seam cleanup unavailable'),
    );
    const adapter = createSecurityEquivalenceAdapters(value)[0];
    const context = {
      cell: cell(descriptor),
      grant: grant(descriptor),
      prepared: {
        resource: {
          resource_id: RESOURCE_ID,
          resource_ref: grant(descriptor).resource_ref,
        },
      },
      compensations: [],
    };
    await expect(adapter.cleanup(context)).rejects.toMatchObject({
      code: 'security_adapter_cleanup_failed',
    });
    expect(value.isolation.cleanup).toHaveBeenCalledOnce();
  });
});
