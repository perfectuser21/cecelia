import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const migrationUrl = new URL('../../migrations/370_gp_governance_decisions.sql', import.meta.url);
const sql = readFileSync(migrationUrl, 'utf8');

const HAS_REAL_POSTGRES = Boolean(process.env.DATABASE_URL || process.env.DB);

describe.runIf(HAS_REAL_POSTGRES)('migration 370 — PostgreSQL execution and idempotency', () => {
  let pool;
  let client;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
      port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
      database: process.env.PGDATABASE || process.env.DB_NAME || 'cecelia_test',
      user: process.env.PGUSER || process.env.DB_USER || 'cecelia',
      password: process.env.PGPASSWORD || process.env.DB_PASSWORD || undefined,
      max: 1,
    });
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO pg_temp, public');
    await client.query(`
      CREATE TEMP TABLE decisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category TEXT,
        topic TEXT,
        decision TEXT,
        reason TEXT,
        status TEXT,
        level TEXT,
        scope TEXT,
        context JSONB,
        source_ref TEXT,
        author TEXT,
        made_by TEXT,
        priority TEXT,
        area TEXT,
        decided_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ
      );
      CREATE TEMP TABLE schema_version (
        version TEXT PRIMARY KEY,
        description TEXT,
        applied_at TIMESTAMPTZ
      );
    `);
    await client.query(sql);
    await client.query(sql);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    if (pool) await pool.end();
  });

  it('keeps exactly one active row for each of the six stable policy keys', async () => {
    const { rows } = await client.query(`
      SELECT context->>'policy_key' AS policy_key, COUNT(*)::int AS count
      FROM decisions
      GROUP BY context->>'policy_key'
      ORDER BY policy_key
    `);

    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.count === 1)).toBe(true);
    expect(rows.map((row) => row.policy_key)).toEqual([
      'gp.classification-and-yield-defaults',
      'gp.high-risk.global-invariant',
      'gp.ownership-transfer.b',
      'gp.sealing.contract-criterion',
      'gp.sealing.element-criterion',
      'gp.sealing.rejection-template',
    ]);
  });

  it('persists the exact global human-gate payload and leaves ownership transfer inactive', async () => {
    const { rows: riskRows } = await client.query(`
      SELECT category, level, context
      FROM decisions
      WHERE context->>'policy_key' = 'gp.high-risk.global-invariant'
    `);
    expect(riskRows[0]).toMatchObject({
      category: 'invariant',
      level: 'global',
    });
    expect(riskRows[0].context.risk_domains).toEqual([
      'permission',
      'money',
      'external_publish',
      'production_data',
    ]);
    expect(riskRows[0].context.action).toBe('require_human_confirmation');

    const { rows: ownershipRows } = await client.query(`
      SELECT context
      FROM decisions
      WHERE context->>'policy_key' = 'gp.ownership-transfer.b'
    `);
    expect(ownershipRows[0].context.effective_now).toBe(false);
    expect(ownershipRows[0].context.effective_when).toEqual([
      'red_team_wiring_live',
      'assertion_stamping_live',
    ]);
  });
});
