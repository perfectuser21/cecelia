import { describe, expect, it, vi } from 'vitest';
import {
  createRequiredE2EManifest,
  executeRequiredE2EManifest,
  validateRequiredE2EManifest,
} from '../release-run-e2e.js';

const RELEASE_RUN_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const CONTRACT_ID = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';
const MERGE_SHA = 'b'.repeat(40);
const APPROVED_AT = '2026-07-28T06:00:00.000Z';
const artifacts = [{
  name: 'brain',
  version: '1.268.5',
  digest: `sha256:${'c'.repeat(64)}`,
}];
const acceptance = {
  scenarios: [{
    name: 'exact contract behavior',
    covered_tasks: [TASK_ID],
    commands: [{
      type: 'probe',
      id: 'brain.health',
    }],
  }],
};

function manifest() {
  return createRequiredE2EManifest({
    release_run_id: RELEASE_RUN_ID,
    run_id: RUN_ID,
    repository: 'perfectuser21/cecelia',
    merge_sha: MERGE_SHA,
    artifact_versions: artifacts,
    contract: {
      id: CONTRACT_ID,
      version: 3,
      approved_at: APPROVED_AT,
      contract_content: '# frozen approved contract',
      e2e_acceptance: acceptance,
    },
  });
}

function expectedAuthority() {
  const value = manifest();
  return {
    release_run_id: RELEASE_RUN_ID,
    run_id: RUN_ID,
    repository: 'perfectuser21/cecelia',
    merge_sha: MERGE_SHA,
    artifact_versions: artifacts,
    contract_id: CONTRACT_ID,
    contract_version: 3,
    contract_approved_at: APPROVED_AT,
    contract_digest: value.contract_digest,
    e2e_acceptance_digest: value.e2e_acceptance_digest,
  };
}

