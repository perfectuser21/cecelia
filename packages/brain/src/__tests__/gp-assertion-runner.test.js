import { describe, expect, it, vi } from 'vitest';
import { runGpAssertion } from '../gp-assertion-runner.js';

const RUN = '11111111-1111-4111-8111-111111111111';
const LINK = '22222222-2222-4222-8222-222222222222';
const SHA = 'c'.repeat(40);
const DIGEST = `sha256:${'a'.repeat(64)}`;
const FILE_DIGEST = `sha256:${'f'.repeat(64)}`;
const TOOLCHAIN_PATHS = ['/usr/local/bin/node', '/repo/vitest.mjs'];
const command = {
  executable: '/usr/local/bin/node',
  argv: ['/repo/vitest.mjs', 'run', './cell.test.js', '--'],
  options: {
    cwd: '/repo/packages/brain',
    evidenceKind: 'vitest',
    toolchain_paths: TOOLCHAIN_PATHS,
  },
};

function harness(patch = {}) {
  const query = vi.fn(async () => ({ rows: [] }));
  const client = { query, release: vi.fn() };
  const saved = [];
  const admission = {
    machine_id: 'us-mac-m4', state: 'base_admitted',
    base_admitted: true, dispatch_ready: true,
    observed_at: '2026-07-30T08:00:00.000Z',
  };
  const receipt = request => ({
    schema_version: 'gp-assertion-execution/v1',
    run_id: RUN, journey_step_link_id: LINK, machine_id: 'us-mac-m4',
    runner_image_digest: DIGEST, source_repo: 'github.com/org/repo',
    source_sha: SHA, command_digest: request.command_digest,
    isolation: {
      rootfs_read_only: true,
      workspace_read_only: true,
      non_root: true,
    },
    toolchain_attestation: {
      kind: 'pinned_toolchain',
      actual_runner_digest: DIGEST,
      expected_runner_digest: DIGEST,
      files: TOOLCHAIN_PATHS.map(path => ({ path, sha256: FILE_DIGEST })),
    },
    exit_code: 0, stdout: '1 passed', stderr: '',
    started_at: '2026-07-30T08:00:01.000Z',
    completed_at: '2026-07-30T08:00:02.000Z',
  });
  const deps = {
    pool: { connect: vi.fn(async () => client) },
    linkId: LINK, runId: RUN, repoRoot: '/repo',
    trustedExecute: vi.fn(async request => receipt(request)),
    getMachineId: vi.fn(async () => 'us-mac-m4'),
    getNodeProfile: vi.fn(() => ({ runner_image_digest: DIGEST })),
    admissionClient: { getAdmission: vi.fn(async () => admission) },
    checkReadiness: vi.fn(async () => ({ ready: true })),
    loadAssertionCell: vi.fn(async () => ({
      id: LINK, journey_id: 'journey-1', assertion_ref: 'cell.test.js',
      assertion_revision: 1,
    })),
    findExistingReceipt: vi.fn(async () => null),
    persistReceipt: vi.fn(async draft => {
      saved.push(draft);
      return { id: 'receipt-1', ...draft };
    }),
    getSignedContract: vi.fn(async () => ({ hasHistory: false, signed: null })),
    buildCommand: vi.fn(async () => command),
    getSourceSha: vi.fn(async () => SHA),
    getSourceRepo: vi.fn(async () => 'github.com/org/repo'),
    isRepoClean: vi.fn(async () => true),
    ...patch,
  };
  return { deps, saved, admission };
}

