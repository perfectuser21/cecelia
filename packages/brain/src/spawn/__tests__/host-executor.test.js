import { describe, it, expect } from 'vitest';
import { executeOnHost } from '../host-executor.js';

describe('host-executor', () => {
  it('exports executeOnHost function', () => {
    expect(typeof executeOnHost).toBe('function');
  });

  it('throws if task.id missing', async () => {
    await expect(executeOnHost({ task: {}, prompt: 'test' })).rejects.toThrow('task.id required');
  });

  it('throws if prompt is not a string', async () => {
    await expect(executeOnHost({ task: { id: 'tid' }, prompt: null })).rejects.toThrow('prompt required');
  });
});
