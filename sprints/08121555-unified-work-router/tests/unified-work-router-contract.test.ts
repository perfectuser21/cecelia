import { describe, it, expect } from 'vitest';

// TDD Red：这些稳定入口由本 Sprint 实现；测试先于生产代码提交并永久保留。
describe('Unified Work Router [BEHAVIOR]', () => {
  it('凭据 origin 归一化、日志脱敏且保护活跃 Kernel 工作区', async () => {
    const recovery = await import('../../../packages/brain/src/orchestrator/workspace-recovery.js');
    const credentialed = 'https://user:p%40ss@example.com/perfectuser21/cecelia.git';
    const plain = 'https://example.com/perfectuser21/cecelia.git';
    expect(recovery.canonicalizeOrigin(credentialed)).toBe(recovery.canonicalizeOrigin(plain));
    expect(recovery.redactOrigin(credentialed)).not.toMatch(/user|p%40ss/);
    expect(recovery.shouldPreserveHarnessWorkspace({ detached: true, activeKernelRun: true })).toBe(true);
  });

  it('原子创建 receipt 并只按四档正向映射', async () => {
    const router = await import('../../../packages/brain/src/work-router.js');
    const expected = new Map([
      ['new_capability', 'new-capability-v1'],
      ['capability_change', 'capability-change-v1'],
      ['bugfix', 'hotfix-v1'],
      ['parameter_only', 'parameter-only-v1'],
    ]);
    for (const [changeKind, profile] of expected) {
      expect(router.selectPipeline({ work_kind: 'coding_mutation', change_kind: changeKind }))
        .toMatchObject({ pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: profile });
    }
    expect(() => router.selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' })).toThrow('change_kind_required');
  });

  it('fresh Map 建立 Impact Contract 且异常 fail closed', async () => {
    const preflight = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    const ok = await preflight.evaluateMapImpactPreflight({ repo: 'perfectuser21/cecelia', baseline: 'abc', map: { freshness: 'fresh', revision: 'abc', scanner_version: '1' } });
    expect(ok).toMatchObject({ allowed: true, impact_contract_policy: 'required' });
    for (const freshness of ['missing', 'stale']) {
      await expect(preflight.evaluateMapImpactPreflight({ repo: 'perfectuser21/cecelia', baseline: 'abc', map: { freshness } }))
        .resolves.toMatchObject({ allowed: false, provider_attempt_created: false });
    }
  });

  it('有头无头动作闸与 Generator trust boundary', async () => {
    const guard = await import('../../../packages/brain/src/work-routing-guard.js');
    await expect(guard.validateMutationReceipt({ mutationCapable: true, receipt: null })).resolves.toMatchObject({ allowed: false, exit_code: 2 });
    expect(guard.generatorEnvironment(['HARNESS_CALLBACK_TOKEN', 'HARNESS_LEASE_OWNER', 'PATH']))
      .not.toEqual(expect.arrayContaining(['HARNESS_CALLBACK_TOKEN', 'HARNESS_LEASE_OWNER']));
  });
});
