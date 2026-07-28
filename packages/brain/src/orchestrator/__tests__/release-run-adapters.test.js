import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createReleaseRunAdapters } from '../release-run-adapters.js';
import { createRequiredE2EManifest } from '../release-run-e2e.js';

const sha = 'b'.repeat(40);
const deployedImage = `sha256:${'d'.repeat(64)}`;
const rollbackImage = `sha256:${'e'.repeat(64)}`;
const rollbackTag = `cecelia-brain:rollback-${'e'.repeat(12)}`;
const rollbackCommand = `BRAIN_VERSION=rollback-${'e'.repeat(12)} docker compose -f docker-compose.yml up -d`;
const verificationClaim = { dispatch_claim_id: 21, generation: 3 };
const artifacts = [{ name: 'brain', version: '1.268.5', digest: `sha256:${'c'.repeat(64)}` }];
const e2eManifest = {
  id: '66666666-6666-4666-8666-666666666666',
  ...createRequiredE2EManifest({
    release_run_id: '44444444-4444-4444-8444-444444444444',
    run_id: '77777777-7777-4777-8777-777777777777',
    repository: 'perfectuser21/cecelia',
    merge_sha: sha,
    artifact_versions: artifacts,
    contract: {
      id: '88888888-8888-4888-8888-888888888888',
      version: 3,
      approved_at: '2026-07-28T06:00:00.000Z',
      contract_content: '# frozen approved contract',
      e2e_acceptance: {
        scenarios: [{
          name: 'release behavior',
          covered_tasks: ['99999999-9999-4999-8999-999999999999'],
          commands: [{ type: 'probe', id: 'brain.health' }],
        }],
      },
    },
  }),
};
const request = {
  release_run_id: '44444444-4444-4444-8444-444444444444',
  merge_sha: sha,
  idempotency_key: '55555555-5555-4555-8555-555555555555',
  artifact_versions: artifacts,
  e2e_manifest: e2eManifest,
};

