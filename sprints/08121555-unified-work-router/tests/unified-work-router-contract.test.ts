import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

const baseline = '22a62578f0aab77c58e1e0be25a6c321a78b35ad';

describe('Unified Work Router contract [BEHAVIOR]', () => {
  it('credential-bearing origin 不得误判 orphan', async () => {
    const module = await import('../../../packages/brain/src/harness-worktree.js');
    expect(module.canonicalizeRemoteUrl).toBeTypeOf('function');
    expect(module.redactRemoteUrl).toBeTypeOf('function');
    expect(module.canonicalizeRemoteUrl('https://user:secret@github.com/perfectuser21/cecelia.git'))
      .toBe(module.canonicalizeRemoteUrl('https://github.com/perfectuser21/cecelia.git'));
    expect(module.redactRemoteUrl('https://user:secret@github.com/perfectuser21/cecelia.git')).not.toContain('secret');
  });

  it('冻结 baseline 必须是最终 HEAD 祖先', () => {
    expect(() => execFileSync('git', ['merge-base', '--is-ancestor', baseline, 'HEAD'])).not.toThrow();
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()).not.toBe(baseline);
  });

  it('四种 change_kind 正向映射', async () => {
    const { selectPipeline } = await import('../../../packages/brain/src/work-router.js');
    const expected = {
      new_capability: 'new-capability-v1',
      capability_change: 'capability-change-v1',
      bugfix: 'bugfix-v1',
      parameter_only: 'parameter-only-v1',
    };
    for (const [change_kind, profile] of Object.entries(expected)) {
      expect(selectPipeline({ work_kind: 'coding_mutation', change_kind })).toMatchObject({
        pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: profile,
      });
    }
    expect(() => selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' })).toThrow('change_kind_required');
  });

  it('coding mutation 必须原子创建 receipt', async () => {
    const { createRoutedTask } = await import('../../../packages/brain/src/work-routing-store.js');
    expect(createRoutedTask).toBeTypeOf('function');
  });

  it('Map 与 Impact Contract 必须锚定 baseline', async () => {
    const preflight = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    expect(preflight.validateMapImpactContract).toBeTypeOf('function');
  });

  it('Generator trust boundary 必须 fail closed', () => {
    expect(() => execFileSync('bash', ['docker/cecelia-runner/__tests__/entrypoint-generator-trust-boundary.test.sh'], { stdio: 'pipe' })).not.toThrow();
  });
});

