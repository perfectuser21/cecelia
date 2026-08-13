import { describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [] })) }));
vi.mock('../db.js', () => ({ default: { query } }));
vi.mock('../actions.js', () => ({ createTask: vi.fn() }));

import { advanceCrystallizeStage, CRYSTALLIZE_STAGES } from '../crystallize-orchestrator.js';

describe('crystallize-orchestrator public contract', () => {
  it('keeps the four ordered stages and ignores an unknown task safely', async () => {
    expect(CRYSTALLIZE_STAGES).toEqual([
      'crystallize_scope',
      'crystallize_forge',
      'crystallize_verify',
      'crystallize_register',
    ]);

    await expect(advanceCrystallizeStage('missing-task', 'completed', {})).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SELECT id, task_type'), ['missing-task']);
  });
});
