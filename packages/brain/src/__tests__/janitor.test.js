import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPool = {
  query: vi.fn()
};

describe('janitor module', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getJobs() 仅暴露现役镜像策略且默认停用', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const { getJobs } = await import('../janitor.js');
    const result = await getJobs(mockPool);
    expect(result.jobs).toEqual([{ id: 'us-brain-image-retention-v1', name: 'US 历史 Brain 镜像保留清理', enabled: false, last_run: null }]);
  });

  it('退役缓存策略不能执行或配置，早于数据库访问', async () => {
    const { runJob, setJobConfig } = await import('../janitor.js');
    await expect(runJob({}, 'preview-owned-npm-cache-expiry-v1')).rejects.toMatchObject({ code: 'JANITOR_UNKNOWN_JOB' });
    await expect(setJobConfig({}, 'preview-owned-npm-cache-expiry-v1', { enabled: true })).rejects.toMatchObject({ code: 'JANITOR_UNKNOWN_JOB' });
  });

  it('runJob() 对未知 job 抛出错误', async () => {
    const { runJob } = await import('../janitor.js');
    await expect(runJob(mockPool, 'docker-prune')).rejects.toThrow('Unknown job');
  });
});
