import { describe, it, expect, vi } from 'vitest';

vi.mock('../../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn() }));

describe('tasks router', () => {
  it('exports an express router', async () => {
    const { default: router } = await import('../tasks.js');
    expect(router).toBeDefined();
    expect(typeof router).toBe('function');
  });
});
