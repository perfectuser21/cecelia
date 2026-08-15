import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';

const { Pool } = pg;
const migrationSql = readFileSync(
  new URL('../../../migrations/426_map_repository_and_route_snapshot_authority.sql', import.meta.url),
  'utf8',
);
let pool;

beforeAll(() => {
  pool = new Pool({ ...DB_DEFAULTS, database: process.env.DB_NAME || 'cecelia_test', max: 1 });
});

afterAll(async () => {
  await pool?.end();
});

describe('migration 426 validation generation on PostgreSQL', () => {
  it('preserves legacy NULL while rejecting new coding rows without the generation', async () => {
    const schema = `route_rollout_${randomUUID().replaceAll('-', '')}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}", public`);
      await client.query('CREATE TABLE map_scope_repositories(scope_key text,repo text)');
      await client.query(
        `CREATE TABLE work_routing_receipts(
           work_kind text NOT NULL,change_kind text,
           default_execution_profile text,execution_profile_override text
         )`,
      );
      await client.query('CREATE TABLE schema_version(version text PRIMARY KEY,description text)');
      await client.query(
        `INSERT INTO work_routing_receipts(
           work_kind,change_kind,default_execution_profile,execution_profile_override
         ) VALUES('coding_mutation','bugfix','hotfix-v1',NULL)`,
      );

      await client.query(migrationSql);
      await expect(client.query(migrationSql)).resolves.toBeDefined();

      const legacy = await client.query(
        'SELECT map_scope_validation_version FROM work_routing_receipts',
      );
      expect(legacy.rows).toEqual([{ map_scope_validation_version: null }]);

      await client.query('SAVEPOINT missing_validation_version');
      await expect(client.query(
        `INSERT INTO work_routing_receipts(
           work_kind,change_kind,default_execution_profile,execution_profile_override
         ) VALUES('coding_mutation','bugfix','hotfix-v1',NULL)`,
      )).rejects.toMatchObject({
        code: '23514',
        constraint: 'work_routing_receipts_map_scope_validation_version_check',
      });
      await client.query('ROLLBACK TO SAVEPOINT missing_validation_version');

      await expect(client.query(
        `INSERT INTO work_routing_receipts(
           work_kind,change_kind,default_execution_profile,execution_profile_override,
           map_scope_validation_version
         ) VALUES('coding_mutation','bugfix','hotfix-v1',NULL,'active-business-node-v1')`,
      )).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
