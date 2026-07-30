import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pool from '../../db.js';
import {
  ensureSyntheticRun,
} from '../../../scripts/smoke/kernel-fleet-three-machine-canary.mjs';

let client;

beforeAll(async () => {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query(`
    CREATE TEMP TABLE initiative_runs (
      id UUID PRIMARY KEY,
      initiative_id UUID NOT NULL,
      phase TEXT NOT NULL,
      orchestrator_version TEXT NOT NULL DEFAULT 'v1'
        CHECK (orchestrator_version IN ('v1','v2')),
      orchestrator_host TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    ) ON COMMIT DROP;
  `);
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    client.release();
  }
  await pool.end();
});

describe('Fleet synthetic canary run PostgreSQL contract', () => {
  it('uses the legal v1 lane and never impersonates a business v2 run', async () => {
    const runId = randomUUID();

    await ensureSyntheticRun(client, runId);

    const result = await client.query(
      `SELECT initiative_id,phase,orchestrator_version,orchestrator_host
         FROM initiative_runs
        WHERE id=$1`,
      [runId],
    );
    expect(result.rows).toEqual([{
      initiative_id: runId,
      phase: 'gan',
      orchestrator_version: 'v1',
      orchestrator_host: 'kernel-fleet-canary',
    }]);
  });
});
