import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import pool from '../../db.js';
import { runMigrations } from '../../migrate.js';
import actionsRouter from '../../routes/actions.js';
import goldenPathsRouter from '../../routes/golden-paths.js';


function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', goldenPathsRouter);
  app.use('/api/brain', actionsRouter);
  return app;
}

const testKey = `gp-contract-itest-${process.pid}-${Date.now()}`;
let journeyId;
let goldenPathId;
const pendingActionIds = [];

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
  await runMigrations(pool);
});

afterAll(async () => {
  try {
    if (goldenPathId) {
      await pool.query(
        `DELETE FROM tasks
          WHERE task_type = 'harness_initiative'
            AND payload->>'golden_path_id' = $1`,
        [goldenPathId],
      );
      await pool.query(
        'DELETE FROM golden_path_contract_versions WHERE golden_path_id = $1',
        [goldenPathId],
      );
      await pool.query(
        `DELETE FROM decisions
          WHERE context->>'golden_path_id' = $1
            AND context->>'policy_key' = 'gp.contract.signature'`,
        [goldenPathId],
      );
      await pool.query('DELETE FROM golden_paths WHERE id = $1', [goldenPathId]);
    }
    if (pendingActionIds.length > 0) {
      await pool.query(
        'DELETE FROM pending_actions WHERE id = ANY($1::uuid[])',
        [pendingActionIds],
      );
    }
    if (journeyId) {
      await pool.query('DELETE FROM journeys WHERE id = $1', [journeyId]);
    }
  } finally {
    await pool.end();
  }
});

describe('Golden Path contract real PostgreSQL lifecycle', () => {
  it('signs v1, invalidates it on change, and signs a task-bound v2', async () => {
    const app = makeApp();

    const journey = await pool.query(
      `INSERT INTO journeys (name, description)
       VALUES ($1, 'Golden Path contract integration fixture')
       RETURNING id`,
      [testKey],
    );
    journeyId = journey.rows[0].id;

    const createGp = await request(app)
      .post('/api/brain/golden-paths')
      .send({
        title: testKey,
        one_liner: '测试 GP 合同签字',
        journey_id: journeyId,
        proposal_doc: '# converged proposal',
      });
    expect(createGp.status).toBe(201);
    goldenPathId = createGp.body.golden_path.id;

    const propose = await request(app)
      .patch(`/api/brain/golden-paths/${goldenPathId}`)
      .send({ status: 'proposed' });
    expect(propose.status).toBe(200);

    const submitV1 = await request(app)
      .post(`/api/brain/golden-paths/${goldenPathId}/contracts`)
      .send(CONTRACT_V1);
    expect(submitV1.status).toBe(201);
    expect(submitV1.body.contract_version.version).toBe(1);
    pendingActionIds.push(submitV1.body.pending_action_id);

    const convergeV1 = await request(app)
      .patch(`/api/brain/golden-paths/${goldenPathId}`)
      .send({ status: 'converged' });
    expect(convergeV1.status).toBe(200);

    const signV1 = await request(app)
      .post(`/api/brain/pending-actions/${submitV1.body.pending_action_id}/approve`)
      .send({ reviewer: 'integration-owner' });
    expect(signV1.status).toBe(200);
    const taskV1 = signV1.body.execution_result.task;
    expect(taskV1.payload).toMatchObject({
      gp_contract_id: submitV1.body.contract_version.id,
      gp_contract_version: 1,
      gp_contract_hash: submitV1.body.contract_version.content_hash,
    });

    const contractV2 = structuredClone(CONTRACT_V1);
    contractV2.success_and_close.observation_window = '48h';
    const submitV2 = await request(app)
      .post(`/api/brain/golden-paths/${goldenPathId}/contracts`)
      .send(contractV2);
    expect(submitV2.status).toBe(201);
    expect(submitV2.body.contract_version.version).toBe(2);
    pendingActionIds.push(submitV2.body.pending_action_id);

    const afterChange = await pool.query(
      `SELECT version, status, signed_by, invalidated_at
         FROM golden_path_contract_versions
        WHERE golden_path_id = $1
        ORDER BY version`,
      [goldenPathId],
    );
    expect(afterChange.rows).toMatchObject([
      {
        version: 1,
        status: 'invalidated',
        signed_by: 'integration-owner',
      },
      {
        version: 2,
        status: 'pending_signature',
        signed_by: null,
      },
    ]);
    expect(afterChange.rows[0].invalidated_at).not.toBeNull();

    const oldTask = await pool.query(
      'SELECT status FROM tasks WHERE id = $1',
      [taskV1.id],
    );
    expect(oldTask.rows[0].status).toBe('cancelled');

    const reconverge = await request(app)
      .patch(`/api/brain/golden-paths/${goldenPathId}`)
      .send({ status: 'converged' });
    expect(reconverge.status).toBe(200);

    const signV2 = await request(app)
      .post(`/api/brain/pending-actions/${submitV2.body.pending_action_id}/approve`)
      .send({ reviewer: 'integration-owner' });
    expect(signV2.status).toBe(200);
    const taskV2 = signV2.body.execution_result.task;
    expect(taskV2.id).not.toBe(taskV1.id);
    expect(taskV2.payload).toMatchObject({
      gp_contract_id: submitV2.body.contract_version.id,
      gp_contract_version: 2,
      gp_contract_hash: submitV2.body.contract_version.content_hash,
    });

    const finalRows = await pool.query(
      `SELECT version, status
         FROM golden_path_contract_versions
        WHERE golden_path_id = $1
        ORDER BY version`,
      [goldenPathId],
    );
    expect(finalRows.rows).toEqual([
      { version: 1, status: 'invalidated' },
      { version: 2, status: 'signed' },
    ]);
  });
});
