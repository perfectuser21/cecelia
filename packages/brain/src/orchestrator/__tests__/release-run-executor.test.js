import { describe, expect, it, vi } from 'vitest';

import { createReleaseRunExecutor } from '../release-run-executor.js';
import { createRequiredE2EManifest } from '../release-run-e2e.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '22222222-2222-4222-8222-222222222222';
const RELEASE_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = '66666666-6666-4666-8666-666666666666';
const MANIFEST_ID = '77777777-7777-4777-8777-777777777777';
const HEAD_SHA = 'a'.repeat(40);
const MERGE_SHA = 'b'.repeat(40);
const APPROVED_AT = '2026-07-28T06:00:00.000Z';
const artifacts = [
  { name: 'brain', version: '1.268.2', digest: `sha256:${'1'.repeat(64)}` },
];
const e2eManifest = {
  id: MANIFEST_ID,
  ...createRequiredE2EManifest({
    release_run_id: RELEASE_ID,
    run_id: RUN_ID,
    repository: 'perfectuser21/cecelia',
    merge_sha: MERGE_SHA,
    artifact_versions: artifacts,
    contract: {
      id: CONTRACT_ID,
      version: 3,
      approved_at: APPROVED_AT,
      contract_content: '# frozen approved contract',
      e2e_acceptance: {
        scenarios: [{
          name: 'release behavior',
          covered_tasks: [TASK_ID],
          commands: [{ type: 'probe', id: 'brain.health' }],
        }],
      },
    },
  }),
};

function e2eEvidence(environment) {
  return {
    dispatch_claim_id: environment === 'staging' ? 21 : 31,
    dispatch_generation: environment === 'staging' ? 3 : 5,
    required_e2e: 'pass',
    e2e_manifest_digest: e2eManifest.manifest_digest,
    e2e_environment: environment,
    e2e_scenarios_total: 1,
    e2e_scenarios_passed: 1,
    e2e_scenario_results: [{
      name: 'release behavior',
      status: 'pass',
      started_at: '2026-07-28T06:01:00.000Z',
      finished_at: '2026-07-28T06:01:01.000Z',
      log_digest: `sha256:${'f'.repeat(64)}`,
    }],
    e2e_probe_results: [{
      scenario_name: 'release behavior',
      probe_id: 'brain.health',
      status: 'pass',
      observation_digest: `sha256:${'9'.repeat(64)}`,
    }],
    e2e_started_at: '2026-07-28T06:01:00.000Z',
    e2e_finished_at: '2026-07-28T06:01:01.000Z',
    e2e_artifact_readback: artifacts,
  };
}

function stagingPass(overrides = {}) {
  return {
    status: 'pass',
    ...e2eEvidence('staging'),
    merge_sha: MERGE_SHA,
    artifact_versions: artifacts,
    ...overrides,
  };
}

