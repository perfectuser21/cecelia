import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import unit from '../../vitest.config.js';
import integration from '../../vitest.integration.config.js';
const api = await import('./helpers/crm-pg-fixture.js').catch(() => ({}));
const files = ['crm-store.pg.integration.test.js', 'crm-contact-resolve.pg.integration.test.js'];
describe('CRM真PG由既有CI集成消费者运行', () => {
  it('两份验收位于现有integration选择范围，unit排除而集成配置保留', () => {
    for (const name of files) expect(existsSync(new URL(`./integration/${name}`, import.meta.url))).toBe(true);
    expect(unit.test.exclude).toContain('src/__tests__/integration/**');
    expect(integration.test.exclude).not.toContain('src/__tests__/integration/**');
    const workflow = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const job = workflow.match(/\n  brain-integration:[\s\S]*?(?=\n  [\w-]+:|$)/)?.[0];
    expect(job).toContain("POSTGRES_INTEGRATION: '1'");
    expect(job).toContain('--config vitest.integration.config.js');
    expect(job).toContain('src/__tests__/integration/');
    expect(job).toContain('DATABASE_URL: postgresql://cecelia:');
  });
  it('CI标记直接启用，DATABASE_URL优先，URL实际database不得覆盖成生产', () => {
    expect(api.crmPgTestConfig({ POSTGRES_INTEGRATION: '1', DATABASE_URL: 'postgresql://ci-user:test@localhost:5432/cecelia_test', DB_NAME: 'cecelia' })).toMatchObject({ enabled: true, database: 'cecelia_test', config: { connectionString: 'postgresql://ci-user:test@localhost:5432/cecelia_test' } });
    expect(() => api.crmPgTestConfig({ POSTGRES_INTEGRATION: '1', DATABASE_URL: 'postgresql://ci-user:test@localhost:5432/cecelia_test?database=cecelia' })).toThrow(/test database/);
  });
  it('DB_*连接CI测试库，缺少数据库不猜默认生产库', () => {
    expect(api.crmPgTestConfig({ POSTGRES_INTEGRATION: '1', DB_NAME: 'cecelia_test', DB_HOST: 'db', DB_PORT: '5433', DB_USER: 'ci-user', DB_PASSWORD: 'test-only' })).toMatchObject({ enabled: true, database: 'cecelia_test', config: { host: 'db', port: 5433, database: 'cecelia_test', user: 'ci-user', password: 'test-only' } });
    expect(() => api.crmPgTestConfig({ POSTGRES_INTEGRATION: '1' })).toThrow(/test database/);
    expect(() => api.crmPgTestConfig({ POSTGRES_INTEGRATION: '1', DB_NAME: 'cecelia' })).toThrow(/test database/);
  });
  it('本地显式scratch兼容，未启用不连接，指定危险库不会被scratch默认掩盖', () => {
    expect(api.crmPgTestConfig({ CRM_STORE_SCRATCH_TEST: '1' })).toMatchObject({ enabled: true, database: 'cecelia_scratch', config: { host: '/tmp', database: 'cecelia_scratch', user: 'administrator' } });
    expect(api.crmPgTestConfig({})).toEqual({ enabled: false });
    expect(() => api.crmPgTestConfig({ CRM_STORE_SCRATCH_TEST: '1', DATABASE_URL: 'postgresql://localhost/zenithjoy' })).toThrow(/test database/);
  });
});
