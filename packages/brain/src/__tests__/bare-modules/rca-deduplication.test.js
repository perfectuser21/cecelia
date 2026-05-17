/**
 * Bare Module Test: rca-deduplication.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe('rca-deduplication module', () => {
  it('can be imported', async () => {
    const mod = await import('../../rca-deduplication.js');
    expect(mod).toBeDefined();
  });

  it('exports generateErrorSignature function', async () => {
    const { generateErrorSignature } = await import('../../rca-deduplication.js');
    expect(typeof generateErrorSignature).toBe('function');
  });

  it('exports shouldAnalyzeFailure function', async () => {
    const { shouldAnalyzeFailure } = await import('../../rca-deduplication.js');
    expect(typeof shouldAnalyzeFailure).toBe('function');
  });

  it('exports cacheRcaResult function', async () => {
    const { cacheRcaResult } = await import('../../rca-deduplication.js');
    expect(typeof cacheRcaResult).toBe('function');
  });
});
