import { describe, expect, it, vi } from 'vitest';
import {
  createIndependentCleanupVerifierRegistry,
  createServerOwnedAdapterRegistry,
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
    verifyCleanup: vi.fn(async () => ({
      confirmed: true,
      evidence_ref: `cleanup-evidence:${'a'.repeat(64)}`,
    })),
    ...overrides,
  };
}

describe('server-owned equivalence runtime registries', () => {
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
    const context = {
      cell: fixtureCell(),
      cleanup: { adapter_claim: true },
    };

    await expect(registry.verify(context)).resolves.toEqual({
      confirmed: true,
      evidence_ref: `cleanup-evidence:${'a'.repeat(64)}`,
    });
    expect(cleanup.verifyCleanup).toHaveBeenCalledWith(context);
    await expect(registry.verify({
      ...context,
      cell: { ...context.cell, adapter_id: 'kernel.drill.unknown.v1' },
    })).rejects.toMatchObject({ code: 'cleanup_verifier_unavailable' });
  });

  it.each([
    [{ confirmed: true }, 'cleanup_verifier_result_invalid'],
    [{ confirmed: true, evidence_ref: 'ordinary string' }, 'cleanup_verifier_result_invalid'],
    [{
      confirmed: true,
      evidence_ref: `cleanup-evidence:${'a'.repeat(64)}`,
      adapter_says: true,
    }, 'cleanup_verifier_result_invalid'],
    [{
      confirmed: false,
      evidence_ref: `cleanup-evidence:${'a'.repeat(64)}`,
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
      cell: fixtureCell(),
      cleanup: {},
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
          evidence_ref: null,
        })),
      })],
    });

    await expect(registry.verify({
      cell: fixtureCell(),
      cleanup: {},
    })).resolves.toEqual({
      confirmed: false,
      evidence_ref: null,
    });
  });
});
