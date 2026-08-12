import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { materializeApprovedContract } from '../contract-store.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);
let client;

const runId = '11111111-1111-4111-8111-111111111111';
const initiativeId = '22222222-2222-4222-8222-222222222222';
const revision = '6faaa9f55e9789ffd29fd2760a9b5994df272e86';
function artifact(path, content) {
  return Object.freeze({
    path,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    byte_length: Buffer.byteLength(content),
    source_revision: revision,
  });
}
const artifacts = Object.freeze([
  artifact('sprints/router/contract-dod.md', '# DoD'),
  artifact('sprints/router/contract-draft.md', '# Contract'),
  artifact('sprints/router/sprint-prd.md', '# PRD'),
  artifact('sprints/router/tests/routing.test.mjs', 'test("routing", () => {})'),
]);

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
      CREATE TEMP TABLE initiative_contract_artifacts (
        contract_id uuid NOT NULL REFERENCES initiative_contracts(id),
        path text NOT NULL,
        content text NOT NULL,
        sha256 text NOT NULL,
        byte_length integer NOT NULL CHECK (byte_length >= 0),
        source_revision text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (contract_id, path)
      ) ON COMMIT DROP;
      CREATE TEMP TABLE initiative_contract_artifact_seals (
        contract_id uuid PRIMARY KEY REFERENCES initiative_contracts(id),
        artifact_count integer NOT NULL,
        manifest_sha256 text NOT NULL,
        source_revision text NOT NULL,
        sealed_at timestamptz NOT NULL DEFAULT now()
      ) ON COMMIT DROP;
      CREATE OR REPLACE FUNCTION pg_temp.reject_sealed_artifact_append()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $trigger$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM initiative_contract_artifact_seals
           WHERE contract_id = NEW.contract_id
        ) THEN
          RAISE EXCEPTION 'initiative_contract_artifacts are sealed after approval';
        END IF;
        RETURN NEW;
      END;
      $trigger$;
      CREATE TRIGGER initiative_contract_artifacts_no_append
      BEFORE INSERT ON initiative_contract_artifacts
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_sealed_artifact_append();
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
      artifacts,
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

    const frozen = await client.query(
      `SELECT path, content, sha256, byte_length, source_revision
         FROM initiative_contract_artifacts
        WHERE contract_id = $1::uuid`,
      [contract.id],
    );
    expect(frozen.rows).toEqual(artifacts);
    const sealed = await client.query(
      `SELECT artifact_count, source_revision, length(manifest_sha256) AS digest_length
         FROM initiative_contract_artifact_seals
        WHERE contract_id = $1::uuid`,
      [contract.id],
    );
    expect(sealed.rows).toEqual([{
      artifact_count: 4,
      source_revision: revision,
      digest_length: 64,
    }]);
    await client.query('SAVEPOINT sealed_append_probe');
    await expect(client.query(
      `INSERT INTO initiative_contract_artifacts
         (contract_id, path, content, sha256, byte_length, source_revision)
       VALUES ($1::uuid, 'sprints/router/tests/appended.test.mjs', 'x', $2, 1, $3)`,
      [contract.id, createHash('sha256').update('x').digest('hex'), revision],
    )).rejects.toThrow(/sealed after approval/i);
    await client.query('ROLLBACK TO SAVEPOINT sealed_append_probe');

    await expect(materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-22222222-a8',
      prdContent: '# PRD',
      contractContent: '# Contract\n\n# DoD',
      artifacts,
      approvedAt,
    })).resolves.toMatchObject({ id: contract.id, status: 'approved' });

    await expect(materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-22222222-a8',
      prdContent: '# PRD',
      contractContent: '# Contract\n\n# DoD',
      artifacts: artifacts.map((item) => item.path.endsWith('/tests/routing.test.mjs')
        ? { ...item, content: 'mutated' }
        : item),
      approvedAt,
    })).rejects.toThrow(/FROZEN_CONTRACT_ARTIFACT_INVALID|immutable/i);

    const unchanged = await client.query(
      'SELECT content FROM initiative_contract_artifacts WHERE contract_id = $1::uuid',
      [contract.id],
    );
    expect(unchanged.rows).toEqual(artifacts.map(({ content }) => ({ content })));

    await expect(materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-22222222-a8',
      prdContent: '# MUTATED PRD',
      contractContent: '# Contract\n\n# DoD',
      artifacts: undefined,
      approvedAt,
    })).rejects.toThrow(/approved_contract_immutable_mismatch/i);

    await expect(materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-different-branch',
      prdContent: '# PRD',
      contractContent: '# Contract\n\n# DoD',
      artifacts,
      approvedAt,
    })).rejects.toThrow(/approved_contract_immutable_mismatch/i);

    const immutableContract = await client.query(
      'SELECT branch, prd_content FROM initiative_contracts WHERE id = $1::uuid',
      [contract.id],
    );
    expect(immutableContract.rows).toEqual([{
      branch: 'cp-harness-propose-r2-22222222-a8',
      prd_content: '# PRD',
    }]);
  });
});
