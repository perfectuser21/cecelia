import { describe, it, expect } from 'vitest';
import { routeWork } from '../work-router.js';
import { createRoutedTask } from '../work-routing-store.js';
import { TASK_TYPE_REGISTRY, EXTERNALLY_EXECUTED_TASK_TYPES, TICK_DISPATCH_EXCLUDED } from '../lib/task-type-registry.js';
import { isExternallyExecuted, EXECUTOR_CONTRACTS } from '../executor-contracts.js';
const policy = 'preview-owned-npm-cache-expiry-v1';
const request = { source: 'scheduler', source_id: 'fixture', title: '清理专属缓存', declared_domain: 'operations',
  requested_task_type: 'janitor', mutation_intent: 'none', metadata: { policy, machine: 'mmv' } };
describe('Janitor固定HTTP执行合同', () => {
  for (const mutation of ['none', 'read_only', 'write']) it(`公开JSON ${mutation}不得伪装受信Janitor`, () => {
    expect(() => routeWork({ ...request, mutation_intent: mutation })).toThrow('janitor_authority_required');
  });
  it('仅伪造executor_kind也在中央writer入口拒绝，早于DB访问', async () => {
    await expect(createRoutedTask({}, { ...request, requested_task_type: 'data', task: { executor_kind: 'preview-janitor' } }))
      .rejects.toThrow('janitor_authority_required');
  });
  it('固定Janitor是受保护远端任务，tick及启动本地探活不会接管', async () => {
    expect(TASK_TYPE_REGISTRY.janitor).toMatchObject({ db: true, tick_dispatchable: false, cleanup_class: 'protected', executor: 'preview-janitor' });
    expect(TICK_DISPATCH_EXCLUDED).toContain('janitor');
    expect(EXTERNALLY_EXECUTED_TASK_TYPES).toContain('janitor');
    expect(isExternallyExecuted({ task_type: 'janitor' })).toBe(true);
    expect(await EXECUTOR_CONTRACTS['preview-janitor'].probe({})).toBe('unknown');
    expect(EXECUTOR_CONTRACTS['preview-janitor'].staleMinutes).toBeNull();
  });
});
