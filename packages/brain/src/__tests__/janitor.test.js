import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = {
  query: vi.fn()
};

describe('janitor module', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getJobs() 返回空（docker-prune 已取消，REGISTRY 为空）', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { getJobs } = await import('../janitor.js');
    const result = await getJobs(mockPool);
    expect(result.jobs).toEqual([]);
  });

  it('runJob() 对未知 job 抛出错误', async () => {
    const { runJob } = await import('../janitor.js');
    await expect(runJob(mockPool, 'docker-prune')).rejects.toThrow('Unknown job');
  });
});
