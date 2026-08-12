import { describe, it, expect } from 'vitest';

describe('Unified Work Router 合同 [BEHAVIOR]', () => {
  it('四档 change_kind 只作正向映射', async () => {
    const { selectPipeline } = await import('../../../packages/brain/src/work-router.js');
    expect(selectPipeline({ work_kind: 'coding_mutation', change_kind: 'new_capability' }))
      .toMatchObject({ pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: 'new-capability-v1' });
    expect(() => selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' }))
      .toThrow('change_kind_required');
  });

  it('credential-bearing origin 归一化且日志脱敏', async () => {
    const { canonicalizeRepositoryOrigin, redactRepositoryOrigin } = await import('../../../packages/brain/src/orchestrator/workspace-origin.js');
    const secret = 'ghp_contract_secret';
    expect(canonicalizeRepositoryOrigin(`https://user:${secret}@github.com/perfectuser21/cecelia.git`))
      .toBe(canonicalizeRepositoryOrigin('https://github.com/perfectuser21/cecelia.git'));
    expect(redactRepositoryOrigin(`https://user:${secret}@github.com/perfectuser21/cecelia.git`)).not.toContain(secret);
  });

  it('stale Map 在 Provider 前失败关闭', async () => {
    const { evaluateMapImpactPreflight } = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    expect(evaluateMapImpactPreflight({ freshness: 'stale', repo: 'perfectuser21/cecelia', baselineRevision: 'a', sourceRevision: 'a' }))
      .toMatchObject({ ok: false, reason_code: 'map_stale', provider_attempt_created: false });
  });

  it('Generator 环境剥离 callback 与 lease 凭据', async () => {
    const fs = await import('node:fs');
    const entrypoint = fs.readFileSync('docker/cecelia-runner/entrypoint.sh', 'utf8');
    for (const key of ['BRAIN_URL', 'HARNESS_CALLBACK_URL', 'HARNESS_CALLBACK_TOKEN', 'HARNESS_LEASE_OWNER', 'HARNESS_LEASE_GENERATION']) {
      expect(entrypoint).toContain(`-u ${key}`);
    }
  });
});

