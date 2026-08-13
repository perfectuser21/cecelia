import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { materializeApprovedContract } from '../contract-store.js';

const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);
let client;

const runId = '11111111-1111-4111-8111-111111111111';
const initiativeId = '22222222-2222-4222-8222-222222222222';
const rerunId = '33333333-3333-4333-8333-333333333333';
const concurrentRunA = '44444444-4444-4444-8444-444444444444';
const concurrentRunB = '55555555-5555-4555-8555-555555555555';
const concurrentInitiativeId = '66666666-6666-4666-8666-666666666666';
const concurrencySchema = `contract_store_${process.pid}`;
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
    await client.query(`
      CREATE SCHEMA ${concurrencySchema};
      CREATE TABLE ${concurrencySchema}.initiative_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        initiative_id uuid NOT NULL,
        version integer NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        prd_content text,
        contract_content text,
        approved_sha text,
        frozen_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
        review_rounds integer DEFAULT 0,
        approved_at timestamptz,
        branch text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE (initiative_id, version)
      );
      CREATE TABLE ${concurrencySchema}.initiative_runs (
        id uuid PRIMARY KEY,
        initiative_id uuid NOT NULL,
        contract_id uuid,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE ${concurrencySchema}.tasks (id uuid PRIMARY KEY);
      CREATE TABLE ${concurrencySchema}.initiative_contract_artifacts (
        contract_id uuid NOT NULL REFERENCES ${concurrencySchema}.initiative_contracts(id),
        path text NOT NULL,
        content text NOT NULL,
        sha256 text NOT NULL,
        byte_length integer NOT NULL,
        source_revision text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (contract_id, path)
      );
      CREATE TABLE ${concurrencySchema}.initiative_contract_artifact_seals (
        contract_id uuid PRIMARY KEY REFERENCES ${concurrencySchema}.initiative_contracts(id),
        artifact_count integer NOT NULL,
        manifest_sha256 text NOT NULL,
        source_revision text NOT NULL,
        sealed_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE initiative_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        initiative_id uuid NOT NULL,
        version integer NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        prd_content text,
        contract_content text,
        approved_sha text,
        frozen_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
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
      CREATE TEMP TABLE tasks (id uuid PRIMARY KEY) ON COMMIT DROP;
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
    await client.query('INSERT INTO tasks (id) VALUES ($1::uuid)', [initiativeId]);
    await client.query(
      `INSERT INTO initiative_runs (id, initiative_id)
       VALUES ($1::uuid, $3::uuid), ($2::uuid, $3::uuid)`,
      [runId, rerunId, initiativeId],
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
    await pool.query(`DROP SCHEMA IF EXISTS ${concurrencySchema} CASCADE`);
    await pool.end();
  });

  it('materializes the approved version, supersedes older versions, and attaches the run atomically', async () => {
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
      SELECT c.version, c.status, r.contract_id = c.id AS attached,
             c.approved_sha, c.frozen_artifacts
      FROM initiative_contracts c
      CROSS JOIN initiative_runs r
      WHERE r.id = $1::uuid
      ORDER BY c.version
    `, [runId]);
    expect(rows).toEqual([
      {
        version: 1, status: 'superseded', attached: false,
        approved_sha: null, frozen_artifacts: [],
      },
      {
        version: 2, status: 'approved', attached: true,
        approved_sha: revision,
        frozen_artifacts: [],
      },
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
    })).rejects.toThrow(/evidence mismatch|approved_contract_immutable_mismatch/i);

    await expect(materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-different-branch',
      prdContent: '# PRD',
      contractContent: '# Contract\n\n# DoD',
      artifacts,
      approvedAt,
    })).rejects.toThrow(/evidence mismatch|approved_contract_immutable_mismatch/i);

    const immutableContract = await client.query(
      'SELECT branch, prd_content FROM initiative_contracts WHERE id = $1::uuid',
      [contract.id],
    );
    expect(immutableContract.rows).toEqual([{
      branch: 'cp-harness-propose-r2-22222222-a8',
      prd_content: '# PRD',
    }]);
  });

  it('allocates a new immutable version when a rerun approves the same GAN round', async () => {
    const oldRevision = 'c'.repeat(40);
    const newRevision = 'd'.repeat(40);
    const rerunArtifacts = artifacts.map((item) => ({
      ...item,
      source_revision: newRevision,
    }));
    await client.query(
      `INSERT INTO initiative_contracts
         (initiative_id, version, status, approved_sha, branch)
       VALUES ($1::uuid, 3, 'approved', $2, 'cp-old-r3')`,
      [initiativeId, oldRevision],
    );

    const contract = await materializeApprovedContract(client, {
      runId: rerunId,
      version: 3,
      branch: 'cp-new-r3',
      prdContent: '# PRD',
      contractContent: '# Contract\n\n# DoD',
      artifacts: rerunArtifacts,
    });

    expect(contract).toMatchObject({ version: 4, status: 'approved', branch: 'cp-new-r3' });
    const contracts = await client.query(
      `SELECT version, status, approved_sha,
              id = (SELECT contract_id FROM initiative_runs WHERE id = $2::uuid) AS attached
         FROM initiative_contracts
        WHERE initiative_id = $1::uuid AND version >= 3
        ORDER BY version`,
      [initiativeId, rerunId],
    );
    expect(contracts.rows).toEqual([
      { version: 3, status: 'superseded', approved_sha: oldRevision, attached: false },
      { version: 4, status: 'approved', approved_sha: newRevision, attached: true },
    ]);
  });

  it('serializes concurrent approvals for one initiative onto distinct versions', async () => {
    const poolOptions = {
      ...DB_DEFAULTS,
      max: 1,
      options: `-c search_path=${concurrencySchema},public`,
    };
    const firstPool = new Pool(poolOptions);
    const secondPool = new Pool(poolOptions);
    const firstRevision = 'e'.repeat(40);
    const secondRevision = 'f'.repeat(40);
    const artifactsFor = (sourceRevision) => artifacts.map((item) => ({
      ...item,
      source_revision: sourceRevision,
    }));
    try {
      await firstPool.query('INSERT INTO tasks (id) VALUES ($1::uuid)', [concurrentInitiativeId]);
      await firstPool.query(
        `INSERT INTO initiative_runs (id, initiative_id)
         VALUES ($2::uuid, $1::uuid), ($3::uuid, $1::uuid)`,
        [concurrentInitiativeId, concurrentRunA, concurrentRunB],
      );
      const [first, second] = await Promise.all([
        materializeApprovedContract(firstPool, {
          runId: concurrentRunA,
          version: 3,
          branch: 'cp-concurrent-a-r3',
          prdContent: '# PRD',
          contractContent: '# Contract\n\n# DoD',
          artifacts: artifactsFor(firstRevision),
        }),
        materializeApprovedContract(secondPool, {
          runId: concurrentRunB,
          version: 3,
          branch: 'cp-concurrent-b-r3',
          prdContent: '# PRD',
          contractContent: '# Contract\n\n# DoD',
          artifacts: artifactsFor(secondRevision),
        }),
      ]);
      expect([first.version, second.version].sort()).toEqual([3, 4]);
      const contracts = await firstPool.query(
        `SELECT contract.version, contract.status, seal.source_revision
           FROM initiative_contracts AS contract
           JOIN initiative_contract_artifact_seals AS seal ON seal.contract_id = contract.id
          WHERE contract.initiative_id = $1::uuid
          ORDER BY contract.version`,
        [concurrentInitiativeId],
      );
      expect(contracts.rows).toEqual([
        expect.objectContaining({ version: 3, status: 'superseded' }),
        expect.objectContaining({ version: 4, status: 'approved' }),
      ]);
      expect(new Set(contracts.rows.map((row) => row.source_revision))).toEqual(
        new Set([firstRevision, secondRevision]),
      );
    } finally {
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  });
});