describe('GP assertion trusted runner', () => {
  it('fails before DB/git/process when no trusted executor exists', async () => {
    const localExecute = vi.fn();
    const { deps } = harness({ trustedExecute: undefined, execute: localExecute });
    await expect(runGpAssertion(deps)).rejects.toMatchObject({
      code: 'ASSERTION_TRUSTED_RUNNER_UNAVAILABLE',
    });
    expect(deps.pool.connect).not.toHaveBeenCalled();
    expect(deps.getSourceSha).not.toHaveBeenCalled();
    expect(localExecute).not.toHaveBeenCalled();
  });

  it('requires a fresh admitted Fleet node before reading the ledger', async () => {
    const { deps, admission } = harness();
    admission.state = 'draining';
    admission.base_admitted = false;
    await expect(runGpAssertion(deps)).rejects.toMatchObject({
      code: 'ASSERTION_RUNNER_NOT_ADMITTED',
    });
    expect(deps.admissionClient.getAdmission)
      .toHaveBeenCalledWith('us-mac-m4', { forceFresh: true });
    expect(deps.pool.connect).not.toHaveBeenCalled();
    expect(deps.trustedExecute).not.toHaveBeenCalled();
  });

  it('resolves the default Fleet identity from canonical environment state', async () => {
    const previous = process.env.CECELIA_MACHINE_ID;
    process.env.CECELIA_MACHINE_ID = 'xian-mac-m4';
    try {
      const { deps } = harness({
        getMachineId: undefined,
        admissionClient: {
          getAdmission: vi.fn(async machineId => ({
            machine_id: machineId, state: 'draining',
            base_admitted: false, dispatch_ready: false,
          })),
        },
      });
      await expect(runGpAssertion(deps)).rejects.toMatchObject({
        code: 'ASSERTION_RUNNER_NOT_ADMITTED',
      });
      expect(deps.admissionClient.getAdmission).toHaveBeenCalledWith(
        'xian-mac-m4',
        { forceFresh: true },
      );
    } finally {
      if (previous === undefined) delete process.env.CECELIA_MACHINE_ID;
      else process.env.CECELIA_MACHINE_ID = previous;
    }
  });

  it('fails closed when canonical machine identity is missing', async () => {
    const previous = process.env.CECELIA_MACHINE_ID;
    delete process.env.CECELIA_MACHINE_ID;
    try {
      const { deps } = harness({ getMachineId: undefined });
      await expect(runGpAssertion(deps)).rejects.toMatchObject({
        code: 'ASSERTION_RUNNER_NOT_ADMITTED',
      });
      expect(deps.admissionClient.getAdmission).not.toHaveBeenCalled();
      expect(deps.pool.connect).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env.CECELIA_MACHINE_ID = previous;
    }
  });

  it('persists only receipt-bound output evidence and Runner times', async () => {
    const { deps, saved } = harness();
    const result = await runGpAssertion(deps);
    expect(result.status).toBe('recorded');
    expect(saved[0]).toMatchObject({
      scenario_count: 1,
      started_at: '2026-07-30T08:00:01.000Z',
      completed_at: '2026-07-30T08:00:02.000Z',
      machine_id: 'us-mac-m4',
      scenario_evidence: {
        kind: 'vitest',
        trusted_execution: { runner_image_digest: DIGEST },
      },
    });
    expect(deps.trustedExecute.mock.calls[0][0]).toMatchObject({
      expected_runner_digest: DIGEST, source_sha: SHA,
    });
  });

  it('rejects a PASS with zero output-derived scenarios', async () => {
    const base = harness();
    base.deps.trustedExecute = vi.fn(async request => ({
      schema_version: 'gp-assertion-execution/v1',
      run_id: RUN, journey_step_link_id: LINK, machine_id: 'us-mac-m4',
      runner_image_digest: DIGEST, source_repo: 'github.com/org/repo',
      source_sha: SHA, command_digest: request.command_digest,
      isolation: {
        rootfs_read_only: true,
        workspace_read_only: true,
        non_root: true,
      },
      toolchain_attestation: {
        kind: 'pinned_toolchain',
        actual_runner_digest: DIGEST,
        expected_runner_digest: DIGEST,
        files: TOOLCHAIN_PATHS.map(path => ({ path, sha256: FILE_DIGEST })),
      },
      exit_code: 0, stdout: '0 passed', stderr: '',
      started_at: '2026-07-30T08:00:01.000Z',
      completed_at: '2026-07-30T08:00:02.000Z',
    }));
    await expect(runGpAssertion(base.deps)).rejects.toMatchObject({
      code: 'ASSERTION_ZERO_SCENARIOS',
    });
    expect(base.saved).toHaveLength(0);
  });
});
