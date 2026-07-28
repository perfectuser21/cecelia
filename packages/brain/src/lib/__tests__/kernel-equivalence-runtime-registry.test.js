import { describe, expect, it, vi } from 'vitest';
import {
  createCleanupEvidence,
  createIndependentCleanupVerifierRegistry,
  createServerOwnedAdapterRegistry,
  createServerOwnedRuntimeRegistry,
} from '../kernel-equivalence-runtime-registry.js';
import {
  fixtureCell,
} from './kernel-equivalence-test-fixtures.js';

function adapter(overrides = {}) {
  return {
    adapter_id: 'kernel.drill.ci_merge_authority.v1',
    owner_service: 'kernel.merge.effect_executor',
    prepare: vi.fn(),
    invokeActualSeam: vi.fn(),
    observe: vi.fn(),
    cancel: vi.fn(),
    cleanup: vi.fn(),
    ...overrides,
  };
}

function verifier(overrides = {}) {
  return {
    verifier_id: 'kernel.cleanup.ci_merge_authority.v1',
    adapter_id: 'kernel.drill.ci_merge_authority.v1',
    owner_service: 'kernel.cleanup.observer',
    verifyCleanup: vi.fn(async (context) => ({
      confirmed: true,
      evidence: createCleanupEvidence(context),
    })),
    ...overrides,
  };
}

function cleanupContext(overrides = {}) {
  const cell = fixtureCell();
  return {
    cell,
    grant: {
      grant_id: '33333333-3333-4333-8333-333333333333',
      resource_id: 'eq-cleanup',
      resource_ref: 'refs/heads/equivalence-drill/run/attempt/case',
    },
    prepared: {},
    compensations: [],
    cleanup: { adapter_claim: true },
    ...overrides,
  };
}

