import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { materializeApprovedContract } from '../contract-store.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);
let client;

const runId = '11111111-1111-4111-8111-111111111111';
const initiativeId = '22222222-2222-4222-8222-222222222222';

const HAS_REAL_POSTGRES = Boolean(process.env.DATABASE_URL || process.env.DB);

describe.runIf(HAS_REAL_POSTGRES)('materializeApprovedContract PostgreSQL contract', () => {
  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE initiative_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        initiative_id uuid NOT NULL,
        version integer NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        prd_content text,
        contract_content text,
        review_rounds integer DEFAULT 0,
        approved_at timestamptz,
        branch text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE (initiative_id, version)
      ) ON COMMIT DROP;
      CREATE TEMP TABLE initiative_runs (
        id uuid PRIMARY KEY,
        initiative_id uuid NOT NULL,
        contract_id uuid,
        updated_at timestamptz DEFAULT now()
      ) ON COMMIT DROP;
    `);
    await client.query(
      'INSERT INTO initiative_runs (id, initiative_id) VALUES ($1::uuid, $2::uuid)',
      [runId, initiativeId],
    );
    await client.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch)
       VALUES ($1::uuid, 1, 'draft', 'cp-old-r1')`,
      [initiativeId],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  });

  it('upserts the approved version, supersedes older versions, and attaches the run atomically', async () => {
    const approvedAt = new Date('2026-07-22T15:00:00Z');
    const contract = await materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-22222222-a8',
      prdContent: '# PRD',
      contractContent: '# Contract\n\n# DoD',
      approvedAt,
    });

    expect(contract).toMatchObject({
      version: 2,
      status: 'approved',
      branch: 'cp-harness-propose-r2-22222222-a8',
    });
    const { rows } = await client.query(`
      SELECT c.version, c.status, r.contract_id = c.id AS attached
      FROM initiative_contracts c
      CROSS JOIN initiative_runs r
      WHERE r.id = $1::uuid
      ORDER BY c.version
    `, [runId]);
    expect(rows).toEqual([
      { version: 1, status: 'superseded', attached: false },
      { version: 2, status: 'approved', attached: true },
    ]);
  });
});
