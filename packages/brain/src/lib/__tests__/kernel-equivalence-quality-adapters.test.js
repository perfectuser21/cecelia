import { describe, expect, it, vi } from 'vitest';

import {
  QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
  createQualityCleanupVerifier,
  createQualityEquivalenceAdapterRegistry,
} from '../kernel-equivalence-quality-adapters.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

function cell(descriptor, scenario = 'normal') {
  return {
    ...descriptor,
    cell_id: `${descriptor.behavior_id}::codex::${scenario}`,
    provider: 'codex',
    scenario,
    isolation: {
      environment: 'isolated',
      resource_type: 'ephemeral_run',
      resource_prefix: 'equivalence-drill/{run_id}/{attempt_id}/case/',
    },
  };
}

function grant(target) {
  return {
    run_id: RUN_ID,
    attempt_id: ATTEMPT_ID,
    grant_id: '33333333-3333-4333-8333-333333333333',
    nonce: '44444444-4444-4444-8444-444444444444',
    resource_id: `eq-${ATTEMPT_ID}`,
    resource_prefix: `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/case/`,
    resource_ref: `equivalence-drill/${RUN_ID}/${ATTEMPT_ID}/case/resource`,
    seam_id: target.seam_id,
    adapter_id: target.adapter_id,
  };
}

function signedReceipt(target, authorization) {
  return {
    schema_version: 'kernel-equivalence-effect-receipt/v1',
    seam_id: target.seam_id,
    adapter_id: target.adapter_id,
    grant_id: authorization.grant_id,
    nonce: authorization.nonce,
    resource_id: authorization.resource_id,
    resource_ref: authorization.resource_ref,
    signature: 'signed-by-test-seam',
  };
}

function fixture() {
  const resources = new Map();
  const isolation = {
    owner_service: 'kernel.equivalence.isolation',
    prepare: vi.fn(async ({ authorization, registerCompensation }) => {
      const resource = {
        resource_id: authorization.resource_id,
        resource_ref: authorization.resource_ref,
      };
      resources.set(resource.resource_ref, resource);
      registerCompensation(resource);
      return resource;
    }),
    cancel: vi.fn(async () => ({ confirmed: true })),
    cleanup: vi.fn(async ({ resources: targets }) => {
      for (const resource of targets) resources.delete(resource.resource_ref);
      return { removed: targets.map((resource) => resource.resource_ref) };
    }),
  };
  const inspector = {
    owner_service: 'kernel.equivalence.cleanup_inspector',
    inspect: vi.fn(async ({ resource }) => ({
      exists: resources.has(resource.resource_ref),
      evidence_ref: `cleanup-evidence:${'a'.repeat(64)}`,
    })),
  };
  const seams = Object.fromEntries(
    QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS.map((descriptor) => [
      descriptor.seam_id,
      {
        owner_service: descriptor.seam_id,
        invoke: vi.fn(async ({ cell: target, grant: authorization }) => (
          signedReceipt(target, authorization)
        )),
        cancel: vi.fn(async () => ({ confirmed: true })),
        cleanup: vi.fn(async () => ({ confirmed: true })),
      },
    ]),
  );
  return { resources, isolation, inspector, seams };
}

