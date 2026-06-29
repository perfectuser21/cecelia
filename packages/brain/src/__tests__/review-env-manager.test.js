/**
 * Brain unit tests for review-env-manager.js
 * Tests the module-level exports contract (function signatures / types).
 */
import { describe, it, expect } from 'vitest';

describe('review-env-manager exports', () => {
  it('exports findFreePort as a function', async () => {
    const mod = await import('../review-env-manager.js');
    expect(typeof mod.findFreePort).toBe('function');
  });

  it('exports allocateReviewEnv as a function', async () => {
    const mod = await import('../review-env-manager.js');
    expect(typeof mod.allocateReviewEnv).toBe('function');
  });

  it('exports releaseReviewEnv as a function', async () => {
    const mod = await import('../review-env-manager.js');
    expect(typeof mod.releaseReviewEnv).toBe('function');
  });

  it('exports cleanupHarnessReviewEnvs as a function', async () => {
    const mod = await import('../review-env-manager.js');
    expect(typeof mod.cleanupHarnessReviewEnvs).toBe('function');
  });
});
