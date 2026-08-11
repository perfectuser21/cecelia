import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  getActiveImpactContract,
  persistImpactContract,
} from '../../impact-contract/contract-store.js';
import {
  addHardDependency,
  assignRepairTask,
  openGapForDrift,
  transitionGapStatus,
} from '../../impact-contract/gap-store.js';
import { verifyImpactMergeFence } from '../../impact-contract/harness-gates.js';

let pool;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../../db.js')).default;
});

afterAll(async () => {
  await pool.end();
});

describe('Impact Contract → Gap → 修复 → 恢复真实 PostgreSQL 闭环', () => {
  it('直接 SQL 不能用 failed 中转解除 unresolved gap', async () => {
    const client = await pool.connect();
    const sourceTaskId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks (id, title, task_type, status, priority, payload, blocked_at)
         VALUES ($1, 'blocked source', 'dev', 'blocked', 'P1', '{}', NOW())`,
        [sourceTaskId],
      );
      await openGapForDrift(client, {
        sourceTaskId,
        impactNodeId: 'brain-direct-sql',
        owner: 'factory',
        revision: 'd'.repeat(40),
      });
      await client.query("UPDATE tasks SET status = 'failed' WHERE id = $1", [sourceTaskId]);

      await expect(client.query(
        "UPDATE tasks SET status = 'queued' WHERE id = $1",
        [sourceTaskId],
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('直接 SQL 不能把 verifying gap 伪造成 resolved', async () => {
    const client = await pool.connect();
    const sourceTaskId = randomUUID();
    const repairTaskId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks (id, title, task_type, status, priority, payload, blocked_at)
         VALUES
           ($1, 'blocked source', 'dev', 'blocked', 'P1', '{}', NOW()),
           ($2, 'repair source', 'dev', 'completed', 'P1', '{}', NULL)`,
        [sourceTaskId, repairTaskId],
      );
      const { gap } = await openGapForDrift(client, {
        sourceTaskId,
        impactNodeId: 'brain-fake-resolve',
        owner: 'factory',
        revision: 'e'.repeat(40),
      });
      await assignRepairTask(client, gap.id, repairTaskId);
      await transitionGapStatus(client, gap.id, 'assigned');
      await transitionGapStatus(client, gap.id, 'fixing');
      await transitionGapStatus(client, gap.id, 'verifying');

      await expect(client.query(
        `UPDATE harness_gaps
         SET status = 'resolved',
             resolution_evidence = jsonb_build_object(
               'assertion_id', 'fake', 'receipt_id', $2::text, 'revision', current_revision
             )
         WHERE id = $1`,
        [gap.id, randomUUID()],
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('同一任务并发提交相同合同只产生一个 active 版本', async () => {
    const taskId = randomUUID();
    const revision = 'b'.repeat(40);
    const input = {
      task_id: taskId,
      change_kind: 'bugfix',
      repo: 'perfectuser21/cecelia',
      base_revision: revision,
      manifest_digest: '3'.repeat(64),
      projection_digest: '4'.repeat(64),
      contract_body: {
        task_id: taskId,
        change_kind: 'bugfix',
        base_revision: revision,
        affected_capabilities: [{ capability_id: 'brain' }],
        required_assertions: [],
      },
    };

    try {
      await pool.query(
        `INSERT INTO tasks (id, title, task_type, status, priority, payload)
         VALUES ($1, 'impact concurrent', 'dev', 'queued', 'P1', '{"change_kind":"bugfix"}')`,
        [taskId],
      );
      const results = await Promise.all([
        persistImpactContract(pool, input),
        persistImpactContract(pool, input),
      ]);
      expect(new Set(results.map((result) => result.contract.id)).size).toBe(1);
      expect(results.filter((result) => result.created)).toHaveLength(1);
      const rows = await pool.query(
        `SELECT id FROM harness_impact_contracts
         WHERE task_id = $1 AND status = 'active'`,
        [taskId],
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    }
  });

  it('普通 HTTP 写入口在 Mapper 不可用时返回 503 且不产生 active 合同', async () => {
    const taskId = randomUUID();
    process.env.CECELIA_MAP_RADIUS_URL = 'http://127.0.0.1:15999/api/brain/map/radius';
    const { default: impactContractsRouter } = await import(
      '../../routes/impact-contracts.js?integration-http'
    );
    const app = express();
    app.use(express.json());
    app.use('/api/brain', impactContractsRouter);

    try {
      await pool.query(
        `INSERT INTO tasks (id, title, task_type, status, priority, payload)
         VALUES ($1, 'impact api source', 'dev', 'queued', 'P1', '{"change_kind":"bugfix"}')`,
        [taskId],
      );

      const response = await request(app)
        .post(`/api/brain/tasks/${taskId}/impact-contract`)
        .send({
          change_kind: 'bugfix',
          repo: 'perfectuser21/cecelia',
          base_revision: 'a'.repeat(40),
          affected_capabilities: [{ capability_id: 'brain' }],
          required_assertions: [],
        });

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        gate: 'blocked',
        reason: 'mapper_unavailable',
        retryable: true,
      });
      const active = await pool.query(
        `SELECT id FROM harness_impact_contracts
         WHERE task_id = $1 AND status = 'active'`,
        [taskId],
      );
      expect(active.rows).toHaveLength(0);
    } finally {
      await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
      delete process.env.CECELIA_MAP_RADIUS_URL;
    }
  });

  it('持久化合同、建立硬依赖，并在当前 revision 断言 PASS 后恢复原任务', async () => {
    const client = await pool.connect();
    const sourceTaskId = randomUUID();
    const repairTaskId = randomUUID();
    const journeyId = randomUUID();
    const stepId = randomUUID();
    const journeyStepLinkId = randomUUID();
    const repairRunId = randomUUID();
    const evaluatorAttemptId = randomUUID();
    const revision = 'a'.repeat(40);
    const assertionId = 'orchestrator-regression';
    const assertionDigest = createHash('sha256').update(assertionId).digest('hex');

    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks (id, title, task_type, status, priority, payload, blocked_at)
         VALUES
           ($1, 'impact source', 'dev', 'blocked', 'P1', '{"change_kind":"bugfix"}', NOW()),
           ($2, 'impact repair', 'dev', 'queued', 'P1', '{"change_kind":"bugfix"}', NULL)`,
        [sourceTaskId, repairTaskId],
      );
      await client.query(
        `INSERT INTO journeys (id, name, journey_type)
         VALUES ($1, 'impact contract integration', 'dev_pipeline')`,
        [journeyId],
      );
      await client.query(
        `INSERT INTO journey_steps (id, journey_id, name, step_number)
         VALUES ($1, $2, 'assert impact', 1)`,
        [stepId, journeyId],
      );
      await client.query(
        `INSERT INTO journey_step_links
           (id, journey_id, step_id, step_order, status, assertion_ref, assertion_revision)
         VALUES ($1, $2, $3, 1, 'in_progress', $4, 1)`,
        [journeyStepLinkId, journeyId, stepId, assertionId],
      );

      const contractBody = {
        task_id: sourceTaskId,
        change_kind: 'bugfix',
        base_revision: revision,
        affected_capabilities: [{ capability_id: 'brain-orchestrator' }],
        required_assertions: [{
          assertion_id: assertionId,
          command: 'npm test',
          covers_capability_ids: ['brain-tick'],
          journey_step_link_id: journeyStepLinkId,
          assertion_revision: 1,
          assertion_digest: assertionDigest,
        }],
      };
      const { contract, created } = await persistImpactContract(client, {
        task_id: sourceTaskId,
        change_kind: 'bugfix',
        repo: 'perfectuser21/cecelia',
        base_revision: revision,
        manifest_digest: '1'.repeat(64),
        projection_digest: '2'.repeat(64),
        contract_body: contractBody,
      });
      expect(created).toBe(true);
      expect((await getActiveImpactContract(client, sourceTaskId)).id).toBe(contract.id);

      const { gap } = await openGapForDrift(client, {
        sourceTaskId,
        impactNodeId: 'brain-tick',
        owner: 'factory',
        revision,
      });
      const duplicateGap = await openGapForDrift(client, {
        sourceTaskId,
        impactNodeId: 'brain-tick',
        owner: 'factory',
        revision,
      });
      expect(duplicateGap).toMatchObject({ created: false, gap: { id: gap.id } });
      await assignRepairTask(client, gap.id, repairTaskId);
      await addHardDependency(client, {
        fromTaskId: sourceTaskId,
        toTaskId: repairTaskId,
        gapId: gap.id,
      });

      await transitionGapStatus(client, gap.id, 'assigned');
      await transitionGapStatus(client, gap.id, 'fixing');
      await transitionGapStatus(client, gap.id, 'verifying');
      await client.query(
        `INSERT INTO initiative_runs (
           id, initiative_id, current_task_id, phase, orchestrator_version,
           created_source, impact_contract_policy, impact_contract_policy_reason
         ) VALUES (
           $1, $2, $3, 'evaluate', 'v2', 'kernel_dispatch',
           'required', 'integration repair run'
         )`,
        [repairRunId, repairTaskId, repairTaskId],
      );
      await client.query(
        "UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1",
        [repairTaskId],
      );
      await client.query(
        `INSERT INTO harness_attempts (
           id, run_id, hop, phase, role, provider, machine_id,
           requested_machine_id, actual_machine_id, execution_transport,
           machine_attestation_status, task_bundle, result, status,
           callback_secret_hash, completed_at
         ) VALUES (
           $1, $2, 1, 'evaluate', 'evaluator', 'codex', 'integration-runner',
           'integration-runner', 'integration-runner', 'local-docker', 'local',
           $3::jsonb, $4::jsonb, 'completed', $5, NOW()
         )`,
        [
          evaluatorAttemptId,
          repairRunId,
          JSON.stringify({ inputs: { task_id: repairTaskId } }),
          JSON.stringify({ status: 'completed', decision: { outcome: 'PASS' } }),
          '1'.repeat(64),
        ],
      );
      const receiptResult = await client.query(
        `INSERT INTO journey_assertion_receipts (
           journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
           assertion_digest, source_repo, source_sha, command_argv,
           impact_contract_id, impact_contract_hash, harness_attempt_id,
           scenario_count, scenario_evidence, verdict, exit_code,
           started_at, completed_at, machine_id, output_digest
         ) VALUES (
           $1, $2, 1, $3,
           $4, 'perfectuser21/cecelia', $5, '["bash","-lc","npm test"]'::jsonb,
           $7, $8, $9,
           1, '{"passed":1}'::jsonb, 'PASS', 0,
           NOW(), NOW(), 'integration-runner', $6
         )
         RETURNING id`,
        [
          journeyStepLinkId, repairRunId, assertionId, assertionDigest, revision,
          'f'.repeat(64), contract.id, contract.contract_hash, evaluatorAttemptId,
        ],
      );
      await expect(verifyImpactMergeFence(client, {
        taskId: sourceTaskId,
        runId: repairRunId,
        headRevision: revision,
        expectedContractHash: contract.contract_hash,
      })).resolves.toMatchObject({ gate: 'pass' });
      await transitionGapStatus(client, gap.id, 'resolved', {
        idempotencyKey: `resolved:${gap.id}:${revision}`,
        resolutionEvidence: {
          assertion_id: assertionId,
          receipt_id: receiptResult.rows[0].id,
          revision,
        },
      });

      const task = await client.query(
        'SELECT status, blocked_at FROM tasks WHERE id = $1',
        [sourceTaskId],
      );
      const dependency = await client.query(
        `SELECT status, gap_id FROM task_dependencies
         WHERE from_task_id = $1 AND to_task_id = $2`,
        [sourceTaskId, repairTaskId],
      );
      const events = await client.query(
        'SELECT event_type FROM gap_events WHERE gap_id = $1 ORDER BY created_at',
        [gap.id],
      );

      expect(task.rows[0]).toMatchObject({ status: 'queued', blocked_at: null });
      expect(dependency.rows[0]).toMatchObject({ status: 'satisfied', gap_id: gap.id });
      expect(events.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
        'CONTRACT_IMPACT_DRIFT',
        'assigned',
        'fix_started',
        'verification_started',
        'resolved',
      ]));
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
