import { describe, expect, it } from 'vitest';
import { assertAutoPoolTestDatabase } from './helpers/auto-pool-test-database.js';

const nightly = { CI: 'true', POSTGRES_INTEGRATION: '1', GITHUB_ACTIONS: 'true',
  GITHUB_JOB: 'brain-integration', GITHUB_WORKFLOW: 'Deep Regression' };
const scratch = { host: '127.0.0.1', port: 5432, database: 'cecelia_scratch' };
const ciTest = { ...scratch, database: 'cecelia_test' };

describe('自动池真实PG回归的连接目标保护', () => {
  it('普通CI只许scratch，原对象就是后续fixture实际连接对象', () => {
    expect(assertAutoPoolTestDatabase(scratch, { CI: 'true', POSTGRES_INTEGRATION: '1' })).toBe(scratch);
  });
  it('精确Nightly身份允许隔离cecelia_test，不能误验另一个TEST_DB_URL', () => {
    expect(assertAutoPoolTestDatabase(ciTest, { ...nightly, TEST_DB_URL: 'postgresql://127.0.0.1/cecelia_scratch' })).toBe(ciTest);
    expect(() => assertAutoPoolTestDatabase({ ...ciTest, database: 'cecelia' }, {
      ...nightly, DB_NAME: 'cecelia_scratch', TEST_DB_URL: 'postgresql://127.0.0.1/cecelia_scratch',
    })).toThrow('actual isolated');
  });
  it.each(['CI', 'POSTGRES_INTEGRATION', 'GITHUB_ACTIONS', 'GITHUB_JOB', 'GITHUB_WORKFLOW'])('缺少或错误身份不得让cecelia_test获豁免：%s', key => {
    expect(() => assertAutoPoolTestDatabase(ciTest, { ...nightly, [key]: 'other' })).toThrow('actual isolated');
  });
  it.each(['cecelia', 'postgres', 'cecelia_staging'])('拒绝生产或其他数据库：%s', database => {
    expect(() => assertAutoPoolTestDatabase({ ...scratch, database }, nightly)).toThrow('actual isolated');
  });
  it.each(['100.79.41.61', 'example.test', '/var/run/postgresql'])('拒绝远端或未知连接：%s', host => {
    expect(() => assertAutoPoolTestDatabase({ ...ciTest, host }, nightly)).toThrow('actual isolated');
  });
  it.each([0, 65536, NaN, '5432'])('端口必须是实际有效整数：%s', port => {
    expect(() => assertAutoPoolTestDatabase({ ...scratch, port }, nightly)).toThrow('actual isolated');
  });
});
