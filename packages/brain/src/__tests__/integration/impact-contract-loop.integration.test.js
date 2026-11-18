import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import pool from '../../db.js';
import impactContracts from '../../routes/impact-contracts.js';

afterAll(() => pool.end());

it('实际任务与提交的变更类型冲突时，HTTP 入口拒绝写入影响合同', async () => {
  const id = randomUUID();
  const app = express();
  app.use(express.json());
  app.use('/api/brain', impactContracts);
  await pool.query(
    `INSERT INTO tasks(id, title, task_type, status, priority, payload)
     VALUES ($1, 'impact contract mismatch', 'dev', 'queued', 'P1', '{"change_kind":"bugfix"}')`,
    [id],
  );
  try {
    const response = await request(app).post(`/api/brain/tasks/${id}/impact-contract`).send({
      change_kind: 'capability_change',
      repo: 'perfectuser21/cecelia',
      base_revision: 'a'.repeat(40),
      affected_capabilities: [{ capability_id: 'brain' }],
      required_assertions: [],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body).toMatchObject({
      gate: 'blocked', reason: 'change_kind_mismatch', expected: 'bugfix', received: 'capability_change',
    });
    const contracts = await pool.query('SELECT id FROM harness_impact_contracts WHERE task_id=$1', [id]);
    expect(contracts.rows).toEqual([]);
  } finally {
    await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
  }
});
