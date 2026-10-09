import { describe, expect, it } from 'vitest';
import unitConfig from '../../vitest.config.js';
import integrationConfig from '../../vitest.integration.config.js';

// 两个真 PG 回归曾被普通 QuickCheck 选进无 DB 的单元检查，连接错误掩盖真实断言。
const realPostgresCases = [
  'src/phone-dispatch/store.test.js',
  'src/__tests__/integration/account-quota-ledger.pg.integration.test.js',
  'src/__tests__/integration/escalation-cancel-pending-sql.integration.test.js',
];

describe('真实 PostgreSQL 回归的执行边界', () => {
  it.each(realPostgresCases)('%s：无 DB 单元检查不连接数据库', (testPath) => {
    expect(unitConfig.test.exclude).toContain(testPath);
  });

  it.each(realPostgresCases)('%s：有 DB 集成检查保留原始回归', (testPath) => {
    expect(integrationConfig.test.exclude).not.toContain(testPath);
    expect(integrationConfig.test.include).toContain('src/**/*.{test,spec}.?(c|m)[jt]s?(x)');
  });
});
