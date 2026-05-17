/**
 * Bare Module Test: migrate.js
 * Verifies import + main exports exist.
 */
import { describe, it, expect } from 'vitest';

describe('migrate module', () => {
  it('can be imported', async () => {
    const mod = await import('../../migrate.js');
    expect(mod).toBeDefined();
  });

  it('exports runMigrations function', async () => {
    const { runMigrations } = await import('../../migrate.js');
    expect(typeof runMigrations).toBe('function');
  });
});
