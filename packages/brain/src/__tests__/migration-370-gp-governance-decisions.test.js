import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const migrationUrl = new URL('../../migrations/370_gp_governance_decisions.sql', import.meta.url);
const migrationPath = fileURLToPath(migrationUrl);
const sql = existsSync(migrationPath) ? readFileSync(migrationUrl, 'utf8') : '';

describe('migration 370 — finalized Golden Path governance decisions', () => {
  it('exists as the next migration', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('seeds every finalized policy with stable machine keys', () => {
    const policyKeys = [
      'gp.sealing.element-criterion',
      'gp.sealing.contract-criterion',
      'gp.sealing.rejection-template',
      'gp.ownership-transfer.b',
      'gp.high-risk.global-invariant',
      'gp.classification-and-yield-defaults',
    ];

    expect(sql).toContain('policy_version');
    for (const key of policyKeys) {
      expect(sql).toContain(key);
      expect(sql).toContain(`harness-gp-governance-prd:${key}:v1`);
    }
  });

  it('adds a real global invariant level and the four immutable risk domains', () => {
    expect(sql).toMatch(/decisions_level_chk[\s\S]+?'global'[\s\S]+?'area'/);
    expect(sql).toContain("'category', 'invariant'");
    expect(sql).toContain("'level', 'global'");
    expect(sql).toContain("'permission'");
    expect(sql).toContain("'money'");
    expect(sql).toContain("'external_publish'");
    expect(sql).toContain("'production_data'");
    expect(sql).toContain("'require_human_confirmation'");
  });

  it('records the sealed wording, ownership B condition, and default yield order', () => {
    expect(sql).toContain('每步单独回答、逐步不同、且未被四区收留');
    expect(sql).toContain('每 GP 单独回答、且必须人签字');
    expect(sql).toContain('11 要素封版，不再增补');
    expect(sql).toContain('红方接线');
    expect(sql).toContain('断言盖章');
    expect(sql).toContain('权和闸同步交接，不裸奔');
    expect(sql).toContain('安全/资金正确性');
    expect(sql).toContain('数据一致性');
    expect(sql).toContain('功能完整');
    expect(sql).toContain('性能');
    expect(sql).toContain('体验顺滑');
  });

  it('is Owner-attributed and idempotent only within the governance namespace', () => {
    expect(sql).toContain("'owner'");
    expect(sql).toContain("'user'");
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]+source_ref[\s\S]+harness-gp-governance-prd:/);
    expect(sql).toMatch(/ON CONFLICT\s*\(source_ref\)[\s\S]+harness-gp-governance-prd:/);
    expect(sql).toContain("VALUES ('370'");
  });
});

describe('migration 370 — PostgreSQL execution and idempotency', () => {
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
