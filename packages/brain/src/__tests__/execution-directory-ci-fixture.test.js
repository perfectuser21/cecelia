import { describe, expect, it, vi } from 'vitest';
import { seedExecutionDirectoryPgFixture } from './helpers/execution-directory-pg-fixture.js';

const env = { NODE_ENV: 'test', GITHUB_ACTIONS: 'true', DB_HOST: 'localhost', DB_NAME: 'cecelia_test' };

describe('execution-directory-ci-fixture 写入边界', () => {
  it.each([
    { NODE_ENV: 'production' }, { GITHUB_ACTIONS: '' },
    { DB_HOST: '100.79.41.61' }, { DB_NAME: 'cecelia' },
  ])('错误环境在连接数据库前拒绝 %j', async override => {
    const pool = { query: vi.fn() };
    await expect(seedExecutionDirectoryPgFixture(pool, { ciSmoke: true, env: { ...env, ...override } }))
      .rejects.toThrow('CI execution directory fixture boundary');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('配置正确但实际库为生产库仍拒绝，未写设备或授权', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ database: 'cecelia' }] }) };
    await expect(seedExecutionDirectoryPgFixture(pool, { ciSmoke: true, env }))
      .rejects.toThrow('isolated fixture database required');
    expect(pool.query.mock.calls).toEqual([['SELECT current_database() AS database']]);
  });
});
