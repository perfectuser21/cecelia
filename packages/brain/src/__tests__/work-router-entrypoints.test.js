import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('work-router-entrypoints legacy routing defects', () => {
  it('planner, proposal and API delegate coding routing correctly', async () => {
    const planner = await readFile(new URL('../planner.js', import.meta.url), 'utf8');
    const proposal = await readFile(new URL('../proposal.js', import.meta.url), 'utf8');
    const tasks = await readFile(new URL('../routes/task-tasks.js', import.meta.url), 'utf8');
    expect(planner).toContain('task_type');
    expect(proposal).not.toContain('task_type: change.skill');
    expect(tasks).toMatch(/createRoutedTask\s*\(/);
    expect(tasks).not.toMatch(/INSERT\s+INTO\s+tasks/i);
  });
});
