import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../kernel-equivalence-production-seam-builders.js', () => ({
  createBrainOwnedProductionSeamBuilders: vi.fn(),
}));
vi.mock('../kernel-equivalence-production-signers.js', () => ({
  loadProductionEffectSignerSet: vi.fn(),
}));
vi.mock('../kernel-equivalence-trusted-assembly.js', () => ({
  createBrainOwnedTrustedRuntimeRegistry: vi.fn(),
}));
vi.mock('../kernel-equivalence-runtime-loader.js', () => ({
  loadTrustedEquivalenceRuntime: vi.fn(),
}));
vi.mock('../kernel-equivalence-trusted-execution-service.js', () => ({
  createBrainTrustedExecutionService: vi.fn(),
}));

import {
  createBrainOwnedProductionSeamBuilders,
} from '../kernel-equivalence-production-seam-builders.js';
import {
  loadProductionEffectSignerSet,
} from '../kernel-equivalence-production-signers.js';
import {
  createProductionTrustedExecutionServiceFactory,
} from '../kernel-equivalence-production-service-factory.js';
import {
  loadTrustedEquivalenceRuntime,
} from '../kernel-equivalence-runtime-loader.js';
import {
  createBrainOwnedTrustedRuntimeRegistry,
} from '../kernel-equivalence-trusted-assembly.js';
import {
  createBrainTrustedExecutionService,
} from '../kernel-equivalence-trusted-execution-service.js';

function fn() {
  return vi.fn();
}

