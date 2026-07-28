import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import {
  compileDrillPlan,
  executeDrillCell,
} from '../kernel-equivalence-drills.js';
import {
  FIXTURE_NOW,
  createTrustFixture,
  fixtureBundle,
  fixtureCell,
  fixtureGrant,
  fixtureReceipt,
} from './kernel-equivalence-test-fixtures.js';

function rootContract() {
  return load(readFileSync(
    new URL('../../../../../regression-contract.yaml', import.meta.url),
    'utf8',
  ));
}

function clone(value) {
  return structuredClone(value);
}

function expectDrillError(run, code) {
  expect(run).toThrowError(expect.objectContaining({ code }));
}

describe('compileDrillPlan', () => {
  it('expands eleven canonical descriptors into exactly 99 unique blocked cells', () => {
    const plan = compileDrillPlan(rootContract());

    expect(plan.behavior_count).toBe(11);
    expect(plan.cells).toHaveLength(99);
    expect(new Set(plan.cells.map((cell) => cell.cell_id))).toHaveLength(99);
    expect(new Set(plan.cells.map((cell) => cell.provider))).toEqual(
      new Set(['claude', 'codex', 'grok']),
    );
    expect(new Set(plan.cells.map((cell) => cell.scenario))).toEqual(
      new Set(['normal', 'violation', 'recovery']),
    );
    expect(plan.cells.every((cell) => (
      cell.effect_signer_status === 'missing'
      && cell.blocked_by === 'seam_receipt_signer_missing'
    ))).toBe(true);
  });

  it('rejects a missing scenario instead of compiling a partial matrix', () => {
    const contract = clone(rootContract());
    delete contract.behavior_equivalence.behaviors[0].drill.scenarios.recovery;

    expectDrillError(
      () => compileDrillPlan(contract),
      'drill_scenario_catalog_invalid',
    );
  });

  it('rejects duplicate behavior identities before generating cells', () => {
    const contract = clone(rootContract());
    contract.behavior_equivalence.behaviors[1].behavior_id =
      contract.behavior_equivalence.behaviors[0].behavior_id;

    expectDrillError(
      () => compileDrillPlan(contract),
      'drill_behavior_id_duplicate',
    );
  });

  it.each([
    ['production environment', (drill) => { drill.isolation.environment = 'production'; }],
    ['main ref prefix', (drill) => { drill.isolation.resource_prefix = 'refs/heads/main'; }],
    ['protected ref prefix', (drill) => { drill.isolation.resource_prefix = 'refs/heads/release'; }],
  ])('rejects unsafe default isolation: %s', (_label, mutate) => {
    const contract = clone(rootContract());
    mutate(contract.behavior_equivalence.behaviors[0].drill);

    expectDrillError(
      () => compileDrillPlan(contract),
      'drill_isolation_unsafe',
    );
  });

  it('rejects an available signer without an active effect-receipt key', () => {
    const contract = clone(rootContract());
    contract.behavior_equivalence.behaviors[0].drill.effect_signer_status = 'available';
    contract.behavior_equivalence.behaviors[0].drill.blocked_by = null;

    expectDrillError(
      () => compileDrillPlan(contract),
      'drill_effect_signer_key_missing',
    );
  });
});

function executionFixture() {
  const keys = createTrustFixture();
  const cell = {
    ...fixtureCell(),
    effect_signer_status: 'available',
    effect_key_id: keys.effect.record.key_id,
    blocked_by: null,
  };
  const grant = fixtureGrant(keys, cell);
  const receipt = fixtureReceipt(keys, grant, cell);
  const bundle = fixtureBundle(keys, cell, grant, [receipt]);
  const calls = [];
  const audits = [];
  const nonceConsumer = vi.fn(async () => {
    calls.push('nonce');
    return { consumed: true };
  });
  const adapter = {
    prepare: vi.fn(async () => {
      calls.push('prepare');
      return { resource_id: grant.resource_id };
    }),
    invokeActualSeam: vi.fn(async () => {
      calls.push('seam');
      return receipt;
    }),
    observe: vi.fn(async (value) => {
      calls.push('observe');
      return value;
    }),
    cleanup: vi.fn(async () => {
      calls.push('cleanup');
      return { confirmed: true };
    }),
  };
  const collector = vi.fn(async () => {
    calls.push('collector');
    return bundle;
  });
  const auditSink = vi.fn((audit) => audits.push(audit));
  return {
    keys,
    cell,
    grant,
    receipt,
    bundle,
    calls,
    audits,
    nonceConsumer,
    adapter,
    adapters: new Map([[cell.adapter_id, adapter]]),
    collector,
    auditSink,
  };
}

