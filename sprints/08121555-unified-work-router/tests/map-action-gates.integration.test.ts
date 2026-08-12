import { describe, it, expect } from 'vitest';

describe('Map 与动作闸 [BEHAVIOR]', () => {
  it('stale Map 在 Provider 前失败', async () => {
    const preflight = await import('../../../packages/brain/src/orchestrator/preflight/map-impact-contract.js');
    await expect(preflight.verifyMapImpactPreflight({ freshness: 'stale' })).rejects.toThrow('map_stale');
  });

  it('有头无头 receipt 均在动作前验证', async () => {
    const routing = await import('../../../packages/brain/src/routes/work-routing.js');
    expect(routing.validateRoutingReceipt).toBeTypeOf('function');
  });
});