function response(body) {
  return {
    ok: true,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

function healthyProbeResponse() {
  return response({ status: 'healthy', version: '1.268.5', git_sha: sha });
}

describe('production ReleaseRun adapters', () => {
  it('resolves artifact identity from the exact merge tree', async () => {
    const gitExecFile = vi.fn((args) => {
      if (args[0] === 'show') return JSON.stringify({ version: '1.268.5' });
      if (args[0] === 'diff-tree') return 'packages/brain/src/x.js\n';
      return 'exact immutable ls-tree';
    });
    const adapters = createReleaseRunAdapters({ gitExecFile });
    const result = await adapters.resolveArtifactVersions({ merge_sha: sha });
    expect(gitExecFile).toHaveBeenCalledWith(['show', `${sha}:packages/brain/package.json`]);
    expect(gitExecFile).toHaveBeenCalledWith(['ls-tree', '-r', sha, 'packages/brain']);
    expect(result).toEqual([expect.objectContaining({
      name: 'brain',
      version: '1.268.5',
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })]);
  });

  it.each([
    ['apps/dashboard/src/x.ts', 'workspace', 'apps'],
    ['apps/api/src/x.ts', 'workspace', 'apps'],
    ['packages/workflows/skills/x/SKILL.md', 'workflow-skills', 'packages/workflows/skills'],
  ])('maps %s to its real deployable artifact', async (changedPath, name, treePath) => {
    const gitExecFile = vi.fn((args) => {
      if (args[0] === 'show') return JSON.stringify({ version: '1.268.5' });
      if (args[0] === 'diff-tree') return `${changedPath}\n`;
      return `immutable tree for ${treePath}`;
    });
    const adapters = createReleaseRunAdapters({ gitExecFile });
    await expect(adapters.resolveArtifactVersions({ merge_sha: sha })).resolves.toEqual([
      expect.objectContaining({ name, digest: expect.stringMatching(/^sha256:/) }),
    ]);
    expect(gitExecFile).toHaveBeenCalledWith(['ls-tree', '-r', sha, treePath]);
  });

  it('blocks changed paths without a ReleaseRun effect owner', async () => {
    const gitExecFile = vi.fn((args) => {
      if (args[0] === 'show') return JSON.stringify({ version: '1.268.5' });
      if (args[0] === 'diff-tree') return 'packages/engine/src/runner.js\n';
      return 'tree';
    });
    const adapters = createReleaseRunAdapters({ gitExecFile });
    await expect(adapters.resolveArtifactVersions({ merge_sha: sha }))
      .rejects.toThrow('release_non_deployable_change_blocked');
  });

  it('runs only the authorized exact-SHA deploy request', async () => {
    const fetchFn = vi.fn(async () => response({ status: 'accepted' }));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      deployToken: 'token',
      brainUrl: 'http://brain',
    });
    await adapters.runProduction(request);
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body).toMatchObject({
      staging: false,
      release_run_id: request.release_run_id,
      merge_sha: sha,
      release_authorization: request.idempotency_key,
      artifact_versions: artifacts,
    });
  });

  it('captures the exact Brain rollback baseline before production mutation', async () => {
    const fetchFn = vi.fn(async () => response({
      status: 'success',
      deployed_image_digest: rollbackImage,
    }));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      brainUrl: 'http://brain',
    });

    await expect(adapters.prepareProductionRollback(request)).resolves.toEqual([{
      artifact_name: 'brain',
      expected_current_version: artifacts[0].version,
      expected_current_digest: artifacts[0].digest,
      expected_anchor: `brain:${artifacts[0].digest}`,
      expected_previous_version: `brain-image:${rollbackImage}`,
      expected_previous_digest: rollbackImage,
    }]);
    expect(fetchFn).toHaveBeenCalledWith('http://brain/api/brain/deploy/status', undefined);
  });

  it('observes exact production health, E2E and rollback evidence', async () => {
    const e2eFetchFn = vi.fn(async () => healthyProbeResponse());
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response({
        status: 'success',
        release_run_id: request.release_run_id,
        merge_sha: sha,
        release_authorization: request.idempotency_key,
        deployed_image_digest: deployedImage,
        rollback_image_digest: rollbackImage,
        rollback_image_reference: rollbackImage,
        rollback_image_tag: rollbackTag,
        rollback_image_exists: true,
        rollback_probe: 'pass',
        rollback_command: rollbackCommand,
        deployed_artifact_versions: artifacts,
        e2e_receipt: {
          status: 'pass',
          merge_sha: sha,
          release_run_id: request.release_run_id,
          artifact_versions: artifacts,
          evidence_digest: `sha256:${'f'.repeat(64)}`,
        },
      }))
      .mockResolvedValueOnce(response({ status: 'healthy', version: '1.268.5', git_sha: sha }))
      .mockResolvedValueOnce(response({ ok: true, queue: {} }))
      .mockResolvedValueOnce(response(verificationClaim));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      e2eFetchFn,
      brainUrl: 'http://brain',
      deployToken: 'token',
    });
    await expect(adapters.observeProduction(request)).resolves.toMatchObject({
      status: 'pass',
      health: 'pass',
      required_e2e: 'pass',
      e2e_manifest_digest: e2eManifest.manifest_digest,
      e2e_environment: 'production',
      e2e_scenarios_total: 1,
      e2e_scenarios_passed: 1,
      e2e_scenario_results: [{
        name: 'release behavior',
        status: 'pass',
        started_at: expect.any(String),
        finished_at: expect.any(String),
        log_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }],
      e2e_artifact_readback: artifacts,
      merge_sha: sha,
      deployed_versions: artifacts,
      dispatch_claim_id: verificationClaim.dispatch_claim_id,
      dispatch_generation: verificationClaim.generation,
      rollback_metadata: {
        anchor: `brain:${artifacts[0].digest}`,
        previous_version: `brain-image:${rollbackImage}`,
        image_reference: rollbackImage,
        image_tag: rollbackTag,
        rollback_command: rollbackCommand,
        probe: 'pass',
      },
    });
    expect(e2eFetchFn).toHaveBeenCalledWith(
      'http://brain/api/brain/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses exact deploy status SHA for a workspace-only production receipt', async () => {
    const workspaceArtifact = {
      name: 'workspace',
      version: sha.slice(0, 12),
      digest: `sha256:${'7'.repeat(64)}`,
    };
    const workspaceManifest = {
      id: e2eManifest.id,
      ...createRequiredE2EManifest({
        release_run_id: request.release_run_id,
        run_id: e2eManifest.run_id,
        repository: e2eManifest.repository,
        merge_sha: sha,
        artifact_versions: [workspaceArtifact],
        contract: {
          id: e2eManifest.contract_id,
          version: e2eManifest.contract_version,
          approved_at: e2eManifest.contract_approved_at,
          contract_content: '# frozen approved contract',
          e2e_acceptance: e2eManifest.e2e_acceptance,
        },
      }),
    };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response({
        status: 'success',
        release_run_id: request.release_run_id,
        merge_sha: sha,
        deployed_artifact_versions: [workspaceArtifact],
        dashboard_rollback_metadata: JSON.parse(readFileSync(
          resolve(
            import.meta.dirname,
            'fixtures/dashboard-release-rollback-receipt.json',
          ),
          'utf8',
        )),
      }))
      .mockResolvedValueOnce(response({
        status: 'healthy',
        version: '1.268.5',
        git_sha: 'a'.repeat(40),
      }))
      .mockResolvedValueOnce(response({ ok: true, queue: {} }))
      .mockResolvedValueOnce(response({ git_sha: sha }))
      .mockResolvedValueOnce(response(verificationClaim));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      brainUrl: 'http://brain',
      dashboardUrl: 'http://dashboard',
      deployToken: 'token',
      e2eFetchFn: vi.fn(async () => healthyProbeResponse()),
    });

    await expect(adapters.observeProduction({
      ...request,
      artifact_versions: [workspaceArtifact],
      e2e_manifest: workspaceManifest,
    })).resolves.toMatchObject({
      status: 'pass',
      merge_sha: sha,
      deployed_versions: [workspaceArtifact],
      rollback_metadata: {
        anchor: `workspace:${workspaceArtifact.digest}`,
        previous_version: 'dashboard:prod-cecelia-v41',
      },
    });
  });

  it('rejects dashboard rollback metadata that does not name the exact old tag', async () => {
    const workspaceArtifact = {
      name: 'workspace',
      version: sha.slice(0, 12),
      digest: `sha256:${'7'.repeat(64)}`,
    };
    const workspaceManifest = {
      id: e2eManifest.id,
      ...createRequiredE2EManifest({
        release_run_id: request.release_run_id,
        run_id: e2eManifest.run_id,
        repository: e2eManifest.repository,
        merge_sha: sha,
        artifact_versions: [workspaceArtifact],
        contract: {
          id: e2eManifest.contract_id,
          version: e2eManifest.contract_version,
          approved_at: e2eManifest.contract_approved_at,
          contract_content: '# frozen approved contract',
          e2e_acceptance: e2eManifest.e2e_acceptance,
        },
      }),
    };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response({
        status: 'success',
        release_run_id: request.release_run_id,
        merge_sha: sha,
        deployed_artifact_versions: [workspaceArtifact],
        dashboard_rollback_metadata: {
          schema_version: 1,
          release_run_id: request.release_run_id,
          merge_sha: sha,
          artifact_name: 'workspace',
          old_tag: '',
          new_tag: 'prod-cecelia-v42',
          anchor: 'dashboard:prod-cecelia-v42',
          previous_version: 'dashboard:history-tail-guess',
          previous_digest: `sha256:${'6'.repeat(64)}`,
        },
      }))
      .mockResolvedValueOnce(response({
        status: 'healthy',
        version: '1.268.5',
        git_sha: 'a'.repeat(40),
      }))
      .mockResolvedValueOnce(response({ ok: true, queue: {} }))
      .mockResolvedValueOnce(response({ git_sha: sha }));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      brainUrl: 'http://brain',
      dashboardUrl: 'http://dashboard',
      deployToken: 'token',
      e2eFetchFn: vi.fn(async () => healthyProbeResponse()),
    });

    await expect(adapters.observeProduction({
      ...request,
      artifact_versions: [workspaceArtifact],
      e2e_manifest: workspaceManifest,
    })).resolves.toEqual({ status: 'fail' });
  });

  it('requires live Workflow Skills rollback readback for a routed artifact', async () => {
    const workflowArtifact = {
      name: 'workflow-skills',
      version: sha.slice(0, 12),
      digest: `sha256:${'9'.repeat(64)}`,
    };
    const mixedArtifacts = [...artifacts, workflowArtifact];
    const mixedManifest = {
      id: e2eManifest.id,
      ...createRequiredE2EManifest({
        release_run_id: request.release_run_id,
        run_id: e2eManifest.run_id,
        repository: e2eManifest.repository,
        merge_sha: sha,
        artifact_versions: mixedArtifacts,
        contract: {
          id: e2eManifest.contract_id,
          version: e2eManifest.contract_version,
          approved_at: e2eManifest.contract_approved_at,
          contract_content: '# frozen approved contract',
          e2e_acceptance: e2eManifest.e2e_acceptance,
        },
      }),
    };
    const mixedRequest = {
      ...request,
      artifact_versions: mixedArtifacts,
      e2e_manifest: mixedManifest,
    };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response({
        status: 'success',
        release_run_id: request.release_run_id,
        merge_sha: sha,
        deployed_image_digest: deployedImage,
        rollback_image_digest: rollbackImage,
        rollback_image_reference: rollbackImage,
        rollback_image_tag: rollbackTag,
        rollback_image_exists: true,
        rollback_probe: 'pass',
        rollback_command: rollbackCommand,
        deployed_artifact_versions: mixedArtifacts,
        workflow_rollback_metadata: {
          anchor: `workflow-skills:${workflowArtifact.digest}`,
          current_links_digest: `sha256:${'7'.repeat(64)}`,
          previous_version: `workflow-skills:sha256:${'8'.repeat(64)}`,
          previous_digest: `sha256:${'8'.repeat(64)}`,
        },
      }))
      .mockResolvedValueOnce(response({ status: 'healthy', version: '1.268.5', git_sha: sha }))
      .mockResolvedValueOnce(response({ ok: true, queue: {} }))
      .mockResolvedValueOnce(response(verificationClaim));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      e2eFetchFn: vi.fn(async () => healthyProbeResponse()),
      brainUrl: 'http://brain',
      deployToken: 'token',
    });
    await expect(adapters.observeProduction(mixedRequest)).resolves.toMatchObject({
      status: 'pass',
      rollback_metadata: {
        anchor: `brain:${artifacts[0].digest}+workflow-skills:${workflowArtifact.digest}`,
        previous_version:
          `brain-image:${rollbackImage}+workflow-skills:sha256:${'8'.repeat(64)}`,
      },
    });
  });

  it('rejects healthy production when the exact contract E2E fails', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response({
        status: 'success',
        release_run_id: request.release_run_id,
        merge_sha: sha,
        release_authorization: request.idempotency_key,
        deployed_image_digest: deployedImage,
        rollback_image_digest: rollbackImage,
        rollback_image_reference: rollbackImage,
        rollback_image_tag: rollbackTag,
        rollback_image_exists: true,
        rollback_probe: 'pass',
        rollback_command: rollbackCommand,
        deployed_artifact_versions: artifacts,
      }))
      .mockResolvedValueOnce(response({ status: 'healthy', version: '1.268.5', git_sha: sha }))
      .mockResolvedValueOnce(response({ ok: true }));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      e2eFetchFn: vi.fn(async () => ({ ok: false, status: 503 })),
      brainUrl: 'http://brain',
    });
    await expect(adapters.observeProduction(request)).resolves.toEqual({ status: 'fail' });
  });

  it('observes staging only after exact contract E2E runs against staging', async () => {
    const e2eFetchFn = vi.fn(async () => healthyProbeResponse());
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response({
        status: 'success',
        release_run_id: request.release_run_id,
        merge_sha: sha,
        release_authorization: request.idempotency_key,
        deployed_artifact_versions: artifacts,
      }))
      .mockResolvedValueOnce(response({
        status: 'healthy',
        version: '1.268.5',
        git_sha: sha,
      }))
      .mockResolvedValueOnce(response(verificationClaim));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      e2eFetchFn,
      brainUrl: 'http://brain',
      stagingUrl: 'http://staging',
      deployToken: 'token',
    });
    await expect(adapters.observeStaging(request)).resolves.toMatchObject({
      status: 'pass',
      required_e2e: 'pass',
      e2e_environment: 'staging',
      e2e_manifest_digest: e2eManifest.manifest_digest,
      e2e_scenarios_total: 1,
      e2e_scenarios_passed: 1,
      dispatch_claim_id: verificationClaim.dispatch_claim_id,
      dispatch_generation: verificationClaim.generation,
    });
    expect(e2eFetchFn).toHaveBeenCalledWith(
      'http://staging/api/brain/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects production evidence without a distinct recoverable image', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(response({
        status: 'success',
        release_run_id: request.release_run_id,
        merge_sha: sha,
        release_authorization: request.idempotency_key,
        deployed_image_digest: deployedImage,
        rollback_image_digest: deployedImage,
        rollback_image_reference: deployedImage,
        rollback_image_tag: `cecelia-brain:rollback-${'d'.repeat(12)}`,
        rollback_image_exists: true,
        rollback_probe: 'pass',
        rollback_command: `BRAIN_VERSION=rollback-${'d'.repeat(12)} docker compose -f docker-compose.yml up -d`,
      }))
      .mockResolvedValueOnce(response({ status: 'healthy', version: '1.268.5', git_sha: sha }))
      .mockResolvedValueOnce(response({ ok: true, queue: {} }));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      brainUrl: 'http://brain',
    });
    await expect(adapters.observeProduction(request)).resolves.toEqual({ status: 'fail' });
  });
});
