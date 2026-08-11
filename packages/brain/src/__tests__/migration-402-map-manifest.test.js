import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const upSql = readFileSync(new URL('../../migrations/402_map_manifest_versions.sql', import.meta.url), 'utf8');
const downSql = readFileSync(new URL('../../migrations/rollback/402_map_manifest_versions.down.sql', import.meta.url), 'utf8');

describe('migration 402 — immutable map manifest versions', () => {
  it('建立版本表、decision FK、digest/version 幂等键与状态约束', () => {
    expect(upSql).toMatch(/CREATE TABLE IF NOT EXISTS map_manifest_versions/i);
    expect(upSql).toMatch(/source_decision_id UUID NOT NULL REFERENCES decisions\s*\(id\)/i);
    expect(upSql).toMatch(/UNIQUE\s*\(scope_key,\s*version\)/i);
    expect(upSql).toMatch(/UNIQUE\s*\(scope_key,\s*digest\)/i);
    expect(upSql).toMatch(/CHECK\s*\(status IN \('draft', 'active', 'superseded', 'rejected'\)\)/i);
    expect(upSql).toMatch(/digest ~ '\^\[0-9a-f\]\{64\}\$'/i);
  });

  it('partial unique index 保证每 scope 最多一个 active', () => {
    expect(upSql).toMatch(/CREATE UNIQUE INDEX[\s\S]*ON map_manifest_versions\s*\(scope_key\)[\s\S]*WHERE status = 'active'/i);
  });

  it('immutable trigger 禁止更新完整版本字段，rollback 移除函数与表', () => {
    expect(upSql).toMatch(/BEFORE UPDATE ON map_manifest_versions/i);
    for (const column of ['scope_key', 'version', 'source_decision_id', 'manifest', 'digest', 'created_at']) {
      expect(upSql).toMatch(new RegExp(`NEW\\.${column}\\s+IS DISTINCT FROM\\s+OLD\\.${column}`, 'i'));
    }
    expect(downSql).toMatch(/DROP FUNCTION IF EXISTS reject_map_manifest_content_update/i);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS map_manifest_versions/i);
  });

  it('登记 schema 402', () => {
    expect(upSql).toMatch(/VALUES\s*\(\s*'402'/i);
  });
});
