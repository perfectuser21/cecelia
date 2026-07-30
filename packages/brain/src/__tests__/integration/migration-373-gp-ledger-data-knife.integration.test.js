import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

let pool;
const migration373 = readFileSync(
  new URL('../../../migrations/373_gp_ledger_data_knife.sql', import.meta.url),
  'utf8',
);

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  // migration-350.integration.test.js intentionally replays the historical seed
  // against this shared CI database. Restore the latest post-migration contract
  // so this suite verifies 373, not whichever integration file ran immediately
  // before it.
  await pool.query(migration373);
});

describe('migration 373 Golden Path ledger data knife [PostgreSQL]', () => {
  it('registers schema version and journey_step target constraint', async () => {
    const version = await pool.query(
      `SELECT description FROM schema_version WHERE version='373'`,
    );
    expect(version.rows).toHaveLength(1);

    const constraint = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname='decisions_target_type_chk'`,
    );
    expect(constraint.rows[0].definition).toContain('journey_step');
  });

  it('places all four GP-B NFR decisions on product journey steps and inherits biz home', async () => {
    const { rows } = await pool.query(
      `SELECT d.source_ref, d.target_type, d.target_id, j.home
       FROM decisions d
       JOIN journey_steps s ON s.id=d.target_id
       JOIN journeys j ON j.id=s.journey_id
       WHERE d.source_ref LIKE 'gp-ledger-phase3:nfr:gp-b:%'
       ORDER BY d.source_ref`,
    );
    expect(rows).toHaveLength(4);
    expect(rows.every(row => row.target_type === 'journey_step')).toBe(true);
    expect(rows.every(row => row.home === 'biz')).toBe(true);
  });

  it('has no evidence-less positive cell and no unrecognized assertion prose', async () => {
    const positiveMissing = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM journey_step_links
       WHERE cell_kind IS NOT NULL
         AND cell_status IN ('green','pending')
         AND assertion_ref IS NULL
         AND na_reason IS NULL`,
    );
    expect(positiveMissing.rows[0].count).toBe(0);

    const unknown = await pool.query(
      `SELECT assertion_ref
       FROM journey_step_links
       WHERE assertion_ref IS NOT NULL
         AND assertion_ref NOT LIKE 'manual:%'
         AND assertion_ref NOT LIKE 'eval:%'
         AND assertion_ref NOT LIKE 'decision:%'
         AND assertion_ref NOT LIKE 'tests/%'
         AND assertion_ref NOT LIKE '%/tests/%'
         AND assertion_ref !~ '(^|/)test_[^/]+\\.py$'
         AND assertion_ref !~ '\\.(test|spec)\\.[cm]?[jt]sx?$'
         AND assertion_ref !~ '/smoke/[^/]+\\.sh$'`,
    );
    expect(unknown.rows).toEqual([]);
  });

  it('backfills positive base references from real feature anchors', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM journey_step_links
       WHERE cell_kind='base_ref'
         AND cell_status IN ('green','pending')
         AND assertion_ref IS NULL`,
    );
    expect(rows[0].count).toBe(0);
  });
});
