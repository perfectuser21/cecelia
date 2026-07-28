import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
} from '../kernel-equivalence-quality-adapters.js';
import {
  SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
} from '../kernel-equivalence-security-adapters.js';
import {
  createBrainOwnedTrustedRuntimeRegistry,
  createGrantAuthorityBinding,
} from '../kernel-equivalence-trusted-assembly.js';
import {
  loadTrustedEquivalenceRuntime,
} from '../kernel-equivalence-runtime-loader.js';
import {
  createTrustFixture,
} from './kernel-equivalence-test-fixtures.js';

const PROVIDERS = ['claude', 'codex', 'grok'];
const SCENARIOS = ['normal', 'violation', 'recovery'];
const DESCRIPTORS = [
  ...SECURITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
  ...QUALITY_EQUIVALENCE_ADAPTER_DESCRIPTORS,
];
const RELEASE_DESCRIPTOR = {
  behavior_id: 'KERNEL-P0-07-RELEASE-PROMOTION',
  seam_id: 'kernel.release.staging_promotion',
  adapter_id: 'kernel.drill.release_promotion.v1',
};
const PLAN_DESCRIPTORS = [...DESCRIPTORS, RELEASE_DESCRIPTOR];
const roots = [];

function keyId(descriptor) {
  return `${descriptor.adapter_id}.effect-key`;
}

function cell(descriptor, provider = 'codex', scenario = 'normal') {
  const release = descriptor === RELEASE_DESCRIPTOR;
  return {
    cell_id: `${descriptor.behavior_id}::${provider}::${scenario}`,
    behavior_id: descriptor.behavior_id,
    provider,
    scenario,
    seam_id: descriptor.seam_id,
    adapter_id: descriptor.adapter_id,
    effect_signer_status: release ? 'missing' : 'available',
    effect_key_id: release ? null : keyId(descriptor),
    blocked_by: release ? 'seam_receipt_signer_missing' : null,
    assembly_status: release ? 'not_assembled' : 'assembled',
    isolation: {
      environment: 'isolated',
      resource_type: 'ephemeral_run',
      resource_prefix:
        'equivalence-drill/{run_id}/{attempt_id}/trusted/',
    },
    expected: {
      expected_outcome: scenario === 'recovery'
        ? 'recovered'
        : scenario === 'violation' ? 'denied' : 'confirmed',
      effect_code: `${descriptor.adapter_id}.${scenario}`,
    },
  };
}

function plan() {
  return {
    schema_version: 'kernel-equivalence-drill-plan/v1',
    behavior_count: 11,
    cells: PLAN_DESCRIPTORS.flatMap((descriptor) => (
      PROVIDERS.flatMap((provider) => (
        SCENARIOS.map((scenario) => cell(descriptor, provider, scenario))
      ))
    )),
  };
}

function seamFor(descriptor) {
  return {
    owner_service: descriptor.seam_id,
    invoke: vi.fn(),
    cancel: vi.fn(async () => ({ confirmed: true })),
    cleanup: vi.fn(async () => ({ confirmed: true })),
  };
}

function fixture() {
  const effectSignersBySeam = Object.fromEntries(DESCRIPTORS.map(
    (descriptor) => [
      descriptor.seam_id,
      Object.freeze({
        key_id: keyId(descriptor),
        purpose: 'effect_receipt',
        service_id: descriptor.seam_id,
        signEffectResult: vi.fn(),
      }),
    ],
  ));
  const seamBuilders = Object.fromEntries(DESCRIPTORS.map(
    (descriptor) => [
      descriptor.seam_id,
      vi.fn(({ effectSigner }) => {
        expect(effectSigner).toBe(
          effectSignersBySeam[descriptor.seam_id],
        );
        return seamFor(descriptor);
      }),
    ],
  ));
  const securityIsolation = {
    owner_service: 'kernel.equivalence.isolation',
    capability_id: 'security-isolation-writer',
    prepare: vi.fn(),
    cancel: vi.fn(),
    cleanup: vi.fn(),
  };
  const qualityIsolation = {
    owner_service: 'kernel.equivalence.quality_isolation',
    capability_id: 'quality-isolation-writer',
    prepare: vi.fn(),
    cancel: vi.fn(),
    cleanup: vi.fn(),
  };
  const cleanupInspector = {
    owner_service: 'kernel.equivalence.cleanup_inspector',
    capability_id: 'cleanup-read-only-inspector',
    inspect: vi.fn(),
  };
  return {
    plan: plan(),
    effectSignersBySeam,
    seamBuilders,
    securityIsolation,
    qualityIsolation,
    cleanupInspector,
  };
}

