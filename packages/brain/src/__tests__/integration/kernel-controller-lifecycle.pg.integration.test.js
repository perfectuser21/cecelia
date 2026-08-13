/**
 * [BEHAVIOR] Controller / Kernel 生命周期隔离 + 无主 fail-closed 恢复 + 日志脱敏
 * （sprint 08131104 Harness 入口统一，issue 962d399c 无主 Kernel Run 修复）。
 *
 * 真 Postgres 集成——真 migrate（含 419）+ 真 createKernelRun + 真 finalizeKernelRun +
 * 真 kernel-controller-lifecycle（handleKernelProcessFatal / reconcileOwnerlessKernelRuns）。
 *
 * 禁 mock 边（合同「禁 mock 边清单」）：代码 ↔ initiative_runs（controller ownership/lease 写读）
 * 真 pool 连真 PG；createKernelRun / finalizeKernelRun / lifecycle 全真代码路径，禁 stub。
 * 本文件不含对 kernel-run-store / derive / ground-truth 被改边的 vi.mock（INV-1 机械 grep 核查）。
 *
 * 登记进 vitest.config.js 的 POSTGRES_INTEGRATION_TESTS，由 brain-integration job 起真 PG 跑。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createKernelRun } from '../../orchestrator/kernel-run-store.js';
import { writeHeartbeat } from '../../orchestrator/heartbeat.js';
import {
  handleKernelProcessFatal,
  reconcileOwnerlessKernelRuns,
  KERNEL_FATAL_REASON_PREFIX,
  OWNERLESS_RECOVERED_REASON_PREFIX,
} from '../../orchestrator/kernel-controller-lifecycle.js';
import {
  createRoutedKernelRun,
  seedRoutedKernelTask,
} from './helpers/routed-kernel-fixture.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^kernel_ctllife_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

async function createIsolatedDatabase() {
  databaseName = `kernel_ctllife_${process.pid}_${randomUUID().replaceAll('-', '')}`;
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
    await adminPool.query(
      'UPDATE pg_database SET datallowconn=false WHERE datname=$1',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
      [databaseName],
    ).catch(() => {});
    await adminPool.query(
      `DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`,
    ).catch(() => {});
  }
  if (adminPool) await adminPool.end().catch(() => {});
}

async function seedTask() {
  return seedRoutedKernelTask(testPool, {
    titlePrefix: 'kernel-ctllife',
    changeKind: 'bugfix',
  });
}

// 直接 INSERT 一个受管 run（模拟迁移前无主历史 / lease 过期），绕过 createKernelRun 的
// ownership 校验以构造无主态。真 PG 真行，供 reconciler 真扫描真收敛。
async function insertRawRun({
  taskId, initiativeId, phase = 'generate',
  controllerSessionId = null, leaseOffsetSeconds = null,
}) {
  if (controllerSessionId) {
    await testPool.query(
      `INSERT INTO kernel_controller_sessions
         (id,task_id,generation,source,status,last_heartbeat_at,lease_expires_at)
       VALUES ($1,$2,1,'integration','active',NOW(),
               NOW()+($3*INTERVAL '1 second'))`,
      [controllerSessionId,taskId,leaseOffsetSeconds ?? 1800],
    );
  }
  // enforce_v2_run_insert_identity() 触发器要求 v2 run 带 current_task_id + created_source；
  // 无主历史 run 用 historical_reconstruction（迁移前老数据语义），ownership 列刻意留空/过期。
  const { rows } = await testPool.query(
    `INSERT INTO initiative_runs (
       initiative_id, current_task_id, phase, orchestrator_version, created_source,
       deadline_at, controller_session_id, controller_generation, controller_lease_expires_at
     ) VALUES (
       $1, $2, $3, 'v2', 'historical_reconstruction',
       NOW() + INTERVAL '8 hours', $4, ${controllerSessionId ? '1' : 'NULL'},
       ${leaseOffsetSeconds == null ? 'NULL' : `NOW() + ($5 * INTERVAL '1 second')`}
     ) RETURNING id`,
    leaseOffsetSeconds == null
      ? [initiativeId, taskId, phase, controllerSessionId]
      : [initiativeId, taskId, phase, controllerSessionId, leaseOffsetSeconds],
  );
  if (controllerSessionId) {
    await testPool.query(
      'UPDATE kernel_controller_sessions SET run_id=$2 WHERE id=$1',
      [controllerSessionId,rows[0].id],
    );
  }
  return rows[0].id;
}

async function runRow(runId) {
  const { rows } = await testPool.query(
    `SELECT phase, failure_reason, controller_session_id
       FROM initiative_runs WHERE id = $1`,
    [runId],
  );
  return rows[0];
}

beforeAll(createIsolatedDatabase, 60_000);
afterAll(dropIsolatedDatabase, 30_000);

describe('Controller / Kernel 生命周期隔离 + 无主 fail-closed 恢复（真 PG）', () => {
  it('Kernel fatal 只结束 Kernel Controller 存活（失败回传结构化 failure_reason）', async () => {
    const { initiativeId, taskId } = await seedTask();
    const created = await createRoutedKernelRun(testPool, {
      taskId,
      initiativeId,
      phase: 'planning',
      journeyId: null,
      abilityId: null,
      host: 'kernel-v1',
      deadlineHours: 8,
      createdSource: 'kernel_dispatch',
    });

    const result = await handleKernelProcessFatal(testPool, {
      runId: created.run.id,
      expectedTaskId: taskId,
      failureCode: 'dependency_assembly_failed',
    });
    expect(result.controllerAlive).toBe(true);

    const row = await runRow(created.run.id);
    // Kernel run 结构化失败回传（可观测约定 kernel_process_fatal:<code>）
    expect(row.failure_reason).toBe(`${KERNEL_FATAL_REASON_PREFIX}:dependency_assembly_failed`);
    expect(row.failure_reason.length).toBeGreaterThan(0);
    // Controller ownership 记录存活（controller_session_id 未被 Kernel fatal 清除）
    expect(row.controller_session_id).toBe(created.run.controller_session_id);
  });

  it('failure_reason 结构化脱敏（不落 token/credential 明文）', async () => {
    const { initiativeId, taskId } = await seedTask();
    const controllerSessionId = randomUUID();
    const created = await createRoutedKernelRun(testPool, {
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

    const secret = 'SUPERSECRETVALUE12345';
    const result = await handleKernelProcessFatal(testPool, {
      runId: created.run.id,
      expectedTaskId: taskId,
      failureCode: `Bearer ${secret} token=${secret}`,
    });

    const row = await runRow(created.run.id);
    // 结构化前缀存在
    expect(row.failure_reason.startsWith(`${KERNEL_FATAL_REASON_PREFIX}:`)).toBe(true);
    // 脱敏：不含凭据明文
    expect(row.failure_reason).not.toContain(secret);
    expect(result.failureReason).not.toContain(secret);
  });

  it('Controller fatal Kernel 不无主 无主历史 fail-closed（无主判定 + 进恢复，不静默 done）', async () => {
    // (1) 迁移前无主历史 run：controller_session_id 为空
    const historyTask = await seedTask();
    const historyRun = await insertRawRun({
      taskId: historyTask.taskId,
      initiativeId: historyTask.initiativeId,
      phase: 'generate',
      controllerSessionId: null,
    });
    // (2) Controller fatal → lease 过期（controller_lease_expires_at < NOW() 且无存活 controller）
    const expiredTask = await seedTask();
    const expiredRun = await insertRawRun({
      taskId: expiredTask.taskId,
      initiativeId: expiredTask.initiativeId,
      phase: 'evaluate',
      controllerSessionId: randomUUID(),
      leaseOffsetSeconds: -600, // 过期 10 分钟
    });
    // (3) 健康 owned run：controller_session_id 有 + lease 未过期 → 不得被误伤
    const healthyTask = await seedTask();
    const healthyController = randomUUID();
    const healthyRun = await insertRawRun({
      taskId: healthyTask.taskId,
      initiativeId: healthyTask.initiativeId,
      phase: 'generate',
      controllerSessionId: healthyController,
      leaseOffsetSeconds: 1800, // 未来 30 分钟
    });

    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date() });
    const recoveredIds = recovered.map((r) => r.runId);

    // 两个无主 run 均被判无主并进恢复；健康 run 不在其中
    expect(recoveredIds).toContain(historyRun);
    expect(recoveredIds).toContain(expiredRun);
    expect(recoveredIds).not.toContain(healthyRun);

    // 无主 run fail-closed 收敛（phase=failed + 结构化恢复 reason），绝不静默停留 done/活跃
    const historyRowAfter = await runRow(historyRun);
    expect(historyRowAfter.phase).toBe('failed');
    expect(historyRowAfter.phase).not.toBe('done');
    expect(historyRowAfter.failure_reason.startsWith(`${OWNERLESS_RECOVERED_REASON_PREFIX}:`)).toBe(true);

    const expiredRowAfter = await runRow(expiredRun);
    expect(expiredRowAfter.phase).toBe('failed');
    expect(expiredRowAfter.failure_reason.startsWith(`${OWNERLESS_RECOVERED_REASON_PREFIX}:`)).toBe(true);

    // 健康 owned run 不被触碰
    const healthyRowAfter = await runRow(healthyRun);
    expect(healthyRowAfter.phase).toBe('generate');
    expect(healthyRowAfter.controller_session_id).toBe(healthyController);

    // 不存在无主的活跃 run 静默残留
    const { rows: stillOwnerless } = await testPool.query(
      `SELECT count(*)::int AS n
         FROM initiative_runs
        WHERE phase NOT IN ('done', 'failed')
          AND (controller_session_id IS NULL OR controller_lease_expires_at < NOW())`,
    );
    expect(stillOwnerless[0].n).toBe(0);
  });

  it('无主历史 Kernel Run fail-closed 进恢复（controller_session_id 为空的历史 run）', async () => {
    const { initiativeId, taskId } = await seedTask();
    const orphanRun = await insertRawRun({
      taskId, initiativeId, phase: 'planning', controllerSessionId: null,
    });

    const recovered = await reconcileOwnerlessKernelRuns(testPool, { now: new Date() });
    expect(recovered.map((r) => r.runId)).toContain(orphanRun);

    const row = await runRow(orphanRun);
    // 无静默 done：无主历史 run 一律 fail-closed 进恢复
    expect(row.phase).toBe('failed');
    expect(row.phase).not.toBe('done');
    expect(row.failure_reason.startsWith(`${OWNERLESS_RECOVERED_REASON_PREFIX}:`)).toBe(true);
  });

  it('心跳 CAS 续租可跨过扫描窗口，停止后并发扫描仅回收一次', async () => {
    const { initiativeId,taskId } = await seedTask();
    const created = await createRoutedKernelRun(testPool, {
      taskId,initiativeId,phase:'planning',journeyId:null,abilityId:null,
      host:'kernel-v1',deadlineHours:8,createdSource:'kernel_dispatch',
    });
    const now = new Date();
    await testPool.query(
      `UPDATE kernel_controller_sessions SET lease_expires_at=$2::timestamptz-INTERVAL '1 second'
        WHERE id=$1`,
      [created.run.controller_session_id,now],
    );
    await testPool.query(
      `UPDATE initiative_runs SET controller_lease_expires_at=$2::timestamptz-INTERVAL '1 second'
        WHERE id=$1`,
      [created.run.id,now],
    );
    await writeHeartbeat(testPool, {
      runId:created.run.id,controllerSessionId:created.run.controller_session_id,
      controllerGeneration:created.run.controller_generation,
      host:'integration',pid:process.pid,now,leaseSeconds:2,
    });
    const withinLease = await reconcileOwnerlessKernelRuns(testPool, {
      now:new Date(now.getTime()+1_000),
    });
    expect(withinLease).toEqual([]);
    expect((await runRow(created.run.id)).phase).toBe('planning');

    const expiredAt = new Date(now.getTime()+3_000);
    const [left,right] = await Promise.all([
      reconcileOwnerlessKernelRuns(testPool,{now:expiredAt}),
      reconcileOwnerlessKernelRuns(testPool,{now:expiredAt}),
    ]);
    expect([...left,...right].filter((row)=>row.runId===created.run.id)).toHaveLength(1);
    expect((await runRow(created.run.id)).phase).toBe('failed');
  });

  it('失权的 Controller 不能为新 generation 续租',async()=>{
    const {initiativeId,taskId}=await seedTask();
    const created=await createRoutedKernelRun(testPool,{taskId,initiativeId,phase:'planning',
      journeyId:null,abilityId:null,host:'kernel-v1',deadlineHours:8,createdSource:'kernel_dispatch'});
    const oldSession=created.run.controller_session_id;
    const replacement=randomUUID();
    await testPool.query(
      `INSERT INTO kernel_controller_sessions(id,run_id,task_id,generation,source,status,last_heartbeat_at,lease_expires_at)
       VALUES($1,$2,$3,2,'takeover','active',NOW(),NOW()-INTERVAL '1 second')`,
      [replacement,created.run.id,taskId],
    );
    await testPool.query(
      `UPDATE kernel_controller_sessions SET run_id=NULL,status='closed' WHERE id=$1`,
      [oldSession],
    );
    await testPool.query(
      `UPDATE initiative_runs SET controller_session_id=$2,controller_generation=2,
       controller_lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1`,
      [created.run.id,replacement],
    );
    await expect(writeHeartbeat(testPool,{runId:created.run.id,
      controllerSessionId:oldSession,controllerGeneration:1,host:'stale',pid:999,now:new Date()}))
      .rejects.toThrow('controller_lease_renewal_lost');
    const fresh=await testPool.query(
      'SELECT orchestrator_host,controller_lease_expires_at<NOW() AS expired FROM initiative_runs WHERE id=$1',
      [created.run.id],
    );
    expect(fresh.rows[0]).toMatchObject({expired:true});
    expect(fresh.rows[0].orchestrator_host).not.toBe('stale');
  });
});
