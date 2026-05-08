import { describe, it, expect } from 'vitest';
import { spawnDockerDetached, __test__ } from '../detached.js';

describe('spawnDockerDetached [BEHAVIOR]', () => {
  it('opts.task.id 缺失 throw', async () => {
    await expect(spawnDockerDetached({})).rejects.toThrow(/task\.id is required/);
    await expect(spawnDockerDetached({ task: {} })).rejects.toThrow(/task\.id is required/);
  });

  it('opts.prompt 缺失 throw', async () => {
    await expect(spawnDockerDetached({ task: { id: 't1' } })).rejects.toThrow(/prompt is required/);
    await expect(spawnDockerDetached({ task: { id: 't1' }, prompt: '' })).rejects.toThrow(/prompt is required/);
  });

  it('opts.containerId 缺失 throw', async () => {
    await expect(
      spawnDockerDetached({ task: { id: 't1' }, prompt: 'p' })
    ).rejects.toThrow(/containerId is required/);
  });
});

describe('writePromptFile (test hook) [BEHAVIOR]', () => {
  it('exports writePromptFile via __test__', () => {
    expect(typeof __test__.writePromptFile).toBe('function');
  });
});
