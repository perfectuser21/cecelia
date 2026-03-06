/**
 * Bare Module Test: desire-feedback.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('desire-feedback module', () => {
  it('can be imported', async () => {
    const mod = await import('../../desire-feedback.js');
    expect(mod).toBeDefined();
  });

  it('exports updateDesireFromTask function', async () => {
    const { updateDesireFromTask } = await import('../../desire-feedback.js');
    expect(typeof updateDesireFromTask).toBe('function');
  });
});
