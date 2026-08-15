import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const upSql = readFileSync(
  new URL('../../migrations/426_map_repository_and_route_snapshot_authority.sql', import.meta.url),
  'utf8',
);
const downSql = readFileSync(
  new URL(
    '../../migrations/rollback/426_map_repository_and_route_snapshot_authority.down.sql',
    import.meta.url,
  ),
  'utf8',
);

describe('migration 426 — Map route snapshot authority', () => {
  it('makes repository ownership unique and records schema 426', () => {
    expect(upSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS\s+uq_map_scope_repositories_repo[\s\S]*ON map_scope_repositories\s*\(\s*repo\s*\)/i,
    );
    expect(upSql).toMatch(/VALUES\s*\(\s*'426'/i);
  });

  it('rejects new receipt profile downgrades without validating legacy rows', () => {
    expect(upSql).toMatch(
      /ADD CONSTRAINT work_routing_receipts_profile_shape_strength_check[\s\S]*CHECK[\s\S]*NOT VALID/i,
    );
    expect(upSql).toMatch(/change_kind IS NOT NULL/i);
    expect(upSql).toMatch(/default_execution_profile IS NOT NULL/i);
    expect(upSql).toMatch(/execution_profile_override[\s\S]*default_execution_profile/i);
    expect(upSql).toMatch(/new-capability-v1[\s\S]*capability-change-v1[\s\S]*hotfix-v1/i);
  });

  it('versions newly validated coding receipts without rewriting legacy authority', () => {
    expect(upSql).toMatch(
      /ADD COLUMN IF NOT EXISTS map_scope_validation_version\s+text/i,
    );
    expect(upSql).toMatch(
      /ADD CONSTRAINT work_routing_receipts_map_scope_validation_version_check[\s\S]*work_kind\s*<>\s*'coding_mutation'[\s\S]*map_scope_validation_version\s*=\s*'active-business-node-v1'[\s\S]*NOT VALID/i,
    );
    expect(upSql).toMatch(/map_scope_validation_version IS NOT NULL/i);
    expect(upSql).not.toMatch(/UPDATE\s+work_routing_receipts[\s\S]*map_scope_validation_version/i);
  });

  it('rollback removes the unique authority before its schema marker', () => {
    expect(downSql).toMatch(
      /DROP CONSTRAINT IF EXISTS work_routing_receipts_profile_shape_strength_check/i,
    );
    expect(downSql).toMatch(
      /DROP CONSTRAINT IF EXISTS work_routing_receipts_map_scope_validation_version_check/i,
    );
    expect(downSql).toMatch(
      /DROP COLUMN IF EXISTS map_scope_validation_version/i,
    );
    expect(downSql).toMatch(/DROP INDEX IF EXISTS uq_map_scope_repositories_repo/i);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '426'/i);
    expect(downSql.indexOf('DROP INDEX')).toBeLessThan(downSql.indexOf('DELETE FROM schema_version'));
  });
});