function createRegistry(value = fixture()) {
  return createBrainOwnedTrustedRuntimeRegistry(value);
}

function writeCollectorKey(root, privateKey) {
  const path = join(root, 'collector.pem');
  writeFileSync(
    path,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
  return path;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

describe('Brain-owned trusted equivalence assembly', () => {
  it('assembles the exact ten non-release seams and resolves every scenario', () => {
    const value = fixture();
    const registry = createRegistry(value);

    expect(registry.size).toBe(10);
    expect(registry.ids).toEqual(
      DESCRIPTORS.map((descriptor) => descriptor.adapter_id).sort(),
    );
    for (const descriptor of DESCRIPTORS) {
      expect(value.seamBuilders[descriptor.seam_id]).toHaveBeenCalledOnce();
      expect(value.seamBuilders[descriptor.seam_id]).toHaveBeenCalledWith({
        effectSigner:
          value.effectSignersBySeam[descriptor.seam_id],
        createAuthorityBinding: expect.any(Function),
      });
      for (const scenario of SCENARIOS) {
        const selected = registry.resolveForCell(
          cell(descriptor, 'codex', scenario),
        );
        expect(selected.adapter).toMatchObject({
          adapter_id: descriptor.adapter_id,
          owner_service: descriptor.seam_id,
        });
        expect(selected.verifyCleanup).toEqual(expect.any(Function));
      }
    }
    expect(JSON.stringify(registry)).not.toMatch(
      /effect-key|signEffectResult|private|secret/i,
    );
  });

  it('loads as one explicit trusted runtime with adapter_count=10', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kernel-eq-assembly-'));
    roots.push(root);
    const keys = createTrustFixture();
    const runtime = await loadTrustedEquivalenceRuntime({
      env: {
        KERNEL_EQ_COLLECTOR_KEY_FILE: writeCollectorKey(
          root,
          keys.collector.privateKey,
        ),
        KERNEL_EQ_COLLECTOR_KEY_ID: keys.collector.record.key_id,
      },
      trustRegistry: keys.registry,
      pool: {
        connect: vi.fn(),
        query: vi.fn(async () => ({
          rows: [{
            genesis_hash: null,
            head_hash: null,
            revision: 0,
          }],
          rowCount: 1,
        })),
      },
      runtimeRegistry: createRegistry(),
      now: () => Date.parse('2026-07-28T12:02:00.000Z'),
    });

    expect(runtime.adapter_count).toBe(10);
  });

  it.each([
    ['seam builder', (value) => {
      delete value.seamBuilders[DESCRIPTORS[0].seam_id];
    }, 'trusted_assembly_seam_builder_set_invalid'],
    ['effect signer', (value) => {
      delete value.effectSignersBySeam[DESCRIPTORS[0].seam_id];
    }, 'trusted_assembly_effect_signer_set_invalid'],
    ['cleanup inspector', (value) => {
      value.cleanupInspector.capability_id =
        value.qualityIsolation.capability_id;
    }, 'trusted_assembly_cleanup_inspector_invalid'],
    ['security allocator capability', (value) => {
      delete value.securityIsolation.capability_id;
    }, 'trusted_assembly_isolation_port_invalid'],
    ['quality allocator capability', (value) => {
      delete value.qualityIsolation.capability_id;
    }, 'trusted_assembly_isolation_port_invalid'],
  ])('fails startup when %s is missing or shared', (
    _label,
    mutate,
    code,
  ) => {
    const value = fixture();
    mutate(value);

    expect(() => createRegistry(value)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('rejects cross-seam and wrong-plan effect signer identities', () => {
    const value = fixture();
    const descriptor = DESCRIPTORS[0];
    value.effectSignersBySeam[descriptor.seam_id] = {
      ...value.effectSignersBySeam[descriptor.seam_id],
      service_id: DESCRIPTORS[1].seam_id,
    };
    expect(() => createRegistry(value)).toThrowError(
      expect.objectContaining({
        code: 'trusted_assembly_effect_signer_boundary_invalid',
      }),
    );

    const wrongKey = fixture();
    wrongKey.effectSignersBySeam[descriptor.seam_id] = {
      ...wrongKey.effectSignersBySeam[descriptor.seam_id],
      key_id: 'other-key',
    };
    expect(() => createRegistry(wrongKey)).toThrowError(
      expect.objectContaining({
        code: 'trusted_assembly_effect_signer_boundary_invalid',
      }),
    );
  });

  it.each([
    ['missing release cell', (value) => {
      value.plan.cells = value.plan.cells.filter(
        (entry, index) => (
          entry.behavior_id !== RELEASE_DESCRIPTOR.behavior_id
          || index !== value.plan.cells.findIndex(
            (cellEntry) => (
              cellEntry.behavior_id === RELEASE_DESCRIPTOR.behavior_id
            ),
          )
        ),
      );
    }],
    ['duplicate cell', (value) => {
      value.plan.cells.push(structuredClone(value.plan.cells[0]));
    }],
    ['extra cell', (value) => {
      value.plan.cells.push({
        ...structuredClone(value.plan.cells[0]),
        cell_id: 'CALLER-EXTRA::codex::normal',
        behavior_id: 'CALLER-EXTRA',
      });
    }],
    ['blocked required signer', (value) => {
      value.plan.cells[0].effect_signer_status = 'missing';
      value.plan.cells[0].blocked_by = 'seam_receipt_signer_missing';
    }],
    ['non-canonical cell id', (value) => {
      value.plan.cells[0].cell_id = 'caller-selected-cell-id';
    }],
    ['shared effect key across seams', (value) => {
      const first = DESCRIPTORS[0];
      const second = DESCRIPTORS[1];
      for (const entry of value.plan.cells) {
        if (entry.behavior_id === second.behavior_id) {
          entry.effect_key_id = keyId(first);
        }
      }
    }],
  ])('rejects a non-canonical 11/99 plan: %s', (_label, mutate) => {
    const value = fixture();
    mutate(value);

    expect(() => createRegistry(value)).toThrowError(
      expect.objectContaining({
        code: 'trusted_assembly_plan_invalid',
      }),
    );
  });

  it('generates the four authority binding fragments required by seams', () => {
    const descriptorBySeam = new Map(
      DESCRIPTORS.map((descriptor) => [descriptor.seam_id, descriptor]),
    );
    const grant = {
      run_id: '11111111-1111-4111-8111-111111111111',
      attempt_id: '22222222-2222-4222-8222-222222222222',
      resource_id: 'resource-id',
      resource_ref: 'equivalence-drill/run/attempt/resource',
      artifact_sha: 'a'.repeat(40),
    };
    const resource = {
      resource_id: grant.resource_id,
      resource_ref: grant.resource_ref,
    };

    expect(createGrantAuthorityBinding({
      seamId: descriptorBySeam.get('kernel.quality.devgate').seam_id,
      grant,
      resource,
    })).toEqual({
      run_id: grant.run_id,
      attempt_id: grant.attempt_id,
      resource_id: grant.resource_id,
      resource_ref: grant.resource_ref,
    });
    expect(createGrantAuthorityBinding({
      seamId: 'kernel.credential.attempt_lease',
      grant,
      resource,
    })).toEqual({
      runId: grant.run_id,
      attemptId: grant.attempt_id,
      resourceId: grant.resource_id,
      resourceRef: grant.resource_ref,
    });
    expect(createGrantAuthorityBinding({
      seamId: 'kernel.evaluation.independent_judge',
      grant,
      resource,
    })).toEqual({
      runId: grant.run_id,
      attempt: {
        id: grant.attempt_id,
        run_id: grant.run_id,
      },
      observed: {
        run: { id: grant.run_id },
        pr: { head_sha: grant.artifact_sha },
      },
      resource,
    });
    expect(createGrantAuthorityBinding({
      seamId: 'kernel.liveness.orphan_recovery',
      grant,
      resource,
    })).toEqual({
      attempt: {
        id: grant.attempt_id,
        run_id: grant.run_id,
      },
      resource,
    });
  });
});
