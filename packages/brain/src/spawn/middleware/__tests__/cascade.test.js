import { describe, it, expect } from 'vitest';
import { resolveCascade } from '../cascade.js';

const mockCascade = ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5-20251001'];

function makeDeps(cascade = mockCascade) {
  return { getCascadeForTask: (_task) => cascade };
}

describe('resolveCascade() cascade middleware', () => {
  it('respects explicit opts.cascade (no override)', async () => {
    const opts = { task: { task_type: 'dev' }, cascade: ['explicit-model'] };
    await resolveCascade(opts, { deps: makeDeps() });
    expect(opts.cascade).toEqual(['explicit-model']);
  });

  it('fills opts.cascade from task when unset', async () => {
    const opts = { task: { task_type: 'dev' } };
    await resolveCascade(opts, { deps: makeDeps() });
    expect(opts.cascade).toEqual(mockCascade);
  });

  it('no-op when no task', async () => {
    const opts = {};
    await resolveCascade(opts, { deps: makeDeps() });
    expect(opts.cascade).toBeUndefined();
  });

  it('no-op when getCascadeForTask returns empty array', async () => {
    const opts = { task: { task_type: 'dev' } };
    await resolveCascade(opts, { deps: makeDeps([]) });
    expect(opts.cascade).toBeUndefined();
  });

  it('keeps opts.cascade undefined when deps throw', async () => {
    const opts = { task: { task_type: 'dev' } };
    const deps = { getCascadeForTask: () => { throw new Error('boom'); } };
    await resolveCascade(opts, { deps });
    expect(opts.cascade).toBeUndefined();
  });
});
