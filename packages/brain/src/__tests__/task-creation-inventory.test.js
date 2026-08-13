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
      const callsWriterDirectly = /(?:createRoutedTask|createTask)\s*\(/.test(source);
      const callsInjectedWriter = /taskCreator\s*\(/.test(source) && /=\s*createTask\b/.test(source);
      expect(callsWriterDirectly || callsInjectedWriter, row.module).toBe(true);
      if ((callsWriterDirectly || callsInjectedWriter) && row.module !== 'actions.js') {
        const importsActionsBoundary = /import\s+\{\s*createTask\s*\}\s+from\s+['"].*actions\.js['"]/.test(source);
        const importsAtomicStore = /import\s+\{\s*createRoutedTask\s*\}\s+from\s+['"].*work-routing-store\.js['"]/.test(source);
        expect(importsActionsBoundary || importsAtomicStore, row.module).toBe(true);
      }
      expect(source, row.module).not.toMatch(/INSERT\s+INTO\s+tasks/i);
    }
  });
});
