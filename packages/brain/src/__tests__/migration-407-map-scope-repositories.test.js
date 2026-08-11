import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const upSql = readFileSync(
  new URL('../../migrations/407_map_scope_repositories.sql', import.meta.url),
  'utf8',
);
const downSql = readFileSync(
  new URL('../../migrations/rollback/407_map_scope_repositories.down.sql', import.meta.url),
  'utf8',
);

describe('migration 407 — explicit map scope repositories', () => {
  it('建立 scope 到 repo 的显式多对多配置与 adapter key', () => {
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS map_scope_repositories/i);
    expect(upSql).toMatch(/scope_key TEXT NOT NULL/i);
    expect(upSql).toMatch(/repo TEXT NOT NULL/i);
    expect(upSql).toMatch(/adapter_key TEXT NOT NULL/i);
    expect(upSql).toMatch(/adapter_config JSONB NOT NULL/i);
    expect(upSql).toMatch(/PRIMARY KEY \(scope_key, repo\)/i);
  });

  it('种入 Cecelia 首个验收域的显式映射，不定义隐式同名规则', () => {
    expect(upSql).toMatch(/VALUES\s*\(\s*'cecelia',\s*'cecelia',\s*'legacy-ledger-v1',[\s\S]*ledger_partition/i);
    expect(upSql).not.toMatch(/scope_key\s*=\s*repo/i);
  });

  it('rollback 移除配置表和 schema marker', () => {
    expect(downSql).toMatch(/DROP TABLE IF EXISTS map_scope_repositories/i);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '407'/i);
  });

  it('登记 schema 407', () => {
    expect(upSql).toMatch(/VALUES\s*\(\s*'407'/i);
  });
});