// 移植自 sprints/08131745-harness-contract-reopen-r5/tests/contract-reopen-atomic-swap.test.js
// （CLAUDE.md 铁律 20：修复后永久回归用例留在 CI，brain-integration 真 Postgres 跑）。
// 禁 mock 被改的边：materializeApprovedContract ↔ initiative_contracts / initiative_runs 一律真 PG。
describe.runIf(HAS_REAL_POSTGRES)('materializeApprovedContract 合同重开后原子换版（r5 回归）', () => {
  const reopenPool = new Pool(DB_DEFAULTS);
  let reopenClient;

  const rev1 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
  const rev2 = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1';

  function reopenArtifact(root, rel, content, sourceRevision) {
    return Object.freeze({
      path: `${root}/${rel}`,
      content,
      sha256: createHash('sha256').update(content).digest('hex'),
      byte_length: Buffer.byteLength(content),
      source_revision: sourceRevision,
    });
  }
  function artifactsFor(root, sourceRevision) {
    return Object.freeze([
      reopenArtifact(root, 'contract-dod.md', '# DoD', sourceRevision),
      reopenArtifact(root, 'contract-draft.md', '# Contract', sourceRevision),
      reopenArtifact(root, 'sprint-prd.md', '# PRD', sourceRevision),
      reopenArtifact(root, 'tests/x.test.mjs', 'test("x", () => {})', sourceRevision),
    ]);
  }
  // prdContent / contractContent 必须与 artifacts 投影一致（assertArtifactProjection）。
  const PRD = '# PRD';
  const CONTRACT = '# Contract\n\n# DoD';

  beforeAll(async () => {
    reopenClient = await reopenPool.connect();
    await reopenClient.query('BEGIN');
    await reopenClient.query(`
      CREATE TEMP TABLE initiative_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        initiative_id uuid NOT NULL,
        version integer NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        prd_content text,
        contract_content text,
        approved_sha text,
        frozen_artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
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
      CREATE TEMP TABLE tasks (id uuid PRIMARY KEY) ON COMMIT DROP;
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
    `);
  });

  afterAll(async () => {
    if (reopenClient) {
      await reopenClient.query('ROLLBACK');
      reopenClient.release();
    }
    await reopenPool.end();
  });

  async function seedRun(initiativeId, runId) {
    await reopenClient.query('INSERT INTO tasks (id) VALUES ($1::uuid)', [initiativeId]);
    await reopenClient.query(
      'INSERT INTO initiative_runs (id, initiative_id) VALUES ($1::uuid, $2::uuid)',
      [runId, initiativeId],
    );
  }

  it('reopen v1 draft attached + Round2 新证据 → 原子换版 v2 approved、v1 superseded、run.contract_id 切 v2', async () => {
    const initiativeId = '10000000-0000-4000-8000-000000000001';
    const runId = '10000000-0000-4000-8000-0000000000a1';
    await seedRun(initiativeId, runId);
    // 复现 reopen 后：run.contract_id 指向 v1 draft（当前实现会误判为“已批准证据”而抛 mismatch）。
    const { rows: [v1] } = await reopenClient.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch)
       VALUES ($1::uuid, 1, 'draft', 'cp-harness-propose-r1-reopen') RETURNING id`,
      [initiativeId],
    );
    await reopenClient.query(
      'UPDATE initiative_runs SET contract_id = $2::uuid WHERE id = $1::uuid',
      [runId, v1.id],
    );

    const contract = await materializeApprovedContract(reopenClient, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-reopen-a4',
      prdContent: PRD,
      contractContent: CONTRACT,
      artifacts: artifactsFor('sprints/reopen-r5', rev2),
      approvedAt: new Date('2026-08-13T00:00:00Z'),
    });

    expect(contract).toMatchObject({
      version: 2,
      status: 'approved',
      branch: 'cp-harness-propose-r2-reopen-a4',
    });
    const { rows } = await reopenClient.query(
      `SELECT c.version, c.status, r.contract_id = c.id AS attached, c.approved_sha
         FROM initiative_contracts c
         CROSS JOIN initiative_runs r
        WHERE r.id = $1::uuid AND c.initiative_id = $2::uuid
        ORDER BY c.version`,
      [runId, initiativeId],
    );
    expect(rows).toEqual([
      { version: 1, status: 'superseded', attached: false, approved_sha: null },
      { version: 2, status: 'approved', attached: true, approved_sha: rev2 },
    ]);
  });

  it('reopen 换版幂等：相同 v2 证据重放返回同一 contract.id，不新建版本、不重复 supersede', async () => {
    const initiativeId = '10000000-0000-4000-8000-000000000002';
    const runId = '10000000-0000-4000-8000-0000000000a2';
    await seedRun(initiativeId, runId);
    const { rows: [v1] } = await reopenClient.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch)
       VALUES ($1::uuid, 1, 'draft', 'cp-harness-propose-r1-reopen') RETURNING id`,
      [initiativeId],
    );
    await reopenClient.query(
      'UPDATE initiative_runs SET contract_id = $2::uuid WHERE id = $1::uuid',
      [runId, v1.id],
    );
    const evidence = {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-reopen-a4',
      prdContent: PRD,
      contractContent: CONTRACT,
      artifacts: artifactsFor('sprints/reopen-r5', rev2),
      approvedAt: new Date('2026-08-13T00:00:00Z'),
    };
    const first = await materializeApprovedContract(reopenClient, evidence);
    const second = await materializeApprovedContract(reopenClient, evidence);
    expect(second).toMatchObject({ id: first.id, version: 2, status: 'approved' });
    const { rows } = await reopenClient.query(
      `SELECT count(*)::int AS n
         FROM initiative_contracts WHERE initiative_id = $1::uuid`,
      [initiativeId],
    );
    expect(rows[0].n).toBe(2); // v1 superseded + v2 approved，重放未新增版本
  });

  it('fail-closed：附着 approved 合同 + 证据分支不一致 → 仍抛 attached approved contract evidence mismatch', async () => {
    const initiativeId = '10000000-0000-4000-8000-000000000003';
    const runId = '10000000-0000-4000-8000-0000000000a3';
    await seedRun(initiativeId, runId);
    // 先原子换版得到 attached v2 approved。
    await materializeApprovedContract(reopenClient, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-reopen-a4',
      prdContent: PRD,
      contractContent: CONTRACT,
      artifacts: artifactsFor('sprints/reopen-r5', rev2),
      approvedAt: new Date('2026-08-13T00:00:00Z'),
    });
    // 附着已是 approved：任一证据字段（此处 branch）不一致必须 fail-closed，禁止静默换版。
    await expect(materializeApprovedContract(reopenClient, {
      runId,
      version: 2,
      branch: 'cp-tampered-branch',
      prdContent: PRD,
      contractContent: CONTRACT,
      artifacts: artifactsFor('sprints/reopen-r5', rev2),
      approvedAt: new Date('2026-08-13T00:00:00Z'),
    })).rejects.toThrow(/evidence mismatch|approved_contract_immutable_mismatch/i);
  });

  it('run 首轮无 contract_id 时保持既有插入路径不回归（draft 分流不误伤 null 附着）', async () => {
    const initiativeId = '10000000-0000-4000-8000-000000000004';
    const runId = '10000000-0000-4000-8000-0000000000a4';
    await seedRun(initiativeId, runId);
    await reopenClient.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch)
       VALUES ($1::uuid, 1, 'draft', 'cp-old-r1')`,
      [initiativeId],
    );
    const contract = await materializeApprovedContract(reopenClient, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-firstround-a4',
      prdContent: PRD,
      contractContent: CONTRACT,
      artifacts: artifactsFor('sprints/reopen-r5', rev1),
      approvedAt: new Date('2026-08-13T00:00:00Z'),
    });
    expect(contract).toMatchObject({ version: 2, status: 'approved' });
    const { rows } = await reopenClient.query(
      `SELECT c.version, c.status, r.contract_id = c.id AS attached
         FROM initiative_contracts c CROSS JOIN initiative_runs r
        WHERE r.id = $1::uuid AND c.initiative_id = $2::uuid ORDER BY c.version`,
      [runId, initiativeId],
    );
    expect(rows).toEqual([
      { version: 1, status: 'superseded', attached: false },
      { version: 2, status: 'approved', attached: true },
    ]);
  });
});

describe('materializeApprovedContract concurrency contract', () => {
  it('Pool 路径在独立事务中先锁逻辑 contract，再用新语句 snapshot 物化', async () => {
    const queries = [];
    const client = {
      query: async (sql) => {
        queries.push(sql);
        if (/FOR UPDATE OF run, task/i.test(sql)) {
          return { rows: [{ initiative_id: initiativeId, contract_id: null }] };
        }
        if (/GREATEST\(\$2::integer/i.test(sql)) {
          return { rows: [{ version: 2 }] };
        }
        if (/UPDATE initiative_runs AS run/i.test(sql)) {
          return {
            rows: [{
              id: '33333333-3333-4333-8333-333333333333',
              version: 2,
              status: 'approved',
              branch: 'cp-harness-propose-r2-22222222-a8',
            }],
          };
        }
        return { rows: [] };
      },
      release: vi.fn(),
    };
    const db = { connect: vi.fn(async () => client) };

    await expect(materializeApprovedContract(db, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-22222222-a8',
      prdContent: '# PRD',
      contractContent: '# Contract\n\n# DoD',
      artifacts,
      approvedAt: new Date('2026-07-22T15:00:00Z'),
    })).resolves.toMatchObject({ status: 'approved' });

    expect(queries[0]).toBe('BEGIN');
    expect(queries[1]).toMatch(/FOR UPDATE OF run, task/i);
    expect(queries[2]).toMatch(/GREATEST\(\$2::integer/i);
    expect(queries[3]).toMatch(/UPDATE initiative_runs AS run/i);
    expect(queries.at(-1)).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('writer-first manifest 冲突回滚后返回稳定 assembly fault，而非 SQL 除零错误', async () => {
    const queries = [];
    const client = {
      query: vi.fn(async (sql) => {
        queries.push(sql);
        if (/FOR UPDATE OF run, task/i.test(sql)) {
          return { rows: [{ initiative_id: initiativeId, contract_id: null }] };
        }
        if (/GREATEST\(\$2::integer/i.test(sql)) {
          return { rows: [{ version: 2 }] };
        }
        if (/UPDATE initiative_runs AS run/i.test(sql)) {
          throw Object.assign(new Error('division by zero'), { code: '22012' });
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const db = { connect: vi.fn(async () => client) };

    await expect(materializeApprovedContract(db, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-22222222-a8',
      prdContent: '# PRD',
      contractContent: '# Contract\n\n# DoD',
      artifacts,
      approvedAt: new Date('2026-07-22T15:00:00Z'),
    })).rejects.toThrow('FROZEN_CONTRACT_ARTIFACT_INVALID:seal_mismatch');

    expect(queries.at(-1)).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});
