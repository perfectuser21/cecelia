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
import { seedOwnedActiveV2RunInClient } from './helpers/controller-authority-fixture.js';

let pool;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../../db.js')).default;
});

afterAll(async () => {
  await pool.end();
});

describe('Impact Contract → Gap → 修复 → 恢复真实 PostgreSQL 闭环', () => {
  it('unresolved gap 的权威身份不能被直接 SQL 改写或删除', async () => {
    const client = await pool.connect();
    const sourceTaskId = randomUUID();
    const otherTaskId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks (id, title, task_type, status, priority, payload, blocked_at)
         VALUES ($1, 'gap identity source', 'dev', 'blocked', 'P1', '{}', NOW()),
                ($2, 'gap identity other', 'dev', 'blocked', 'P1', '{}', NOW())`,
        [sourceTaskId, otherTaskId],
      );
      const { gap } = await openGapForDrift(client, {
        sourceTaskId,
        impactNodeId: 'brain-gap-identity',
        owner: 'factory',
        revision: '9'.repeat(40),
      });

      await client.query('SAVEPOINT before_gap_identity_update');
      await expect(client.query(
        'UPDATE harness_gaps SET source_task_id = $2 WHERE id = $1',
        [gap.id, otherTaskId],
      )).rejects.toMatchObject({ code: '23514' });
      await client.query('ROLLBACK TO SAVEPOINT before_gap_identity_update');

      await expect(client.query(
        'DELETE FROM harness_gaps WHERE id = $1',
        [gap.id],
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('Impact Contract 语义字段在 DB 层不可变', async () => {
    const client = await pool.connect();
    const taskId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks (id, title, task_type, status, priority, payload)
         VALUES ($1, 'immutable contract source', 'dev', 'queued', 'P1', '{}')`,
        [taskId],
      );
      const contract = await client.query(
        `INSERT INTO harness_impact_contracts (
           task_id, version, status, schema_version, change_kind, repo,
           base_revision, manifest_digest, projection_digest, contract_hash, contract_body
         ) VALUES ($1, 1, 'active', 1, 'bugfix', 'perfectuser21/cecelia',
           $2, $3, $4, $5, $6::jsonb)
         RETURNING id`,
        [taskId, 'a'.repeat(40), '1'.repeat(64), '2'.repeat(64), '3'.repeat(64),
          JSON.stringify({ affected_capabilities: [{ capability_id: 'brain' }], required_assertions: [] })],
      );

      await expect(client.query(
        `UPDATE harness_impact_contracts
            SET contract_body = jsonb_set(
              contract_body, '{required_assertions}', '[{"assertion_id":"forged"}]'::jsonb
            )
          WHERE id = $1`,
        [contract.rows[0].id],
      )).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

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
    const assertionId = 'packages/brain/src/__tests__/integration/impact-contract-loop.integration.test.js';
    const assertionDigest = createHash('sha256').update(assertionId).digest('hex');
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
        required_assertions: [{
          assertion_id: assertionId,
          command: `npx vitest run ${assertionId}`,
          covers_capability_ids: ['brain'],
          journey_step_link_id: '11111111-1111-4111-8111-111111111111',
          assertion_revision: 1,
          assertion_digest: assertionDigest,
        }],
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
    const secondaryStepId = randomUUID();
    const journeyStepLinkId = randomUUID();
    const secondaryJourneyStepLinkId = randomUUID();
    const repairRunId = randomUUID();
    const evaluatorAttemptId = randomUUID();
    const revision = 'a'.repeat(40);
    const assertionId = 'packages/brain/src/__tests__/integration/impact-contract-loop.integration.test.js';
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
         VALUES ($1, $2, 'assert impact', 1),
                ($3, $2, 'assert impact secondary binding', 2)`,
        [stepId, journeyId, secondaryStepId],
      );
      await client.query(
        `INSERT INTO journey_step_links
           (id, journey_id, step_id, step_order, status, assertion_ref, assertion_revision)
         VALUES ($1, $2, $3, 1, 'in_progress', $5, 1),
                ($4, $2, $6, 2, 'in_progress', $5, 2)`,
        [journeyStepLinkId, journeyId, stepId, secondaryJourneyStepLinkId, assertionId, secondaryStepId],
      );

      const contractBody = {
        task_id: sourceTaskId,
        change_kind: 'bugfix',
        base_revision: revision,
        affected_capabilities: [
          { capability_id: 'brain-orchestrator' },
          { capability_id: 'brain-tick' },
        ],
        required_assertions: [{
          assertion_id: assertionId,
          command: `npx vitest run ${assertionId}`,
          covers_capability_ids: ['brain-orchestrator', 'brain-tick'],
          journey_step_link_id: journeyStepLinkId,
          assertion_revision: 1,
          assertion_digest: assertionDigest,
          source_bindings: [
            {
              journey_step_link_id: journeyStepLinkId,
              assertion_revision: 1,
              assertion_digest: assertionDigest,
            },
            {
              journey_step_link_id: secondaryJourneyStepLinkId,
              assertion_revision: 2,
              assertion_digest: assertionDigest,
            },
          ],
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
      await seedOwnedActiveV2RunInClient(client, {
        runId: repairRunId,
        initiativeId: repairTaskId,
        taskId: repairTaskId,
        phase: 'evaluate',
        impactContractPolicy: 'required',
        impactContractPolicyReason: 'integration repair run',
      });
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
           $4, 'perfectuser21/cecelia', $5, $10::jsonb,
           $7, $8, $9,
           1, '{"passed":1}'::jsonb, 'PASS', 0,
           NOW(), NOW(), 'integration-runner', $6
         )
         RETURNING id`,
        [
          journeyStepLinkId, repairRunId, assertionId, assertionDigest, revision,
          'f'.repeat(64), contract.id, contract.contract_hash, evaluatorAttemptId,
          JSON.stringify(['npx', 'vitest', 'run', assertionId]),
        ],
      );
      await client.query('SAVEPOINT before_incomplete_binding_resolution');
      await expect(client.query(
        `UPDATE harness_gaps
            SET status = 'resolved',
                resolution_evidence = jsonb_build_object(
                  'assertion_id', $2, 'receipt_id', $3::text, 'revision', $4
                )
          WHERE id = $1`,
        [gap.id, assertionId, receiptResult.rows[0].id, revision],
      )).rejects.toThrow();
      await client.query('ROLLBACK TO SAVEPOINT before_incomplete_binding_resolution');

      await client.query(
        `INSERT INTO journey_assertion_receipts (
           journey_step_link_id, run_id, assertion_revision, assertion_ref_snapshot,
           assertion_digest, source_repo, source_sha, command_argv,
           impact_contract_id, impact_contract_hash, harness_attempt_id,
           scenario_count, scenario_evidence, verdict, exit_code,
           started_at, completed_at, machine_id, output_digest
         ) VALUES (
           $1, $2, 2, $3,
           $4, 'perfectuser21/cecelia', $5, $10::jsonb,
           $7, $8, $9,
           1, '{"passed":1}'::jsonb, 'PASS', 0,
           NOW(), NOW(), 'integration-runner', $6
         )`,
        [
          secondaryJourneyStepLinkId, repairRunId, assertionId, assertionDigest, revision,
          'e'.repeat(64), contract.id, contract.contract_hash, evaluatorAttemptId,
          JSON.stringify(['npx', 'vitest', 'run', assertionId]),
        ],
      );
      await expect(verifyImpactMergeFence(client, {
        taskId: sourceTaskId,
        runId: repairRunId,
        headRevision: revision,
        expectedContractHash: contract.contract_hash,
      })).resolves.toMatchObject({ gate: 'pass' });
      const bindingTrust = await client.query(
        `SELECT receipt.journey_step_link_id,
                receipt.completed_at >= event.verification_started_at AS after_verification,
                receipt.command_argv = harness_assertion_command_argv($2) AS canonical_command,
                link.assertion_ref = receipt.assertion_ref_snapshot AS current_ref,
                link.assertion_revision = receipt.assertion_revision AS current_revision,
                attempt.status = 'completed' AS completed_attempt
           FROM journey_assertion_receipts AS receipt
           JOIN journey_step_links AS link ON link.id = receipt.journey_step_link_id
           JOIN harness_attempts AS attempt ON attempt.id = receipt.harness_attempt_id
           CROSS JOIN LATERAL (
             SELECT MAX(created_at) AS verification_started_at
               FROM gap_events WHERE gap_id = $1 AND event_type = 'verification_started'
           ) AS event
          WHERE receipt.run_id = $3
          ORDER BY receipt.assertion_revision`,
        [gap.id, `npx vitest run ${assertionId}`, repairRunId],
      );
      expect(bindingTrust.rows).toEqual([
        expect.objectContaining({
          journey_step_link_id: journeyStepLinkId,
          after_verification: true,
          canonical_command: true,
          current_ref: true,
          current_revision: true,
          completed_attempt: true,
        }),
        expect.objectContaining({
          journey_step_link_id: secondaryJourneyStepLinkId,
          after_verification: true,
          canonical_command: true,
          current_ref: true,
          current_revision: true,
          completed_attempt: true,
        }),
      ]);
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
