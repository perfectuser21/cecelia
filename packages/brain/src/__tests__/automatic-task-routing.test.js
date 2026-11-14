import { describe, expect, it, vi } from 'vitest';

import { checkAndCreateCodeReviewTrigger } from '../code-review-trigger.js';
import { ensureCodexImmune } from '../codex-immune.js';

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

  it('routes codex immune review through createTask', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const create = taskCreator('immune-task');

    const result = await ensureCodexImmune(pool, create);

    expect(result).toEqual({ created: true, elapsed_ms: Infinity });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      db: pool,
      source: 'scheduler',
      task_type: 'codex_qa',
      trigger_source: 'brain_auto',
      allow_unscoped: true,
    }));
  });
});
