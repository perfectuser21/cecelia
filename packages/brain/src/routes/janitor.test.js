// see packages/brain/src/__tests__/janitor.test.js for full integration test suite
import { describe, it, expect } from 'vitest';

describe('janitor routes', () => {
  it('module loads without error', async () => {
    const mod = await import('./janitor.js');
    expect(typeof mod.default).toBe('function');
  });
});
