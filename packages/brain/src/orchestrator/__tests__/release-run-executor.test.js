import { describe, expect, it, vi } from 'vitest';

import { createReleaseRunExecutor } from '../release-run-executor.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const RELEASE_ID = '33333333-3333-4333-8333-333333333333';
const HEAD_SHA = 'a'.repeat(40);
const MERGE_SHA = 'b'.repeat(40);
const artifacts = [
  { name: 'brain', version: '1.268.2', digest: `sha256:${'1'.repeat(64)}` },
];

function stagingPass(overrides = {}) {
  return {
    status: 'pass',
    merge_sha: MERGE_SHA,
    artifact_versions: artifacts,
    ...overrides,
  };
}

function productionPass(overrides = {}) {
  return {
    status: 'pass',
    health: 'pass',
    required_e2e: 'pass',
    merge_sha: MERGE_SHA,
    deployed_versions: artifacts,
    rollback_metadata: {
      anchor: 'prod-cecelia-v4401',
      previous_version: 'prod-cecelia-v4400',
    },
    ...overrides,
  };
}

function deps(overrides = {}) {
  const order = [];
  let release = null;
  const intents = new Map();
  const store = {
    withReleaseLease: vi.fn(async (callback) => {
      order.push('lease:acquire');
      try {
        return await callback({});
      } finally {
        order.push('lease:release');
      }
    }),
    loadMergeAuthority: vi.fn(async () => ({
      run_id: RUN_ID,
      task_id: TASK_ID,
      merge_intent_id: '44444444-4444-4444-8444-444444444444',
      merge_receipt_id: '55555555-5555-4555-8555-555555555555',
      repository: 'perfectuser21/cecelia',
      pr_number: 4401,
      source_head_sha: HEAD_SHA,
      merge_sha: MERGE_SHA,
    })),
    loadRelease: vi.fn(async () => release),
    createRelease: vi.fn(async (_client, identity) => {
      order.push('release:create');
      release = { id: RELEASE_ID, state: 'merged', ...identity };
      return release;
    }),
    appendTransition: vi.fn(async (_client, transition) => {
      order.push(`state:${transition.state}`);
      release = { ...release, state: transition.state };
      return transition;
    }),
    findOrCreateIntent: vi.fn(async (_client, { effectKind }) => {
      if (!intents.has(effectKind)) {
        order.push(`intent:${effectKind}`);
        intents.set(effectKind, {
          id: `${effectKind}-intent`,
          effect_kind: effectKind,
          idempotency_key: `${effectKind}-key`,
          expected_merge_sha: MERGE_SHA,
          expected_artifact_versions: artifacts,
          confirmed_receipt: null,
          last_receipt_status: null,
        });
      }
      return intents.get(effectKind);
    }),
    appendReceipt: vi.fn(async (_client, receipt) => {
      order.push(`receipt:${receipt.intent_id}:${receipt.receipt_status}`);
      if (receipt.receipt_status === 'confirmed') {
        const kind = receipt.intent_id.startsWith('staging') ? 'staging' : 'production';
        intents.set(kind, { ...intents.get(kind), confirmed_receipt: `${kind}-receipt` });
      }
      return receipt;
    }),
  };
  const resolveArtifactVersions = vi.fn(async () => artifacts);
  const observeStaging = vi.fn()
    .mockResolvedValueOnce({ status: 'not_applied' })
    .mockResolvedValueOnce(stagingPass());
  const runStaging = vi.fn(async ({ idempotency_key }) => {
    order.push(`effect:staging:${idempotency_key}`);
  });
  const observeProduction = vi.fn()
    .mockResolvedValueOnce({ status: 'not_applied' })
    .mockResolvedValueOnce(productionPass());
  const runProduction = vi.fn(async ({ idempotency_key }) => {
    order.push(`effect:production:${idempotency_key}`);
  });
  return {
    order,
    store,
    resolveArtifactVersions,
    observeStaging,
    runStaging,
    observeProduction,
    runProduction,
    getRelease: () => release,
    setRelease: (value) => { release = value; },
    ...overrides,
  };
}

