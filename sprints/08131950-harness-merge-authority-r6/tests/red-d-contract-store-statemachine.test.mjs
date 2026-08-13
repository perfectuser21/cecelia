/**
 * RED-D 永久回归 — materializeApprovedContract Impact Contract 状态机四态守卫。
 *
 * 要求：
 *   - 仅 draft 附着可原子换版（已实现，作为回归钉死）
 *   - approved 附着 + 同证据 → 幂等返回（已实现，钉死）
 *   - approved 附着 + 不同证据 → 报错（已实现，钉死）
 *   - superseded / 未知状态附着 → 报错，不得重激活（本刀新增守卫；当前实现会误落到
 *     draft 换版插入路径把 superseded 合同「重激活」成新 approved —— 本测试当前 RED）
 *
 * 禁 mock 边：contract-store.js ↔ initiative_contracts / initiative_runs 表是本刀改写
 *   的状态机边，必须真 Postgres 落库验证，禁止 mock DB（用 TEMP 表 + 事务隔离）。
 *
 * DB 门控：与既有 contract-store.test.js 一致，仅在注入 DATABASE_URL/DB 的 local_api
 *   环境运行（fleet-worker 无 postgres 时 skip）。
 *
 * 永久落位（Generator 实现时迁入）：
 *   packages/brain/src/orchestrator/__tests__/contract-store.test.js
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../../packages/brain/src/db-config.js';
import { materializeApprovedContract } from '../../../packages/brain/src/orchestrator/contract-store.js';

const { Pool } = pg;
const HAS_REAL_POSTGRES = Boolean(process.env.DATABASE_URL || process.env.DB);

const runId = '11111111-1111-4111-8111-1111111111d0';
const initiativeId = '22222222-2222-4222-8222-2222222222d0';

describe.runIf(HAS_REAL_POSTGRES)('RED-D: materializeApprovedContract 状态机守卫', () => {
  const pool = new Pool(DB_DEFAULTS);
  let client;

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
        path text NOT NULL, content text NOT NULL, sha256 text NOT NULL,
        byte_length integer NOT NULL, source_revision text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (contract_id, path)
      ) ON COMMIT DROP;
      CREATE TEMP TABLE initiative_contract_artifact_seals (
        contract_id uuid PRIMARY KEY REFERENCES initiative_contracts(id),
        artifact_count integer NOT NULL, manifest_sha256 text NOT NULL,
        source_revision text NOT NULL, sealed_at timestamptz NOT NULL DEFAULT now()
      ) ON COMMIT DROP;
    `);
    await client.query('INSERT INTO tasks (id) VALUES ($1::uuid)', [initiativeId]);
    await client.query('INSERT INTO initiative_runs (id, initiative_id) VALUES ($1::uuid, $2::uuid)', [runId, initiativeId]);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  });

  async function attachContractWithStatus(status, version) {
    const { rows } = await client.query(
      `INSERT INTO initiative_contracts (initiative_id, version, status, branch, prd_content, contract_content)
       VALUES ($1::uuid, $2::integer, $3::text, 'cp-old', '# PRD', '# Contract')
       RETURNING id`,
      [initiativeId, version, status],
    );
    await client.query('UPDATE initiative_runs SET contract_id = $2::uuid WHERE id = $1::uuid', [runId, rows[0].id]);
    return rows[0].id;
  }

  it('superseded 附着 → 报错，不得重激活', async () => {
    await attachContractWithStatus('superseded', 91);
    await expect(materializeApprovedContract(client, {
      runId, version: 92, branch: 'cp-new-r2', prdContent: '# PRD2', contractContent: '# Contract2',
    })).rejects.toThrow(/superseded|reactivate|invalid_attached_contract_status|不得重激活/i);
  });

  it('未知状态附着 → 报错，不得重激活', async () => {
    await attachContractWithStatus('mystery_state', 93);
    await expect(materializeApprovedContract(client, {
      runId, version: 94, branch: 'cp-new-r3', prdContent: '# PRD3', contractContent: '# Contract3',
    })).rejects.toThrow(/invalid_attached_contract_status|unknown|mystery_state|状态/i);
  });

  it('draft 附着 → 允许原子换版为 approved（回归钉死）', async () => {
    await attachContractWithStatus('draft', 95);
    const contract = await materializeApprovedContract(client, {
      runId, version: 96, branch: 'cp-new-r4', prdContent: '# PRD4', contractContent: '# Contract4',
    });
    expect(contract.status).toBe('approved');
  });
});