describe('server-owned equivalence runtime registries', () => {
  it('exports a content-addressed cleanup evidence builder', async () => {
    const runtimeRegistry = await import(
      '../kernel-equivalence-runtime-registry.js'
    );
    expect(runtimeRegistry.createCleanupEvidence).toEqual(
      expect.any(Function),
    );
  });

  it('resolves a complete immutable adapter snapshot by exact ID', () => {
    const registered = adapter();
    const source = [registered];
    const registry = createServerOwnedAdapterRegistry({ adapters: source });
    source.length = 0;
    registered.prepare = vi.fn(() => 'replaced');

    expect(registry.ids).toEqual(['kernel.drill.ci_merge_authority.v1']);
    expect(registry.size).toBe(1);
    expect(registry.resolve('kernel.drill.ci_merge_authority.v1'))
      .toMatchObject({
        adapter_id: 'kernel.drill.ci_merge_authority.v1',
        owner_service: 'kernel.merge.effect_executor',
      });
    expect(registry.resolve('missing')).toBeNull();
    expect(registry.resolveForCell(fixtureCell())).toMatchObject({
      adapter_id: 'kernel.drill.ci_merge_authority.v1',
      owner_service: 'kernel.merge.effect_executor',
    });
    expect(() => registry.resolveForCell({
      ...fixtureCell(),
      seam_id: 'kernel.other.seam',
    })).toThrowError(expect.objectContaining({
      code: 'adapter_seam_owner_mismatch',
    }));
    expect(registry.resolve('kernel.drill.ci_merge_authority.v1').prepare)
      .not.toBe(registered.prepare);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(
      registry.resolve('kernel.drill.ci_merge_authority.v1'),
    )).toBe(true);
  });

  it.each([
    ['duplicate ID', [adapter(), adapter()], 'adapter_registry_duplicate'],
    ['missing cancel', [adapter({ cancel: undefined })], 'adapter_registry_invalid'],
    ['unknown field', [adapter({ cleanupVerifier: vi.fn() })], 'adapter_registry_invalid'],
    ['unsafe ID', [adapter({ adapter_id: '../adapter' })], 'adapter_registry_invalid'],
  ])('rejects %s', (_label, adapters, code) => {
    expect(() => createServerOwnedAdapterRegistry({ adapters }))
      .toThrowError(expect.objectContaining({ code }));
  });

  it('requires a separately owned cleanup verifier for every registered adapter', () => {
    const adapterRegistry = createServerOwnedAdapterRegistry({
      adapters: [adapter()],
    });

    expect(() => createIndependentCleanupVerifierRegistry({
      adapterRegistry,
      verifiers: [verifier({
        owner_service: 'kernel.merge.effect_executor',
      })],
    })).toThrowError(expect.objectContaining({
      code: 'cleanup_verifier_not_independent',
    }));
    expect(() => createIndependentCleanupVerifierRegistry({
      adapterRegistry,
      verifiers: [],
    })).toThrowError(expect.objectContaining({
      code: 'cleanup_verifier_missing',
    }));
  });

  it('validates the independent verifier result contract', async () => {
    const adapterRegistry = createServerOwnedAdapterRegistry({
      adapters: [adapter()],
    });
    const cleanup = verifier();
    const registry = createIndependentCleanupVerifierRegistry({
      adapterRegistry,
      verifiers: [cleanup],
    });
    const context = cleanupContext();

    await expect(registry.verify(context)).resolves.toEqual({
      confirmed: true,
      evidence: createCleanupEvidence(context),
    });
    expect(cleanup.verifyCleanup).toHaveBeenCalledWith(context);
    await expect(registry.verify({
      ...context,
      cell: { ...context.cell, adapter_id: 'kernel.drill.unknown.v1' },
    })).rejects.toMatchObject({ code: 'cleanup_verifier_unavailable' });
  });

  it.each([
    ['cell', (context) => ({
      ...context,
      cell: { ...context.cell, cell_id: `${context.cell.cell_id}-other` },
    })],
    ['grant', (context) => ({
      ...context,
      grant: {
        ...context.grant,
        grant_id: '44444444-4444-4444-8444-444444444444',
      },
    })],
    ['resource', (context) => ({
      ...context,
      grant: { ...context.grant, resource_id: 'eq-other' },
    })],
    ['resource ref', (context) => ({
      ...context,
      grant: {
        ...context.grant,
        resource_ref: `${context.grant.resource_ref}-other`,
      },
    })],
    ['prepared context', (context) => ({
      ...context,
      prepared: { injected: true },
    })],
    ['cleanup context', (context) => ({
      ...context,
      cleanup: { adapter_claim: false },
    })],
  ])('rejects evidence replayed across a different %s binding', async (_axis, alter) => {
    const original = cleanupContext();
    const adapterRegistry = createServerOwnedAdapterRegistry({
      adapters: [adapter()],
    });
    const registry = createIndependentCleanupVerifierRegistry({
      adapterRegistry,
      verifiers: [verifier({
        verifyCleanup: vi.fn(async () => ({
          confirmed: true,
          evidence: createCleanupEvidence(original),
        })),
      })],
    });

    await expect(registry.verify(alter(original))).rejects.toMatchObject({
      code: 'cleanup_evidence_invalid',
    });
  });

  it.each([
    [{ confirmed: true }, 'cleanup_verifier_result_invalid'],
    [{ confirmed: true, evidence: 'ordinary string' }, 'cleanup_verifier_result_invalid'],
    [{
      confirmed: true,
      evidence: createCleanupEvidence(cleanupContext()),
      adapter_says: true,
    }, 'cleanup_verifier_result_invalid'],
    [{
      confirmed: false,
      evidence: createCleanupEvidence(cleanupContext()),
    }, 'cleanup_verifier_result_invalid'],
  ])('rejects malformed verifier output: %j', async (result, code) => {
    const adapterRegistry = createServerOwnedAdapterRegistry({
      adapters: [adapter()],
    });
    const registry = createIndependentCleanupVerifierRegistry({
      adapterRegistry,
      verifiers: [verifier({
        verifyCleanup: vi.fn(async () => result),
      })],
    });

    await expect(registry.verify({
      ...cleanupContext(),
    })).rejects.toMatchObject({ code });
  });

  it('allows an independent negative result only with no evidence claim', async () => {
    const adapterRegistry = createServerOwnedAdapterRegistry({
      adapters: [adapter()],
    });
    const registry = createIndependentCleanupVerifierRegistry({
      adapterRegistry,
      verifiers: [verifier({
        verifyCleanup: vi.fn(async () => ({
          confirmed: false,
          evidence: null,
        })),
      })],
    });

    await expect(registry.verify({
      ...cleanupContext(),
    })).resolves.toEqual({
      confirmed: false,
      evidence: null,
    });
  });

  it('composes the adapter and cleanup authority inside one server-owned registry', async () => {
    const runtime = createServerOwnedRuntimeRegistry({
      adapters: [adapter()],
      cleanupVerifiers: [verifier()],
    });
    const selected = runtime.resolveForCell(fixtureCell());

    expect(selected.adapter).toMatchObject({
      adapter_id: fixtureCell().adapter_id,
      owner_service: fixtureCell().seam_id,
    });
    const context = cleanupContext();
    await expect(selected.verifyCleanup(context)).resolves.toEqual({
      confirmed: true,
      evidence: createCleanupEvidence(context),
    });
    expect(selected).not.toHaveProperty('selectCleanupVerifier');
    expect(Object.isFrozen(selected)).toBe(true);
  });
});
