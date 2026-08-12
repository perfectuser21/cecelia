import { describe, it, expect } from 'vitest';

describe('Unified Work Router [BEHAVIOR]', () => {
  it('四档 change_kind 只正向映射', async () => {
    const { selectPipeline } = await import('../../../packages/brain/src/work-router.js');
    expect(selectPipeline({ work_kind: 'coding_mutation', change_kind: 'new_capability' })).toMatchObject({ pipeline: 'harness', canonical_task_type: 'harness_initiative', default_execution_profile: 'new-capability-v1' });
    expect(() => selectPipeline({ work_kind: 'coding_mutation', gear: 'hotfix' })).toThrow('change_kind_required');
  });

  it('coding unknown 按 write', async () => {
    const { routeWork } = await import('../../../packages/brain/src/work-router.js');
    expect(routeWork({ source: 'api', source_id: 'red', title: '修改代码', mutation_intent: 'unknown' }, { repositories: [] }).work_kind).toBe('coding_mutation');
  });
});

