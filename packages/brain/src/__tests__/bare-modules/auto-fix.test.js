/**
 * Bare Module Test: auto-fix.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe('auto-fix module', () => {
  it('can be imported', async () => {
    const mod = await import('../../auto-fix.js');
    expect(mod).toBeDefined();
  });

  it('exports shouldAutoFix function', async () => {
    const { shouldAutoFix } = await import('../../auto-fix.js');
    expect(typeof shouldAutoFix).toBe('function');
  });

  it('exports generateFixPrd function', async () => {
    const { generateFixPrd } = await import('../../auto-fix.js');
    expect(typeof generateFixPrd).toBe('function');
  });

  it('exports dispatchToDevSkill function', async () => {
    const { dispatchToDevSkill } = await import('../../auto-fix.js');
    expect(typeof dispatchToDevSkill).toBe('function');
  });
});
