import { describe, it, expect } from 'vitest';

describe('Unified Work Router [BEHAVIOR] contract', () => {
  it('归一化含凭据 origin 且不泄露 secret', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/harness-worktree-recovery.js');
    const secret = 'contract-secret';
    const normalized = mod.canonicalizeOrigin(`https://user:${secret}@github.com/perfectuser21/cecelia.git`);
    expect(normalized).toBe('github.com/perfectuser21/cecelia');
    expect(mod.redactOrigin(`https://user:${secret}@github.com/perfectuser21/cecelia.git`)).not.toContain(secret);
  });

  it('保护 active detached Kernel workspace', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/harness-worktree-recovery.js');
    expect(mod.shouldPreserveWorkspace({ activeRun: true, detachedHead: true })).toBe(true);
  });

  it('只接受四种 change_kind 正向映射', async () => {
    const { CHANGE_KINDS, selectPipeline } = await import('../../../packages/brain/src/work-router.js');
    expect([...CHANGE_KINDS]).toEqual(['new_capability', 'capability_change', 'bugfix', 'parameter_only']);
    expect(selectPipeline({ work_kind: 'coding_mutation', change_kind: 'new_capability' })).toMatchObject({ pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: 'new-capability-v1' });
    expect(() => selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' })).toThrow('change_kind_required');
  });

  it('coding mutation 强制 receipt 与 required Impact Contract', async () => {
    const { routeWork } = await import('../../../packages/brain/src/work-router.js');
    const decision = routeWork({ source: 'api', source_id: 'contract-red', title: 'modify code', mutation_intent: 'write', declared_change_kind: 'bugfix', repo_hint: 'perfectuser21/cecelia' }, { repositories: ['perfectuser21/cecelia'] });
    expect(decision).toMatchObject({ pipeline: 'harness', canonical_task_type: 'harness_initiative', impact_contract_required: true, repo: 'perfectuser21/cecelia' });
  });

  it('实现基线保持冻结且 HEAD 只需为其后代', async () => {
    const { routeWork } = await import('../../../packages/brain/src/work-router.js');
    const decision = routeWork({ source: 'api', source_id: 'baseline-red', title: 'modify code', mutation_intent: 'write', declared_change_kind: 'new_capability', repo_hint: 'perfectuser21/cecelia', implementation_baseline: '310ab9e704d4e3f866e6ce7beb25b79dd0f9d524', workspace_base_sha: 'fbd23565587125f852ae490b7114dbde75765cc8' }, { repositories: ['perfectuser21/cecelia'] });
    expect(decision.base_sha).toBe('310ab9e704d4e3f866e6ce7beb25b79dd0f9d524');
    expect(decision.base_sha).not.toBe('fbd23565587125f852ae490b7114dbde75765cc8');
  });

  it('Generator Provider 不获得发布与回调能力', async () => {
    const mod = await import('../../../packages/brain/src/orchestrator/generator-trust-boundary.js');
    const policy = mod.buildGeneratorPolicy({ baselineSha: '310ab9e704d4e3f866e6ce7beb25b79dd0f9d524' });
    expect(policy).toMatchObject({ pushAllowed: false, callbackAllowed: false, privileged: false });
  });
});

