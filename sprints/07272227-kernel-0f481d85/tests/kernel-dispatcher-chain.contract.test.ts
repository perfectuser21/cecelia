import { describe, it, expect } from 'vitest';

describe('Kernel dispatcher real-chain contract', () => {
  it('dispatcher tick 真实 role target 交集：只允许 server owned role_assignments 命中的 provider account，未知候选只拒自身', async () => {
    const dispatcher = await import('../../../packages/brain/src/dispatcher.js');

    expect(typeof (dispatcher as any).buildKernelDispatchCandidates).toBe('function');

    const result = await (dispatcher as any).buildKernelDispatchCandidates({
      task: {
        id: 'task-kernel-1',
        task_type: 'harness_contract_propose',
        priority: 'P0',
        payload: {
          orchestrator: 'skill-relay',
          harness_runtime: 'kernel-v1',
          role_assignments: {
            proposer: { provider: 'codex', account: 'team5' },
          },
          review_required: true,
        },
      },
      role: 'proposer',
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
    expect(result.considered).toEqual([{ provider: 'codex', account: 'team5' }]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'grok', account: 'grok', reason: 'candidate_unknown' }),
      ]),
    );
  });

  it('dispatcher tick -> harnessSlotCheck -> unified Controller 真实链路：Claude 满载拒 Claude，Codex 或 Grok 仅在 pinned account 可用时派发', async () => {
    const dispatcher = await import('../../../packages/brain/src/dispatcher.js');

    expect(typeof (dispatcher as any).runKernelDispatchProbe).toBe('function');

    const probe = await (dispatcher as any).runKernelDispatchProbe({
      task: {
        id: 'task-kernel-probe',
        task_type: 'harness_contract_propose',
        priority: 'P0',
        payload: {
          orchestrator: 'skill-relay',
          harness_runtime: 'kernel-v1',
          role_assignments: {
            proposer: { provider: 'codex', account: 'team5' },
          },
          review_required: true,
        },
      },
      role: 'proposer',
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
    expect(probe.selected).toMatchObject({ provider: 'codex', account: 'team5' });
    expect(probe.fallback_selected).not.toMatchObject({ provider: 'grok', account: 'grok' });
  });
});
