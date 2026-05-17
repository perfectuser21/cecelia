/**
 * Bare Module Test: trace-routes.js
 * Verifies import + default export is an Express router.
 */
import { describe, it, expect } from 'vitest';

describe('trace-routes module', () => {
  it('can be imported', async () => {
    const mod = await import('../../trace-routes.js');
    expect(mod).toBeDefined();
  });

  it('exports default as a router (function)', async () => {
    const mod = await import('../../trace-routes.js');
    expect(typeof mod.default).toBe('function');
  });
});
