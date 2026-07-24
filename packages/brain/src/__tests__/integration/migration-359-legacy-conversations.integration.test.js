/**
 * Migration 359 legacy-conversations integration test (real PostgreSQL).
 *
 * Reproduces the production collision where a capture-era `conversations`
 * table predates migration 359. Each test uses a unique schema so the real
 * migration SQL can run without touching shared public tables.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, '../../../migrations/359_conversations.sql'),
  'utf8'
);

if (!/_test$|_scratch$/.test(DB_DEFAULTS.database || '')) {
  throw new Error(
    `migration 359 integration test requires a test database, got ${DB_DEFAULTS.database}`
  );
}

const pool = new pg.Pool({ ...DB_DEFAULTS, max: 2 });
let client;
let schemaName;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function executeMigration() {
  await client.query('BEGIN');
  try {
    await client.query(migrationSql);
    await client.query('COMMIT');
    return null;
  } catch (error) {
    await client.query('ROLLBACK');
    return error;
  }
}

async function createParentTables() {
  await client.query(`
    CREATE TABLE journeys (id UUID PRIMARY KEY);
    CREATE TABLE golden_path (id UUID PRIMARY KEY);
  `);
}

async function createLegacyConversations(tableName = 'conversations') {
  await client.query(`
    CREATE TABLE ${quoteIdentifier(tableName)} (
      id UUID PRIMARY KEY,
      mode TEXT,
      topic TEXT,
      summary TEXT,
      key_points JSONB,
      action_items JSONB,
      area TEXT,
      session_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      area_id UUID
    )
  `);
}

describe('migration 359 — production-shaped legacy conversations', () => {
  beforeEach(async () => {
    schemaName = `migration_359_${process.pid}_${randomUUID().replaceAll('-', '')}`;
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await client.query(
      `SET search_path TO ${quoteIdentifier(schemaName)}, public`
    );
    await createParentTables();
  });

  afterEach(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.query('SET search_path TO public');
    await client.query(
      `DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`
    );
    client.release();
    client = null;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('renames the legacy table, preserves its row, creates the new schema, and reruns idempotently', async () => {
    const legacyId = '11111111-1111-4111-8111-111111111111';
    await createLegacyConversations();
    await client.query(
      `INSERT INTO conversations (id, mode, topic, summary, key_points, action_items, area)
       VALUES ($1, 'pair', 'legacy topic', 'legacy summary', '["point"]', '["act"]', 'brain')`,
      [legacyId]
    );

    const firstError = await executeMigration();
    expect(firstError?.message ?? null).toBeNull();

    const newColumn = await client.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = 'conversations'
        AND column_name = 'journey_id'
    `, [schemaName]);
    expect(newColumn.rows).toEqual([{ data_type: 'uuid' }]);

    const preserved = await client.query(`
      SELECT id, topic, summary
      FROM conversations_legacy_pre_359
      WHERE id = $1
    `, [legacyId]);
    expect(preserved.rows).toEqual([{
      id: legacyId,
      topic: 'legacy topic',
      summary: 'legacy summary',
    }]);

    const primaryKeys = await client.query(`
      SELECT t.relname AS table_name, c.conname AS constraint_name
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1
        AND c.contype = 'p'
        AND t.relname IN ('conversations', 'conversations_legacy_pre_359')
      ORDER BY t.relname
    `, [schemaName]);
    expect(primaryKeys.rows).toEqual([
      {
        table_name: 'conversations',
        constraint_name: 'conversations_pkey',
      },
      {
        table_name: 'conversations_legacy_pre_359',
        constraint_name: 'conversations_legacy_pre_359_pkey',
      },
    ]);

    const secondError = await executeMigration();
    expect(secondError?.message ?? null).toBeNull();

    const preservedAfterRerun = await client.query(
      'SELECT COUNT(*)::int AS count FROM conversations_legacy_pre_359'
    );
    expect(preservedAfterRerun.rows[0].count).toBe(1);
  });

  it('fails closed when both an incompatible current table and legacy backup exist', async () => {
    await createLegacyConversations('conversations');
    await createLegacyConversations('conversations_legacy_pre_359');
    await client.query(`
      INSERT INTO conversations
        (id, topic)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 'current legacy');
      INSERT INTO conversations_legacy_pre_359
        (id, topic)
      VALUES
        ('33333333-3333-4333-8333-333333333333', 'existing backup');
    `);

    const error = await executeMigration();
    expect(error).not.toBeNull();
    expect(error.message).toContain(
      'migration 359: incompatible conversations and conversations_legacy_pre_359 both exist'
    );

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM conversations) AS current_count,
        (SELECT COUNT(*)::int FROM conversations_legacy_pre_359) AS backup_count
    `);
    expect(counts.rows).toEqual([{ current_count: 1, backup_count: 1 }]);
  });
});
