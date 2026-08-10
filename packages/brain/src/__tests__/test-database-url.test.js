import { describe, expect, it } from 'vitest';
import { resolveTestDatabaseUrl } from './test-database-url.js';

describe('resolveTestDatabaseUrl', () => {
  it('优先使用 TEST_DATABASE_URL', () => {
    expect(resolveTestDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://test-user:test-pass@test-host:5433/cecelia_test',
      DATABASE_URL: 'postgresql://database-user:database-pass@database-host:5432/other_test',
    })).toBe('postgresql://test-user:test-pass@test-host:5433/cecelia_test');
  });

  it('CI 未设置 TEST_DATABASE_URL 时使用带密码的 DATABASE_URL', () => {
    expect(resolveTestDatabaseUrl({
      DATABASE_URL: 'postgresql://cecelia:ci-secret@localhost:5432/cecelia_test',
      DB_PASSWORD: 'ignored-secret',
    })).toBe('postgresql://cecelia:ci-secret@localhost:5432/cecelia_test');
  });

  it('无 URL 时从 DB_* 变量构造并编码凭据', () => {
    expect(resolveTestDatabaseUrl({
      DB_HOST: 'db.local',
      DB_PORT: '5544',
      DB_NAME: 'map_scratch',
      DB_USER: 'map user',
      DB_PASSWORD: 'p@ss:word',
    })).toBe('postgresql://map%20user:p%40ss%3Aword@db.local:5544/map_scratch');
  });

  it('拒绝任何非 _test 或 _scratch 数据库', () => {
    expect(() => resolveTestDatabaseUrl({
      DATABASE_URL: 'postgresql://cecelia:secret@localhost:5432/cecelia',
    })).toThrow('集成测试拒绝连接非测试库: cecelia');
  });
});