async function execute(value, overrides = {}) {
  return executeDrillCell({
    cell: value.cell,
    grant: value.grant,
    trustRegistry: value.keys.registry,
    nonceConsumer: value.nonceConsumer,
    adapters: value.adapters,
    collector: value.collector,
    predecessorResolver: value.predecessorResolver,
    auditSink: value.auditSink,
    now: FIXTURE_NOW,
    timeoutMs: 25,
    ...overrides,
  });
}

describe('executeDrillCell', () => {
  it('blocks a missing signer before grant, nonce, adapter, or collector activity', async () => {
    const value = executionFixture();
    value.cell.effect_signer_status = 'missing';
    value.cell.blocked_by = 'seam_receipt_signer_missing';

    await expect(execute(value)).resolves.toMatchObject({
      status: 'blocked',
      code: 'seam_receipt_signer_missing',
      bundle: null,
    });
    expect(value.nonceConsumer).not.toHaveBeenCalled();
    expect(value.adapter.prepare).not.toHaveBeenCalled();
    expect(value.collector).not.toHaveBeenCalled();
  });

  it('atomically consumes nonce after grant verification and before adapter prepare', async () => {
    const value = executionFixture();
    const result = await execute(value);

    expect(result).toMatchObject({
      status: 'collected',
      code: 'drill_receipt_collected',
    });
    expect(result.bundle.bundle_id).toBe(value.bundle.bundle_id);
    expect(value.calls).toEqual([
      'nonce',
      'prepare',
      'seam',
      'observe',
      'cleanup',
      'collector',
    ]);
  });

  it('blocks invalid grants without consuming nonce', async () => {
    const value = executionFixture();
    value.grant = { ...value.grant, provider: 'grok' };

    await expect(execute(value)).resolves.toMatchObject({
      status: 'blocked',
      code: 'grant_axis_mismatch',
    });
    expect(value.nonceConsumer).not.toHaveBeenCalled();
  });

  it('blocks nonce replay and writes a secret-free denial audit', async () => {
    const value = executionFixture();
    value.nonceConsumer.mockResolvedValue({ consumed: false });

    await expect(execute(value)).resolves.toMatchObject({
      status: 'blocked',
      code: 'grant_nonce_replay',
    });
    expect(value.adapter.prepare).not.toHaveBeenCalled();
    expect(value.audits).toHaveLength(1);
    const serialized = JSON.stringify(value.audits[0]);
    expect(serialized).not.toContain('signature');
    expect(serialized).not.toContain(value.grant.signature);
    expect(serialized).not.toContain(value.grant.nonce);
  });

  it('times out the actual seam, cleans up, and never collects', async () => {
    const value = executionFixture();
    value.adapter.invokeActualSeam.mockImplementation(
      () => new Promise(() => {}),
    );

    await expect(execute(value, { timeoutMs: 5 })).resolves.toMatchObject({
      status: 'blocked',
      code: 'adapter_timeout',
    });
    expect(value.adapter.cleanup).toHaveBeenCalledTimes(1);
    expect(value.collector).not.toHaveBeenCalled();
  });

  it.each([
    ['unsigned output', () => ({ effect_code: 'ordinary object' }), 'effect_fields_invalid'],
    [
      'axis mismatch',
      (value) => ({ ...value.receipt, provider: 'grok' }),
      'effect_axis_mismatch',
    ],
  ])('blocks %s from the adapter without a bundle', async (_label, output, code) => {
    const value = executionFixture();
    value.adapter.invokeActualSeam.mockImplementation(async () => (
      typeof output === 'function' ? output(value) : output
    ));

    await expect(execute(value)).resolves.toMatchObject({
      status: 'blocked',
      code,
      bundle: null,
    });
    expect(value.collector).not.toHaveBeenCalled();
  });

  it('blocks unconfirmed cleanup and collector-invalid bundles', async () => {
    const cleanup = executionFixture();
    cleanup.adapter.cleanup.mockResolvedValue({ confirmed: false });
    await expect(execute(cleanup)).resolves.toMatchObject({
      status: 'blocked',
      code: 'adapter_cleanup_unconfirmed',
    });
    expect(cleanup.collector).not.toHaveBeenCalled();

    const collector = executionFixture();
    collector.collector.mockResolvedValue({ ordinary: 'object' });
    await expect(execute(collector)).resolves.toMatchObject({
      status: 'blocked',
      code: 'bundle_fields_invalid',
    });
  });

  it('verifies the exact violation predecessor before executing recovery', async () => {
    const keys = createTrustFixture();
    const violationCell = {
      ...fixtureCell({ scenario: 'violation' }),
      effect_signer_status: 'available',
      effect_key_id: keys.effect.record.key_id,
      blocked_by: null,
    };
    const recoveryCell = {
      ...fixtureCell({ scenario: 'recovery' }),
      effect_signer_status: 'available',
      effect_key_id: keys.effect.record.key_id,
      blocked_by: null,
    };
    const violationGrant = fixtureGrant(keys, violationCell);
    const recoveryGrant = fixtureGrant(keys, recoveryCell);
    const violationReceipt = fixtureReceipt(
      keys,
      violationGrant,
      violationCell,
    );
    const recoveryReceipt = fixtureReceipt(
      keys,
      recoveryGrant,
      recoveryCell,
      violationReceipt,
    );
    const bundle = fixtureBundle(
      keys,
      recoveryCell,
      recoveryGrant,
      [violationReceipt, recoveryReceipt],
      [violationGrant, recoveryGrant],
    );
    const calls = [];
    const adapter = {
      prepare: vi.fn(async () => {
        calls.push('prepare');
        return {};
      }),
      invokeActualSeam: vi.fn(async () => {
        calls.push('seam');
        return recoveryReceipt;
      }),
      observe: vi.fn(async (output) => {
        calls.push('observe');
        return output;
      }),
      cleanup: vi.fn(async () => {
        calls.push('cleanup');
        return { confirmed: true };
      }),
    };
    const predecessorResolver = vi.fn(async () => {
      calls.push('predecessor');
      return {
        grant: violationGrant,
        receipt: violationReceipt,
      };
    });
    const nonceConsumer = vi.fn(async () => {
      calls.push('nonce');
      return { consumed: true };
    });
    const collector = vi.fn(async (input) => {
      calls.push('collector');
      expect(input.executionGrants).toEqual([violationGrant, recoveryGrant]);
      expect(input.receipts).toEqual([violationReceipt, recoveryReceipt]);
      return bundle;
    });

    await expect(executeDrillCell({
      cell: recoveryCell,
      grant: recoveryGrant,
      trustRegistry: keys.registry,
      predecessorResolver,
      nonceConsumer,
      adapters: new Map([[recoveryCell.adapter_id, adapter]]),
      collector,
      now: FIXTURE_NOW,
      timeoutMs: 25,
    })).resolves.toMatchObject({
      status: 'collected',
      code: 'drill_receipt_collected',
    });
    expect(calls).toEqual([
      'predecessor',
      'nonce',
      'prepare',
      'seam',
      'observe',
      'cleanup',
      'collector',
    ]);
  });

  it('blocks recovery without a trusted violation predecessor before nonce use', async () => {
    const value = executionFixture();
    value.cell = {
      ...value.cell,
      cell_id: value.cell.cell_id.replace(/::normal$/, '::recovery'),
      scenario: 'recovery',
    };
    value.grant = fixtureGrant(value.keys, value.cell);

    await expect(execute(value, {
      predecessorResolver: null,
    })).resolves.toMatchObject({
      status: 'blocked',
      code: 'recovery_predecessor_unavailable',
    });
    expect(value.nonceConsumer).not.toHaveBeenCalled();
    expect(value.adapter.prepare).not.toHaveBeenCalled();
  });
});
