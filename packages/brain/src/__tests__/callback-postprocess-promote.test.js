import { describe, it, expect, vi, beforeEach } from 'vitest';

const promoteMock = vi.fn(async () => ({ ok: true, dbWritten: true, yamlPrUrl: null, reason: 'db_only' }));
vi.mock('../harness-promote-regression.js', () => ({
  promoteToRegression: promoteMock,
  default: { promoteToRegression: promoteMock },
}));

const { promoteRegressionOnHarnessMerged } = await import('../lib/callback-postprocess.js');

const TASK_ID = '11111111-1111-4111-8111-111111111111';

function makePool(taskRow) {
  return { query: vi.fn(async () => ({ rows: taskRow ? [taskRow] : [] })) };
}

describe('promoteRegressionOnHarnessMerged', () => {
  beforeEach(() => promoteMock.mockClear());

  it('非 harness_initiative 任务静默跳过', async () => {
    const pool = makePool({ id: TASK_ID, task_type: 'dev', ability_id: null, payload: {}, pr_url: 'https://github.com/x/y/pull/1' });
    await promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it('无 merged PR 证据时跳过', async () => {
    const pool = makePool({ id: TASK_ID, task_type: 'harness_initiative', ability_id: null, payload: { sprint_dir: 'sprints/x' }, pr_url: null });
    await promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it('payload 缺 sprint_dir 时跳过', async () => {
    const pool = makePool({ id: TASK_ID, task_type: 'harness_initiative', ability_id: null, payload: {}, pr_url: 'https://github.com/x/y/pull/1' });
    await promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool);
    expect(promoteMock).not.toHaveBeenCalled();
  });

  it('有证据时以 dbOnly:true 调 promoteToRegression，带 ability_id 与 sprint_dir', async () => {
    const pool = makePool({
      id: TASK_ID, task_type: 'harness_initiative',
      ability_id: '22222222-2222-4222-8222-222222222222',
      payload: { sprint_dir: 'sprints/0710-x' }, pr_url: null,
    });
    await promoteRegressionOnHarnessMerged(TASK_ID, { merged: true, pr_url: 'https://github.com/x/y/pull/9' }, null, pool);
    expect(promoteMock).toHaveBeenCalledTimes(1);
    const [deps, params] = promoteMock.mock.calls[0];
    expect(deps.pool).toBe(pool);
    expect(params.dbOnly).toBe(true);
    expect(params.sprintDir).toBe('sprints/0710-x');
    expect(params.task).toMatchObject({ id: TASK_ID, ability_id: '22222222-2222-4222-8222-222222222222' });
    expect(params.subTasks).toEqual([{ pr_url: 'https://github.com/x/y/pull/9' }]);
    expect(typeof params.worktreePath).toBe('string');
    expect(params.worktreePath.length).toBeGreaterThan(0);
  });

  it('payload.worktree_path 优先于推导路径', async () => {
    const pool = makePool({
      id: TASK_ID, task_type: 'harness_initiative', ability_id: null,
      payload: { sprint_dir: 'sprints/0710-x', worktree_path: '/tmp/custom-wt' }, pr_url: 'https://github.com/x/y/pull/2',
    });
    await promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool);
    expect(promoteMock.mock.calls[0][1].worktreePath).toBe('/tmp/custom-wt');
  });

  it('promoteToRegression 抛错向外传播（fail-open 由调用方 catch）', async () => {
    promoteMock.mockRejectedValueOnce(new Error('boom'));
    const pool = makePool({
      id: TASK_ID, task_type: 'harness_initiative', ability_id: null,
      payload: { sprint_dir: 'sprints/0710-x' }, pr_url: 'https://github.com/x/y/pull/3',
    });
    await expect(promoteRegressionOnHarnessMerged(TASK_ID, null, null, pool)).rejects.toThrow('boom');
  });
});
