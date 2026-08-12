import { describe, it, expect } from 'vitest';

describe('Map 与动作闸 [BEHAVIOR]', () => {
  it('stale Map 在 Provider 前失败', async () => {
    const preflight = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    const result = await preflight.verifyMapImpactPreflight({ repo: 'perfectuser21/cecelia', baselineSha: 'a'.repeat(40), map: { freshness: 'stale', revision: 'a'.repeat(40), scanner_version: 'valid' } });
    expect(result).toMatchObject({ ok: false, reason_code: 'map_stale', provider_attempt_created: false });
  });

  it('有头无头 receipt 均在动作前验证', async () => {
    const routing = await import('../../../packages/brain/src/routes/work-routing.js');
    const invalid = await routing.validateRoutingReceipt({ task_id: 'task-red', receipt_status: 'superseded', repo: 'perfectuser21/cecelia', branch: 'feature/red', base_sha: 'b'.repeat(40) });
    expect(invalid).toMatchObject({ valid: false, reason_code: 'receipt_superseded' });
    expect(invalid.executor_called).toBe(false);
  });
});