describe('ReleaseRun executor', () => {
  it('holds one lease and advances exact states with intent-before-effect and observation-after-effect', async () => {
    const d = deps();
    const execute = createReleaseRunExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toEqual({
      status: 'DONE',
      release_state: 'production_verified',
      release_run_id: RELEASE_ID,
      merge_sha: MERGE_SHA,
    });

    expect(d.order).toEqual([
      'lease:acquire',
      'release:create',
      'state:staging_queued',
      'state:staging_running',
      'intent:staging',
      'effect:staging:staging-key',
      'receipt:staging-intent:confirmed',
      'state:staging_passed',
      'state:production_deploying',
      'intent:production',
      'effect:production:production-key',
      'receipt:production-intent:confirmed',
      'state:production_verified',
      'lease:release',
    ]);
    expect(d.observeStaging).toHaveBeenCalledTimes(2);
    expect(d.observeProduction).toHaveBeenCalledTimes(2);
  });

  it('recovers crash-after-effects from external truth without reissuing', async () => {
    const d = deps();
    d.observeStaging = vi.fn(async () => stagingPass());
    d.observeProduction = vi.fn(async () => productionPass());
    const execute = createReleaseRunExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'DONE',
      release_state: 'production_verified',
    });
    expect(d.runStaging).not.toHaveBeenCalled();
    expect(d.runProduction).not.toHaveBeenCalled();
    expect(d.order).toContain('receipt:staging-intent:confirmed');
    expect(d.order).toContain('receipt:production-intent:confirmed');
  });

  it.each(['skipped', 'idle', 'unknown', 'unavailable', 'fail'])(
    'blocks ambiguous staging %s without production or blind replay',
    async (status) => {
      const d = deps();
      d.observeStaging = vi.fn(async () => ({ status }));
      const execute = createReleaseRunExecutor(d);

      await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
        status: 'BLOCKED',
        release_state: 'staging_running',
      });
      expect(d.runStaging).not.toHaveBeenCalled();
      expect(d.runProduction).not.toHaveBeenCalled();
      expect(d.order).not.toContain('state:staging_passed');
    },
  );

  it('does not trust a successful production command without complete post-effect observation', async () => {
    const d = deps();
    d.observeProduction = vi.fn()
      .mockResolvedValueOnce({ status: 'not_applied' })
      .mockResolvedValueOnce(productionPass({ required_e2e: 'skipped' }));
    const execute = createReleaseRunExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'BLOCKED',
      release_state: 'production_deploying',
      detail: 'release_production_e2e_not_passed',
    });
    expect(d.runProduction).toHaveBeenCalledOnce();
    expect(d.order).not.toContain('state:production_verified');
  });

  it('fails closed before an effect when its adapter is absent', async () => {
    const d = deps({ runStaging: undefined });
    const execute = createReleaseRunExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'BLOCKED',
      detail: 'release_staging_adapter_unavailable',
    });
    expect(d.observeStaging).not.toHaveBeenCalled();
    expect(d.runProduction).not.toHaveBeenCalled();
  });

  it('returns an already verified ReleaseRun without resolving artifacts or effects', async () => {
    const d = deps();
    d.setRelease({
      id: RELEASE_ID,
      run_id: RUN_ID,
      task_id: TASK_ID,
      state: 'production_verified',
      source_head_sha: HEAD_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
    });
    const execute = createReleaseRunExecutor(d);

    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toEqual({
      status: 'DONE',
      release_state: 'production_verified',
      release_run_id: RELEASE_ID,
      merge_sha: MERGE_SHA,
    });
    expect(d.resolveArtifactVersions).not.toHaveBeenCalled();
    expect(d.observeStaging).not.toHaveBeenCalled();
    expect(d.observeProduction).not.toHaveBeenCalled();
    expect(d.order).toEqual(['lease:acquire', 'lease:release']);
  });

  it('blocks when server-owned artifact resolution is missing or empty', async () => {
    const d = deps({ resolveArtifactVersions: undefined });
    const execute = createReleaseRunExecutor(d);
    await expect(execute({ runId: RUN_ID, taskId: TASK_ID })).resolves.toMatchObject({
      status: 'BLOCKED',
      detail: 'release_artifact_resolver_unavailable',
    });

    const empty = deps();
    empty.resolveArtifactVersions.mockResolvedValueOnce([]);
    await expect(createReleaseRunExecutor(empty)({
      runId: RUN_ID,
      taskId: TASK_ID,
    })).resolves.toMatchObject({
      status: 'BLOCKED',
      detail: 'release_identity_artifact_versions_invalid',
    });
  });
});