function fixture() {
  return {
    cleanupInspector: Object.freeze({
      owner_service: 'kernel.equivalence.cleanup_inspector',
      capability_id: 'cleanup-inspector-v1',
      inspect: fn(),
    }),
    effectSigningKeys: {
      'kernel.test.seam': {
        key_id: 'effect-key',
        secret_file: '/run/secrets/kernel-effect.pem',
      },
    },
    expectedPlanDigest: 'a'.repeat(64),
    grantAuthority: Object.freeze({
      owner_service: 'brain.kernel_equivalence.grants',
      capability_id: 'protected-grant-reader-v1',
      resolveProtectedGrant: fn(),
    }),
    now: vi.fn(() => 1_785_240_120_000),
    plan: {
      schema_version: 'kernel-equivalence-drill-plan/v1',
      behavior_count: 11,
      cells: [{ cell_id: 'canonical-cell' }],
    },
    pool: {
      connect: fn(),
      query: fn(),
    },
    qualityIsolation: Object.freeze({
      owner_service: 'kernel.equivalence.quality_isolation',
      capability_id: 'quality-isolation-v1',
      prepare: fn(),
      cancel: fn(),
      cleanup: fn(),
    }),
    runtimeEnvironment: {
      KERNEL_EQ_COLLECTOR_KEY_FILE:
        '/run/secrets/kernel-equivalence-collector.pem',
      KERNEL_EQ_COLLECTOR_KEY_ID: 'collector-2026-07',
    },
    seamPorts: {
      authorities: { marker: 'authorities' },
      dependencies: { marker: 'dependencies' },
    },
    securityIsolation: Object.freeze({
      owner_service: 'kernel.equivalence.isolation',
      capability_id: 'security-isolation-v1',
      prepare: fn(),
      cancel: fn(),
      cleanup: fn(),
    }),
    trustRegistry: {
      schema_version: 'kernel-equivalence-trust-registry/v1',
      algorithm: 'ed25519',
      keys: [{ key_id: 'collector-2026-07' }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createBrainOwnedProductionSeamBuilders.mockReturnValue(
    Object.freeze({ seam: fn() }),
  );
  loadProductionEffectSignerSet.mockReturnValue(
    Object.freeze({ signer: fn() }),
  );
  createBrainOwnedTrustedRuntimeRegistry.mockReturnValue(
    Object.freeze({ size: 10, ids: [] }),
  );
  loadTrustedEquivalenceRuntime.mockResolvedValue(
    Object.freeze({
      schema_version: 'kernel-equivalence-trusted-runtime/v1',
      adapter_count: 10,
      executeCell: fn(),
    }),
  );
  createBrainTrustedExecutionService.mockReturnValue(
    Object.freeze({
      schema_version:
        'kernel-equivalence-trusted-execution-service/v1',
      execute: fn(),
    }),
  );
});

describe('production trusted execution service factory', () => {
  it('assembles the one server-owned service once from pinned inputs', async () => {
    const value = fixture();
    const originalPlan = structuredClone(value.plan);
    const originalRegistry = structuredClone(value.trustRegistry);
    const createService =
      createProductionTrustedExecutionServiceFactory(value);

    value.plan.cells[0].cell_id = 'caller-mutated';
    value.trustRegistry.keys[0].key_id = 'caller-mutated';
    value.runtimeEnvironment.KERNEL_EQ_COLLECTOR_KEY_ID = 'caller-mutated';
    const first = await createService();
    const second = await createService();

    expect(first).toBe(second);
    expect(createBrainOwnedProductionSeamBuilders).toHaveBeenCalledOnce();
    expect(loadProductionEffectSignerSet).toHaveBeenCalledWith({
      plan: originalPlan,
      trustRegistry: originalRegistry,
      signingKeys: value.effectSigningKeys,
      now: value.now,
    });
    expect(createBrainOwnedTrustedRuntimeRegistry).toHaveBeenCalledWith({
      plan: originalPlan,
      seamBuilders:
        createBrainOwnedProductionSeamBuilders.mock.results[0].value,
      effectSignersBySeam:
        loadProductionEffectSignerSet.mock.results[0].value,
      securityIsolation: expect.objectContaining({
        owner_service: 'kernel.equivalence.isolation',
      }),
      qualityIsolation: expect.objectContaining({
        owner_service: 'kernel.equivalence.quality_isolation',
      }),
      cleanupInspector: expect.objectContaining({
        owner_service: 'kernel.equivalence.cleanup_inspector',
      }),
    });
    expect(loadTrustedEquivalenceRuntime).toHaveBeenCalledWith({
      env: {
        KERNEL_EQ_COLLECTOR_KEY_FILE:
          '/run/secrets/kernel-equivalence-collector.pem',
        KERNEL_EQ_COLLECTOR_KEY_ID: 'collector-2026-07',
      },
      trustRegistry: originalRegistry,
      pool: value.pool,
      runtimeRegistry:
        createBrainOwnedTrustedRuntimeRegistry.mock.results[0].value,
      now: value.now,
    });
    expect(createBrainTrustedExecutionService).toHaveBeenCalledWith({
      plan: originalPlan,
      expectedPlanDigest: value.expectedPlanDigest,
      runtime: await loadTrustedEquivalenceRuntime.mock.results[0].value,
      grantAuthority: expect.objectContaining({
        owner_service: 'brain.kernel_equivalence.grants',
      }),
      now: value.now,
    });
  });

  it('caches a failed assembly and never retries against changed state', async () => {
    const value = fixture();
    loadTrustedEquivalenceRuntime.mockRejectedValueOnce(
      Object.assign(new Error('database unavailable'), {
        code: 'trusted_runtime_database_unavailable',
      }),
    );
    const createService =
      createProductionTrustedExecutionServiceFactory(value);

    await expect(createService()).rejects.toMatchObject({
      code: 'trusted_runtime_database_unavailable',
    });
    await expect(createService()).rejects.toMatchObject({
      code: 'trusted_runtime_database_unavailable',
    });
    expect(loadTrustedEquivalenceRuntime).toHaveBeenCalledOnce();
    expect(createBrainTrustedExecutionService).not.toHaveBeenCalled();
  });

  it.each([
    ['missing field', (value) => {
      delete value.grantAuthority;
    }, 'production_trusted_execution_factory_input_invalid'],
    ['extra field', (value) => {
      value.createService = fn();
    }, 'production_trusted_execution_factory_input_invalid'],
    ['raw secret env', (value) => {
      value.runtimeEnvironment.KERNEL_EQ_PRIVATE_KEY = 'forbidden';
    }, 'production_trusted_execution_runtime_environment_invalid'],
    ['mutable isolation port', (value) => {
      value.securityIsolation = {
        ...value.securityIsolation,
      };
    }, 'production_trusted_execution_isolation_port_invalid'],
    ['mutable grant authority', (value) => {
      value.grantAuthority = {
        ...value.grantAuthority,
      };
    }, 'production_trusted_execution_grant_authority_invalid'],
  ])('fails closed for %s', (_label, mutate, code) => {
    const value = fixture();
    mutate(value);

    expect(() => (
      createProductionTrustedExecutionServiceFactory(value)
    )).toThrowError(expect.objectContaining({ code }));
    expect(createBrainOwnedProductionSeamBuilders).not.toHaveBeenCalled();
  });

  it('rejects accessor-backed top-level configuration', () => {
    const value = fixture();
    Object.defineProperty(value, 'expectedPlanDigest', {
      configurable: true,
      enumerable: true,
      get() {
        return 'a'.repeat(64);
      },
    });

    expect(() => (
      createProductionTrustedExecutionServiceFactory(value)
    )).toThrowError(expect.objectContaining({
      code: 'production_trusted_execution_factory_input_invalid',
    }));
  });
});
