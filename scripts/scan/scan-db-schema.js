#!/usr/bin/env node
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('pg');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://localhost/cecelia' });
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCANNER_VERSION = 'db-schema-v2';

const CECELIA_TABLES = new Set([
  'journeys','journey_steps','journey_features','api_registry',
  'db_schema_registry','test_registry','issues','tasks','decisions',
  'learnings','dev_records','initiative_contracts','areas','features',
  'system_registry','notion_sync_log','db_schemas','okrs','key_results',
]);

function getSourceRevision() {
  try {
    const revision = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (!revision) throw new Error('empty revision');
    return revision;
  } catch (error) {
    throw new Error(`无法读取 cecelia source revision: ${error.message}`);
  }
}

async function main() {
  try {
    const sourceRevision = getSourceRevision();
    const { replaceFactSnapshot } = await import('../../packages/brain/src/lib/fact-snapshot-store.js');
    const { rows: tables } = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'
       ORDER BY table_name`,
    );

    const snapshotRows = [];
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

      snapshotRows.push({ table_name, columns: cols, indexes: idxs, foreign_keys: fks, area });
    }

    await replaceFactSnapshot(pool, 'db_schema', {
      repo: 'cecelia', sourceRevision, scannerVersion: SCANNER_VERSION, rows: snapshotRows,
    });
    console.log(`db_schema_registry 填充完成，共 ${snapshotRows.length} 条`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
