#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');

const TARGET_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/cecelia';
const SOURCE_DATABASE_URL = process.env.SOURCE_DATABASE_URL || TARGET_DATABASE_URL;
const SCAN_REPO_ROOT = path.resolve(process.env.SCAN_REPO_ROOT || path.resolve(__dirname, '../..'));
const SCAN_REPO_NAME = process.env.SCAN_REPO_NAME || 'cecelia';
const SCANNER_VERSION = 'db-schema-v2';

function stableTableName(schema, table) {
  return schema === 'public' ? table : `${schema}.${table}`;
}

async function describeTable(pool, tableSchema, tableName) {
  const { rows: columns } = await pool.query(
    `SELECT column_name AS name, data_type AS type,
            is_nullable = 'YES' AS nullable, column_default AS default_val,
            EXISTS(
              SELECT 1 FROM information_schema.key_column_usage k
              JOIN information_schema.table_constraints tc
                ON k.constraint_name=tc.constraint_name AND k.constraint_schema=tc.constraint_schema
             WHERE k.table_schema=$1 AND k.table_name=$2 AND k.column_name=c.column_name
               AND tc.constraint_type='PRIMARY KEY'
            ) AS primary_key
       FROM information_schema.columns c
      WHERE table_schema=$1 AND table_name=$2
      ORDER BY ordinal_position`,
    [tableSchema, tableName],
  );
  const { rows: indexes } = await pool.query(
    `SELECT indexname AS name, indexdef AS def, indexdef LIKE '%UNIQUE%' AS "unique"
       FROM pg_indexes WHERE schemaname=$1 AND tablename=$2`,
    [tableSchema, tableName],
  );
  const { rows: foreignKeys } = await pool.query(
    `SELECT kcu.column_name AS col,
            ccu.table_schema || '.' || ccu.table_name AS ref_table,
            ccu.column_name AS ref_col
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name=ccu.constraint_name AND tc.constraint_schema=ccu.constraint_schema
      WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=$1 AND tc.table_name=$2`,
    [tableSchema, tableName],
  );
  return {
    table_name: stableTableName(tableSchema, tableName),
    columns,
    indexes,
    foreign_keys: foreignKeys,
    area: tableSchema,
  };
}

async function main() {
  if (!fs.existsSync(SCAN_REPO_ROOT)) throw new Error(`scanner root 不存在: ${SCAN_REPO_ROOT}`);
  const [{ replaceFactSnapshot }, { readGitRevision }] = await Promise.all([
    import('../../packages/brain/src/lib/fact-snapshot-store.js'),
    import('../../packages/brain/src/lib/git-revision.js'),
  ]);
  const targetPool = new pg.Pool({ connectionString: TARGET_DATABASE_URL });
  const sourcePool = new pg.Pool({ connectionString: SOURCE_DATABASE_URL });
  try {
    const { rows: tables } = await sourcePool.query(
      `SELECT table_schema, table_name
         FROM information_schema.tables
        WHERE table_type='BASE TABLE'
          AND table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY table_schema, table_name`,
    );
    const facts = [];
    for (const { table_schema: tableSchema, table_name: tableName } of tables) {
      facts.push(await describeTable(sourcePool, tableSchema, tableName));
    }
    const sourceRevision = readGitRevision(SCAN_REPO_ROOT);
    await replaceFactSnapshot(targetPool, 'db_schema', {
      repo: SCAN_REPO_NAME,
      sourceRevision,
      scannerVersion: SCANNER_VERSION,
      rows: facts,
    });
    console.log(`db_schema_registry repo=${SCAN_REPO_NAME} rows=${facts.length} revision=${sourceRevision.slice(0, 8)}`);
  } finally {
    await Promise.all([targetPool.end(), sourcePool.end()]);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