describe('quality equivalence adapter registry', () => {
  it('describes exactly the five requested behavior and adapter IDs', () => {
    expect(QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS).toEqual([
      expect.objectContaining({
        behavior_id: 'KERNEL-P0-05-INDEPENDENT-EVALUATOR-JUDGE',
        seam_id: 'kernel.evaluation.independent_judge',
        adapter_id: 'kernel.drill.independent_evaluator_judge.v1',
      }),
      expect.objectContaining({
        behavior_id: 'KERNEL-P1-08-STOP-ORPHAN-LIVENESS',
        seam_id: 'kernel.liveness.orphan_recovery',
        adapter_id: 'kernel.drill.stop_orphan_liveness.v1',
      }),
      expect.objectContaining({
        behavior_id: 'KERNEL-P1-09-DEVGATE-TDD-DOD',
        seam_id: 'kernel.quality.devgate',
        adapter_id: 'kernel.drill.devgate_tdd_dod.v1',
      }),
      expect.objectContaining({
        behavior_id: 'KERNEL-P1-10-CONTROLLER-SESSION-ISOLATION',
        seam_id: 'kernel.controller.attempt_ownership',
        adapter_id: 'kernel.drill.controller_session_isolation.v1',
      }),
      expect.objectContaining({
        behavior_id: 'KERNEL-P1-11-REPORT-LEARNING-CLOSURE',
        seam_id: 'kernel.closure.report_learning',
        adapter_id: 'kernel.drill.report_learning_closure.v1',
      }),
    ]);
  });

  it('builds executeDrillCell-compatible adapters without exposing signer ports', async () => {
    const value = fixture();
    const registry = createQualityEquivalenceAdapterRegistry(value);

    for (const descriptor of QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS) {
      const adapter = registry.get(descriptor.adapter_id);
      expect(Object.keys(adapter).sort()).toEqual([
        'adapter_id',
        'cancel',
        'cleanup',
        'invokeActualSeam',
        'observe',
        'owner_service',
        'prepare',
      ]);
      expect(adapter).toMatchObject({
        adapter_id: descriptor.adapter_id,
        owner_service: descriptor.seam_id,
      });
      expect(JSON.stringify(adapter)).not.toContain('signer');
    }

    const descriptor = QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0];
    const target = cell(descriptor);
    const authorization = grant(target);
    const compensations = [];
    const controller = new AbortController();
    const prepared = await registry.get(target.adapter_id).prepare({
      cell: target,
      grant: authorization,
      signal: controller.signal,
      registerCompensation: (resource) => compensations.push(resource),
      predecessor: null,
    });
    const seamOutput = await registry.get(target.adapter_id).invokeActualSeam({
      cell: target,
      grant: authorization,
      prepared,
      compensations,
      predecessor: null,
      signal: controller.signal,
    });
    await expect(registry.get(target.adapter_id).observe(seamOutput, {
      cell: target,
      grant: authorization,
      prepared,
      predecessor: null,
      signal: controller.signal,
    })).resolves.toEqual(seamOutput);
    expect(value.seams[target.seam_id].invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        cell: target,
        grant: authorization,
        resource: prepared.resource,
        predecessor: null,
        signal: controller.signal,
      }),
    );
  });

  it('rejects resources outside the exact isolated run/attempt prefix', async () => {
    const value = fixture();
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const target = cell(QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0]);
    const authorization = {
      ...grant(target),
      resource_ref: 'equivalence-drill/other-run/other-attempt/case/resource',
    };

    await expect(registry.get(target.adapter_id).prepare({
      cell: target,
      grant: authorization,
      signal: new AbortController().signal,
      registerCompensation: vi.fn(),
    })).rejects.toMatchObject({ code: 'adapter_resource_boundary_invalid' });
    expect(value.isolation.prepare).not.toHaveBeenCalled();
  });

  it('rejects a seam whose registered owner does not match the contract cell', () => {
    const value = fixture();
    const descriptor = QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0];
    value.seams[descriptor.seam_id].owner_service = 'kernel.fake.owner';

    expect(() => createQualityEquivalenceAdapterRegistry(value))
      .toThrowError(expect.objectContaining({
        code: 'adapter_actual_seam_owner_mismatch',
      }));
  });

  it('rejects non-serializable adapter resources before seam invocation', async () => {
    const value = fixture();
    value.isolation.prepare.mockImplementationOnce(async ({ authorization }) => ({
      resource_id: authorization.resource_id,
      resource_ref: authorization.resource_ref,
      signer: () => 'forged',
    }));
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const target = cell(QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0]);

    await expect(registry.get(target.adapter_id).prepare({
      cell: target,
      grant: grant(target),
      predecessor: null,
      signal: new AbortController().signal,
      registerCompensation: vi.fn(),
    })).rejects.toMatchObject({
      code: 'adapter_prepared_resource_invalid',
    });
    expect(value.seams[target.seam_id].invoke).not.toHaveBeenCalled();
  });

  it('does not turn an unsigned or mismatched seam result into a receipt', async () => {
    const value = fixture();
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const target = cell(QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0]);
    const authorization = grant(target);
    const context = {
      cell: target,
      grant: authorization,
      prepared: { resource: authorization },
      signal: new AbortController().signal,
    };

    await expect(registry.get(target.adapter_id).observe({
      observed_outcome: 'confirmed',
      effect_code: 'independent_verdict_recorded',
    }, context)).rejects.toMatchObject({ code: 'adapter_seam_receipt_invalid' });
    await expect(registry.get(target.adapter_id).observe({
      ...signedReceipt(target, authorization),
      seam_id: 'kernel.fake.seam',
    }, context)).rejects.toMatchObject({ code: 'adapter_seam_receipt_invalid' });
  });

  it('uses the one verified predecessor supplied by the runtime core', async () => {
    const value = fixture();
    const predecessor = {
      grant: {
        schema_version: 'kernel-equivalence-execution-grant/v1',
        grant_id: '66666666-6666-4666-8666-666666666666',
      },
      receipt: {
        schema_version: 'kernel-equivalence-effect-receipt/v1',
        cell_id: 'violation-cell',
        receipt_id: '55555555-5555-4555-8555-555555555555',
      },
    };
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const descriptor = QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0];
    const target = cell(descriptor, 'recovery');
    const authorization = grant(target);
    const prepared = await registry.get(target.adapter_id).prepare({
      cell: target,
      grant: authorization,
      signal: new AbortController().signal,
      registerCompensation: vi.fn(),
      predecessor,
    });

    expect(prepared).toEqual({
      resource: {
        resource_id: authorization.resource_id,
        resource_ref: authorization.resource_ref,
      },
    });

    await registry.get(target.adapter_id).invokeActualSeam({
      cell: target,
      grant: authorization,
      prepared,
      predecessor,
      signal: new AbortController().signal,
    });
    expect(value.seams[target.seam_id].invoke).toHaveBeenCalledWith(
      expect.objectContaining({ predecessor }),
    );
  });

  it('fails closed when recovery lineage is unavailable', async () => {
    const value = fixture();
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const target = cell(
      QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0],
      'recovery',
    );

    await expect(registry.get(target.adapter_id).prepare({
      cell: target,
      grant: grant(target),
      signal: new AbortController().signal,
      registerCompensation: vi.fn(),
      predecessor: null,
    })).rejects.toMatchObject({ code: 'adapter_recovery_predecessor_unavailable' });
    expect(value.isolation.prepare).not.toHaveBeenCalled();
  });

  it('confirms cancellation only after both the seam and isolation boundary stop', async () => {
    const value = fixture();
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const target = cell(QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0]);
    const adapter = registry.get(target.adapter_id);
    const result = await adapter.cancel({
      cell: target,
      grant: grant(target),
      prepared: { resource: { resource_ref: 'resource' } },
      phase: 'invoke',
      signal: AbortSignal.abort(),
    });

    expect(result).toEqual({ confirmed: true });
    value.seams[target.seam_id].cancel.mockResolvedValue({ confirmed: false });
    await expect(adapter.cancel({
      cell: target,
      grant: grant(target),
      prepared: { resource: { resource_ref: 'resource' } },
      phase: 'invoke',
      signal: AbortSignal.abort(),
    })).resolves.toEqual({ confirmed: false });
  });

  it('still cancels the isolation boundary when seam cancellation rejects', async () => {
    const value = fixture();
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const target = cell(QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0]);
    value.seams[target.seam_id].cancel.mockRejectedValueOnce(
      new Error('seam cancellation failed'),
    );

    await expect(registry.get(target.adapter_id).cancel({
      cell: target,
      grant: grant(target),
      prepared: { resource: { resource_ref: 'resource' } },
      phase: 'invoke',
      signal: AbortSignal.abort(),
    })).resolves.toEqual({ confirmed: false });
    expect(value.isolation.cancel).toHaveBeenCalledOnce();
  });

  it('attempts isolation compensation even when seam cleanup fails', async () => {
    const value = fixture();
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const target = cell(QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0]);
    const authorization = grant(target);
    const compensations = [];
    const adapter = registry.get(target.adapter_id);
    const prepared = await adapter.prepare({
      cell: target,
      grant: authorization,
      predecessor: null,
      signal: new AbortController().signal,
      registerCompensation: (resource) => compensations.push(resource),
    });
    value.seams[target.seam_id].cleanup.mockRejectedValueOnce(
      new Error('seam cleanup failed'),
    );

    await expect(adapter.cleanup({
      cell: target,
      grant: authorization,
      predecessor: null,
      prepared,
      compensations,
    })).rejects.toMatchObject({
      code: 'adapter_cleanup_failed',
    });
    expect(value.isolation.cleanup).toHaveBeenCalledOnce();
    expect(value.resources.has(authorization.resource_ref)).toBe(false);
  });

  it('uses an independent inspection hook to verify all cleanup targets are absent', async () => {
    const value = fixture();
    const registry = createQualityEquivalenceAdapterRegistry(value);
    const descriptor = QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0];
    const verifyCleanup = createQualityCleanupVerifier({
      descriptor,
      inspector: value.inspector,
    });
    expect(Object.keys(verifyCleanup).sort()).toEqual([
      'adapter_id',
      'owner_service',
      'verifier_id',
      'verifyCleanup',
    ]);
    expect(verifyCleanup).toMatchObject({
      adapter_id: descriptor.adapter_id,
      owner_service: value.inspector.owner_service,
    });
    expect(verifyCleanup.owner_service).not.toBe(descriptor.seam_id);
    const target = cell(descriptor);
    const authorization = grant(target);
    const compensations = [];
    const prepared = await registry.get(target.adapter_id).prepare({
      cell: target,
      grant: authorization,
      signal: new AbortController().signal,
      registerCompensation: (resource) => compensations.push(resource),
    });
    const context = {
      cell: target,
      grant: authorization,
      prepared,
      compensations,
      predecessor: null,
    };
    const cleanup = await registry.get(target.adapter_id).cleanup(context);

    await expect(verifyCleanup.verifyCleanup({
      ...context,
      cleanup,
    })).resolves.toEqual({
      confirmed: true,
      evidence_ref: expect.stringMatching(/^cleanup-evidence:[a-f0-9]{64}$/),
    });
    value.resources.set(authorization.resource_ref, prepared.resource);
    await expect(verifyCleanup.verifyCleanup({
      ...context,
      cleanup,
    })).resolves.toEqual({
      confirmed: false,
      evidence_ref: null,
    });
  });

  it('rejects cleanup inspection owned by the adapter seam', () => {
    const value = fixture();
    const descriptor = QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS[0];
    value.inspector.owner_service = descriptor.seam_id;

    expect(() => createQualityCleanupVerifier({
      descriptor,
      inspector: value.inspector,
    })).toThrowError(expect.objectContaining({
      code: 'cleanup_inspector_not_independent',
    }));
  });
});
