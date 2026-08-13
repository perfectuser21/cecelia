// TDD RED 规格（真实 PostgreSQL integration）— Harness 合同重开后批准证据原子换版（r5）。
//
// 本文件是 GAN 冻结的 RED 规格与可移植用例来源：Generator 必须把下列 4 个 it() 用例
// **原样移植进永久回归 CI 文件** `packages/brain/src/orchestrator/__tests__/contract-store.test.js`
// 的 `describe.runIf(HAS_REAL_POSTGRES)('materializeApprovedContract PostgreSQL contract', ...)`
// 块内（该块已在 ci.yml brain-integration job 用真实 Postgres 跑，见 vitest.config.js /
// brain-ci 说明）。每个用例自带 task/run/contract 造数，可直接落进现有 beforeAll 温床，
// 不改动共享 beforeAll。CLAUDE.md 铁律 20：修复后这些回归用例必须永久留在 CI。
//
// 禁 mock 被改的边（本单是状态机 + DB 写路径）：materializeApprovedContract ↔ initiative_contracts /
// initiative_runs 一律真 Postgres，禁 vi.mock/stub 被改的这几条边。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { materializeApprovedContract } from '../../../packages/brain/src/orchestrator/contract-store.js';

const { Pool } = pg;
const HAS_REAL_POSTGRES = Boolean(process.env.DATABASE_URL || process.env.DB);
const pool = new Pool(DB_DEFAULTS);
let client;

const rev1 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const rev2 = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1';

function artifact(root, rel, content, sourceRevision) {
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
    artifact(root, 'contract-dod.md', '# DoD', sourceRevision),
    artifact(root, 'contract-draft.md', '# Contract', sourceRevision),
    artifact(root, 'sprint-prd.md', '# PRD', sourceRevision),
    artifact(root, 'tests/x.test.mjs', 'test("x", () => {})', sourceRevision),
  ]);
}
// prdContent / contractContent 必须与 artifacts 投影一致（assertArtifactProjection）。
const PRD = '# PRD';
const CONTRACT = '# Contract\n\n# DoD';

describe.runIf(HAS_REAL_POSTGRES)('materializeApprovedContract 合同重开后原子换版（r5 回归）', () => {
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
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  });

  async function seedRun(initiativeId, runId) {
    await client.query('INSERT INTO tasks (id) VALUES ($1::uuid)', [initiativeId]);
    await client.query(
      'INSERT INTO initiative_runs (id, initiative_id) VALUES ($1::uuid, $2::uuid)',
      [runId, initiativeId],
    );
  }

  it('reopen v1 draft attached + Round2 新证据 → 原子换版 v2 approved、v1 superseded、run.contract_id 切 v2', async () => {
    const initiativeId = '10000000-0000-4000-8000-000000000001';
    const runId = '10000000-0000-4000-8000-0000000000a1';
    await seedRun(initiativeId, runId);
    // 复现 reopen 后：run.contract_id 指向 v1 draft（当前实现会误判为“已批准证据”而抛 mismatch）。
    const { rows: [v1] } = await client.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch)
       VALUES ($1::uuid, 1, 'draft', 'cp-harness-propose-r1-reopen') RETURNING id`,
      [initiativeId],
    );
    await client.query(
      'UPDATE initiative_runs SET contract_id = $2::uuid WHERE id = $1::uuid',
      [runId, v1.id],
    );

    const contract = await materializeApprovedContract(client, {
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
    const { rows } = await client.query(
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
    const { rows: [v1] } = await client.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch)
       VALUES ($1::uuid, 1, 'draft', 'cp-harness-propose-r1-reopen') RETURNING id`,
      [initiativeId],
    );
    await client.query(
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
    const first = await materializeApprovedContract(client, evidence);
    const second = await materializeApprovedContract(client, evidence);
    expect(second).toMatchObject({ id: first.id, version: 2, status: 'approved' });
    const { rows } = await client.query(
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
    await materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-reopen-a4',
      prdContent: PRD,
      contractContent: CONTRACT,
      artifacts: artifactsFor('sprints/reopen-r5', rev2),
      approvedAt: new Date('2026-08-13T00:00:00Z'),
    });
    // 附着已是 approved：任一证据字段（此处 branch）不一致必须 fail-closed，禁止静默换版。
    await expect(materializeApprovedContract(client, {
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
    await client.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch)
       VALUES ($1::uuid, 1, 'draft', 'cp-old-r1')`,
      [initiativeId],
    );
    const contract = await materializeApprovedContract(client, {
      runId,
      version: 2,
      branch: 'cp-harness-propose-r2-firstround-a4',
      prdContent: PRD,
      contractContent: CONTRACT,
      artifacts: artifactsFor('sprints/reopen-r5', rev1),
      approvedAt: new Date('2026-08-13T00:00:00Z'),
    });
    expect(contract).toMatchObject({ version: 2, status: 'approved' });
    const { rows } = await client.query(
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
