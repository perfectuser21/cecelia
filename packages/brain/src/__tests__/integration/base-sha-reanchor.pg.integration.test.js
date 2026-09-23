import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import {
  HAS_ANY_RUN_SQL,
  reanchorReceiptIfEmptyBranch,
} from '../../orchestrator/preflight/base-sha-reanchor.js';
import { seedOwnedActiveV2Run } from './helpers/controller-authority-fixture.js';
import { seedRoutedKernelTask } from './helpers/routed-kernel-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
// routed-kernel-fixture 种的收据锚在 'a'*40；地图 revision 用 'b'*40 制造可快进的落差。
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
let adminPool;
let pool;
let databaseName;

function quoteIdentifier(value) {
  if (!/^reanchor_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database name');
  return `"${value}"`;
}

function freshMap(revision = NEW) {
  return {
    projection_run_id: null,
    freshness: {
      status: 'fresh',
      repos: { cecelia: { status: 'fresh', source_revision: revision } },
    },
  };
}

function seedTask() {
  // helper 只把 base_sha 写进收据 evidence；生产的 createRoutedTask 会同时投影进 payload，
  // 补上它才验得了「快进前后 payload.base_sha 怎么动」。
  return seedRoutedKernelTask(pool, {
    titlePrefix: 'reanchor', mapScope: ['F1'], payload: { base_sha: OLD },
  });
}

// 接班收据的复制式直插：绕过模块，只动 DB，用来验触发器/唯一键本身。
const CLONE_SUCCESSOR_SQL = `
  INSERT INTO work_routing_receipts(
    id,task_id,source,source_id,work_kind,change_kind,pipeline,
    canonical_task_type,default_execution_profile,execution_profile_override,
    repo,map_scope,impact_contract_required,orchestrator,router_version,
    route_reason,evidence,map_scope_validation_version,direct_contract_seed,
    supersedes_receipt_id,anchor_generation
  ) SELECT gen_random_uuid(),task_id,source,source_id,work_kind,change_kind,pipeline,
    canonical_task_type,default_execution_profile,execution_profile_override,
    repo,map_scope,impact_contract_required,orchestrator,router_version,
    route_reason,evidence,map_scope_validation_version,direct_contract_seed,
    id,$2 FROM work_routing_receipts WHERE id=$1
  RETURNING id`;

async function loadLocked(client, taskId, receiptId) {
  const { rows: taskRows } = await client.query(
    'SELECT id, task_type, status, payload, metadata FROM tasks WHERE id=$1 FOR UPDATE',
    [taskId],
  );
  const { rows: receiptRows } = await client.query(
    `SELECT receipt.*,
            EXISTS (
              SELECT 1 FROM work_routing_receipts s WHERE s.supersedes_receipt_id = receipt.id
            ) AS superseded,
            -- 故意恒为 false：生产 loader 查到 v2 run 会让模块在这一列上先行短路，
            -- 那条路径永远盖不到模块自己的 initiative_runs EXISTS 探测。置 false 才能
            -- 把 needs_rebase 的判定压到真 DB 查询上（用例 4 验的就是它）。
            false AS has_v2_run
       FROM work_routing_receipts receipt WHERE receipt.id=$1`,
    [receiptId],
  );
  return { task: taskRows[0], receipt: receiptRows[0] };
}

beforeAll(async () => {
  databaseName = `reanchor_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
}, 120_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

describe.sequential('base_sha reanchor against real PostgreSQL（任务 d9c405e2）', () => {
  it('同事务 INSERT 接班收据 → UPDATE payload：421 触发器放行，gen=2 且 supersedes 指向旧收据', async () => {
    const { taskId, receiptId } = await seedTask();
    const client = await pool.connect();
    let successor;
    try {
      await client.query('BEGIN');
      const { task, receipt } = await loadLocked(client, taskId, receiptId);
      successor = await reanchorReceiptIfEmptyBranch(client, {
        task, receipt, map: freshMap(), now: new Date(), createdSource: 'kernel_dispatch',
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    expect(successor).toMatchObject({
      anchor_generation: 2, supersedes_receipt_id: receiptId, base_sha: NEW,
    });
    const persisted = await pool.query(
      `SELECT r.anchor_generation, r.supersedes_receipt_id, r.evidence, t.payload, t.metadata
         FROM work_routing_receipts r JOIN tasks t ON t.id=r.task_id
        WHERE r.id=$1`,
      [successor.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      anchor_generation: 2,
      supersedes_receipt_id: receiptId,
      evidence: expect.objectContaining({
        base_sha: NEW, prev_base_sha: OLD, branch: expect.stringMatching(/^cp-reanchor-/),
      }),
      payload: expect.objectContaining({ routing_receipt_id: successor.id, base_sha: NEW }),
      metadata: expect.objectContaining({ base_sha_fastforward_count: 1 }),
    });
    const taskEvents = await pool.query(
      "SELECT event_type FROM task_events WHERE task_id=$1 AND event_type='base_sha_reanchored'",
      [taskId],
    );
    expect(taskEvents.rowCount).toBe(1);
    const busEvents = await pool.query(
      `SELECT source, payload FROM cecelia_events
        WHERE event_type='work_route_reanchored' AND payload->>'task_id'=$1::text`,
      [taskId],
    );
    expect(busEvents.rowCount).toBe(1);
    expect(busEvents.rows[0].source).toBe('work-router');
    expect(busEvents.rows[0].payload).toMatchObject({
      old_receipt_id: receiptId, new_receipt_id: successor.id, new_base_sha: NEW,
    });
  });

  it('只 INSERT 接班收据不同步 payload → 421 触发器把该任务的 payload 写入全部拒掉', async () => {
    const { taskId, receiptId } = await seedTask();
    // 对照组：接班收据还没插，投影与唯一收据一致，同样的写法必须过 421。
    const before = await pool.query(
      "UPDATE tasks SET payload = payload || '{\"probe\":0}'::jsonb WHERE id=$1",
      [taskId],
    );
    expect(before.rowCount).toBe(1);

    const successor = await pool.query(CLONE_SUCCESSOR_SQL, [receiptId, 2]);
    const successorId = successor.rows[0].id;
    // 投影仍指向旧收据：421 按「最新收据」比对 routing_receipt_id，任何 payload 写入都被拒。
    await expect(pool.query(
      "UPDATE tasks SET payload = payload || '{\"probe\":1}'::jsonb WHERE id=$1",
      [taskId],
    )).rejects.toMatchObject({
      message: expect.stringContaining('work_routing_task_projection_immutable'),
    });
    const still = await pool.query(
      `SELECT payload->>'routing_receipt_id' AS rid, payload->>'base_sha' AS base_sha,
              payload->>'probe' AS probe
         FROM tasks WHERE id=$1`,
      [taskId],
    );
    expect(still.rows[0]).toEqual({ rid: receiptId, base_sha: OLD, probe: '0' });
    // 把投影对齐到接班收据（模块在同事务里做的那一步）后，同样的写入立刻放行。
    await pool.query(
      'UPDATE tasks SET payload = payload || $2::jsonb WHERE id=$1',
      [taskId, JSON.stringify({ routing_receipt_id: successorId, base_sha: NEW, probe: 1 })],
    );
    const aligned = await pool.query(
      "SELECT payload->>'routing_receipt_id' AS rid FROM tasks WHERE id=$1",
      [taskId],
    );
    expect(aligned.rows[0].rid).toBe(successorId);
  });

  it('同一旧收据二次接班 → 465 唯一键 23505；模块入口先以 receipt_superseded 拒绝', async () => {
    const { taskId, receiptId } = await seedTask();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const first = await loadLocked(client, taskId, receiptId);
      await reanchorReceiptIfEmptyBranch(client, {
        task: first.task, receipt: first.receipt, map: freshMap(), now: new Date(),
      });
      await client.query('COMMIT');
      await client.query('BEGIN');
      const again = await loadLocked(client, taskId, receiptId);
      expect(again.receipt.superseded).toBe(true);
      await expect(reanchorReceiptIfEmptyBranch(client, {
        task: again.task, receipt: again.receipt, map: freshMap('c'.repeat(40)), now: new Date(),
      })).rejects.toMatchObject({ code: 'receipt_superseded' });
    } finally {
      // 事务可能已被 abort：不 ROLLBACK 就把坏连接还回池子，后续用例全被 25P02 连坐。
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    // gen=3 在四列键 (source,source_id,router_version,anchor_generation) 上还是空位，
    // 撞的是 465 的 supersedes 唯一键——同一张旧收据只许被接班一次，分叉链插不进来。
    await expect(pool.query(CLONE_SUCCESSOR_SQL, [receiptId, 3])).rejects.toMatchObject({
      code: '23505',
      constraint: 'work_routing_receipts_supersedes_unique',
    });
  });

  it('已有 initiative_runs → needs_rebase 且零写库', async () => {
    const { taskId, receiptId, initiativeId } = await seedTask();
    await seedOwnedActiveV2Run(pool, { taskId, initiativeId });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { task, receipt } = await loadLocked(client, taskId, receiptId);
      await expect(reanchorReceiptIfEmptyBranch(client, {
        task, receipt, map: freshMap(), now: new Date(),
      })).rejects.toMatchObject({ code: 'needs_rebase' });
      // 「零写库」必须在同一事务内、ROLLBACK 之前查：等回滚完再数，数的是回滚后的库，
      // 那样连「先写了再被回滚掉」都看不出来，断言等于白给。
      const inTx = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM work_routing_receipts WHERE task_id=$1) AS receipts,
           (SELECT COUNT(*)::int FROM task_events
             WHERE task_id=$1 AND event_type='base_sha_reanchored') AS task_events,
           (SELECT COUNT(*)::int FROM cecelia_events
             WHERE event_type='work_route_reanchored' AND payload->>'task_id'=$1::text) AS bus_events`,
        [taskId],
      );
      expect(inTx.rows[0]).toEqual({ receipts: 1, task_events: 0, bus_events: 0 });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  it('initiative_runs 产出探测两侧都走索引（465 idx_initiative_runs_current_task / 238 idx_initiative_runs_initiative）', async () => {
    // 空表规划器必选 Seq Scan（一页扫完最便宜），先灌占位行 + ANALYZE 才谈得上"走没走索引"。
    // 377 的 INSERT 触发器每行取两把 advisory xact lock，整批一条语句会撞
    // max_locks_per_transaction，故按 200 行一语句（= 一事务）分批灌。
    for (let batch = 0; batch < 10; batch += 1) {
      await pool.query(
        `INSERT INTO initiative_runs(id,initiative_id,phase,orchestrator_version)
         SELECT gen_random_uuid(),gen_random_uuid(),'planning','v1'
           FROM generate_series(1,200)`,
      );
    }
    await pool.query('ANALYZE initiative_runs');
    // 直接拼模块导出的 SQL 真身：验的计划与跑的查询是同一份文本。
    const plan = await pool.query(
      `EXPLAIN (FORMAT JSON) ${HAS_ANY_RUN_SQL}`,
      [randomUUID()],
    );
    const text = JSON.stringify(plan.rows[0]['QUERY PLAN']);
    expect(text).toContain('idx_initiative_runs_current_task');
    expect(text).toContain('idx_initiative_runs_initiative');
    expect(text).not.toContain('"Seq Scan"');
  });
});
