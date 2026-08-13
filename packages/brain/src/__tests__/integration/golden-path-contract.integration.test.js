import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import pool from '../../db.js';
import {
  createGoldenPathContractVersion,
  signAndLaunchGoldenPathContract,
} from '../../golden-path-contracts.js';
import { runMigrations } from '../../migrate.js';

const CONTRACT_V1 = {
  fr_summary: { statements: ['用户提交后看到成功'] },
  lifelines_and_nfr: {
    items: [{
      statement: '写入必须唯一',
      class: 'lifeline',
      verification: 'SELECT COUNT(*) = 1',
      rationale: '重复写入即业务失败',
    }],
  },
  yield_order: {
    order: ['安全/资金正确性', '数据一致性', '功能完整', '性能', '体验顺滑'],
    override_reason: null,
  },
  external_commitment_changes: { changes: [], none: true },
  release_and_blast_radius: {
    stages: ['internal'],
    blast_radius: '单一测试 Journey',
    rollback_triggers: ['错误率 > 1%'],
  },
  success_and_close: {
    metrics: ['成功率 >= 99%'],
    observation_window: '24h',
    close_conditions: ['24h 达标'],
    shutdown_conditions: ['连续 5 分钟错误率 > 1%'],
  },
  budget_guard: {
    total_cost_cap_usd: 10,
    atom_cost_cap_usd: 2,
    atom_runtime_sec: 1800,
    atom_parallelism: 1,
  },
};

beforeAll(async () => {
  const databaseName = new URL(
    process.env.DATABASE_URL ?? 'postgresql://localhost/cecelia_test',
  ).pathname.slice(1);
  expect(databaseName).toMatch(/(?:_test|_scratch)$/);
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('Golden Path contract real PostgreSQL lifecycle', () => {
  it('atomically routes signed versions through immutable receipts and rolls fixtures back', async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const marker = `gp-contract-${process.pid}-${Date.now()}`;
      const repo = `${marker}-repo`;
      const revision = 'a'.repeat(40);
      const journey = await client.query(
        `INSERT INTO journeys (name, description)
         VALUES ($1, 'Golden Path contract integration fixture')
         RETURNING id`,
        [marker],
      );
      const gp = await client.query(
        `INSERT INTO golden_paths (
           title, one_liner, journey_id, proposal_doc, status,
           base_repo, target_environment, change_kind, map_scope
         ) VALUES ($1, '测试 GP 合同签字', $2, '# converged proposal', 'candidate',
                   $3, 'local_api', 'new_capability', $4::jsonb)
         RETURNING id`,
        [marker, journey.rows[0].id, repo, JSON.stringify(['capability_social_feed'])],
      );
      const goldenPathId = gp.rows[0].id;
      await client.query(
        `INSERT INTO map_scope_repositories (scope_key, repo, adapter_key, adapter_config)
         VALUES ($1, $1, 'legacy-ledger-v1', '{}'::jsonb)`,
        [repo],
      );
      for (const [kind, scanner] of [
        ['api', 'api-registry-v2'],
        ['db_schema', 'db-schema-v2'],
        ['test', 'test-registry-v2'],
        ['graph', 'graph-v3'],
      ]) {
        await client.query(
          `INSERT INTO fact_snapshot_headers
             (kind, repo, source_revision, scanner_version, scanned_at, row_count)
           VALUES ($1, $2, $3, $4, now(), 0)`,
          [kind, repo, revision, scanner],
        );
      }

      const submittedV1 = await createGoldenPathContractVersion(client, {
        goldenPathId,
        contract: CONTRACT_V1,
      });
      await client.query(
        "UPDATE golden_paths SET status='converged' WHERE id=$1",
        [goldenPathId],
      );
      const signedV1 = await signAndLaunchGoldenPathContract(client, {
        goldenPathId,
        contractId: submittedV1.contract_version.id,
        version: 1,
        contentHash: submittedV1.contract_version.content_hash,
        reviewer: 'integration-owner',
      });
      expect(signedV1.task).toMatchObject({
        task_type: 'harness_initiative',
        payload: {
          gp_contract_id: submittedV1.contract_version.id,
          routing_receipt_id: expect.any(String),
          change_kind: 'new_capability',
          repo,
          base_sha: revision,
        },
      });

      const contractV2 = structuredClone(CONTRACT_V1);
      contractV2.success_and_close.observation_window = '48h';
      const submittedV2 = await createGoldenPathContractVersion(client, {
        goldenPathId,
        contract: contractV2,
      });
      await client.query(
        "UPDATE golden_paths SET status='converged' WHERE id=$1",
        [goldenPathId],
      );
      const signedV2 = await signAndLaunchGoldenPathContract(client, {
        goldenPathId,
        contractId: submittedV2.contract_version.id,
        version: 2,
        contentHash: submittedV2.contract_version.content_hash,
        reviewer: 'integration-owner',
      });

      expect(signedV2.task.id).not.toBe(signedV1.task.id);
      const versions = await client.query(
        `SELECT version, status
           FROM golden_path_contract_versions
          WHERE golden_path_id=$1
          ORDER BY version`,
        [goldenPathId],
      );
      expect(versions.rows).toEqual([
        { version: 1, status: 'invalidated' },
        { version: 2, status: 'signed' },
      ]);
      const receiptCount = await client.query(
        `SELECT count(*)::int AS count
           FROM work_routing_receipts
          WHERE task_id IN ($1, $2)`,
        [signedV1.task.id, signedV2.task.id],
      );
      expect(receiptCount.rows[0].count).toBe(2);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
