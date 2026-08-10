import { describe, expect, it, vi } from 'vitest';

async function loadRevisionHelper() {
  return import('../git-revision.js');
}

describe('readGitRevision', () => {
  it('统一执行 git -C repoRoot rev-parse HEAD 并 trim revision', async () => {
    const { readGitRevision } = await loadRevisionHelper();
    const exec = vi.fn(() => '  abc123\n');

    expect(readGitRevision('/repo/root', exec)).toBe('abc123');
    expect(exec).toHaveBeenCalledWith(
      'git', ['-C', '/repo/root', 'rev-parse', 'HEAD'], { encoding: 'utf8' },
    );
  });

  it('空 revision 统一失败且带 repoRoot 上下文', async () => {
    const { readGitRevision } = await loadRevisionHelper();
    expect(() => readGitRevision('/empty/repo', () => '  \n'))
      .toThrow('无法读取 source revision (/empty/repo): empty revision');
  });

  it('git 执行失败统一包装且保留原因', async () => {
    const { readGitRevision } = await loadRevisionHelper();
    expect(() => readGitRevision('/broken/repo', () => { throw new Error('not a git repository'); }))
      .toThrow('无法读取 source revision (/broken/repo): not a git repository');
  });
});
