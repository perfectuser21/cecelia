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

describe('__test__ hook [BEHAVIOR]', () => {
  it('暴露 buildDockerArgs；本地 writePromptFile 已删除（prompt 落盘统一走 forensics.promptFile）', () => {
    expect(typeof __test__.buildDockerArgs).toBe('function');
    expect(__test__.writePromptFile).toBeUndefined();
  });
});
