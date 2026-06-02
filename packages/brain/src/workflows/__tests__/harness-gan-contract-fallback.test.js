import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const { readFile, readdir } = await import('node:fs/promises');
const { execFile } = await import('node:child_process');
const { defaultReadContractFile } = await import('../harness-gan.graph.js');

describe('defaultReadContractFile — contract.md fallback', () => {
  beforeEach(() => vi.resetAllMocks());

  it('contract-draft.md 存在时优先用它', async () => {
    readFile.mockImplementation(async (p) => {
      if (String(p).endsWith('contract-draft.md')) return 'draft content';
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    readdir.mockResolvedValue([]);
    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('draft content');
  });

  it('没有 contract-draft.md 时用 sprint-contract.md', async () => {
    readFile.mockImplementation(async (p) => {
      if (String(p).endsWith('sprint-contract.md')) return 'sprint content';
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    readdir.mockResolvedValue([]);
    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('sprint content');
  });

  it('只有 contract.md 时兜底用它', async () => {
    readFile.mockImplementation(async (p) => {
      const ps = String(p);
      if (ps.endsWith('contract.md') && !ps.endsWith('contract-draft.md') && !ps.endsWith('sprint-contract.md')) {
        return 'plain content';
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    readdir.mockResolvedValue([]);
    execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error('no commits')));
    const result = await defaultReadContractFile('/repo', 'sprints');
    expect(result).toBe('plain content');
  });

  it('三个都没有时抛 contract file not found', async () => {
    readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    readdir.mockResolvedValue([]);
    execFile.mockImplementation((_cmd, _args, _opts, cb) => cb(new Error('no commits')));
    await expect(defaultReadContractFile('/repo', 'sprints')).rejects.toThrow('contract file not found');
  });
});
