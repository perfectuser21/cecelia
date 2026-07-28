import { describe, expect, it, vi } from 'vitest';
import { createReleaseRunAdapters } from '../release-run-adapters.js';

const sha = 'b'.repeat(40);
const artifacts = [{ name: 'cecelia-source', version: '1.268.5', digest: `sha256:${'c'.repeat(64)}` }];
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
    const gitExecFile = vi.fn((args) => args[0] === 'show'
      ? JSON.stringify({ version: '1.268.5' })
      : 'exact immutable ls-tree');
    const adapters = createReleaseRunAdapters({ gitExecFile });
    const result = await adapters.resolveArtifactVersions({ merge_sha: sha });
    expect(gitExecFile).toHaveBeenCalledWith(['show', `${sha}:packages/brain/package.json`]);
    expect(gitExecFile).toHaveBeenCalledWith(['ls-tree', '-r', sha]);
    expect(result).toEqual([expect.objectContaining({
      name: 'cecelia-source',
      version: '1.268.5',
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    })]);
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
      }))
      .mockResolvedValueOnce(response({ ok: true, git_sha: sha }))
      .mockResolvedValueOnce(response({ ok: true, queue: {} }));
    const adapters = createReleaseRunAdapters({
      fetchFn,
      brainUrl: 'http://brain',
      readRollbackFile: () => 'current=prod-v2\nhistory=prod-v1\n',
    });
    await expect(adapters.observeProduction(request)).resolves.toMatchObject({
      status: 'pass',
      health: 'pass',
      required_e2e: 'pass',
      merge_sha: sha,
      deployed_versions: artifacts,
      rollback_metadata: { anchor: 'prod-v2', previous_version: 'prod-v1' },
    });
  });
});