describe('required ReleaseRun contract E2E manifest', () => {
  it('freezes approved contract, repository, artifacts, and exact merge identity', () => {
    expect(manifest()).toEqual({
      policy_version: 'kernel-release-e2e/v2',
      release_run_id: RELEASE_RUN_ID,
      run_id: RUN_ID,
      repository: 'perfectuser21/cecelia',
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
      artifact_set_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      contract_id: CONTRACT_ID,
      contract_version: 3,
      contract_approved_at: APPROVED_AT,
      contract_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      e2e_acceptance: acceptance,
      e2e_acceptance_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      scenarios_total: 1,
      manifest_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it.each([
    ['missing scenarios', { e2e_acceptance: { scenarios: [] } }],
    ['wrong merge SHA', { merge_sha: 'c'.repeat(40) }],
    ['wrong repository', { repository: 'attacker/repo' }],
    ['wrong contract version', { contract_version: 4 }],
    ['stale approval', { contract_approved_at: '2026-07-27T06:00:00.000Z' }],
    ['mutated contract', { contract_digest: `sha256:${'d'.repeat(64)}` }],
    ['mutated acceptance', { e2e_acceptance_digest: `sha256:${'d'.repeat(64)}` }],
    ['wrong artifacts', {
      artifact_versions: [{ ...artifacts[0], digest: `sha256:${'d'.repeat(64)}` }],
    }],
    ['wrong digest', { manifest_digest: `sha256:${'0'.repeat(64)}` }],
    ['extra field', { caller_override: true }],
  ])('rejects a persisted manifest with %s', (_label, override) => {
    expect(() => validateRequiredE2EManifest(
      { ...manifest(), ...override },
      expectedAuthority(),
    )).toThrow(/release_e2e_manifest_/);
  });

  it.each([
    ['unsupported command type', {
      ...acceptance,
      scenarios: [{
        ...acceptance.scenarios[0],
        commands: [{ type: 'bash', cmd: 'curl "$RELEASE_E2E_TARGET_URL"' }],
      }],
    }],
    ['arbitrary shell injection', {
      ...acceptance,
      scenarios: [{
        ...acceptance.scenarios[0],
        commands: [{ type: 'bash', cmd: 'curl localhost; rm -rf /tmp/release' }],
      }],
    }],
    ['duplicate covered task', {
      ...acceptance,
      scenarios: [{
        ...acceptance.scenarios[0],
        covered_tasks: [TASK_ID, TASK_ID],
      }],
    }],
    ['scenario extra field', {
      scenarios: [{ ...acceptance.scenarios[0], caller_override: true }],
    }],
    ['command extra field', {
      scenarios: [{
        ...acceptance.scenarios[0],
        commands: [{ ...acceptance.scenarios[0].commands[0], env: { TOKEN: 'x' } }],
      }],
    }],
    ['command without target semantics', {
      scenarios: [{
        ...acceptance.scenarios[0],
        commands: [{ type: 'probe', id: 'unregistered.command' }],
      }],
    }],
  ])('rejects %s', (_label, e2eAcceptance) => {
    expect(() => createRequiredE2EManifest({
      release_run_id: RELEASE_RUN_ID,
      run_id: RUN_ID,
      repository: 'perfectuser21/cecelia',
      merge_sha: MERGE_SHA,
      artifact_versions: artifacts,
      contract: {
        id: CONTRACT_ID,
        version: 3,
        approved_at: APPROVED_AT,
        contract_content: '# frozen approved contract',
        e2e_acceptance: e2eAcceptance,
      },
    })).toThrow(/release_e2e_manifest_/);
  });

  it('runs only the registered server probe and returns environment-bound evidence', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        status: 'healthy',
        version: artifacts[0].version,
        git_sha: MERGE_SHA,
      }),
    }));
    const times = [
      new Date('2026-07-28T06:01:00.000Z'),
      new Date('2026-07-28T06:01:01.000Z'),
    ];

    await expect(executeRequiredE2EManifest(manifest(), {
      environment: 'staging',
      artifact_readback: artifacts,
      fetchFn,
      endpoints: {
        brain: 'http://staging:5222',
        dashboard: 'http://dashboard-staging:5211',
      },
      now: () => times.shift(),
    })).resolves.toEqual({
      status: 'pass',
      environment: 'staging',
      merge_sha: MERGE_SHA,
      manifest_digest: manifest().manifest_digest,
      artifact_readback: artifacts,
      scenarios_total: 1,
      scenarios_passed: 1,
      scenario_results: [{
        name: 'exact contract behavior',
        status: 'pass',
        started_at: '2026-07-28T06:01:00.000Z',
        finished_at: '2026-07-28T06:01:01.000Z',
        log_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }],
      probe_results: [{
        scenario_name: 'exact contract behavior',
        probe_id: 'brain.health',
        status: 'pass',
        observation_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }],
      started_at: '2026-07-28T06:01:00.000Z',
      finished_at: '2026-07-28T06:01:01.000Z',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(
      'http://staging:5222/api/brain/health',
    );
  });

  it('fails closed when a registered probe fails', async () => {
    await expect(executeRequiredE2EManifest(manifest(), {
      environment: 'production',
      artifact_readback: artifacts,
      fetchFn: vi.fn(async () => ({ ok: false, status: 503 })),
      endpoints: {
        brain: 'http://brain:5221',
        dashboard: 'http://dashboard:5211',
      },
    })).rejects.toThrow(/release_e2e_execution_not_passed/);
  });

  it.each([
    ['unknown environment', { environment: 'preview', artifact_readback: artifacts }],
    ['wrong artifact readback', {
      environment: 'production',
      artifact_readback: [{ ...artifacts[0], digest: `sha256:${'d'.repeat(64)}` }],
    }],
  ])('fails closed on %s', async (_label, options) => {
    await expect(executeRequiredE2EManifest(manifest(), {
      fetchFn: vi.fn(),
      endpoints: {
        brain: 'http://brain:5221',
        dashboard: 'http://dashboard:5211',
      },
      ...options,
    })).rejects.toThrow(/release_e2e_execution_/);
  });
});
