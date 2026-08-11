#!/usr/bin/env node
'use strict';
const pg = require('pg');
const { execSync } = require('child_process');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = require('path').resolve(__dirname, '../..');
const SCANNER_VERSION = 'db-schema-v2';

function readGitRevision(dir) {
  try { return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8', timeout: 5000 }).trim(); }
  catch { return null; }
}

async function replaceFactSnapshot(pool, kind, { repo, sourceRevision, scannerVersion }) {
  await pool.query(
    `INSERT INTO fact_snapshot_headers (kind, repo, source_revision, scanner_version, scanned_at, row_count)
     VALUES ($1, $2, $3, $4, NOW(), (SELECT COUNT(*)::int FROM db_schema_registry WHERE repo = $2))
     ON CONFLICT (kind, repo) DO UPDATE
       SET source_revision = EXCLUDED.source_revision,
           scanner_version = EXCLUDED.scanner_version,
           scanned_at = EXCLUDED.scanned_at,
           row_count = EXCLUDED.row_count`,
    [kind, repo, sourceRevision, scannerVersion],
  );
}

const CECELIA_TABLES = new Set([
  'journeys','journey_steps','journey_features','api_registry',
  'db_schema_registry','test_registry','issues','tasks','decisions',
  'learnings','dev_records','initiative_contracts','areas','features',
  'system_registry','notion_sync_log','db_schemas','okrs','key_results',
]);

async function main() {
  const sourceRevision = readGitRevision(REPO_ROOT);
  try {
    const { rows: tables } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'
       ORDER BY table_name`,
    );

    for (const { table_name } of tables) {
      const { rows: cols } = await pool.query(
        `SELECT column_name AS name, data_type AS type,
                is_nullable = 'YES' AS nullable,
                column_default AS default_val,
                EXISTS(
                  SELECT 1 FROM information_schema.key_column_usage k
                  JOIN information_schema.table_constraints tc
                    ON k.constraint_name=tc.constraint_name
                  WHERE k.table_name=$1 AND k.column_name=c.column_name
                    AND tc.constraint_type='PRIMARY KEY'
                ) AS primary_key
         FROM information_schema.columns c
         WHERE table_schema='public' AND table_name=$1
         ORDER BY ordinal_position`,
        [table_name],
      );

      const { rows: idxs } = await pool.query(
        `SELECT indexname AS name, indexdef AS def,
                indexdef LIKE '%UNIQUE%' AS "unique"
         FROM pg_indexes WHERE tablename=$1`,
        [table_name],
      );

      const { rows: fks } = await pool.query(
        `SELECT kcu.column_name AS col,
                ccu.table_name  AS ref_table,
                ccu.column_name AS ref_col
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name=kcu.constraint_name AND kcu.table_name=$1
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name=ccu.constraint_name
         WHERE tc.constraint_type='FOREIGN KEY'`,
        [table_name],
      );

      const area = CECELIA_TABLES.has(table_name) ? 'cecelia' : 'shared';

      await pool.query(
        `INSERT INTO db_schema_registry (table_name, columns, indexes, foreign_keys, area, repo, source_revision, scanner_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (repo, table_name) DO UPDATE
           SET columns=$2, indexes=$3, foreign_keys=$4, area=$5,
               source_revision=$7, scanner_version=$8,
               scanned_at=NOW(), updated_at=NOW()`,
        [table_name, JSON.stringify(cols), JSON.stringify(idxs), JSON.stringify(fks), area, 'cecelia', sourceRevision, SCANNER_VERSION],
      );
    }

    const { rows: [{ cnt }] } = await pool.query(
      'SELECT COUNT(*)::int AS cnt FROM db_schema_registry',
    );
    await replaceFactSnapshot(pool, 'db_schema', {
      repo: 'cecelia',
      sourceRevision,
      scannerVersion: SCANNER_VERSION,
    });
    console.log(`db_schema_registry 填充完成，共 ${cnt} 条 revision=${sourceRevision?.slice(0,8) ?? 'unknown'}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
