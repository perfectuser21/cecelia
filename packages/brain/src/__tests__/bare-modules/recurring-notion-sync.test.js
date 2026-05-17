/**
 * Bare Module Test: recurring-notion-sync.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('recurring-notion-sync module', () => {
  it('can be imported', async () => {
    const mod = await import('../../recurring-notion-sync.js');
    expect(mod).toBeDefined();
  });

  it('exports syncRecurringFromNotion function', async () => {
    const { syncRecurringFromNotion } = await import('../../recurring-notion-sync.js');
    expect(typeof syncRecurringFromNotion).toBe('function');
  });

  it('exports writeBackRunResult function', async () => {
    const { writeBackRunResult } = await import('../../recurring-notion-sync.js');
    expect(typeof writeBackRunResult).toBe('function');
  });

  it('exports RECURRING_TASKS_NOTION_DB_ID constant', async () => {
    const { RECURRING_TASKS_NOTION_DB_ID } = await import('../../recurring-notion-sync.js');
    expect(typeof RECURRING_TASKS_NOTION_DB_ID).toBe('string');
  });
});
