import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = {
  query: vi.fn()
};

describe('janitor module', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getJobs() 只有固定专属cache策略且默认停用', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { getJobs } = await import('../janitor.js');
    const result = await getJobs(mockPool);
    expect(result.jobs).toEqual([{ id: 'preview-owned-npm-cache-expiry-v1', name: 'MMV preview 专属 npm cache 过期回收', enabled: false, last_run: null }]);
  });

  it('runJob() 对未知 job 抛出错误', async () => {
    const { runJob } = await import('../janitor.js');
    await expect(runJob(mockPool, 'docker-prune')).rejects.toThrow('Unknown job');
  });
});
