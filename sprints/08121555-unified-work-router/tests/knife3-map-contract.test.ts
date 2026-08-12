import { describe, it, expect } from 'vitest';

describe('Knife 3 Map/Impact Contract 与恢复合同', () => {
  it('fresh 同 repo Map 才放行且 map_recovery 只能单次窄化消费', async () => {
    const p = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    expect(await p.evaluateMapImpactPreflight({ repo:'perfectuser21/cecelia', baseline:'abc', map:{ repo:'perfectuser21/cecelia', freshness:'fresh', revision:'abc', scanner_version:'1' } })).toMatchObject({ allowed:true, impact_contract_policy:'required' });
    for (const map of [{freshness:'missing'},{freshness:'stale'},{freshness:'fresh',revision:'wrong'},{freshness:'fresh',revision:'abc',scanner_version:null},{freshness:'fresh',revision:'abc',scanner_version:'1',repo:'other/repo'}]) {
      expect(await p.evaluateMapImpactPreflight({ repo:'perfectuser21/cecelia', baseline:'abc', map })).toMatchObject({ allowed:false, provider_attempt_created:false });
    }
    expect(await p.consumeMapRecoveryContract({ change_kind:'bugfix', reason_code:'map_unavailable', attempt_id:'attempt-1', diff:['packages/brain/src/lib/map-scanner.js'] })).toMatchObject({ consumed:true });
    await expect(p.consumeMapRecoveryContract({ change_kind:'bugfix', reason_code:'map_unavailable', attempt_id:'attempt-1', diff:[] })).rejects.toThrow(/consumed/);
  });
});