function productionPass(overrides = {}) {
  return {
    status: 'pass',
    health: 'pass',
    ...e2eEvidence('production'),
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
      release = {
        id: RELEASE_ID,
        state: 'merged',
        ...identity,
        e2e_manifest: e2eManifest,
      };
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
      const receiptId = `${receipt.intent_id}-receipt`;
      if (receipt.receipt_status === 'confirmed') {
        const kind = receipt.intent_id.startsWith('staging') ? 'staging' : 'production';
        intents.set(kind, { ...intents.get(kind), confirmed_receipt: receiptId });
      }
      return { id: receiptId, ...receipt };
    }),
    findOrCreateRollbackIntent: vi.fn(async (_client, { releaseRun }) => {
      order.push('rollback:intent');
      return {
        id: '88888888-8888-4888-8888-888888888888',
        release_run_id: releaseRun.id,
        expected_merge_sha: releaseRun.merge_sha,
        expected_artifact_versions: releaseRun.artifact_versions,
      };
    }),
    appendRollbackReceipt: vi.fn(async (_client, receipt) => {
      order.push('rollback:receipt');
      return {
        id: '99999999-9999-4999-8999-999999999999',
        ...receipt,
      };
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
      'rollback:intent',
      'state:production_deploying',
      'intent:production',
      'effect:production:production-key',
      'receipt:production-intent:confirmed',
      'rollback:receipt',
      'state:production_verified',
      'lease:release',
    ]);
    expect(d.observeStaging).toHaveBeenCalledTimes(2);
    expect(d.observeProduction).toHaveBeenCalledTimes(2);
    for (const adapter of [
      d.observeStaging,
      d.runStaging,
      d.observeProduction,
      d.runProduction,
    ]) {
      expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
        e2e_manifest: e2eManifest,
      }));
    }
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

  it('re-observes external truth after a confirmed receipt but before transition', async () => {
    const d = deps();
    d.setRelease({
      id: RELEASE_ID,
      run_id: RUN_ID,
      task_id: TASK_ID,
      state: 'staging_running',
      source_head_sha: HEAD_SHA,
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
      e2e_manifest: e2eManifest,
    });
    d.store.findOrCreateIntent.mockResolvedValueOnce({
      id: 'staging-intent',
      idempotency_key: 'staging-key',
      confirmed_receipt: 'old-receipt',
    });
    d.observeStaging = vi.fn(async () => stagingPass());

    await createReleaseRunExecutor(d)({ runId: RUN_ID, taskId: TASK_ID });

    expect(d.observeStaging).toHaveBeenCalledOnce();
    expect(d.runStaging).not.toHaveBeenCalled();
    expect(d.order).toContain('state:staging_passed');
  });

  it('persists complete production verification evidence', async () => {
    const d = deps();
    await createReleaseRunExecutor(d)({ runId: RUN_ID, taskId: TASK_ID });
    const receipt = d.store.appendReceipt.mock.calls
      .map((call) => call[1])
      .find((value) => value.intent_id === 'production-intent'
        && value.receipt_status === 'confirmed');
    expect(receipt.evidence.verification).toEqual({
      status: 'pass',
      health: 'pass',
      ...Object.fromEntries(
        Object.entries(e2eEvidence('production'))
          .filter(([key]) => !key.startsWith('dispatch_')),
      ),
      rollback_metadata: {
        anchor: 'prod-cecelia-v4401',
        previous_version: 'prod-cecelia-v4400',
      },
    });
    const transition = d.store.appendTransition.mock.calls
      .map((call) => call[1])
      .find((value) => value.state === 'production_verified');
    expect(transition.evidence.verification).toMatchObject({
      health: 'pass',
      required_e2e: 'pass',
      e2e_manifest_digest: e2eManifest.manifest_digest,
      e2e_environment: 'production',
      e2e_scenarios_total: 1,
      e2e_scenarios_passed: 1,
      e2e_scenario_results: expect.any(Array),
      e2e_probe_results: expect.any(Array),
      rollback_metadata: expect.any(Object),
    });
    expect(transition.evidence).toMatchObject({
      effect_receipt_id: 'production-intent-receipt',
      e2e_manifest_digest: e2eManifest.manifest_digest,
      rollback_receipt_id: '99999999-9999-4999-8999-999999999999',
    });
    expect(receipt).toMatchObject({
      dispatch_claim_id: 31,
      dispatch_generation: 5,
    });
  });

  it('durably records rollback intent before production and exact receipt after readback', async () => {
    const d = deps();
    await createReleaseRunExecutor(d)({ runId: RUN_ID, taskId: TASK_ID });

    expect(d.store.findOrCreateRollbackIntent).toHaveBeenCalledWith(
      expect.anything(),
      { releaseRun: expect.objectContaining({ id: RELEASE_ID }) },
    );
    expect(d.store.appendRollbackReceipt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        rollback_intent_id: '88888888-8888-4888-8888-888888888888',
        effect_receipt_id: 'production-intent-receipt',
        anchor: 'prod-cecelia-v4401',
        previous_version: 'prod-cecelia-v4400',
      }),
    );
    expect(d.order.indexOf('rollback:intent'))
      .toBeLessThan(d.order.indexOf('effect:production:production-key'));
    expect(d.order.indexOf('rollback:receipt'))
      .toBeGreaterThan(d.order.indexOf('receipt:production-intent:confirmed'));
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

  it('blocks a passing command whose E2E receipt has the wrong manifest digest', async () => {
    const d = deps();
    d.observeStaging = vi.fn()
      .mockResolvedValueOnce({ status: 'not_applied' })
      .mockResolvedValueOnce(stagingPass({
        e2e_manifest_digest: `sha256:${'f'.repeat(64)}`,
      }));
    await expect(createReleaseRunExecutor(d)({
      runId: RUN_ID,
      taskId: TASK_ID,
    })).resolves.toMatchObject({
      status: 'BLOCKED',
      detail: 'release_staging_e2e_manifest_mismatch',
    });
    expect(d.runProduction).not.toHaveBeenCalled();
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
      e2e_manifest: e2eManifest,
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
