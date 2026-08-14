/**
 * [BEHAVIOR] Controller lease heartbeat 续租 + CAS fail-closed（真 PG，RED-1/2/3/5）
 * sprint 08132021-controller-lease-renewal-r2 —— run 60fa6c43 实证根因：
 *   heartbeat.js 的 UPDATE 从不延长 controller_lease_expires_at，心跳跨过 30m lease
 *   仍被 reconcileOwnerlessKernelRuns 当无主取消（Generator 034b5ca7 被杀）。
 *
 * 本文件是「禁 mock 边清单」的执法测试：代码 ↔ initiative_runs（controller lease 读写）
 * 走真 pg.Pool 连真 PostgreSQL；createKernelRun / writeHeartbeat / reconcileOwnerlessKernelRuns
 * 全真代码路径，禁 vi.mock('pg') / stub 被改的 DB 写边。30m 边界用注入 now 确定性跨越
 * （lease 默认 1800s，注入 now = 建 run + 31min 即已越界），不靠真实等待。
 *
 * TDD 顺序：
 *   Commit A（此文件）: 现网 writeHeartbeat 无 controllerSessionId 入参、不写 lease、
 *                       不返回 rowCount → 全部断言 FAIL（红证据）。
 *   Commit B（修复）:   writeHeartbeat 续租 CAS + GREATEST，测试转绿。
 *
 * 永久回归位（sprint frozen 版在 sprints/08132021-controller-lease-renewal-r2/tests/），
 * 登记进 packages/brain/vitest.config.js 的 POSTGRES_INTEGRATION_TESTS，
 * 由 CI brain-integration job 起真 PG 常驻跑。
 *
 * 禁止：vi.mock('pg') / jest.mock('pg') / stub writeHeartbeat / stub reconciler。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { runMigrations } from '../../migrate.js';
import {
  createKernelRun,
  finalizeKernelRun,
  CONTROLLER_LEASE_DEFAULT_SECONDS,
} from '../../orchestrator/kernel-run-store.js';
import { writeHeartbeat } from '../../orchestrator/heartbeat.js';
import { reconcileOwnerlessKernelRuns } from '../../orchestrator/kernel-controller-lifecycle.js';
import { runLoop } from '../../orchestrator/loop.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LEASE = CONTROLLER_LEASE_DEFAULT_SECONDS; // 1800（唯一 SSOT，禁止本文件另写死秒数）
const MIN = 60_000;

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_leaserenew_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_leaserenew_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1, statement_timeout: 10_000 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 10 });
}

async function dropIsolatedDatabase() {
  if (testPool) await testPool.end().catch(() => {});
  if (adminPool && databaseName) {
    await adminPool.query('UPDATE pg_database SET datallowconn=false WHERE datname=$1', [databaseName]).catch(() => {});
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`).catch(() => {});
  }
  if (adminPool) await adminPool.end().catch(() => {});
}

async function seedOwnedRun({ controllerSessionId }) {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [taskId, `kernel-leaserenew-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
  );
  const created = await createKernelRun(testPool, {
    taskId,
    initiativeId,
    phase: 'planning',
    journeyId: null,
    abilityId: null,
    host: 'kernel-v1',
    deadlineHours: 8,
    createdSource: 'kernel_dispatch',
    controllerSessionId,
  });
  return { runId: created.run.id, taskId, initiativeId };
}

async function seedHistoricalBlankRun(controllerSessionId) {
  const initiativeId = randomUUID();
  const taskId = randomUUID();
  await testPool.query(
    `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
     VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
    [taskId, `kernel-blank-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
  );
  const { rows } = await testPool.query(
    `INSERT INTO initiative_runs (
       initiative_id, current_task_id, phase, orchestrator_version, created_source,
       deadline_at, controller_session_id, controller_lease_expires_at
     ) VALUES (
       $1, $2, 'planning', 'v2', 'historical_reconstruction',
       NOW() + INTERVAL '8 hours', $3, NOW() + INTERVAL '1 hour'
     ) RETURNING id`,
    [initiativeId, taskId, controllerSessionId],
  );
  return { runId: rows[0].id, taskId };
}

async function leaseOf(runId) {
  const { rows } = await testPool.query(
    `SELECT r.controller_lease_expires_at, r.phase, r.failure_reason,
            t.status AS task_status
       FROM initiative_runs r
       JOIN tasks t ON t.id = r.current_task_id
      WHERE r.id = $1`,
    [runId],
  );
  return rows[0];
}

async function waitForBlockedFinalize() {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await testPool.query(
      `SELECT count(*)::int AS blocked
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND query LIKE '%SELECT id, status%'
          AND query LIKE '%FROM tasks%'
          AND query LIKE '%FOR UPDATE%'`,
    );
    if (rows[0].blocked > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('reconcile did not reach the blocked finalize boundary');
}

beforeAll(createIsolatedDatabase, 60_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('Controller lease heartbeat 续租 CAS（真 PG）', () => {
  it('RED-1: 正确 session 心跳跨过 30m 边界 → lease 随心跳前移、run 保持 active、reconcile 回收数=0', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);

    // 建 run 31 分钟后（已越过 30m/1800s 原始 lease）心跳一次
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1); // CAS 命中：正确 session + 活跃 phase

    const after = await leaseOf(runId);
    // GREATEST(existing, now+lease) → lease 前移到 now1 + LEASE，已晚于 now1（未过期）
    expect(Date.parse(after.controller_lease_expires_at)).toBe(now1.getTime() + LEASE * 1000);
    expect(Date.parse(after.controller_lease_expires_at)).toBeGreaterThan(now1.getTime());
    expect(after.phase).not.toBe('done');
    expect(after.phase).not.toBe('failed');

    // 心跳后紧接 reconcile（同一 now 语义）→ 该 run 不被判无主
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date(now1.getTime() + 1000) });
    expect(recovered.map((r) => r.runId)).not.toContain(runId);
  });

  it('RED-1b: lease 只增不减（GREATEST）——过去时刻心跳不得缩短已有租约', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const past = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 - 5 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: past, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1);
    const after = await leaseOf(runId);
    // now(past)+LEASE < 原 lease → GREATEST 保留原 lease，不回缩
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));
  });

  it('RED-2 + RED-5(mismatch): 错误 session 心跳 → CAS rowCount=0、lease 不动、无主 run 仍被 reconcile fail-closed 回收', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);

    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: 'forged-wrong-session',
    });
    expect(res.rowCount).toBe(0); // 伪造 session 不得续租

    const after = await leaseOf(runId);
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));

    // lease 已过期（now1 越界）且续租失败 → reconcile 仍把该无主 run fail-closed 回收
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date(now1.getTime() + 1000) });
    expect(recovered.map((r) => r.runId)).toContain(runId);
    const reclaimed = await leaseOf(runId);
    expect(reclaimed.phase).toBe('failed');
  });

  it('RED-3: phase=failed 的 run 心跳 → rowCount=0，lease 不复活', async () => {
    const session = randomUUID();
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    await finalizeKernelRun(testPool, {
      runId, expectedTaskId: taskId, outcome: 'failed', reason: 'test_terminal',
    });

    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(0); // 终态 run 不得被心跳复活

    const after = await leaseOf(runId);
    expect(after.phase).toBe('failed');
    expect(Date.parse(after.controller_lease_expires_at)).toBe(Date.parse(before.controller_lease_expires_at));
  });

  it('RED-3b: leaseSeconds 复用单一 SSOT——省略 leaseSeconds 时续租默认用 CONTROLLER_LEASE_DEFAULT_SECONDS', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const before = await leaseOf(runId);
    const now1 = new Date(Date.parse(before.controller_lease_expires_at) - LEASE * 1000 + 31 * MIN);
    const res = await writeHeartbeat(testPool, {
      runId, host: 'kernel-v1', pid: 4242, now: now1, controllerSessionId: session,
    });
    expect(res.rowCount).toBe(1);
    const after = await leaseOf(runId);
    expect(Date.parse(after.controller_lease_expires_at)).toBe(now1.getTime() + CONTROLLER_LEASE_DEFAULT_SECONDS * 1000);
  });

  it('RACE-A: reconcile 旧快照无权终结随后已被正确 heartbeat 续租的 run', async () => {
    const session = randomUUID();
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const reconcileNow = new Date();
    await testPool.query(
      `UPDATE initiative_runs
          SET controller_lease_expires_at = $2
        WHERE id = $1`,
      [runId, new Date(reconcileNow.getTime() - MIN)],
    );

    const blocker = await testPool.connect();
    let reconcilePromise;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM tasks WHERE id = $1 FOR UPDATE', [taskId]);

      reconcilePromise = reconcileOwnerlessKernelRuns(testPool, { now: reconcileNow });
      await waitForBlockedFinalize();

      const heartbeatAt = new Date(reconcileNow.getTime() + MIN);
      const heartbeat = await writeHeartbeat(testPool, {
        runId,
        host: 'kernel-race-heartbeat-wins',
        pid: 4242,
        now: heartbeatAt,
        controllerSessionId: session,
      });
      expect(heartbeat.rowCount).toBe(1);

      await blocker.query('COMMIT');
      const recovered = await reconcilePromise;
      const after = await leaseOf(runId);

      expect(recovered.map((row) => row.runId)).not.toContain(runId);
      expect(Date.parse(after.controller_lease_expires_at)).toBeGreaterThan(reconcileNow.getTime());
      expect(after.phase).toBe('planning');
      expect(after.task_status).toBe('in_progress');
      expect(after.failure_reason).toBeNull();
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
      await reconcilePromise?.catch(() => {});
    }
  });

  it('RACE-A reverse: reconcile 先终结时随后的正确 heartbeat 不得复活 run', async () => {
    const session = randomUUID();
    const { runId } = await seedOwnedRun({ controllerSessionId: session });
    const reconcileNow = new Date();
    await testPool.query(
      `UPDATE initiative_runs
          SET controller_lease_expires_at = $2
        WHERE id = $1`,
      [runId, new Date(reconcileNow.getTime() - MIN)],
    );

    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: reconcileNow });
    expect(recovered.map((row) => row.runId)).toContain(runId);

    const heartbeat = await writeHeartbeat(testPool, {
      runId,
      host: 'kernel-race-reconcile-wins',
      pid: 4242,
      now: new Date(reconcileNow.getTime() + MIN),
      controllerSessionId: session,
    });
    const after = await leaseOf(runId);

    expect(heartbeat.rowCount).toBe(0);
    expect(after.phase).toBe('failed');
    expect(after.task_status).toBe('failed');
  });

  it('OWNERSHIP-B: 错误 session 在首次 collect/append/dispatch 前失败并零业务动作', async () => {
    const session = randomUUID();
    const { runId, taskId } = await seedOwnedRun({ controllerSessionId: session });
    const collect = vi.fn(async () => ({
      run: { id: runId, phase: 'planning', cost_usd: 0 },
      task: { id: taskId, status: 'in_progress' },
      prdExists: false,
      contract: { approved: false, id: null },
      pr: null,
      inflight: { containers: [], host_pids: [], attempts: [] },
      lastAgentExit: { code: null, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: false,
      evaluateVerdict: null,
      judgeVerdict: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog: [],
      authCircuit: [],
      callbackResult: null,
    }));
    const append = vi.fn(async () => {});
    const dispatch = vi.fn(async () => ({ status: 'DONE', detail: 'must-not-run' }));
    let hop = 0;

    const result = await runLoop({
      pool: testPool,
      collectGroundTruth: collect,
      appendHop: append,
      nextHop: vi.fn(async () => ++hop),
      dispatch,
      sleep: vi.fn(async () => {}),
      now: () => new Date(),
      host: 'kernel-wrong-owner',
      pid: 4242,
      log: vi.fn(),
    }, {
      taskId,
      runId,
      controllerSessionId: 'forged-wrong-session',
    });

    const { rows } = await testPool.query(
      `SELECT orchestrator_heartbeat_at, phase
         FROM initiative_runs
        WHERE id = $1`,
      [runId],
    );
    expect(result).toEqual({ exitReason: 'controller_lease_lost', hops: 0 });
    expect(collect).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(rows[0].orchestrator_heartbeat_at).toBeNull();
    expect(rows[0].phase).toBe('planning');
  });

  it('MIGRATION-C: 历史空串/空白 ownership 归一为 NULL 并验证非空白 CHECK', async () => {
    await testPool.query(
      'ALTER TABLE initiative_runs DROP CONSTRAINT IF EXISTS initiative_runs_controller_session_nonblank_check',
    );
    await testPool.query("DELETE FROM schema_version WHERE version = '416'");
    const historical = [
      await seedHistoricalBlankRun(''),
      await seedHistoricalBlankRun('   '),
    ];

    const applied = await runMigrations(testPool);
    const { rows } = await testPool.query(
      `SELECT id, controller_session_id
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [historical.map(({ runId }) => runId)],
    );
    const { rows: constraints } = await testPool.query(
      `SELECT convalidated
         FROM pg_constraint
        WHERE conrelid = 'initiative_runs'::regclass
          AND conname = 'initiative_runs_controller_session_nonblank_check'`,
    );

    expect(applied).toContain('416');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.controller_session_id === null)).toBe(true);
    expect(constraints).toEqual([{ convalidated: true }]);
  });

  it('NEW-WRITE-C: 数据库权威边拒绝新写入空串或纯空白 ownership', async () => {
    const errors = [];
    for (const blankSession of ['', '   ']) {
      const initiativeId = randomUUID();
      const taskId = randomUUID();
      await testPool.query(
        `INSERT INTO tasks (id, title, status, priority, task_type, trigger_source, payload)
         VALUES ($1, $2, 'in_progress', 'P2', 'harness_initiative', 'api', $3::jsonb)`,
        [taskId, `kernel-blank-write-${taskId}`, JSON.stringify({ initiative_id: initiativeId })],
      );
      try {
        await testPool.query(
          `INSERT INTO initiative_runs (
             initiative_id, current_task_id, phase, orchestrator_version, created_source,
             deadline_at, controller_session_id, controller_lease_expires_at
           ) VALUES (
             $1, $2, 'planning', 'v2', 'historical_reconstruction',
             NOW() + INTERVAL '8 hours', $3, NOW() + INTERVAL '1 hour'
           )`,
          [initiativeId, taskId, blankSession],
        );
        errors.push(null);
        await testPool.query('DELETE FROM initiative_runs WHERE current_task_id = $1', [taskId]);
      } catch (error) {
        errors.push(error.code);
      }
    }
    expect(errors).toEqual(['23514', '23514']);
  });

  it('BLANK-C: rollout 中的空串/空白行不能 heartbeat 续命且未过期 lease 也被 reconcile 收敛', async () => {
    // 模拟应用代码先于 migration 416 到达的生产滚动窗口。
    await testPool.query(
      'ALTER TABLE initiative_runs DROP CONSTRAINT IF EXISTS initiative_runs_controller_session_nonblank_check',
    );
    const historical = [
      { session: '', ...(await seedHistoricalBlankRun('')) },
      { session: '   ', ...(await seedHistoricalBlankRun('   ')) },
    ];

    const heartbeatRows = [];
    for (const row of historical) {
      const heartbeat = await writeHeartbeat(testPool, {
        runId: row.runId,
        host: 'kernel-blank-owner',
        pid: 4242,
        now: new Date(),
        controllerSessionId: row.session,
      });
      heartbeatRows.push(heartbeat.rowCount);
    }
    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date() });
    const recoveredIds = recovered.map((row) => row.runId);
    const { rows } = await testPool.query(
      `SELECT id, phase, orchestrator_heartbeat_at
         FROM initiative_runs
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [historical.map(({ runId }) => runId)],
    );

    expect(heartbeatRows).toEqual([0, 0]);
    expect(historical.every(({ runId }) => recoveredIds.includes(runId))).toBe(true);
    expect(rows.every((row) => row.phase === 'failed')).toBe(true);
    expect(rows.every((row) => row.orchestrator_heartbeat_at === null)).toBe(true);
  });
});
