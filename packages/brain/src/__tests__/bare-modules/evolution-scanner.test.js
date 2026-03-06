/**
 * Bare Module Test: evolution-scanner.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('evolution-scanner module', () => {
  it('can be imported', async () => {
    const mod = await import('../../evolution-scanner.js');
    expect(mod).toBeDefined();
  });

  it('exports scanEvolutionIfNeeded function', async () => {
    const { scanEvolutionIfNeeded } = await import('../../evolution-scanner.js');
    expect(typeof scanEvolutionIfNeeded).toBe('function');
  });

  it('exports synthesizeEvolutionIfNeeded function', async () => {
    const { synthesizeEvolutionIfNeeded } = await import('../../evolution-scanner.js');
    expect(typeof synthesizeEvolutionIfNeeded).toBe('function');
  });
});
