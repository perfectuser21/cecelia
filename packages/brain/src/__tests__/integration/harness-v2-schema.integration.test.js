/**
 * Harness v2 M1 Schema Integration Test
 *
 * 验证 migration 236-239 的效果：
 * 1. 三张新表存在 + 关键列类型正确
 * 2. 各 CHECK 约束生效（status / phase / edge_type / 自环）
 * 3. UNIQUE(initiative_id, version) 生效
 * 4. tasks.task_type 接受三个新类型 + 老类型仍然接受
 *
 * 所有 INSERT 包裹在 BEGIN/ROLLBACK 事务内，不污染共享 DB。
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

let pool;

beforeAll(async () => {
  vi.resetModules();
  pool = (await import('../../db.js')).default;
});

describe('Harness v2 M1 schema: tables exist', () => {
  it('initiative_contracts table exists', async () => {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='initiative_contracts'`
    );
    expect(r.rows).toHaveLength(1);
  });

  it('task_dependencies table exists', async () => {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='task_dependencies'`
    );
    expect(r.rows).toHaveLength(1);
  });

  it('initiative_runs table exists', async () => {
    const r = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='initiative_runs'`
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe('Harness v2 M1 schema: column types', () => {
  it('initiative_contracts.budget_cap_usd is numeric', async () => {
    const r = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='initiative_contracts' AND column_name='budget_cap_usd'`
    );
    expect(r.rows[0].data_type).toBe('numeric');
  });

  it('initiative_contracts.e2e_acceptance is jsonb', async () => {
    const r = await pool.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name='initiative_contracts' AND column_name='e2e_acceptance'`
    );
    expect(r.rows[0].data_type).toBe('jsonb');
  });

  it('initiative_runs.merged_task_ids is uuid array', async () => {
    const r = await pool.query(
      `SELECT data_type, udt_name FROM information_schema.columns
       WHERE table_name='initiative_runs' AND column_name='merged_task_ids'`
    );
    expect(r.rows[0].data_type).toBe('ARRAY');
    expect(r.rows[0].udt_name).toBe('_uuid');
  });

  it('task_dependencies has edge_type with default hard', async () => {
    const r = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='task_dependencies' AND column_name='edge_type'`
    );
    expect(r.rows[0].column_default).toMatch(/'hard'/);
  });
});

describe('Harness v2 M1 schema: CHECK constraints', () => {
  it('initiative_contracts rejects invalid status', async () => {
    const initiativeId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO initiative_contracts(initiative_id, status) VALUES ($1, 'invalid')`,
        [initiativeId]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('initiative_contracts accepts draft/approved/superseded', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const status of ['draft', 'approved', 'superseded']) {
        const initId = randomUUID();
        await client.query(
          `INSERT INTO initiative_contracts(initiative_id, version, status) VALUES ($1, 1, $2)`,
          [initId, status]
        );
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('initiative_contracts UNIQUE(initiative_id, version) enforced', async () => {
    const client = await pool.connect();
    const initId = randomUUID();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO initiative_contracts(initiative_id, version) VALUES ($1, 1)`,
        [initId]
      );
      await expect(
        client.query(
          `INSERT INTO initiative_contracts(initiative_id, version) VALUES ($1, 1)`,
          [initId]
        )
      ).rejects.toThrow(/duplicate|unique/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('initiative_runs rejects invalid phase', async () => {
    const initId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO initiative_runs(initiative_id, phase) VALUES ($1, 'invalid_phase')`,
        [initId]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('initiative_runs accepts all five phases', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const phase of ['A_contract', 'B_task_loop', 'C_final_e2e', 'done', 'failed']) {
        const initId = randomUUID();
        await client.query(
          `INSERT INTO initiative_runs(initiative_id, phase) VALUES ($1, $2)`,
          [initId, phase]
        );
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('task_dependencies rejects self-loop', async () => {
    const taskId = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO task_dependencies(from_task_id, to_task_id) VALUES ($1, $1)`,
        [taskId]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('task_dependencies rejects invalid edge_type', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await expect(
      pool.query(
        `INSERT INTO task_dependencies(from_task_id, to_task_id, edge_type) VALUES ($1, $2, 'maybe')`,
        [a, b]
      )
    ).rejects.toThrow(/check constraint/i);
  });

  it('task_dependencies accepts hard/soft', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const edge of ['hard', 'soft']) {
        await client.query(
          `INSERT INTO task_dependencies(from_task_id, to_task_id, edge_type) VALUES ($1, $2, $3)`,
          [randomUUID(), randomUUID(), edge]
        );
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('Harness v2 M1 schema: tasks.task_type extension', () => {
  const newTypes = ['harness_initiative', 'harness_task', 'harness_final_e2e'];

  for (const t of newTypes) {
    it(`tasks accepts new task_type: ${t}`, async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO tasks(id, title, task_type, status, priority) VALUES (gen_random_uuid(), 'test-' || $1, $1, 'queued', 'P2')`,
          [t]
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });
  }

  it('tasks still accepts legacy harness_planner (backward compat)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks(id, title, task_type, status, priority) VALUES (gen_random_uuid(), 'legacy', 'harness_planner', 'queued', 'P2')`
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('tasks still accepts legacy dev (backward compat)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tasks(id, title, task_type, status, priority) VALUES (gen_random_uuid(), 'legacy-dev', 'dev', 'queued', 'P2')`
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('tasks rejects bogus task_type', async () => {
    await expect(
      pool.query(
        `INSERT INTO tasks(id, title, task_type, status, priority) VALUES (gen_random_uuid(), 'bogus', 'this_does_not_exist', 'queued', 'P2')`
      )
    ).rejects.toThrow(/check constraint/i);
  });
});
