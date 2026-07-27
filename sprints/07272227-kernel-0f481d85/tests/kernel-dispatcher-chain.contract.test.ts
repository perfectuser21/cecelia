import { describe, it, expect } from 'vitest';

describe('Kernel dispatcher real-chain contract', () => {
  it('dispatcher tick 真实 role target 交集：Claude 满载但 pinned Codex account 有位时仍派发 Codex，未知 Grok 不得顶替', async () => {
    const dispatcher = await import('../../../packages/brain/src/dispatcher.js');

    expect(typeof (dispatcher as any).buildKernelDispatchCandidates).toBe('function');

    const result = await (dispatcher as any).buildKernelDispatchCandidates({
      task: {
        id: 'task-kernel-1',
        task_type: 'harness_initiative',
        priority: 'P0',
        payload: {
          role_assignments: {
            generator: { provider: 'codex', account: 'team5' },
          },
          review_required: true,
        },
      },
      role: 'generator',
      snapshot: {
        sampled_at: '2026-07-27T00:00:00.000Z',
        cache_ttl_ms: 60000,
        vendors: {
          claude: { accounts: [{ account: 'account1', free: 0, state: 'full' }] },
          codex: { accounts: [{ account: 'team5', free: 1, state: 'ok' }] },
          grok: { accounts: [{ account: 'grok', free: 1, state: 'unknown' }] },
        },
      },
    });

    expect(result.selected).toMatchObject({ provider: 'codex', account: 'team5' });
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'claude' }),
        expect.objectContaining({ provider: 'grok', reason: 'candidate_unknown' }),
      ]),
    );
  });

  it('dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路证明 Claude 满载拒 Claude 而 Codex Grok 可派发', async () => {
    const dispatcher = await import('../../../packages/brain/src/dispatcher.js');

    expect(typeof (dispatcher as any).runKernelDispatchProbe).toBe('function');

    const probe = await (dispatcher as any).runKernelDispatchProbe({
      task_id: 'task-kernel-probe',
      role: 'generator',
      role_assignments: { generator: { provider: 'codex', account: 'team5' } },
      snapshot: {
        sampled_at: '2026-07-27T00:00:00.000Z',
        cache_ttl_ms: 60000,
        vendors: {
          claude: { accounts: [{ account: 'account1', free: 0, state: 'full' }] },
          codex: { accounts: [{ account: 'team5', free: 1, state: 'ok' }] },
          grok: { accounts: [{ account: 'grok', free: 1, state: 'ok' }] },
        },
      },
    });

    expect(probe.path).toEqual([
      'dispatcher',
      'harnessSlotCheck',
      'unifiedController',
    ]);
    expect(probe.claude).toMatchObject({ allow: false, reason: 'account_full' });
    expect(probe.codex).toMatchObject({ allow: true, provider: 'codex', account: 'team5' });
  });
});
