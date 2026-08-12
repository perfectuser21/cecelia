import { describe, it, expect } from 'vitest';

describe('Unified Work Router contract [BEHAVIOR]', () => {
  it('credential-bearing origin canonicalization protects active Kernel workspace', async () => {
    const mod = await import('../../../packages/brain/src/harness-worktree.js');
    expect(mod.canonicalizeGitRemote).toBeTypeOf('function');
    expect(mod.redactGitRemote('https://x-access-token:secret@github.com/perfectuser21/cecelia.git')).not.toContain('secret');
    expect(mod.isProtectedKernelWorkspace).toBeTypeOf('function');
  });

  it('four change kinds map forward only through one router', async () => {
    const mod = await import('../../../packages/brain/src/work-router.js');
    expect(mod.CHANGE_KINDS).toEqual(['new_capability', 'capability_change', 'bugfix', 'parameter_only']);
    expect(() => mod.selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' })).toThrow('change_kind_required');
  });

  it('coding run requires Map and Impact Contract before Provider creation', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    expect(mod.assertMapImpactContract).toBeTypeOf('function');
  });

  it('frozen baseline is an ancestor, not final HEAD', async () => {
    const source = await import('node:fs').then(fs => fs.readFileSync('docker/cecelia-runner/entrypoint.sh', 'utf8'));
    expect(source).toContain('merge-base --is-ancestor');
    expect(source).not.toContain('test "$(git rev-parse HEAD)" = "$BASELINE_SHA"');
  });

  it('Generator trust boundary removes privileged channels', async () => {
    const source = await import('node:fs').then(fs => fs.readFileSync('docker/cecelia-runner/entrypoint.sh', 'utf8'));
    for (const key of ['HARNESS_CALLBACK_TOKEN', 'HARNESS_LEASE_OWNER', 'HARNESS_LEASE_GENERATION']) {
      expect(source).toContain(`-u ${key}`);
    }
    expect(source).toContain('remote.origin.pushurl');
    expect(source).toContain('setpriv');
  });
});
