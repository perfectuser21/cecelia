/**
 * Bare Module Test: brain-manifest.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('brain-manifest module', () => {
  it('can be imported', async () => {
    const mod = await import('../../brain-manifest.js');
    expect(mod).toBeDefined();
  });

  it('exports BRAIN_MANIFEST object', async () => {
    const { BRAIN_MANIFEST } = await import('../../brain-manifest.js');
    expect(typeof BRAIN_MANIFEST).toBe('object');
    expect(BRAIN_MANIFEST).not.toBeNull();
  });
});
