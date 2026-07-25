import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  __dirname,
  '../../../packages/brain/migrations/360_session_provenance.sql'
);
const database = process.env.DB_NAME || 'cecelia_test';
const schema = `contract_360_${process.pid}_${randomUUID().replaceAll('-', '')}`;

if (!/_test$|_scratch$/.test(database)) {
  throw new Error(`contract test requires a test database, got ${database}`);
}

function psql(sql: string) {
  return spawnSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      database,
      '-tA',
      '-c',
      sql,
    ],
    {
      encoding: 'utf8',
      env: process.env,
    }
  );
}

afterAll(() => {
  psql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
});

describe('session provenance contract（真 PostgreSQL，不 mock DB 边）', () => {
  it('session_provenance migration 在真 PostgreSQL 中约束 human/machine 并可重复应用', () => {
    expect(
      fs.existsSync(migrationPath),
      'RED: packages/brain/migrations/360_session_provenance.sql 尚未实现'
    ).toBe(true);

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    const setup = psql(`
      CREATE SCHEMA "${schema}";
      SET search_path TO "${schema}";
      CREATE TABLE schema_version (
        version TEXT PRIMARY KEY,
        description TEXT,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
      ${migrationSql}
      ${migrationSql}
      INSERT INTO session_provenance(session_id, kind, launched_by)
      VALUES ('human-session', 'human', 'contract-test');
      INSERT INTO session_provenance(session_id, kind, launched_by, task_id)
      VALUES (
        'machine-session',
        'machine',
        'contract-test',
        '00000000-0000-4000-8000-000000000001'
      );
      INSERT INTO session_provenance(session_id, kind, launched_by)
      VALUES ('human-session', 'machine', 'must-not-overwrite')
      ON CONFLICT (session_id) DO NOTHING;
    `);
    expect(setup.status, setup.stderr).toBe(0);

    const rows = psql(`
      SET search_path TO "${schema}";
      SELECT session_id || '|' || kind || '|' || launched_by || '|' ||
             COALESCE(task_id::text, 'NULL')
      FROM session_provenance
      ORDER BY session_id;
    `);
    expect(rows.status, rows.stderr).toBe(0);
    expect(rows.stdout.trim().split('\n')).toEqual([
      'human-session|human|contract-test|NULL',
      'machine-session|machine|contract-test|00000000-0000-4000-8000-000000000001',
    ]);

    const invalid = psql(`
      SET search_path TO "${schema}";
      INSERT INTO session_provenance(session_id, kind, launched_by)
      VALUES ('invalid-session', 'robot', 'contract-test');
    `);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('session_provenance_kind_check');
  });
});

