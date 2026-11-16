import { describe, expect, it, vi } from 'vitest';

import { checkAndCreateCodeReviewTrigger } from '../code-review-trigger.js';

function taskCreator(id = 'task-routed') {
  return vi.fn().mockResolvedValue({
    success: true,
    task: { id, task_type: 'research', trigger_source: 'test' },
  });
}

describe('automatic task routing boundaries', () => {

  it('routes accumulated code review through createTask', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (sql.includes('okr_initiatives')) return { rows: [{ type: 'project' }] };
        if (sql.includes('COUNT(*)')) return { rows: [{ cnt: '5' }] };
        if (sql.includes("task_type = 'code_review'")) return { rows: [] };
        return { rows: [] };
      }),
    };
    const create = taskCreator('review-task');

    const result = await checkAndCreateCodeReviewTrigger(pool, 'project-1', create);

    expect(result.id).toBe('review-task');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      db: pool,
      source: 'discovery',
      task_type: 'code_review',
      project_id: 'project-1',
      allow_unscoped: true,
    }));
  });

});
