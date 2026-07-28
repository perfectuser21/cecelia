import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it, vi } from 'vitest';
import {
  compileDrillPlan,
  executeDrillCell,
} from '../kernel-equivalence-drills.js';
import {
  createServerOwnedRuntimeRegistry,
} from '../kernel-equivalence-runtime-registry.js';
import { sha256Canonical } from '../kernel-equivalence-receipts.js';
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
    ['path traversal prefix', (drill) => { drill.isolation.resource_prefix = 'equivalence-drill/{run_id}/{attempt_id}/../'; }],
    ['empty path segment', (drill) => { drill.isolation.resource_prefix = 'equivalence-drill/{run_id}/{attempt_id}//'; }],
    ['ambiguous delimiter', (drill) => { drill.isolation.resource_prefix = 'equivalence-drill/{run_id}/{attempt_id}/case:/'; }],
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

  it('keeps a future or expired effect key blocked at the evaluation clock', () => {
    for (const [notBefore, notAfter] of [
      ['2030-01-01T00:00:00.000Z', '2031-01-01T00:00:00.000Z'],
      ['2025-01-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z'],
    ]) {
      const contract = clone(rootContract());
      const keys = createTrustFixture(
        contract.behavior_equivalence.behaviors[0].drill.seam_id,
      );
      keys.effect.record.not_before = notBefore;
      keys.effect.record.not_after = notAfter;
      contract.behavior_equivalence.drill_trust_registry.keys = [
        keys.effect.record,
      ];
      const drill = contract.behavior_equivalence.behaviors[0].drill;
      drill.effect_signer_status = 'available';
      drill.effect_key_id = keys.effect.record.key_id;
      drill.blocked_by = null;

      expectDrillError(
        () => compileDrillPlan(contract, { now: FIXTURE_NOW }),
        'drill_effect_signer_key_inactive',
      );
    }
  });

  it('rejects a partial or malformed trusted bundle chain checkpoint', () => {
    const contract = clone(rootContract());
    contract.behavior_equivalence.drill_bundle_chain.head_hash = 'a'.repeat(64);

    expectDrillError(
      () => compileDrillPlan(contract, { now: FIXTURE_NOW }),
      'drill_bundle_chain_invalid',
    );
  });

  it.each([
    ['algorithm', (registry) => { registry.algorithm = 'rsa'; }],
    ['grant freshness', (registry) => { registry.grant_max_age_seconds = 0; }],
    ['effect freshness', (registry) => { registry.effect_receipt_max_age_seconds = '86400'; }],
    ['collector freshness', (registry) => { delete registry.collector_bundle_max_age_seconds; }],
    ['single-use nonce', (registry) => { registry.replay_nonce.single_use = false; }],
    ['atomic nonce', (registry) => { registry.replay_nonce.atomic_consumer_required = false; }],
  ])('rejects an invalid trust registry even while every signer is missing: %s', (
    _label,
    mutate,
  ) => {
    const contract = clone(rootContract());
    mutate(contract.behavior_equivalence.drill_trust_registry);

    expectDrillError(
      () => compileDrillPlan(contract),
      'trust_registry_invalid',
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
    cancel: vi.fn(async () => {
      calls.push('cancel');
      return { confirmed: true };
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
  const cleanupVerifier = vi.fn(async ({ cleanup }) => ({
    confirmed: cleanup?.confirmed === true,
  }));
  const chainBundles = new Map();
  let chainCheckpoint = {
    schema_version: 'kernel-equivalence-bundle-chain/v1',
    genesis_hash: null,
    head_hash: null,
  };
  const bundleChainStore = {
    getCheckpoint: vi.fn(async () => structuredClone(chainCheckpoint)),
    readBundle: vi.fn((hash) => chainBundles.get(hash)),
    commit: vi.fn(async ({ bundle: committedBundle, bundle_hash: hash, previous_head_hash: previous }) => {
      if (previous !== chainCheckpoint.head_hash) return { committed: false };
      chainBundles.set(hash, committedBundle);
      chainCheckpoint = {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: chainCheckpoint.genesis_hash ?? hash,
        head_hash: hash,
      };
      return { committed: true, checkpoint: structuredClone(chainCheckpoint) };
    }),
  };
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
    cleanupVerifier,
    bundleChainStore,
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
    cleanupVerifier: value.cleanupVerifier,
    bundleChainStore: value.bundleChainStore,
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

  it('re-samples one trusted clock across later receipt and bundle boundaries', async () => {
    const value = executionFixture();
    const start = Date.parse('2026-07-28T12:00:00.000Z');
    let reads = 0;
    const clock = vi.fn(() => {
      reads += 1;
      return reads <= 2 ? start : FIXTURE_NOW;
    });

    await expect(execute(value, { now: clock })).resolves.toMatchObject({
      status: 'collected',
      code: 'drill_receipt_collected',
    });
    expect(clock.mock.calls.length).toBeGreaterThanOrEqual(4);
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
      code: 'adapter_cancellation_unconfirmed',
      audit: { late_effect_risk: true },
    });
    expect(value.adapter.cleanup).toHaveBeenCalledTimes(1);
    expect(value.collector).not.toHaveBeenCalled();
  });

  it('compensates and cleans up resources registered before prepare fails', async () => {
    const value = executionFixture();
    const partial = { resource_id: value.grant.resource_id };
    value.adapter.prepare.mockImplementation(async ({
      registerCompensation,
    }) => {
      registerCompensation(partial);
      throw new Error('prepare failed after resource allocation');
    });
    value.adapter.cleanup.mockImplementation(async (context) => {
      expect(context.compensations).toEqual([partial]);
      return { confirmed: true };
    });
    value.cleanupVerifier.mockImplementation(async (context) => {
      expect(context.compensations).toEqual([partial]);
      return { confirmed: context.cleanup?.confirmed === true };
    });

    await expect(execute(value)).resolves.toMatchObject({
      status: 'blocked',
      code: 'adapter_prepare_failed',
    });
    expect(value.adapter.cleanup).toHaveBeenCalledTimes(1);
    expect(value.adapter.invokeActualSeam).not.toHaveBeenCalled();
  });

  it('aborts and confirms cancellation so a delayed effect cannot fire after timeout', async () => {
    const value = executionFixture();
    let lateEffect = false;
    value.adapter.invokeActualSeam.mockImplementation(({ signal }) => (
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          lateEffect = true;
          resolve(value.receipt);
        }, 30);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('cancelled'));
        }, { once: true });
      })
    ));
    value.adapter.cancel.mockImplementation(async ({ signal, phase }) => {
      expect(phase).toBe('invoke');
      expect(signal.aborted).toBe(true);
      return { confirmed: true };
    });

    const result = await execute(value, { timeoutMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'adapter_timeout',
    });
    expect(lateEffect).toBe(false);
    expect(value.adapter.cancel).toHaveBeenCalledTimes(1);
    expect(value.adapter.cleanup).toHaveBeenCalledTimes(1);
    expect(value.collector).not.toHaveBeenCalled();
  });

  it('records late-effect risk when timeout cancellation is not confirmed', async () => {
    const value = executionFixture();
    value.adapter.invokeActualSeam.mockImplementation(
      () => new Promise(() => {}),
    );
    value.adapter.cancel.mockResolvedValue({ confirmed: false });

    const result = await execute(value, { timeoutMs: 5 });

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'adapter_cancellation_unconfirmed',
      audit: {
        late_effect_risk: true,
      },
    });
    expect(value.adapter.cleanup).toHaveBeenCalledTimes(1);
    expect(value.collector).not.toHaveBeenCalled();
  });

  it('does not trust a positive cancel response while the original effect is unsettled', async () => {
    const value = executionFixture();
    let lateEffect = false;
    value.adapter.invokeActualSeam.mockImplementation(
      () => new Promise((resolve) => {
        setTimeout(() => {
          lateEffect = true;
          resolve(value.receipt);
        }, 30);
      }),
    );
    value.adapter.cancel.mockResolvedValue({ confirmed: true });

    const result = await execute(value, { timeoutMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 35));

    expect(result).toMatchObject({
      status: 'blocked',
      code: 'adapter_cancellation_unconfirmed',
      audit: { late_effect_risk: true },
    });
    expect(lateEffect).toBe(true);
    expect(value.collector).not.toHaveBeenCalled();
  });

  it('requires an independent cleanup verifier instead of trusting adapter boolean output', async () => {
    const missing = executionFixture();
    await expect(execute(missing, {
      cleanupVerifier: null,
    })).resolves.toMatchObject({
      status: 'blocked',
      code: 'cleanup_verifier_unavailable',
    });
    expect(missing.collector).not.toHaveBeenCalled();

    const contradicted = executionFixture();
    contradicted.adapter.cleanup.mockResolvedValue({ confirmed: true });
    contradicted.cleanupVerifier.mockResolvedValue({ confirmed: false });
    await expect(execute(contradicted)).resolves.toMatchObject({
      status: 'blocked',
      code: 'adapter_cleanup_unconfirmed',
    });
  });

  it('cannot override cleanup authority selected by the server-owned runtime registry', async () => {
    const value = executionFixture();
    const serverVerifier = vi.fn(async () => ({
      confirmed: false,
      evidence_ref: null,
    }));
    const runtimeRegistry = createServerOwnedRuntimeRegistry({
      adapters: [{
        adapter_id: value.cell.adapter_id,
        owner_service: value.cell.seam_id,
        prepare: value.adapter.prepare,
        invokeActualSeam: value.adapter.invokeActualSeam,
        observe: value.adapter.observe,
        cancel: value.adapter.cancel,
        cleanup: value.adapter.cleanup,
      }],
      cleanupVerifiers: [{
        verifier_id: 'kernel.cleanup.ci_merge_authority.v1',
        adapter_id: value.cell.adapter_id,
        owner_service: 'kernel.cleanup.observer',
        verifyCleanup: serverVerifier,
      }],
    });
    const callerSelectedVerifier = vi.fn(async () => ({
      confirmed: true,
      evidence_ref: `cleanup-evidence:${'c'.repeat(64)}`,
    }));

    await expect(execute(value, {
      adapters: runtimeRegistry,
      cleanupVerifier: callerSelectedVerifier,
    })).resolves.toMatchObject({
      status: 'blocked',
      code: 'adapter_cleanup_unconfirmed',
    });
    expect(serverVerifier).toHaveBeenCalledOnce();
    expect(callerSelectedVerifier).not.toHaveBeenCalled();
  });

  it('maps untrusted error codes and sanitizes invalid audit identifiers', async () => {
    const value = executionFixture();
    value.adapter.invokeActualSeam.mockImplementation(async () => {
      const error = new Error('adapter failed');
      error.code = 'ghp_EXAMPLE_SECRET_SHOULD_NOT_LOG';
      throw error;
    });

    const result = await execute(value);
    expect(result).toMatchObject({
      code: 'adapter_execution_failed',
      audit: { code: 'adapter_execution_failed' },
    });
    expect(JSON.stringify(result.audit)).not.toContain('ghp_');

    const invalid = executionFixture();
    invalid.grant = {
      ...invalid.grant,
      run_id: { secret: 'credential-should-not-log' },
      attempt_id: 'terminal\\u001b[2J',
    };
    const denied = await execute(invalid);
    expect(denied.audit).toMatchObject({
      run_id: null,
      attempt_id: null,
    });
    expect(JSON.stringify(denied.audit)).not.toContain('credential-should-not-log');
  });

  it('rejects a signed effect whose exact outcome contract differs from the cell', async () => {
    const value = executionFixture();
    value.cell.expected = {
      expected_outcome: 'confirmed',
      effect_code: 'exact_sha_merge_confirmed',
    };
    value.receipt = fixtureReceipt(
      value.keys,
      value.grant,
      value.cell,
      null,
      { effect_code: 'different_effect' },
    );
    value.adapter.invokeActualSeam.mockResolvedValue(value.receipt);
    value.adapter.observe.mockImplementation(async (output) => output);

    await expect(execute(value)).resolves.toMatchObject({
      status: 'blocked',
      code: 'effect_contract_mismatch',
    });
    expect(value.collector).not.toHaveBeenCalled();
  });

  it('requires an atomic trusted bundle chain store', async () => {
    const value = executionFixture();
    await expect(execute(value, {
      bundleChainStore: null,
    })).resolves.toMatchObject({
      status: 'blocked',
      code: 'bundle_chain_store_unavailable',
    });
    expect(value.collector).not.toHaveBeenCalled();
  });

  it('rejects an independent bundle root after a trusted chain head exists', async () => {
    const value = executionFixture();
    value.bundleChainStore.getCheckpoint.mockResolvedValue({
      schema_version: 'kernel-equivalence-bundle-chain/v1',
      genesis_hash: 'a'.repeat(64),
      head_hash: 'a'.repeat(64),
    });
    value.bundleChainStore.readBundle.mockReturnValue(null);

    await expect(execute(value)).resolves.toMatchObject({
      status: 'blocked',
      code: 'bundle_previous_head_mismatch',
    });
    expect(value.bundleChainStore.commit).not.toHaveBeenCalled();
  });

  it('preloads async durable ancestry before synchronous bundle verification', async () => {
    const value = executionFixture();
    const previousBundleHash = sha256Canonical(value.bundle);
    const linkedBundle = fixtureBundle(
      value.keys,
      value.cell,
      value.grant,
      [value.receipt],
      [value.grant],
      previousBundleHash,
    );
    const linkedHash = sha256Canonical(linkedBundle);
    value.collector.mockResolvedValue(linkedBundle);
    value.bundleChainStore.getCheckpoint.mockResolvedValue({
      schema_version: 'kernel-equivalence-bundle-chain/v1',
      genesis_hash: previousBundleHash,
      head_hash: previousBundleHash,
    });
    value.bundleChainStore.readBundle.mockImplementation(async (hash) => (
      hash === previousBundleHash ? structuredClone(value.bundle) : null
    ));
    value.bundleChainStore.commit.mockResolvedValue({
      committed: true,
      checkpoint: {
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: previousBundleHash,
        head_hash: linkedHash,
      },
    });

    await expect(execute(value)).resolves.toMatchObject({
      status: 'collected',
      bundle: { bundle_hash: linkedHash },
    });
    expect(value.bundleChainStore.readBundle)
      .toHaveBeenCalledWith(previousBundleHash);
  });

  it.each([
    ['nonce consumer', 'nonce_consumer_timeout', (value) => {
      value.nonceConsumer.mockImplementation(() => new Promise(() => {}));
    }],
    ['collector', 'collector_timeout', (value) => {
      value.collector.mockImplementation(() => new Promise(() => {}));
    }],
  ])('bounds a hung %s', async (_label, code, arrange) => {
    const value = executionFixture();
    arrange(value);
    await expect(execute(value, { timeoutMs: 5 })).resolves.toMatchObject({
      status: 'blocked',
      code,
    });
  });

  it('bounds a hung predecessor resolver before consuming the recovery nonce', async () => {
    const value = executionFixture();
    value.cell = {
      ...value.cell,
      cell_id: value.cell.cell_id.replace(/::normal$/, '::recovery'),
      scenario: 'recovery',
    };
    value.grant = fixtureGrant(value.keys, value.cell);
    value.predecessorResolver = () => new Promise(() => {});

    await expect(execute(value, { timeoutMs: 5 })).resolves.toMatchObject({
      status: 'blocked',
      code: 'recovery_predecessor_timeout',
    });
    expect(value.nonceConsumer).not.toHaveBeenCalled();
  });

  it('does not let a hung audit sink suppress a fail-closed result', async () => {
    const value = executionFixture();
    value.grant = { ...value.grant, provider: 'grok' };
    value.auditSink = () => new Promise(() => {});

    await expect(execute(value, { timeoutMs: 5 })).resolves.toMatchObject({
      status: 'blocked',
      code: 'grant_axis_mismatch',
      audit_delivery: 'timed_out',
    });
  });

  it('waits for a timed-out bundle transaction to settle before auditing', async () => {
    const value = executionFixture();
    let settled = false;
    value.bundleChainStore.commit.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      settled = true;
      const error = new Error('transaction rolled back');
      error.code = 'bundle_chain_commit_timeout';
      throw error;
    });
    value.auditSink = vi.fn(async () => {
      if (!settled) throw new Error('audit raced an unsettled transaction');
    });

    await expect(execute(value, { timeoutMs: 5 })).resolves.toMatchObject({
      status: 'blocked',
      code: 'bundle_chain_commit_timeout',
      audit_delivery: 'delivered',
    });
    expect(settled).toBe(true);
    expect(value.bundleChainStore.commit).toHaveBeenCalledWith(
      expect.objectContaining({ timeout_ms: 5 }),
    );
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

  it('does not trust safe-looking error codes thrown by external collaborators', async () => {
    const collector = executionFixture();
    collector.collector.mockImplementation(async () => {
      const error = new Error('contains untrusted collector detail');
      error.code = 'effect_secret_should_not_log';
      throw error;
    });
    await expect(execute(collector)).resolves.toMatchObject({
      status: 'blocked',
      code: 'collector_failed',
      audit: { code: 'collector_failed' },
    });

    const predecessor = executionFixture();
    predecessor.cell = {
      ...predecessor.cell,
      cell_id: predecessor.cell.cell_id.replace(/::normal$/, '::recovery'),
      scenario: 'recovery',
    };
    predecessor.grant = fixtureGrant(predecessor.keys, predecessor.cell);
    predecessor.predecessorResolver = async () => {
      const error = new Error('contains untrusted predecessor detail');
      error.code = 'grant_secret_should_not_log';
      throw error;
    };
    await expect(execute(predecessor)).resolves.toMatchObject({
      status: 'blocked',
      code: 'recovery_predecessor_unavailable',
      audit: { code: 'recovery_predecessor_unavailable' },
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
    const assertPredecessor = (context) => {
      expect(context.predecessor).toEqual({
        grant: violationGrant,
        receipt: violationReceipt,
      });
      expect(Object.isFrozen(context.predecessor)).toBe(true);
      expect(Object.isFrozen(context.predecessor.grant)).toBe(true);
      expect(Object.isFrozen(context.predecessor.receipt)).toBe(true);
      expect(context).not.toHaveProperty('predecessorResolver');
      expect(context).not.toHaveProperty('predecessorLoader');
    };
    const adapter = {
      prepare: vi.fn(async (context) => {
        assertPredecessor(context);
        calls.push('prepare');
        return {};
      }),
      invokeActualSeam: vi.fn(async (context) => {
        assertPredecessor(context);
        calls.push('seam');
        return recoveryReceipt;
      }),
      observe: vi.fn(async (output, context) => {
        assertPredecessor(context);
        calls.push('observe');
        return output;
      }),
      cancel: vi.fn(async () => ({ confirmed: true })),
      cleanup: vi.fn(async (context) => {
        assertPredecessor(context);
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
    const bundleChainStore = {
      getCheckpoint: vi.fn(async () => ({
        schema_version: 'kernel-equivalence-bundle-chain/v1',
        genesis_hash: null,
        head_hash: null,
      })),
      readBundle: vi.fn(() => null),
      commit: vi.fn(async ({ bundle_hash: hash }) => ({
        committed: true,
        checkpoint: {
          schema_version: 'kernel-equivalence-bundle-chain/v1',
          genesis_hash: hash,
          head_hash: hash,
        },
      })),
    };

    await expect(executeDrillCell({
      cell: recoveryCell,
      grant: recoveryGrant,
      trustRegistry: keys.registry,
      predecessorResolver,
      nonceConsumer,
      adapters: new Map([[recoveryCell.adapter_id, adapter]]),
      collector,
      bundleChainStore,
      cleanupVerifier: async ({ cleanup }) => ({
        confirmed: cleanup?.confirmed === true,
      }),
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
    expect(predecessorResolver).toHaveBeenCalledOnce();
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
