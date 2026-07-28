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
      type: 'bash',
      cmd: 'curl -fsS "$RELEASE_E2E_TARGET_URL/api/brain/health"',
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
      policy_version: 'kernel-release-e2e/v1',
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
        commands: [{ type: 'powershell', cmd: 'curl "$RELEASE_E2E_TARGET_URL"' }],
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
        commands: [{ type: 'bash', cmd: 'true' }],
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

  it('returns environment-bound per-scenario evidence and exact artifact readback', () => {
    const runScenarios = vi.fn(() => ({
      verdict: 'PASS',
      scenariosTotal: 1,
      scenariosPassed: 1,
      failedScenarios: [],
      scenarioResults: [{
        name: 'exact contract behavior',
        status: 'pass',
        started_at: '2026-07-28T06:01:00.000Z',
        finished_at: '2026-07-28T06:01:01.000Z',
        log_digest: `sha256:${'f'.repeat(64)}`,
      }],
    }));

    expect(executeRequiredE2EManifest(manifest(), {
      runScenarios,
      environment: 'staging',
      artifact_readback: artifacts,
      runnerOptions: { host: 'localhost', port: 5222 },
    })).toEqual({
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
        log_digest: `sha256:${'f'.repeat(64)}`,
      }],
      started_at: '2026-07-28T06:01:00.000Z',
      finished_at: '2026-07-28T06:01:01.000Z',
    });
    expect(runScenarios).toHaveBeenCalledWith(acceptance, {
      host: 'localhost',
      port: 5222,
      releaseEnvironment: 'staging',
    });
  });

  it.each([
    ['FAIL', 1, 0, []],
    ['SKIP', 1, 0, []],
    ['PASS', 0, 0, []],
    ['PASS', 1, 0, []],
    ['PASS', 1, 1, []],
    ['PASS', 1, 1, [{
      name: 'exact contract behavior',
      status: 'pass',
      started_at: 'not-a-time',
      finished_at: '2026-07-28T06:01:01.000Z',
      log_digest: `sha256:${'f'.repeat(64)}`,
    }]],
  ])('fails closed on verdict=%s total=%i passed=%i or invalid detail', (
    verdict,
    scenariosTotal,
    scenariosPassed,
    scenarioResults,
  ) => {
    const runScenarios = vi.fn(() => ({
      verdict,
      scenariosTotal,
      scenariosPassed,
      failedScenarios: [],
      scenarioResults,
    }));
    expect(() => executeRequiredE2EManifest(manifest(), {
      runScenarios,
      environment: 'production',
      artifact_readback: artifacts,
    })).toThrow(/release_e2e_execution_not_passed/);
  });

  it.each([
    ['unknown environment', { environment: 'preview', artifact_readback: artifacts }],
    ['wrong artifact readback', {
      environment: 'production',
      artifact_readback: [{ ...artifacts[0], digest: `sha256:${'d'.repeat(64)}` }],
    }],
  ])('fails closed on %s', (_label, options) => {
    expect(() => executeRequiredE2EManifest(manifest(), {
      runScenarios: () => ({
        verdict: 'PASS',
        scenariosTotal: 1,
        scenariosPassed: 1,
        scenarioResults: [{
          name: 'exact contract behavior',
          status: 'pass',
          started_at: '2026-07-28T06:01:00.000Z',
          finished_at: '2026-07-28T06:01:01.000Z',
          log_digest: `sha256:${'f'.repeat(64)}`,
        }],
      }),
      ...options,
    })).toThrow(/release_e2e_execution_/);
  });
});
