import { describe, expect, it } from 'vitest';
import { TASK_CREATION_INVENTORY } from '../task-creation-inventory.js';

describe('task creation inventory', () => {
  it('records each executable creation boundary', () => {
    expect(TASK_CREATION_INVENTORY.length).toBeGreaterThanOrEqual(33);
    for (const row of TASK_CREATION_INVENTORY) expect(row).toMatchObject({ module: expect.any(String), source: expect.any(String), creates_executable_task: expect.any(Boolean), migration_status: expect.any(String) });
  });
});
