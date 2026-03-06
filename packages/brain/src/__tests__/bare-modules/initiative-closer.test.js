/**
 * Bare Module Test: initiative-closer.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('initiative-closer module', () => {
  it('can be imported', async () => {
    const mod = await import('../../initiative-closer.js');
    expect(mod).toBeDefined();
  });

  it('exports checkInitiativeCompletion function', async () => {
    const { checkInitiativeCompletion } = await import('../../initiative-closer.js');
    expect(typeof checkInitiativeCompletion).toBe('function');
  });

  it('exports checkProjectCompletion function', async () => {
    const { checkProjectCompletion } = await import('../../initiative-closer.js');
    expect(typeof checkProjectCompletion).toBe('function');
  });

  it('exports activateNextInitiatives function', async () => {
    const { activateNextInitiatives } = await import('../../initiative-closer.js');
    expect(typeof activateNextInitiatives).toBe('function');
  });

  it('exports getMaxActiveInitiatives function', async () => {
    const { getMaxActiveInitiatives } = await import('../../initiative-closer.js');
    expect(typeof getMaxActiveInitiatives).toBe('function');
  });

  it('exports MAX_ACTIVE_INITIATIVES constant', async () => {
    const { MAX_ACTIVE_INITIATIVES } = await import('../../initiative-closer.js');
    expect(typeof MAX_ACTIVE_INITIATIVES).toBe('number');
  });
});
