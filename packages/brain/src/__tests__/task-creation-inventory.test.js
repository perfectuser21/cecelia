import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { TASK_CREATION_INVENTORY } from '../task-creation-inventory.js';

describe('task creation inventory', () => {
  it('records each executable creation boundary', () => {
    expect(TASK_CREATION_INVENTORY.length).toBeGreaterThanOrEqual(33);
    for (const row of TASK_CREATION_INVENTORY) expect(row).toMatchObject({ module: expect.any(String), source: expect.any(String), creates_executable_task: expect.any(Boolean), migration_status: expect.any(String) });
  });

  it('routes every inventoried executable boundary through the unique task writer', async () => {
    for (const row of TASK_CREATION_INVENTORY) {
      if (!row.creates_executable_task) continue;
      expect(row.migration_status, row.module).toBe('routed');
      const source = await readFile(new URL(`../${row.module}`, import.meta.url), 'utf8');
      expect(source, row.module).toMatch(/createRoutedTask\s*\(/);
      expect(source, row.module).not.toMatch(/INSERT\s+INTO\s+tasks/i);
    }
  });
});
