import { describe, expect, it, vi } from 'vitest';
import { createReleaseRunAdapters } from '../release-run-adapters.js';

const sha = 'b'.repeat(40);
const deployedImage = `sha256:${'d'.repeat(64)}`;
const rollbackImage = `sha256:${'e'.repeat(64)}`;
const rollbackTag = `cecelia-brain:rollback-${'e'.repeat(12)}`;
const rollbackCommand = `BRAIN_VERSION=rollback-${'e'.repeat(12)} docker compose -f docker-compose.yml up -d`;
const artifacts = [{ name: 'brain', version: '1.268.5', digest: `sha256:${'c'.repeat(64)}` }];
const request = {
  release_run_id: '44444444-4444-4444-8444-444444444444',
  merge_sha: sha,
  idempotency_key: '55555555-5555-4555-8555-555555555555',
  artifact_versions: artifacts,
};

function response(body) {
  return { ok: true, json: vi.fn(async () => body) };
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

  it('observes exact production health, E2E and rollback evidence', async () => {
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
      .mockResolvedValueOnce(response({ ok: true, queue: {} }));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      brainUrl: 'http://brain',
    });
    await expect(adapters.observeProduction(request)).resolves.toMatchObject({
      status: 'pass',
      health: 'pass',
      required_e2e: 'pass',
      merge_sha: sha,
      deployed_versions: artifacts,
      rollback_metadata: {
        anchor: `brain-image:${deployedImage}`,
        previous_version: `brain-image:${rollbackImage}`,
        image_reference: rollbackImage,
        image_tag: rollbackTag,
        rollback_command: rollbackCommand,
        probe: 'pass',
      },
    });
  });

  it('rejects healthy production without a fresh exact E2E receipt', async () => {
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
    const adapters = createReleaseRunAdapters({ fetchFn, brainUrl: 'http://brain' });
    await expect(adapters.observeProduction(request)).resolves.toEqual({ status: 'fail' });
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
    const adapters = createReleaseRunAdapters({ fetchFn, brainUrl: 'http://brain' });
    await expect(adapters.observeProduction(request)).resolves.toEqual({ status: 'fail' });
  });
});
