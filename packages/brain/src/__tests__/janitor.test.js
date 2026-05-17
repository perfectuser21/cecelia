import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../janitor-jobs/docker-prune.js', () => ({
  JOB_ID: 'docker-prune',
  JOB_NAME: 'Docker 镜像清理',
  run: vi.fn().mockResolvedValue({ status: 'success', output: 'OK', freed_bytes: 1000 })
}));

const mockPool = {
  query: vi.fn()
};

describe('janitor module', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getJobs() 返回所有注册 job 的状态', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ job_id: 'docker-prune', enabled: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const { getJobs } = await import('../janitor.js');
    const result = await getJobs(mockPool);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].id).toBe('docker-prune');
    expect(result.jobs[0].enabled).toBe(true);
  });

  it('runJob() 写入 janitor_runs 并返回 run_id', async () => {
    const fakeRunId = 'test-uuid-123';
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: fakeRunId, job_id: 'docker-prune' }] })
      .mockResolvedValueOnce({ rows: [] });
    const { runJob } = await import('../janitor.js');
    const result = await runJob(mockPool, 'docker-prune');
    expect(result.run_id).toBe(fakeRunId);
    expect(result.status).toBe('success');
  });

  it('runJob() 对未知 job 抛出错误', async () => {
    const { runJob } = await import('../janitor.js');
    await expect(runJob(mockPool, 'unknown-job')).rejects.toThrow('Unknown job');
  });
});
